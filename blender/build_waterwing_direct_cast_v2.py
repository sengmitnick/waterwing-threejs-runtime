"""Build the volume-safe Waterwing direct-cast v2 action and projectile."""

from __future__ import annotations

import argparse
import json
import math
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_waterwing_direct_cast_v1 import (  # noqa: E402
    combined_world_bounds,
    create_lobed_revolution,
    three_bounds,
)
from build_waterwing_forward_v1 import (  # noqa: E402
    assign_skin_weights,
    bind_anchors_and_core,
    bind_object_to_bone,
    blender_to_three,
    body_thickness,
    configure_animation_curves,
    configure_scene,
    create_anchors,
    create_armature,
    create_root,
    create_water_materials,
    create_weak_core,
    export_glb,
    reset_scene,
    save_blend,
    set_input,
    sha256_file,
    smoothstep,
    tail_blend,
    world_bounds,
)
from waterwing_direct_cast_v2_config import (  # noqa: E402
    ASSET_VERSION,
    CHARGE_NODES,
    CLIP_NAME,
    DEFAULT_BLEND_PATH,
    DEFAULT_GLB_PATH,
    DEFAULT_MANIFEST_PATH,
    DEFAULT_PROJECTILE_BLEND_PATH,
    DEFAULT_PROJECTILE_GLB_PATH,
    DEFAULT_PROJECTILE_MANIFEST_PATH,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_CLIP_NAME,
    MORPH_NAMES,
    PHASES,
    PROJECTILE_ANCHORS,
    PROJECTILE_MESHES,
    PROJECTILE_ROOT,
    PROJECTILE_VERSION,
)
from waterwing_forward_v1_config import (  # noqa: E402
    ANCHOR_NAMES,
    BODY_NAME,
    CORE_NAME,
    RIG_NAME,
    RING_SEGMENTS,
    Y_MAX,
)


BONE_ROTATION_LIMIT = 0.075
DOMINANT_MORPH_THRESHOLD = 0.25
MAX_DOMINANT_MORPHS = 3
CAST_Y_MIN = -2.86
CAST_LONGITUDINAL_SEGMENTS = 96
CAST_RING_SEGMENTS = 128
CAST_OUTLINE_STATIONS = (
    (-2.86, 0.18),
    (-2.72, 0.38),
    (-2.56, 0.86),
    (-2.34, 1.40),
    (-2.02, 2.45),
    (-1.54, 3.48),
    (-0.92, 3.94),
    (-0.28, 4.10),
    (0.34, 3.82),
    (0.94, 3.16),
    (1.46, 2.14),
    (1.84, 1.04),
    (2.08, 0.42),
    (2.44, 0.27),
    (2.82, 0.39),
    (3.18, 0.58),
    (3.52, 0.52),
    (3.82, 0.30),
    (4.18, 0.02),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--output-glb", type=Path, default=DEFAULT_GLB_PATH)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    parser.add_argument("--projectile-blend", type=Path, default=DEFAULT_PROJECTILE_BLEND_PATH)
    parser.add_argument("--projectile-glb", type=Path, default=DEFAULT_PROJECTILE_GLB_PATH)
    parser.add_argument("--projectile-manifest", type=Path, default=DEFAULT_PROJECTILE_MANIFEST_PATH)
    return parser.parse_args(argv)


def configure_action_scene() -> None:
    scene = bpy.context.scene
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    scene.render.fps_base = 1.0


def cast_station_value(y: float) -> float:
    if y <= CAST_OUTLINE_STATIONS[0][0]:
        return CAST_OUTLINE_STATIONS[0][1]
    if y >= CAST_OUTLINE_STATIONS[-1][0]:
        return CAST_OUTLINE_STATIONS[-1][1]
    for (y0, value0), (y1, value1) in zip(CAST_OUTLINE_STATIONS, CAST_OUTLINE_STATIONS[1:]):
        if y0 <= y <= y1:
            phase = smoothstep((y - y0) / (y1 - y0))
            return value0 + (value1 - value0) * phase
    raise AssertionError(f"unhandled cast longitudinal position {y}")


def cast_shape_context(co: Vector) -> tuple[float, float, float, float, float, float, float]:
    x, y, z = co
    width = cast_station_value(y)
    span = min(1.0, abs(x) / max(width, 1e-5))
    wing_gate = (1.0 - smoothstep((y - 1.40) / 0.55)) * smoothstep((abs(x) - 0.44) / 0.72)
    body_gate = math.exp(-((abs(x) / 1.05) ** 2.0)) * (1.0 - smoothstep((y - 1.25) / 0.8))
    tail_gate = smoothstep((y - 1.55) / 0.82)
    return x, y, z, span, max(0.0, wing_gate), max(0.0, body_gate), max(0.0, tail_gate)


def local_midline(x: float, y: float) -> float:
    width = cast_station_value(y)
    span = min(1.0, abs(x) / max(width, 1e-5))
    tail_amount = tail_blend(y)
    front_blend = smoothstep((y - CAST_Y_MIN) / 0.56)
    wing_lift = front_blend * (
        0.54
        * span**2.35
        * (1.0 - tail_amount)
        * (0.86 + 0.14 * math.cos((y + 0.35) * 1.25))
    )
    dorsal_bias = 0.05 * math.exp(-((abs(x) / 0.82) ** 2.0))
    return wing_lift + dorsal_bias


def append_elliptical_ring(
    vertices: list[tuple[float, float, float]],
    count: int,
    y: float,
    x_radius: float,
    z_radius: float,
    z_center: float,
) -> int:
    start = len(vertices)
    for segment in range(count):
        theta = math.tau * segment / count
        vertices.append((x_radius * math.cos(theta), y, z_center + z_radius * math.sin(theta)))
    return start


def bridge_ring_pair(
    faces: list[tuple[int, ...]],
    inner_start: int,
    inner_count: int,
    outer_start: int,
    outer_count: int,
) -> None:
    assert outer_count % inner_count == 0
    ratio = outer_count // inner_count
    for inner_index in range(inner_count):
        current_inner = inner_start + inner_index
        next_inner = inner_start + (inner_index + 1) % inner_count
        outer_group_start = inner_index * ratio
        outer_group_end = (inner_index + 1) * ratio
        for outer_index in range(outer_group_start, outer_group_end):
            current_outer = outer_start + outer_index % outer_count
            next_outer = outer_start + (outer_index + 1) % outer_count
            faces.append((current_inner, current_outer, next_outer))
        boundary_outer = outer_start + outer_group_end % outer_count
        faces.append((current_inner, next_inner, boundary_outer))


def connect_equal_rings(
    faces: list[tuple[int, ...]],
    ring_a: int,
    ring_b: int,
    count: int,
) -> None:
    for segment in range(count):
        next_segment = (segment + 1) % count
        faces.append((
            ring_a + segment,
            ring_b + segment,
            ring_b + next_segment,
            ring_a + next_segment,
        ))


def create_cast_body_loft_v2(name: str = BODY_NAME) -> bpy.types.Object:
    """Create a rounded multi-ring nose instead of the old rigid fan cap."""

    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    ring16 = append_elliptical_ring(vertices, 16, -3.140, 0.008, 0.008, 0.030)
    ring32 = append_elliptical_ring(vertices, 32, -3.125, 0.018, 0.018, 0.030)
    ring64 = append_elliptical_ring(vertices, 64, -3.105, 0.038, 0.035, 0.031)
    ring128_a = append_elliptical_ring(vertices, 128, -3.075, 0.065, 0.060, 0.032)
    ring128_b = append_elliptical_ring(vertices, 128, -3.025, 0.105, 0.090, 0.034)
    ring128_c = append_elliptical_ring(vertices, 128, -2.955, 0.150, 0.125, 0.038)
    main_start = len(vertices)

    for ring_index in range(CAST_LONGITUDINAL_SEGMENTS):
        longitudinal = ring_index / (CAST_LONGITUDINAL_SEGMENTS - 1)
        y = CAST_Y_MIN + (Y_MAX - CAST_Y_MIN) * longitudinal
        width = cast_station_value(y)
        front_blend = smoothstep((y - CAST_Y_MIN) / 0.56)
        body_half = body_thickness(y) * (0.56 + 0.44 * front_blend)
        tail_amount = tail_blend(y)
        for segment in range(CAST_RING_SEGMENTS):
            theta = math.tau * segment / CAST_RING_SEGMENTS
            cosine = math.cos(theta)
            sine = math.sin(theta)
            lateral = math.copysign(abs(cosine) ** 0.93, cosine)
            x = width * lateral
            span = min(1.0, abs(x) / max(width, 1e-5))
            central_volume = body_half * math.exp(-((abs(x) / 0.78) ** 2.15))
            membrane = (
                (0.115 - 0.048 * span)
                * (1.0 - 0.55 * tail_amount)
                * (0.66 + 0.34 * front_blend)
            )
            tail_leaf = 0.10 * tail_amount * math.exp(-((y - 3.25) / 0.78) ** 2)
            half_height = membrane + central_volume + tail_leaf
            wing_lift = front_blend * (
                0.54
                * span**2.35
                * (1.0 - tail_amount)
                * (0.86 + 0.14 * math.cos((y + 0.35) * 1.25))
            )
            dorsal_bias = 0.05 * math.exp(-((abs(x) / 0.78) ** 2.0))
            z = wing_lift + dorsal_bias + half_height * sine
            vertices.append((x, y, z))

    bridge_ring_pair(faces, ring16, 16, ring32, 32)
    bridge_ring_pair(faces, ring32, 32, ring64, 64)
    bridge_ring_pair(faces, ring64, 64, ring128_a, 128)
    connect_equal_rings(faces, ring128_a, ring128_b, 128)
    connect_equal_rings(faces, ring128_b, ring128_c, 128)
    connect_equal_rings(faces, ring128_c, main_start, CAST_RING_SEGMENTS)

    for ring_index in range(CAST_LONGITUDINAL_SEGMENTS - 1):
        ring_a = main_start + ring_index * CAST_RING_SEGMENTS
        ring_b = main_start + (ring_index + 1) * CAST_RING_SEGMENTS
        for segment in range(CAST_RING_SEGMENTS):
            next_segment = (segment + 1) % CAST_RING_SEGMENTS
            faces.append((
                ring_a + segment,
                ring_b + segment,
                ring_b + next_segment,
                ring_a + next_segment,
            ))

    front_pole = len(vertices)
    vertices.append((0.0, -3.155, 0.030))
    rear_pole = len(vertices)
    vertices.append((0.0, Y_MAX + 0.035, 0.0))
    for segment in range(16):
        next_segment = (segment + 1) % 16
        faces.append((front_pole, ring16 + segment, ring16 + next_segment))
    rear_ring = main_start + (CAST_LONGITUDINAL_SEGMENTS - 1) * CAST_RING_SEGMENTS
    for segment in range(CAST_RING_SEGMENTS):
        next_segment = (segment + 1) % CAST_RING_SEGMENTS
        faces.append((rear_pole, rear_ring + next_segment, rear_ring + segment))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=True)
    mesh.update(calc_edges=True)
    body = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(body)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    body["assetVersion"] = ASSET_VERSION
    body["facing"] = "-Y"
    body["topology"] = "closed-rounded-multi-ring-manta-loft-v2"
    return body


def build_geometry_v2() -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    reset_scene()
    configure_scene()
    shell_material, core_material = create_water_materials()
    root = create_root()
    body = create_cast_body_loft_v2()
    body.data.materials.append(shell_material)
    body.parent = root
    core = create_weak_core(core_material)
    core.parent = root
    anchors = create_anchors(root)
    anchors["muzzle-anchor"].location = (0.0, -3.18, 0.03)
    anchors["impact-anchor"].location = (0.0, -1.0, 0.24)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    return root, body, core


def apply_cast_neutral_v2(body: bpy.types.Object) -> None:
    """Thicken the chest while keeping the integrated manta silhouette."""

    for vertex in body.data.vertices:
        x, y, z, span, wing, centre, tail = cast_shape_context(vertex.co)
        chest = centre * math.exp(-((y + 0.45) / 1.85) ** 2)
        midline = local_midline(x, y)
        offset = z - midline
        vertex.co.z = midline + offset * (1.0 + 0.18 * chest)
        vertex.co.z += 0.14 * wing * (0.22 + 0.78 * span) + 0.025 * chest
        vertex.co.x = x * (1.0 + 0.045 * chest + 0.008 * wing)
        vertex.co.y = y + 0.022 * tail
    body.data.update()


def create_cast_shape_keys(body: bpy.types.Object) -> None:
    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}

    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = cast_shape_context(original)
        side = 1.0 if x >= 0.0 else -1.0
        chest = centre * math.exp(-((y + 0.40) / 1.95) ** 2)
        root_focus = wing * (1.0 - 0.62 * span)
        midline = local_midline(x, y)

        gather = original.copy()
        gather.y += 0.08 * chest + 0.035 * wing
        gather.z += 0.18 * wing * (0.30 + 0.70 * span) + 0.025 * chest
        keys["Cast_Gather"].data[index].co = gather

        aim = original.copy()
        aim.y += 0.16 * chest + 0.065 * wing * (0.25 + 0.75 * span)
        aim.z += 0.34 * wing * (0.22 + 0.78 * span) + 0.045 * chest
        aim.x += side * 0.025 * root_focus
        keys["Cast_AimLift"].data[index].co = aim

        recoil = original.copy()
        recoil.y += 0.34 * chest + 0.22 * wing * (0.22 + 0.78 * span)
        recoil.z += 0.07 * chest + 0.13 * wing * (0.28 + 0.72 * span)
        recoil.x += side * 0.018 * root_focus
        keys["Cast_FullBodyRecoil"].data[index].co = recoil

        wave_left = original.copy()
        left = wing if side > 0.0 else 0.0
        left_wave = math.sin((1.0 - span) * math.pi * 1.65 + (y + 0.25) * 0.72)
        wave_left.z += 0.17 * left * left_wave
        wave_left.y += 0.065 * left * (0.25 + 0.75 * span)
        keys["Cast_WingWave_L"].data[index].co = wave_left

        wave_right = original.copy()
        right = wing if side < 0.0 else 0.0
        right_wave = math.sin((1.0 - span) * math.pi * 1.65 + (y + 0.25) * 0.72 + 0.55)
        wave_right.z += 0.17 * right * right_wave
        wave_right.y += 0.065 * right * (0.25 + 0.75 * span)
        keys["Cast_WingWave_R"].data[index].co = wave_right

        tail_lag = original.copy()
        tail_lag.y -= 0.20 * tail
        tail_lag.x += side * 0.12 * tail * math.sin((y - 1.45) * 1.55)
        tail_lag.z -= 0.07 * tail * smoothstep((y - 1.75) / 1.65)
        keys["Cast_TailLag"].data[index].co = tail_lag

        corrective = original.copy()
        corrected_offset = (z - midline) * (1.0 + 0.18 * chest)
        corrective.z = midline + corrected_offset + 0.025 * chest
        corrective.x = x * (1.0 + 0.045 * chest)
        corrective.y = -0.40 + (y + 0.40) * (1.0 + 0.025 * chest)
        keys["Cast_ChestVolume_Corrective"].data[index].co = corrective

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def rig_cast_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_cast_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingDirectCastV2Armature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()


def create_charge_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT_CastChargeV2") or bpy.data.materials.new("MAT_CastChargeV2")
    material.use_nodes = True
    material.diffuse_color = (0.025, 0.55, 0.72, 0.88)
    material.surface_render_method = "DITHERED"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ("Base Color",), (0.006, 0.27, 0.40, 1.0))
    set_input(bsdf, ("Roughness",), 0.08)
    set_input(bsdf, ("IOR",), 1.333)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.60)
    set_input(bsdf, ("Coat Weight", "Coat"), 0.28)
    set_input(bsdf, ("Emission Color", "Emission"), (0.0, 0.14, 0.23, 1.0))
    set_input(bsdf, ("Emission Strength",), 0.48)
    material["semantic"] = "aqueous-muzzle-charge"
    return material


def create_charge_nodes(rig: bpy.types.Object) -> tuple[bpy.types.Object, ...]:
    material = create_charge_material()
    specifications = (
        ("MuzzleCharge", (0.0, -3.34, 0.08), 0.38),
        ("MuzzleDroplet_L", (0.34, -3.16, 0.17), 0.105),
        ("MuzzleDroplet_R", (-0.31, -3.20, -0.02), 0.090),
    )
    assert tuple(name for name, _, _ in specifications) == CHARGE_NODES
    nodes = []
    for name, location, radius in specifications:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=radius, location=location)
        node = bpy.context.object
        node.name = name
        node.data.name = f"{name}Mesh"
        node.data.materials.append(material)
        node["semantic"] = "muzzle-water-charge"
        bind_object_to_bone(node, rig, "body_front")
        nodes.append(node)
    return tuple(nodes)


def insert_rotation_curve(
    bone: bpy.types.PoseBone,
    values: tuple[tuple[float, float, float], ...],
) -> None:
    bone.rotation_mode = "XYZ"
    for frame, rotation in zip(KEY_FRAMES, values, strict=True):
        bone.rotation_euler = rotation
        bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone.name)


def create_armature_action(rig: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(CLIP_NAME)
    rig.animation_data_create()
    rig.animation_data.action = action
    zero = (0.0, 0.0, 0.0)
    root = rig.pose.bones["root"]
    root.rotation_mode = "XYZ"
    for frame in KEY_FRAMES:
        root.location = zero
        root.rotation_euler = zero
        root.keyframe_insert(data_path="location", frame=frame, group="root")
        root.keyframe_insert(data_path="rotation_euler", frame=frame, group="root")

    left_wing = (
        zero,
        (0.008, -0.004, 0.012),
        (0.016, -0.008, 0.024),
        (0.026, -0.010, 0.040),
        (0.008, 0.005, 0.015),
        (-0.018, 0.010, -0.028),
        (-0.010, 0.005, -0.015),
        (-0.004, 0.002, -0.006),
        zero,
    )
    right_wing = tuple((x, -y, -z) for x, y, z in left_wing)
    for side, values in (("L", left_wing), ("R", right_wing)):
        insert_rotation_curve(rig.pose.bones[f"wing_{side}_root"], values)
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_mid"],
            tuple((x * 1.16, y * 1.10, z * 1.18) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_tip"],
            tuple((x * 1.30, y * 1.16, z * 1.34) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_web"],
            tuple((x * 0.72, y * 0.75, z * 0.78) for x, y, z in values),
        )

    insert_rotation_curve(rig.pose.bones["body_front"], (
        zero,
        (-0.006, 0.0, 0.0),
        (-0.012, 0.0, 0.0),
        (-0.018, 0.0, 0.0),
        (0.008, 0.0, 0.0),
        (0.030, 0.0, 0.0),
        (0.012, 0.0, 0.0),
        (0.004, 0.0, 0.0),
        zero,
    ))
    insert_rotation_curve(rig.pose.bones["body_mid"], (
        zero,
        (0.003, 0.0, 0.0),
        (0.006, 0.0, 0.0),
        (0.009, 0.0, 0.0),
        (-0.004, 0.0, 0.0),
        (-0.014, 0.0, 0.0),
        (-0.006, 0.0, 0.0),
        (-0.002, 0.0, 0.0),
        zero,
    ))
    insert_rotation_curve(rig.pose.bones["body_rear"], (
        zero,
        (0.002, 0.0, -0.002),
        (0.004, 0.0, -0.004),
        (0.006, 0.0, 0.003),
        (-0.003, 0.0, 0.008),
        (-0.010, 0.0, 0.018),
        (-0.007, 0.0, 0.024),
        (-0.002, 0.0, 0.007),
        zero,
    ))

    tail_values = (
        zero,
        (0.0, 0.004, -0.003),
        (0.0, 0.008, -0.006),
        (0.0, 0.010, 0.005),
        (0.0, -0.006, 0.010),
        (0.0, -0.016, 0.020),
        (0.0, -0.030, 0.034),
        (0.0, -0.010, 0.012),
        zero,
    )
    for index, bone_name in enumerate(("tail_01", "tail_02", "tail_03"), start=1):
        multiplier = 0.72 + 0.22 * index
        insert_rotation_curve(
            rig.pose.bones[bone_name],
            tuple((x, y * multiplier, z * multiplier) for x, y, z in tail_values),
        )
    action.use_fake_user = True
    return action


def morph_samples() -> dict[str, tuple[float, ...]]:
    values = {
        "Cast_Gather": (0.0, 0.55, 0.75, 0.30, 0.0, 0.0, 0.0, 0.0, 0.0),
        "Cast_AimLift": (0.0, 0.12, 0.45, 1.0, 0.55, 0.10, 0.0, 0.0, 0.0),
        "Cast_FullBodyRecoil": (0.0, 0.0, 0.0, 0.0, 0.38, 1.0, 0.18, 0.06, 0.0),
        "Cast_WingWave_L": (0.0, 0.04, 0.10, 0.06, 0.10, 0.22, 0.14, 0.04, 0.0),
        "Cast_WingWave_R": (0.0, 0.03, 0.07, 0.05, 0.08, 0.10, 0.46, 0.04, 0.0),
        "Cast_TailLag": (0.0, 0.0, 0.0, 0.0, 0.0, 0.18, 1.0, 0.32, 0.0),
        "Cast_ChestVolume_Corrective": (0.0, 0.12, 0.20, 0.35, 0.55, 0.80, 0.55, 0.20, 0.0),
    }
    assert tuple(values) == MORPH_NAMES
    return values


def create_morph_action(body: bpy.types.Object) -> bpy.types.Action:
    shape_keys = body.data.shape_keys
    action = bpy.data.actions.new(MORPH_CLIP_NAME)
    shape_keys.animation_data_create()
    shape_keys.animation_data.action = action
    for name, samples in morph_samples().items():
        key = shape_keys.key_blocks[name]
        for frame, value in zip(KEY_FRAMES, samples, strict=True):
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame, group=name)
    action.use_fake_user = True
    return action


def create_charge_action(
    node: bpy.types.Object,
    scales: tuple[float, ...],
    rotations: tuple[float, ...],
) -> bpy.types.Action:
    action = bpy.data.actions.new(f"{CLIP_NAME}_{node.name}")
    node.animation_data_create()
    node.animation_data.action = action
    node.rotation_mode = "XYZ"
    for frame, scale, rotation in zip(KEY_FRAMES, scales, rotations, strict=True):
        node.scale = (scale, scale, scale)
        node.rotation_euler = (rotation * 0.35, rotation * 0.62, rotation)
        node.keyframe_insert(data_path="scale", frame=frame, group=node.name)
        node.keyframe_insert(data_path="rotation_euler", frame=frame, group=node.name)
    action.use_fake_user = True
    return action


def push_nla(owner, action: bpy.types.Action) -> None:
    animation_data = owner.animation_data
    track = animation_data.nla_tracks.new()
    track.name = CLIP_NAME
    strip = track.strips.new(CLIP_NAME, FRAME_START, action)
    strip.action_frame_start = FRAME_START
    strip.action_frame_end = FRAME_END
    strip.frame_start = FRAME_START
    strip.frame_end = FRAME_END
    strip.extrapolation = "NOTHING"
    animation_data.action = None


def animate_cast(
    body: bpy.types.Object,
    rig: bpy.types.Object,
    charge_nodes: tuple[bpy.types.Object, ...],
) -> None:
    armature_action = create_armature_action(rig)
    morph_action = create_morph_action(body)
    charge_scales = {
        "MuzzleCharge": (0.01, 0.26, 0.72, 1.0, 0.001, 0.001, 0.001, 0.001, 0.001),
        "MuzzleDroplet_L": (0.01, 0.12, 0.62, 0.92, 0.001, 0.001, 0.001, 0.001, 0.001),
        "MuzzleDroplet_R": (0.01, 0.08, 0.48, 0.78, 0.001, 0.001, 0.001, 0.001, 0.001),
    }
    charge_actions = tuple(
        create_charge_action(
            node,
            charge_scales[node.name],
            tuple(index * (0.08 if node.name == "MuzzleCharge" else 0.22) for index in range(len(KEY_FRAMES))),
        )
        for node in charge_nodes
    )
    for action in (armature_action, morph_action, *charge_actions):
        configure_animation_curves(action)
    push_nla(rig, armature_action)
    push_nla(body.data.shape_keys, morph_action)
    for node, action in zip(charge_nodes, charge_actions, strict=True):
        push_nla(node, action)
    bpy.context.scene.frame_set(FRAME_START)


def phase_manifest() -> list[dict[str, object]]:
    return [
        {"name": name, "frame": frame, "seconds": round((frame - FRAME_START) / FPS, 6)}
        for name, frame in PHASES[:-1]
    ]


def sample_muzzle_trajectory() -> list[dict[str, object]]:
    scene = bpy.context.scene
    anchor = bpy.data.objects["muzzle-anchor"]
    samples = []
    for name, frame in PHASES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        location = anchor.matrix_world.translation
        samples.append({
            "phase": name,
            "frame": frame,
            "blender": [round(value, 6) for value in location],
            "three": blender_to_three(location),
        })
    return samples


def write_character_manifest(
    path: Path,
    glb_path: Path,
    body: bpy.types.Object,
    rig: bpy.types.Object,
) -> None:
    muzzle_trajectory = sample_muzzle_trajectory()
    bpy.context.scene.frame_set(FRAME_START)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(body)
    anchors = []
    for name in ANCHOR_NAMES:
        location = bpy.data.objects[name].matrix_world.translation
        anchors.append({
            "name": name,
            "blender": [round(value, 6) for value in location],
            "three": blender_to_three(location),
        })
    manifest = {
        "assetVersion": ASSET_VERSION,
        "action": "enemy-direct-cast",
        "clip": CLIP_NAME,
        "fps": FPS,
        "frameRange": [FRAME_START, FRAME_END],
        "durationSeconds": (FRAME_END - FRAME_START) / FPS,
        "loop": False,
        "rootMotion": False,
        "coordinateConvention": {
            "blender": "right-handed Z-up, creature forward -Y",
            "three": "right-handed Y-up, creature forward +Z",
            "mapping": "(x, y, z) -> (x, z, -y)",
        },
        "bounds": {
            "blender": {"min": minimum, "max": maximum},
            "three": {"min": blender_to_three(minimum), "max": blender_to_three(maximum)},
        },
        "mesh": {"vertices": len(body.data.vertices), "polygons": len(body.data.polygons)},
        "bones": [bone.name for bone in rig.data.bones],
        "morphs": list(MORPH_NAMES),
        "animations": [CLIP_NAME],
        "anchors": anchors,
        "phases": phase_manifest(),
        "muzzleTrajectory": muzzle_trajectory,
        "chargeNodes": list(CHARGE_NODES),
        "events": [{
            "name": "projectile-release",
            "frame": 73,
            "seconds": 2.4,
            "anchor": "muzzle-anchor",
            "projectileAsset": f"{PROJECTILE_VERSION}.glb",
        }],
        "motionDesign": {
            "driver": "shape-keys-with-small-bone-lag",
            "chestVolumePreserved": True,
            "weaponSilhouette": False,
            "boneRotationLimitRadians": BONE_ROTATION_LIMIT,
            "dominantMorphThreshold": DOMINANT_MORPH_THRESHOLD,
            "maxDominantMorphs": MAX_DOMINANT_MORPHS,
        },
        "projectileAsset": f"{PROJECTILE_VERSION}.glb",
        "releaseFrame": 73,
        "sha256": sha256_file(glb_path),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_character(args: argparse.Namespace) -> None:
    root, body, core = build_geometry_v2()
    configure_action_scene()
    for obj in (root, body, core):
        obj["assetVersion"] = ASSET_VERSION
    apply_cast_neutral_v2(body)
    rig = create_armature(root)
    rig["assetVersion"] = ASSET_VERSION
    rig["rigContract"] = ASSET_VERSION
    rig_cast_body(body, rig)
    bind_anchors_and_core(rig, core)
    charge_nodes = create_charge_nodes(rig)
    animate_cast(body, rig, charge_nodes)
    save_blend(args.output_blend)
    export_glb(args.output_glb)
    write_character_manifest(args.manifest, args.output_glb, body, rig)


def create_projectile_material() -> bpy.types.Material:
    material = bpy.data.materials.new("MAT_EnemyWaterProjectileV2")
    material.use_nodes = True
    material.diffuse_color = (0.012, 0.34, 0.48, 0.92)
    material.surface_render_method = "DITHERED"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ("Base Color",), (0.005, 0.20, 0.31, 1.0))
    set_input(bsdf, ("Roughness",), 0.07)
    set_input(bsdf, ("IOR",), 1.333)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.70)
    set_input(bsdf, ("Coat Weight", "Coat"), 0.34)
    set_input(bsdf, ("Coat Roughness",), 0.045)
    set_input(bsdf, ("Emission Color", "Emission"), (0.0, 0.10, 0.16, 1.0))
    set_input(bsdf, ("Emission Strength",), 0.30)
    material["semantic"] = "enemy-water-projectile"
    return material


def create_rounded_projectile_bulb(material: bpy.types.Material) -> bpy.types.Object:
    """Use an icosphere-derived water volume so no axial cap reads as a barrel."""

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0, location=(0.0, -0.04, 0.0))
    bulb = bpy.context.object
    bulb.name = "WaterBulb"
    bulb.data.name = "WaterBulbMesh"
    for vertex in bulb.data.vertices:
        x, y, z = vertex.co
        lobe = 1.0 + 0.035 * math.sin(3.0 * math.atan2(z, x) + y * 2.4)
        vertex.co.x = x * 0.53 * lobe
        vertex.co.y = y * 0.72 + 0.025 * math.sin(x * 3.2 + z * 2.2)
        vertex.co.z = z * 0.50 * (1.0 + 0.025 * math.cos(y * 3.0))
    bulb.data.update()
    bulb.data.materials.append(material)
    for polygon in bulb.data.polygons:
        polygon.use_smooth = True
    return bulb


def build_projectile_geometry() -> tuple[bpy.types.Object, tuple[bpy.types.Object, ...]]:
    reset_scene()
    configure_action_scene()
    root = bpy.data.objects.new(PROJECTILE_ROOT, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root["assetVersion"] = PROJECTILE_VERSION
    root["travelAxis"] = "-Y"
    root["geometry"] = "rounded-teardrop-water-cluster"
    material = create_projectile_material()

    bulb = create_rounded_projectile_bulb(material)
    tail = create_lobed_revolution(
        "ShortFluidTail",
        ((0.30, 0.028), (0.38, 0.075), (0.49, 0.105), (0.60, 0.070), (0.70, 0.025)),
        material,
        1.15,
    )
    tail.location = (0.25, 0.01, 0.11)
    tail.rotation_euler[2] = -0.09

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.12, location=(-0.20, 0.86, 0.10))
    droplet = bpy.context.object
    droplet.name = "WakeDroplet"
    droplet.data.name = "WakeDropletMesh"
    droplet.scale = (0.72, 1.18, 0.68)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    droplet.data.materials.append(material)
    for polygon in droplet.data.polygons:
        polygon.use_smooth = True

    for obj in (bulb, tail, droplet):
        obj.parent = root
        obj["semantic"] = "rounded-water-projectile-volume"

    positions = {
        "center-anchor": (0.0, -0.05, 0.0),
        "impact-anchor": (0.0, -0.77, 0.0),
    }
    assert tuple(positions) == PROJECTILE_ANCHORS
    for name, location in positions.items():
        anchor = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(anchor)
        anchor.empty_display_type = "SPHERE"
        anchor.empty_display_size = 0.055
        anchor.location = location
        anchor.parent = root
        anchor["anchor_role"] = name.removesuffix("-anchor")
    return root, (bulb, tail, droplet)


def write_projectile_manifest(
    path: Path,
    glb_path: Path,
    meshes: tuple[bpy.types.Object, ...],
) -> None:
    minimum, maximum = combined_world_bounds(meshes)
    anchors = []
    for name in PROJECTILE_ANCHORS:
        location = bpy.data.objects[name].matrix_world.translation
        anchors.append({
            "name": name,
            "blender": [round(value, 6) for value in location],
            "three": blender_to_three(location),
        })
    manifest = {
        "assetVersion": PROJECTILE_VERSION,
        "kind": "enemy-projectile",
        "motionProfile": "direct-rounded-bulb-with-short-fluid-wake",
        "geometry": "rounded-teardrop-water-cluster",
        "surfaceContinuity": "smooth-primary-profile",
        "coordinateConvention": {
            "blender": "right-handed Z-up, projectile travel -Y",
            "three": "right-handed Y-up, projectile travel +Z",
        },
        "bounds": {
            "blender": {
                "min": [round(value, 6) for value in minimum],
                "max": [round(value, 6) for value in maximum],
                "size": [round(maximum[i] - minimum[i], 6) for i in range(3)],
            },
            "three": three_bounds(minimum, maximum),
        },
        "meshes": [obj.name for obj in meshes],
        "anchors": anchors,
        "sha256": sha256_file(glb_path),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_projectile(args: argparse.Namespace) -> None:
    _, meshes = build_projectile_geometry()
    save_blend(args.projectile_blend)
    export_glb(args.projectile_glb)
    write_projectile_manifest(args.projectile_manifest, args.projectile_glb, meshes)


def main() -> None:
    args = parse_args()
    build_character(args)
    build_projectile(args)
    print("DIRECT_CAST_V2_EXPORT_OK", json.dumps({
        "characterBlend": str(args.output_blend),
        "characterGlb": str(args.output_glb),
        "projectileBlend": str(args.projectile_blend),
        "projectileGlb": str(args.projectile_glb),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

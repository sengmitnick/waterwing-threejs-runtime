"""Build the rigged Waterwing forward asset deterministically in Blender 5.2."""

from __future__ import annotations

import argparse
import hashlib
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

from waterwing_forward_v1_config import (  # noqa: E402
    ANCHOR_NAMES,
    ASSET_VERSION,
    BODY_NAME,
    BONE_NAMES,
    CORE_NAME,
    CLIP_NAME,
    DEFAULT_BLEND_PATH,
    DEFAULT_GLB_PATH,
    DEFAULT_MANIFEST_PATH,
    FPS,
    FRAME_END,
    FRAME_START,
    LONGITUDINAL_SEGMENTS,
    KEY_FRAMES,
    MORPH_CLIP_NAME,
    OUTLINE_STATIONS,
    MORPH_NAMES,
    RIG_NAME,
    RING_SEGMENTS,
    ROOT_NAME,
    Y_MAX,
    Y_MIN,
)
from waterwing_rounded_nose import (  # noqa: E402
    FRONT_POLE_OFFSET,
    NOSE_RING_SEGMENTS,
    Ring,
    append_rounded_nose,
    bridge_arbitrary_rings,
    cap_rounded_nose,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("geometry", "rig", "export"), default="export")
    parser.add_argument("--output-blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--output-glb", type=Path, default=DEFAULT_GLB_PATH)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    return parser.parse_args(argv)


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def station_value(y: float, stations=OUTLINE_STATIONS) -> float:
    if y <= stations[0][0]:
        return stations[0][1]
    if y >= stations[-1][0]:
        return stations[-1][1]
    for (y0, value0), (y1, value1) in zip(stations, stations[1:]):
        if y0 <= y <= y1:
            phase = smoothstep((y - y0) / (y1 - y0))
            return value0 + (value1 - value0) * phase
    raise AssertionError(f"unhandled longitudinal position {y}")


def reset_scene() -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.008, 0.018, 0.028)


def set_input(node: bpy.types.Node, names: tuple[str, ...], value) -> None:
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def create_water_materials() -> tuple[bpy.types.Material, bpy.types.Material]:
    shell = bpy.data.materials.new("MAT_WaterShell")
    shell.use_nodes = True
    shell.diffuse_color = (0.025, 0.24, 0.31, 1.0)
    shell.surface_render_method = "DITHERED"
    bsdf = shell.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ("Base Color",), (0.012, 0.18, 0.25, 1.0))
    set_input(bsdf, ("Metallic",), 0.0)
    set_input(bsdf, ("Roughness",), 0.16)
    set_input(bsdf, ("IOR",), 1.333)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.52)
    set_input(bsdf, ("Coat Weight", "Coat"), 0.22)
    set_input(bsdf, ("Coat Roughness",), 0.08)
    set_input(bsdf, ("Alpha",), 0.94)
    shell["semantic"] = "water-shell"

    core = bpy.data.materials.new("MAT_CoreWeak")
    core.use_nodes = True
    core.diffuse_color = (0.03, 0.66, 0.78, 1.0)
    core_bsdf = core.node_tree.nodes.get("Principled BSDF")
    set_input(core_bsdf, ("Base Color",), (0.01, 0.32, 0.42, 1.0))
    set_input(core_bsdf, ("Roughness",), 0.18)
    set_input(core_bsdf, ("Metallic",), 0.0)
    set_input(core_bsdf, ("Emission Color", "Emission"), (0.0, 0.32, 0.42, 1.0))
    set_input(core_bsdf, ("Emission Strength",), 0.65)
    core["semantic"] = "weak-water-core"
    return shell, core


def body_thickness(y: float) -> float:
    main = 0.68 * math.exp(-((y + 0.55) / 1.35) ** 2)
    nose = 0.24 * math.exp(-((y + 2.15) / 0.55) ** 2)
    rear = 0.22 * math.exp(-((y - 0.95) / 0.9) ** 2)
    tail = 0.13 * math.exp(-((y - 3.22) / 0.72) ** 2)
    return 0.07 + main + nose + rear + tail


def body_radius(y: float) -> float:
    return 0.56 + 0.30 * math.exp(-((y + 0.55) / 1.45) ** 2)


def tail_blend(y: float) -> float:
    return smoothstep((y - 1.55) / 0.65)


def create_body_loft(name: str = BODY_NAME) -> bpy.types.Object:
    """Create one closed volumetric manta loft; wings and tail are integrated."""

    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    ring_count = LONGITUDINAL_SEGMENTS
    ring_size = RING_SEGMENTS
    nose_rings = append_rounded_nose(vertices, faces, Y_MIN)
    main_start = len(vertices)

    for ring_index in range(ring_count):
        longitudinal = ring_index / (ring_count - 1)
        y = Y_MIN + (Y_MAX - Y_MIN) * longitudinal
        width = station_value(y)
        front_blend = smoothstep((y - Y_MIN) / 0.56)
        body_half = body_thickness(y) * (0.56 + 0.44 * front_blend)
        core_radius = body_radius(y)
        tail_amount = tail_blend(y)
        for segment in range(ring_size):
            theta = math.tau * segment / ring_size
            cosine = math.cos(theta)
            sine = math.sin(theta)
            # The exponent holds more samples near the central body and avoids
            # the flat side-wall artifact of the earlier extrusion model.
            lateral = math.copysign(abs(cosine) ** 0.93, cosine)
            x = width * lateral
            span = min(1.0, abs(x) / max(width, 1e-5))
            central_volume = body_half * math.exp(-((abs(x) / core_radius) ** 2.15))
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
            dorsal_bias = 0.05 * math.exp(-((abs(x) / max(core_radius, 1e-5)) ** 2.0))
            z = wing_lift + dorsal_bias + half_height * sine
            vertices.append((x, y, z))

    first_main_ring = Ring(main_start, ring_size)
    bridge_arbitrary_rings(faces, nose_rings[-1], first_main_ring)

    for ring_index in range(ring_count - 1):
        ring_a = main_start + ring_index * ring_size
        ring_b = main_start + (ring_index + 1) * ring_size
        for segment in range(ring_size):
            next_segment = (segment + 1) % ring_size
            faces.append(
                (
                    ring_a + segment,
                    ring_b + segment,
                    ring_b + next_segment,
                    ring_a + next_segment,
                )
            )

    cap_rounded_nose(vertices, faces, nose_rings[0], Y_MIN)
    rear_pole = len(vertices)
    vertices.append((0.0, Y_MAX + 0.035, 0.0))
    rear_ring = main_start + (ring_count - 1) * ring_size
    for segment in range(ring_size):
        next_segment = (segment + 1) % ring_size
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
    body["frontPoleValence"] = 16
    body["noseRingSegments"] = json.dumps(NOSE_RING_SEGMENTS)
    return body


def create_weak_core(material: bpy.types.Material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, location=(0.0, -0.78, 0.12))
    core = bpy.context.object
    core.name = CORE_NAME
    core.scale = (0.105, 0.13, 0.105)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    core.data.materials.append(material)
    core["semantic"] = "weak-water-core"
    return core


def create_anchors(parent: bpy.types.Object) -> dict[str, bpy.types.Object]:
    positions = {
        "health-anchor": (0.0, -0.35, 1.42),
        "muzzle-anchor": (0.0, Y_MIN + FRONT_POLE_OFFSET - 0.03, 0.03),
        "impact-anchor": (0.0, -0.88, 0.24),
        "waterline-anchor": (0.0, 0.05, 0.0),
        "wingtip-left": (3.98, -0.28, 0.50),
        "wingtip-right": (-3.98, -0.28, 0.50),
        "tailtip-anchor": (0.0, 4.17, 0.0),
    }
    assert tuple(positions) == ANCHOR_NAMES
    anchors = {}
    for name, location in positions.items():
        anchor = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(anchor)
        anchor.empty_display_type = "SPHERE"
        anchor.empty_display_size = 0.08
        anchor.location = location
        anchor.parent = parent
        anchor["anchor_role"] = name.removesuffix("-anchor")
        anchors[name] = anchor
    return anchors


def create_root() -> bpy.types.Object:
    root = bpy.data.objects.new(ROOT_NAME, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.55
    root["assetVersion"] = ASSET_VERSION
    root["coordinateConvention"] = "Blender Z-up; forward -Y"
    return root


def build_geometry() -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    reset_scene()
    configure_scene()
    shell_material, core_material = create_water_materials()
    root = create_root()
    body = create_body_loft()
    body.data.materials.append(shell_material)
    body.parent = root
    core = create_weak_core(core_material)
    core.parent = root
    create_anchors(root)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    return root, body, core


def create_armature(root: bpy.types.Object) -> bpy.types.Object:
    armature_data = bpy.data.armatures.new(f"{RIG_NAME}Data")
    rig = bpy.data.objects.new(RIG_NAME, armature_data)
    bpy.context.collection.objects.link(rig)
    rig.parent = root
    rig.show_in_front = True
    rig.display_type = "WIRE"

    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    specs = {
        "root": ((0.0, 0.0, 0.0), (0.0, -0.45, 0.0), None, False),
        "body_front": ((0.0, -0.15, 0.0), (0.0, -2.42, 0.0), "root", True),
        "body_mid": ((0.0, 0.72, 0.0), (0.0, -0.42, 0.0), "root", True),
        "body_rear": ((0.0, 0.30, 0.0), (0.0, 1.78, 0.0), "root", True),
        "wing_L_root": ((0.42, -0.24, 0.10), (1.40, -0.30, 0.22), "body_mid", True),
        "wing_L_mid": ((1.40, -0.30, 0.22), (2.68, -0.40, 0.38), "wing_L_root", True),
        "wing_L_tip": ((2.68, -0.40, 0.38), (3.92, -0.30, 0.52), "wing_L_mid", True),
        "wing_L_web": ((0.52, 0.36, 0.08), (2.62, 1.02, 0.26), "wing_L_root", True),
        "wing_R_root": ((-0.42, -0.24, 0.10), (-1.40, -0.30, 0.22), "body_mid", True),
        "wing_R_mid": ((-1.40, -0.30, 0.22), (-2.68, -0.40, 0.38), "wing_R_root", True),
        "wing_R_tip": ((-2.68, -0.40, 0.38), (-3.92, -0.30, 0.52), "wing_R_mid", True),
        "wing_R_web": ((-0.52, 0.36, 0.08), (-2.62, 1.02, 0.26), "wing_R_root", True),
        "tail_01": ((0.0, 1.48, 0.0), (0.0, 2.45, 0.02), "body_rear", True),
        "tail_02": ((0.0, 2.45, 0.02), (0.0, 3.26, 0.03), "tail_01", True),
        "tail_03": ((0.0, 3.26, 0.03), (0.0, 4.14, 0.0), "tail_02", True),
    }
    assert tuple(specs) == BONE_NAMES
    for name, (head, tail, parent_name, deform) in specs.items():
        bone = armature_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.use_deform = deform
        if parent_name is not None:
            bone.parent = armature_data.edit_bones[parent_name]
            bone.use_connect = name in {"wing_L_mid", "wing_L_tip", "wing_R_mid", "wing_R_tip", "tail_02", "tail_03"}

    bpy.ops.object.mode_set(mode="OBJECT")
    rig["assetVersion"] = ASSET_VERSION
    rig["rigContract"] = "waterwing-forward-v1"
    return rig


def bind_object_to_bone(obj: bpy.types.Object, rig: bpy.types.Object, bone_name: str) -> None:
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world


def bind_anchors_and_core(rig: bpy.types.Object, core: bpy.types.Object) -> None:
    bone_map = {
        "health-anchor": "body_mid",
        "muzzle-anchor": "body_front",
        "impact-anchor": "body_front",
        "waterline-anchor": "body_mid",
        "wingtip-left": "wing_L_tip",
        "wingtip-right": "wing_R_tip",
        "tailtip-anchor": "tail_03",
    }
    for anchor_name, bone_name in bone_map.items():
        bind_object_to_bone(bpy.data.objects[anchor_name], rig, bone_name)
    bind_object_to_bone(core, rig, "body_mid")


def shape_context(co: Vector) -> tuple[float, float, float, float, float]:
    x, y, z = co
    width = station_value(y)
    span = min(1.0, abs(x) / max(width, 1e-5))
    wing_gate = (1.0 - smoothstep((y - 1.40) / 0.55)) * smoothstep((abs(x) - 0.44) / 0.72)
    body_gate = math.exp(-((abs(x) / 1.05) ** 2.0)) * (1.0 - smoothstep((y - 1.25) / 0.8))
    tail_gate = smoothstep((y - 1.55) / 0.82)
    return x, y, z, span, max(0.0, wing_gate), max(0.0, body_gate), max(0.0, tail_gate)


def create_shape_keys(body: bpy.types.Object) -> None:
    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}

    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = shape_context(original)
        side = 1.0 if x >= 0.0 else -1.0

        preload = original.copy()
        preload.x *= 1.0 + 0.025 * wing
        preload.y -= 0.20 * wing * (0.55 + 0.45 * span)
        preload.z += 0.42 * wing * (0.35 + 0.65 * span)
        keys["Propel_Preload"].data[index].co = preload

        power = original.copy()
        power.x *= 1.0 - 0.082 * wing * (0.35 + 0.65 * span)
        power.y += 0.98 * wing * (0.54 + 0.46 * span)
        power.z -= 0.92 * wing * (0.30 + 0.70 * span)
        mid_thickness = wing * (1.0 - 0.72 * span) * math.exp(-((y + 0.25) / 1.35) ** 2)
        estimated_centre = 0.54 * span**2.35 * (1.0 - tail)
        power.z += math.copysign(0.18 * mid_thickness, z - estimated_centre if abs(z - estimated_centre) > 1e-5 else 1.0)
        keys["Propel_Power"].data[index].co = power

        recovery = original.copy()
        recovery.x *= 1.0 - 0.018 * wing
        recovery.y += 0.18 * wing * (0.45 + 0.55 * span)
        recovery.z += 0.18 * wing * (0.25 + 0.75 * span)
        keys["Propel_Recovery"].data[index].co = recovery

        compress = original.copy()
        compress.y = -0.32 + (y + 0.32) * (1.0 - 0.075 * centre)
        compress.x *= 1.0 + 0.055 * centre
        compress.z *= 1.0 + 0.07 * centre
        keys["Body_Compress"].data[index].co = compress

        stretch = original.copy()
        stretch.y = -0.32 + (y + 0.32) * (1.0 + 0.055 * centre)
        stretch.x *= 1.0 - 0.03 * centre
        stretch.z *= 1.0 - 0.035 * centre
        keys["Body_Stretch"].data[index].co = stretch

        cup_left = original.copy()
        left_gate = wing if side > 0.0 else 0.0
        cup_left.y += 0.12 * left_gate * span
        cup_left.z += 0.31 * left_gate * span**1.35
        cup_left.x *= 1.0 - 0.035 * left_gate
        keys["Wing_Cup_L"].data[index].co = cup_left

        cup_right = original.copy()
        right_gate = wing if side < 0.0 else 0.0
        cup_right.y += 0.12 * right_gate * span
        cup_right.z += 0.31 * right_gate * span**1.35
        cup_right.x *= 1.0 - 0.035 * right_gate
        keys["Wing_Cup_R"].data[index].co = cup_right

        tail_drag = original.copy()
        tail_drag.y += 0.26 * tail
        tail_drag.x += side * 0.08 * tail * math.sin((y - 1.55) * 2.2)
        tail_drag.z -= 0.17 * tail * smoothstep((y - 2.0) / 1.45)
        keys["Tail_Drag"].data[index].co = tail_drag

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def triangular_weights(value: float, centres: tuple[float, ...], radius: float) -> list[float]:
    return [max(0.0, 1.0 - abs(value - centre) / radius) for centre in centres]


def normalized_top_four(weights: dict[str, float]) -> dict[str, float]:
    positive = [(name, value) for name, value in weights.items() if value > 1e-7]
    positive.sort(key=lambda item: item[1], reverse=True)
    selected = positive[:4]
    total = sum(value for _, value in selected)
    assert total > 0.0
    return {name: value / total for name, value in selected}


def assign_skin_weights(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    deform_names = [bone.name for bone in rig.data.bones if bone.use_deform]
    groups = {name: body.vertex_groups.new(name=name) for name in deform_names}
    for vertex in body.data.vertices:
        x, y, _ = vertex.co
        width = station_value(y)
        span = min(1.0, abs(x) / max(width, 1e-5))
        wing_gate = (y < 1.90 and width > 0.75 and abs(x) > 0.46)

        if y > 1.62 and abs(x) < max(0.78, width * 0.68):
            tail_phase = max(0.0, min(1.0, (y - 1.55) / (Y_MAX - 1.55)))
            values = triangular_weights(tail_phase, (0.10, 0.50, 0.88), 0.48)
            weights = {
                "tail_01": values[0],
                "tail_02": values[1],
                "tail_03": values[2],
                "body_rear": max(0.0, 0.42 * (1.0 - tail_phase / 0.28)),
            }
        elif wing_gate:
            side = "L" if x >= 0.0 else "R"
            wing_phase = max(0.0, min(1.0, (abs(x) - 0.40) / max(width - 0.40, 0.01)))
            chain = triangular_weights(wing_phase, (0.14, 0.53, 0.91), 0.45)
            web = 0.34 * smoothstep((y + 0.10) / 1.45) * smoothstep(wing_phase / 0.58)
            weights = {
                f"wing_{side}_root": chain[0],
                f"wing_{side}_mid": chain[1],
                f"wing_{side}_tip": chain[2],
                f"wing_{side}_web": web,
                "body_mid": 0.82 * (1.0 - smoothstep(wing_phase / 0.30)),
            }
        else:
            body_phase = max(0.0, min(1.0, (y - Y_MIN) / 4.68))
            values = triangular_weights(body_phase, (0.20, 0.53, 0.84), 0.55)
            weights = {
                "body_front": values[0],
                "body_mid": values[1],
                "body_rear": values[2],
            }

        for group_name, weight in normalized_top_four(weights).items():
            groups[group_name].add((vertex.index,), weight, "REPLACE")


def rig_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingArmature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()


def build_rigged_asset() -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    root, body, core = build_geometry()
    rig = create_armature(root)
    rig_body(body, rig)
    bind_anchors_and_core(rig, core)
    return root, body, core, rig


def key_pose_bone(
    pose_bone: bpy.types.PoseBone,
    samples: list[tuple[int, tuple[float, float, float]]],
) -> None:
    pose_bone.rotation_mode = "XYZ"
    for frame, rotation in samples:
        pose_bone.rotation_euler = tuple(component * 0.08 for component in rotation)
        pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)


def delayed_samples(
    values: tuple[tuple[float, float, float], ...],
    delay: int,
) -> list[tuple[int, tuple[float, float, float]]]:
    frames = [FRAME_START]
    frames.extend(min(FRAME_END - 1, frame + delay) for frame in KEY_FRAMES[1:-1])
    frames.append(FRAME_END)
    return list(zip(frames, values, strict=True))


def create_armature_animation(rig: bpy.types.Object) -> bpy.types.Action:
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

    # Root-to-tip phase lag is encoded with three progressively delayed curves.
    flap = (
        zero,
        (0.08, -0.04, 0.16),
        (0.12, -0.06, 0.24),
        (0.02, 0.02, 0.06),
        (-0.16, 0.09, -0.24),
        (-0.06, 0.04, -0.08),
        zero,
        (0.07, -0.03, 0.13),
        (-0.11, 0.06, -0.17),
        (-0.03, 0.02, -0.04),
        zero,
    )
    flap = tuple(tuple(component * 0.32 for component in rotation) for rotation in flap)
    flap_mirrored = tuple((x, -y, -z) for x, y, z in flap)
    for side, values in (("L", flap), ("R", flap_mirrored)):
        key_pose_bone(rig.pose.bones[f"wing_{side}_root"], delayed_samples(values, 0))
        key_pose_bone(
            rig.pose.bones[f"wing_{side}_mid"],
            delayed_samples(tuple((x * 1.12, y * 1.05, z * 1.15) for x, y, z in values), 3),
        )
        key_pose_bone(
            rig.pose.bones[f"wing_{side}_tip"],
            delayed_samples(tuple((x * 1.22, y * 1.08, z * 1.24) for x, y, z in values), 7),
        )
        web_values = tuple((x * 0.65, y * 0.7, z * 0.78) for x, y, z in values)
        key_pose_bone(rig.pose.bones[f"wing_{side}_web"], delayed_samples(web_values, 4))

    body_front_values = (
        zero,
        (-0.025, 0.0, 0.0),
        (-0.045, 0.0, 0.0),
        (0.02, 0.0, 0.0),
        (0.075, 0.0, 0.0),
        (0.03, 0.0, 0.0),
        zero,
        (-0.02, 0.0, 0.0),
        (0.05, 0.0, 0.0),
        (0.015, 0.0, 0.0),
        zero,
    )
    key_pose_bone(rig.pose.bones["body_front"], delayed_samples(body_front_values, 0))
    key_pose_bone(
        rig.pose.bones["body_mid"],
        delayed_samples(tuple((x * -0.32, 0.0, 0.0) for x, _, _ in body_front_values), 2),
    )
    key_pose_bone(
        rig.pose.bones["body_rear"],
        delayed_samples(tuple((x * -0.58, 0.0, 0.0) for x, _, _ in body_front_values), 4),
    )

    tail_values = (
        zero,
        (0.0, 0.025, -0.015),
        (0.0, 0.055, -0.028),
        (0.0, 0.02, 0.01),
        (0.0, -0.09, 0.045),
        (0.0, -0.125, 0.07),
        (0.0, -0.035, 0.018),
        (0.0, 0.025, -0.012),
        (0.0, -0.07, 0.035),
        (0.0, -0.055, 0.024),
        zero,
    )
    key_pose_bone(rig.pose.bones["tail_01"], delayed_samples(tail_values, 5))
    key_pose_bone(
        rig.pose.bones["tail_02"],
        delayed_samples(tuple((x, y * 1.28, z * 1.35) for x, y, z in tail_values), 8),
    )
    key_pose_bone(
        rig.pose.bones["tail_03"],
        delayed_samples(tuple((x, y * 1.52, z * 1.68) for x, y, z in tail_values), 11),
    )

    action.use_fake_user = True
    return action


def create_morph_animation(body: bpy.types.Object) -> bpy.types.Action:
    shape_keys = body.data.shape_keys
    action = bpy.data.actions.new(MORPH_CLIP_NAME)
    shape_keys.animation_data_create()
    shape_keys.animation_data.action = action
    values = {
        "Propel_Preload": (0.0, 0.70, 1.0, 0.34, 0.0, 0.0, 0.0, 0.54, 0.0, 0.0, 0.0),
        "Propel_Power": (0.0, 0.0, 0.0, 0.52, 1.0, 0.26, 0.0, 0.0, 0.70, 0.20, 0.0),
        "Propel_Recovery": (0.0, 0.0, 0.0, 0.0, 0.0, 0.72, 0.30, 0.0, 0.0, 0.46, 0.0),
        "Body_Compress": (0.0, 0.20, 0.46, 0.22, 0.0, 0.0, 0.0, 0.24, 0.0, 0.0, 0.0),
        "Body_Stretch": (0.0, 0.0, 0.0, 0.16, 0.56, 0.20, 0.0, 0.0, 0.36, 0.12, 0.0),
        "Wing_Cup_L": (0.0, 0.10, 0.22, 0.10, 0.02, 0.18, 0.08, 0.10, 0.02, 0.10, 0.0),
        "Wing_Cup_R": (0.0, 0.10, 0.22, 0.10, 0.02, 0.18, 0.08, 0.10, 0.02, 0.10, 0.0),
        "Tail_Drag": (0.0, 0.04, 0.08, 0.10, 0.22, 0.46, 0.16, 0.04, 0.18, 0.22, 0.0),
    }
    assert tuple(values) == MORPH_NAMES
    for name, samples in values.items():
        key = shape_keys.key_blocks[name]
        for frame, value in zip(KEY_FRAMES, samples, strict=True):
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame, group=name)
    action.use_fake_user = True
    return action


def push_action_to_named_nla(owner, action: bpy.types.Action) -> None:
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


def configure_animation_curves(action: bpy.types.Action) -> None:
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for curve in channelbag.fcurves:
                    for point in curve.keyframe_points:
                        point.interpolation = "BEZIER"
                        point.handle_left_type = "AUTO_CLAMPED"
                        point.handle_right_type = "AUTO_CLAMPED"


def create_animation(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    armature_action = create_armature_animation(rig)
    morph_action = create_morph_animation(body)
    configure_animation_curves(armature_action)
    configure_animation_curves(morph_action)
    push_action_to_named_nla(rig, armature_action)
    push_action_to_named_nla(body.data.shape_keys, morph_action)
    bpy.context.scene.frame_set(FRAME_START)


def world_bounds(obj: bpy.types.Object) -> tuple[list[float], list[float]]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return minimum, maximum


def blender_to_three(values) -> list[float]:
    x, y, z = values
    return [round(x, 6), round(z, 6), round(-y, 6)]


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path.resolve()),
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_morph=True,
        export_morph_animation=True,
        export_morph_reset_sk_data=True,
        export_animations=True,
        export_frame_range=True,
        export_anim_slide_to_zero=True,
        export_force_sampling=True,
        export_animation_mode="NLA_TRACKS",
        export_merge_animation="NLA_TRACK",
        export_bake_animation=True,
        export_def_bones=True,
        export_extras=True,
        export_apply=False,
        export_reset_pose_bones=True,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
        check_existing=False,
    )


def write_manifest(
    path: Path,
    glb_path: Path,
    body: bpy.types.Object,
    rig: bpy.types.Object,
) -> None:
    bpy.context.scene.frame_set(FRAME_START)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(body)
    anchors = []
    for name in ANCHOR_NAMES:
        location = bpy.data.objects[name].matrix_world.translation
        anchors.append(
            {
                "name": name,
                "blender": [round(value, 6) for value in location],
                "three": blender_to_three(location),
            }
        )
    manifest = {
        "assetVersion": ASSET_VERSION,
        "clip": CLIP_NAME,
        "fps": FPS,
        "frameRange": [FRAME_START, FRAME_END],
        "durationSeconds": (FRAME_END - FRAME_START) / FPS,
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
        "mesh": {
            "vertices": len(body.data.vertices),
            "polygons": len(body.data.polygons),
            "topology": body["topology"],
            "frontPoleValence": body["frontPoleValence"],
            "noseRingSegments": list(NOSE_RING_SEGMENTS),
        },
        "bones": [bone.name for bone in rig.data.bones],
        "morphs": list(MORPH_NAMES),
        "animations": [CLIP_NAME],
        "anchors": anchors,
        "sha256": sha256_file(glb_path),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_export_asset(
    output_blend: Path,
    output_glb: Path,
    manifest_path: Path,
) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    root, body, core, rig = build_rigged_asset()
    create_animation(body, rig)
    save_blend(output_blend)
    export_glb(output_glb)
    write_manifest(manifest_path, output_glb, body, rig)
    return root, body, core, rig


def save_blend(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path.resolve()), check_existing=False)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    if args.stage == "geometry":
        _, body, _ = build_geometry()
        save_blend(args.output_blend)
    elif args.stage == "rig":
        _, body, _, _ = build_rigged_asset()
        save_blend(args.output_blend)
    else:
        _, body, _, _ = build_export_asset(args.output_blend, args.output_glb, args.manifest)
    print(
        {
            "geometry": "GEOMETRY_STAGE_OK",
            "rig": "RIG_STAGE_OK",
            "export": "EXPORT_STAGE_OK",
        }[args.stage],
        json.dumps(
            {
                "vertices": len(body.data.vertices),
                "polygons": len(body.data.polygons),
                "dimensions": [round(value, 4) for value in body.dimensions],
                "blend": str(args.output_blend),
            },
            ensure_ascii=False,
        ),
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

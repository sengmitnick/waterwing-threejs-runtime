"""Build the dedicated Waterwing direct-cast action and waterball projectile."""

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

from build_waterwing_forward_v1 import (  # noqa: E402
    assign_skin_weights,
    bind_anchors_and_core,
    bind_object_to_bone,
    blender_to_three,
    build_geometry,
    configure_animation_curves,
    create_armature,
    export_glb,
    reset_scene,
    save_blend,
    set_input,
    sha256_file,
    shape_context,
    smoothstep,
    world_bounds,
)
from waterwing_direct_cast_v1_config import (  # noqa: E402
    ASSET_VERSION,
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
    ROOT_NAME,
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


def apply_cast_neutral(body: bpy.types.Object) -> None:
    """Give the casting asset a poised hover instead of a forward-power pose."""

    for vertex in body.data.vertices:
        x, y, z, span, wing, centre, tail = shape_context(vertex.co)
        vertex.co.x = x * (1.0 + 0.008 * wing)
        vertex.co.y = y + 0.025 * tail - 0.035 * wing * span
        vertex.co.z = z + 0.10 * wing * (0.2 + 0.8 * span) + 0.025 * centre
    body.data.update()


def create_cast_shape_keys(body: bpy.types.Object) -> None:
    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}

    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = shape_context(original)
        side = 1.0 if x >= 0.0 else -1.0
        root_focus = wing * (1.0 - 0.70 * span)

        gather = original.copy()
        gather.x *= 1.0 - 0.055 * wing * (0.3 + 0.7 * span)
        gather.y -= 0.25 * wing * (0.4 + 0.6 * span)
        gather.z += 0.34 * wing * (0.25 + 0.75 * span)
        keys["Cast_Gather"].data[index].co = gather

        compress = original.copy()
        compress.y = -0.36 + (y + 0.36) * (1.0 - 0.10 * centre)
        compress.x *= 1.0 + 0.07 * centre - 0.035 * wing
        compress.z = z * (1.0 + 0.10 * centre) + 0.08 * centre
        compress.z += 0.16 * root_focus
        keys["Cast_Compress"].data[index].co = compress

        aim = original.copy()
        aim.x *= 1.0 - 0.08 * wing * span
        aim.y -= 0.38 * wing * (0.22 + 0.78 * span)
        aim.z -= 0.17 * wing * span + 0.04 * centre
        keys["Cast_Aim"].data[index].co = aim

        recoil = original.copy()
        recoil.y += 0.42 * centre + 0.22 * wing * (0.25 + 0.75 * span)
        recoil.z += 0.28 * wing * (0.3 + 0.7 * span) + 0.08 * centre
        recoil.x *= 1.0 + 0.035 * wing
        keys["Cast_Recoil"].data[index].co = recoil

        recovery = original.copy()
        recovery.y += 0.08 * wing * span
        recovery.z += 0.10 * wing * (0.25 + 0.75 * span)
        recovery.x *= 1.0 - 0.012 * wing
        keys["Cast_Recovery"].data[index].co = recovery

        channel_left = original.copy()
        left = root_focus if side > 0.0 else 0.0
        channel_left.z += 0.13 * left * math.sin((1.0 - span) * math.pi * 1.8 + y * 0.7)
        channel_left.y -= 0.10 * left * (1.0 - span)
        keys["Wing_Channel_L"].data[index].co = channel_left

        channel_right = original.copy()
        right = root_focus if side < 0.0 else 0.0
        channel_right.z += 0.13 * right * math.sin((1.0 - span) * math.pi * 1.8 + y * 0.7)
        channel_right.y -= 0.10 * right * (1.0 - span)
        keys["Wing_Channel_R"].data[index].co = channel_right

        tension = original.copy()
        ripple = math.sin(x * 2.15 + y * 2.85) * (0.018 + 0.025 * wing)
        tension.z += ripple
        tension.x += side * 0.012 * wing * math.cos(y * 2.2)
        keys["Surface_Tension"].data[index].co = tension

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def rig_cast_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_cast_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingDirectCastArmature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()


def create_charge_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT_CastCharge") or bpy.data.materials.new("MAT_CastCharge")
    material.use_nodes = True
    material.diffuse_color = (0.03, 0.58, 0.74, 0.86)
    material.surface_render_method = "DITHERED"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ("Base Color",), (0.008, 0.30, 0.42, 1.0))
    set_input(bsdf, ("Roughness",), 0.10)
    set_input(bsdf, ("IOR",), 1.333)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.50)
    set_input(bsdf, ("Emission Color", "Emission"), (0.0, 0.18, 0.25, 1.0))
    set_input(bsdf, ("Emission Strength",), 0.55)
    material["semantic"] = "aqueous-charge"
    return material


def create_charge_nodes(rig: bpy.types.Object) -> tuple[bpy.types.Object, ...]:
    material = create_charge_material()
    specifications = (
        ("AqueousCharge_L", (0.78, -0.56, 0.24), "wing_L_root", 0.22),
        ("AqueousCharge_R", (-0.78, -0.56, 0.24), "wing_R_root", 0.22),
        ("MuzzleCharge", (0.0, -2.78, 0.08), "body_front", 0.34),
    )
    nodes = []
    for name, location, bone_name, radius in specifications:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=radius, location=location)
        node = bpy.context.object
        node.name = name
        node.data.name = f"{name}Mesh"
        node.data.materials.append(material)
        node["semantic"] = "cast-charge"
        bind_object_to_bone(node, rig, bone_name)
        nodes.append(node)
    return tuple(nodes)


def insert_rotation_curve(bone: bpy.types.PoseBone, values: tuple[tuple[float, float, float], ...]) -> None:
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
        (0.035, -0.025, 0.060),
        (0.085, -0.050, 0.120),
        (0.055, 0.020, 0.155),
        (-0.060, 0.030, -0.090),
        (-0.115, 0.050, -0.155),
        (-0.025, -0.010, -0.025),
        zero,
    )
    right_wing = tuple((x, -y, -z) for x, y, z in left_wing)
    for side, values in (("L", left_wing), ("R", right_wing)):
        insert_rotation_curve(rig.pose.bones[f"wing_{side}_root"], values)
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_mid"],
            tuple((x * 1.14, y * 1.08, z * 1.17) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_tip"],
            tuple((x * 1.25, y * 1.12, z * 1.28) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_web"],
            tuple((x * 0.72, y * 0.74, z * 0.82) for x, y, z in values),
        )

    insert_rotation_curve(rig.pose.bones["body_front"], (
        zero,
        (-0.045, 0.0, 0.0),
        (-0.090, 0.0, 0.0),
        (-0.055, 0.0, 0.0),
        (0.135, 0.0, 0.0),
        (0.205, 0.0, 0.0),
        (0.045, 0.0, 0.0),
        zero,
    ))
    insert_rotation_curve(rig.pose.bones["body_mid"], (
        zero,
        (0.018, 0.0, 0.0),
        (0.038, 0.0, 0.0),
        (0.025, 0.0, 0.0),
        (-0.050, 0.0, 0.0),
        (-0.080, 0.0, 0.0),
        (-0.018, 0.0, 0.0),
        zero,
    ))
    insert_rotation_curve(rig.pose.bones["body_rear"], (
        zero,
        (0.010, 0.0, -0.008),
        (0.024, 0.0, -0.015),
        (0.018, 0.0, 0.010),
        (-0.030, 0.0, 0.026),
        (-0.050, 0.0, 0.042),
        (-0.012, 0.0, 0.012),
        zero,
    ))
    for index, bone_name in enumerate(("tail_01", "tail_02", "tail_03"), start=1):
        multiplier = 0.60 + 0.28 * index
        insert_rotation_curve(rig.pose.bones[bone_name], tuple(
            (0.0, y * multiplier, z * multiplier)
            for y, z in (
                (0.0, 0.0),
                (0.016, -0.010),
                (0.032, -0.020),
                (0.020, 0.012),
                (-0.042, 0.030),
                (-0.068, 0.045),
                (-0.018, 0.012),
                (0.0, 0.0),
            )
        ))
    action.use_fake_user = True
    return action


def create_morph_action(body: bpy.types.Object) -> bpy.types.Action:
    values = {
        "Cast_Gather": (0.0, 0.72, 0.94, 0.70, 0.14, 0.0, 0.0, 0.0),
        "Cast_Compress": (0.0, 0.28, 0.92, 0.76, 0.16, 0.0, 0.0, 0.0),
        "Cast_Aim": (0.0, 0.10, 0.34, 1.0, 0.72, 0.08, 0.0, 0.0),
        "Cast_Recoil": (0.0, 0.0, 0.0, 0.10, 0.48, 1.0, 0.24, 0.0),
        "Cast_Recovery": (0.0, 0.0, 0.0, 0.0, 0.10, 0.30, 0.82, 0.0),
        "Wing_Channel_L": (0.0, 0.58, 0.90, 0.76, 0.18, 0.0, 0.26, 0.0),
        "Wing_Channel_R": (0.0, 0.24, 0.72, 0.96, 0.26, 0.0, 0.18, 0.0),
        "Surface_Tension": (0.12, 0.44, 0.82, 1.0, 0.35, 0.72, 0.38, 0.10),
    }
    assert tuple(values) == MORPH_NAMES
    shape_keys = body.data.shape_keys
    action = bpy.data.actions.new(MORPH_CLIP_NAME)
    shape_keys.animation_data_create()
    shape_keys.animation_data.action = action
    for name, samples in values.items():
        key = shape_keys.key_blocks[name]
        for frame, value in zip(KEY_FRAMES, samples, strict=True):
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame, group=name)
    action.use_fake_user = True
    return action


def create_charge_action(nodes: tuple[bpy.types.Object, ...]) -> bpy.types.Action:
    action = bpy.data.actions.new(f"{CLIP_NAME}_Charge")
    scale_samples = {
        "AqueousCharge_L": (0.02, 0.46, 0.92, 1.0, 0.12, 0.02, 0.02, 0.02),
        "AqueousCharge_R": (0.02, 0.36, 0.82, 1.0, 0.12, 0.02, 0.02, 0.02),
        "MuzzleCharge": (0.02, 0.18, 0.54, 1.0, 0.05, 0.02, 0.02, 0.02),
    }
    for node in nodes:
        node.animation_data_create()
        node.animation_data.action = action
        for frame, value in zip(KEY_FRAMES, scale_samples[node.name], strict=True):
            node.scale = (value, value, value)
            node.keyframe_insert(data_path="scale", frame=frame, group=node.name)
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


def animate_cast(body: bpy.types.Object, rig: bpy.types.Object, charge_nodes: tuple[bpy.types.Object, ...]) -> None:
    armature_action = create_armature_action(rig)
    morph_action = create_morph_action(body)
    charge_action = create_charge_action(charge_nodes)
    for action in (armature_action, morph_action, charge_action):
        configure_animation_curves(action)
    push_nla(rig, armature_action)
    push_nla(body.data.shape_keys, morph_action)
    for node in charge_nodes:
        push_nla(node, charge_action)
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


def write_character_manifest(path: Path, glb_path: Path, body: bpy.types.Object, rig: bpy.types.Object) -> None:
    scene = bpy.context.scene
    muzzle_trajectory = sample_muzzle_trajectory()
    scene.frame_set(FRAME_START)
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
        "projectileAsset": f"{PROJECTILE_VERSION}.glb",
        "releaseFrame": 67,
        "sha256": sha256_file(glb_path),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_character(args: argparse.Namespace) -> None:
    root, body, core = build_geometry()
    configure_action_scene()
    root["assetVersion"] = ASSET_VERSION
    body["assetVersion"] = ASSET_VERSION
    core["assetVersion"] = ASSET_VERSION
    apply_cast_neutral(body)
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
    material = bpy.data.materials.new("MAT_EnemyWaterProjectile")
    material.use_nodes = True
    material.diffuse_color = (0.015, 0.34, 0.48, 0.91)
    material.surface_render_method = "DITHERED"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ("Base Color",), (0.006, 0.20, 0.31, 1.0))
    set_input(bsdf, ("Roughness",), 0.08)
    set_input(bsdf, ("IOR",), 1.333)
    set_input(bsdf, ("Transmission Weight", "Transmission"), 0.68)
    set_input(bsdf, ("Coat Weight", "Coat"), 0.32)
    set_input(bsdf, ("Coat Roughness",), 0.05)
    set_input(bsdf, ("Emission Color", "Emission"), (0.0, 0.11, 0.17, 1.0))
    set_input(bsdf, ("Emission Strength",), 0.32)
    material["semantic"] = "enemy-water-projectile"
    return material


def create_lobed_revolution(
    name: str,
    stations: tuple[tuple[float, float], ...],
    material: bpy.types.Material,
    phase: float,
) -> bpy.types.Object:
    segments = 64
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for ring_index, (y, radius) in enumerate(stations):
        longitudinal = ring_index / (len(stations) - 1)
        centre_x = 0.035 * math.sin(longitudinal * math.pi * 1.7 + phase)
        centre_z = 0.026 * math.cos(longitudinal * math.pi * 2.1 + phase)
        for segment in range(segments):
            theta = math.tau * segment / segments
            lobe = 1.0 + 0.045 * math.sin(theta * 3.0 + y * 4.2 + phase)
            vertices.append((
                centre_x + radius * lobe * math.cos(theta),
                y,
                centre_z + radius * (1.0 - 0.04 * math.cos(theta * 2.0)) * math.sin(theta),
            ))
    for ring_index in range(len(stations) - 1):
        ring_a = ring_index * segments
        ring_b = (ring_index + 1) * segments
        for segment in range(segments):
            next_segment = (segment + 1) % segments
            faces.append((ring_a + segment, ring_b + segment, ring_b + next_segment, ring_a + next_segment))
    front = len(vertices)
    vertices.append((0.0, stations[0][0] - 0.025, 0.0))
    rear = len(vertices)
    vertices.append((0.0, stations[-1][0] + 0.025, 0.0))
    last_ring = (len(stations) - 1) * segments
    for segment in range(segments):
        next_segment = (segment + 1) % segments
        faces.append((front, segment, next_segment))
        faces.append((rear, last_ring + next_segment, last_ring + segment))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=True)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def build_projectile_geometry() -> tuple[bpy.types.Object, tuple[bpy.types.Object, ...]]:
    reset_scene()
    configure_action_scene()
    root = bpy.data.objects.new(PROJECTILE_ROOT, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root["assetVersion"] = PROJECTILE_VERSION
    root["travelAxis"] = "-Y"
    root["geometry"] = "teardrop-water-cluster"
    material = create_projectile_material()

    bulb = create_lobed_revolution(
        PROJECTILE_MESHES[0],
        (
            (-0.64, 0.035),
            (-0.56, 0.20),
            (-0.38, 0.40),
            (-0.12, 0.52),
            (0.14, 0.48),
            (0.34, 0.34),
            (0.54, 0.22),
            (0.72, 0.12),
            (0.86, 0.055),
            (0.92, 0.015),
        ),
        material,
        0.0,
    )
    tail = create_lobed_revolution(
        PROJECTILE_MESHES[1],
        ((0.20, 0.025), (0.28, 0.075), (0.40, 0.105), (0.54, 0.072), (0.67, 0.030)),
        material,
        1.25,
    )
    tail.location = (0.29, 0.0, 0.12)
    tail.rotation_euler[2] = -0.11
    for obj in (bulb, tail):
        obj.parent = root
        obj["semantic"] = "water-projectile-volume"

    positions = {
        "center-anchor": (0.0, -0.04, 0.0),
        "impact-anchor": (0.0, -0.67, 0.0),
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
    return root, (bulb, tail)


def combined_world_bounds(objects: tuple[bpy.types.Object, ...]) -> tuple[list[float], list[float]]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        [min(point[axis] for point in points) for axis in range(3)],
        [max(point[axis] for point in points) for axis in range(3)],
    )


def three_bounds(minimum: list[float], maximum: list[float]) -> dict[str, list[float]]:
    corners = [
        blender_to_three((x, y, z))
        for x in (minimum[0], maximum[0])
        for y in (minimum[1], maximum[1])
        for z in (minimum[2], maximum[2])
    ]
    low = [min(point[axis] for point in corners) for axis in range(3)]
    high = [max(point[axis] for point in corners) for axis in range(3)]
    return {"min": low, "max": high, "size": [round(high[i] - low[i], 6) for i in range(3)]}


def write_projectile_manifest(path: Path, glb_path: Path, meshes: tuple[bpy.types.Object, ...]) -> None:
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
        "motionProfile": "direct-with-short-fluid-tail",
        "geometry": "teardrop-water-cluster",
        "surfaceContinuity": "single-primary-profile",
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
    print("DIRECT_CAST_EXPORT_OK", json.dumps({
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

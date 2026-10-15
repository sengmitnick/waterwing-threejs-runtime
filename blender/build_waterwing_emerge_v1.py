"""Build the dedicated Waterwing water-condensation emergence asset."""

from __future__ import annotations

import argparse
import json
import math
import sys
import traceback
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_waterwing_forward_v1 import (  # noqa: E402
    assign_skin_weights,
    bind_anchors_and_core,
    blender_to_three,
    build_geometry,
    configure_animation_curves,
    create_armature,
    export_glb,
    save_blend,
    sha256_file,
    shape_context,
    world_bounds,
)
from waterwing_forward_v1_config import ANCHOR_NAMES, BODY_NAME  # noqa: E402
from waterwing_emerge_v1_config import (  # noqa: E402
    ASSET_VERSION,
    CLIP_NAME,
    DEFAULT_BLEND_PATH,
    DEFAULT_GLB_PATH,
    DEFAULT_MANIFEST_PATH,
    DROPLETS_NAME,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_CLIP_NAME,
    MORPH_NAMES,
    PHASE_FRAMES,
    REVIEW_FRAMES,
    REVIEW_VIEWS,
    RIPPLE_NAME,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--output-glb", type=Path, default=DEFAULT_GLB_PATH)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    return parser.parse_args(argv)


def create_emergence_shape_keys(body: bpy.types.Object) -> None:
    """Author six independent relative targets around the complete neutral body."""

    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}

    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = shape_context(original)
        side = 1.0 if x >= 0.0 else -1.0

        # A thin but non-degenerate closed water mass.  Every axis retains a
        # positive scale, so the source manifold never collapses into a plane.
        puddle = original.copy()
        puddle.x = x * (0.57 + 0.07 * centre)
        puddle.y = -0.04 + (y + 0.04) * (0.56 + 0.05 * tail)
        puddle.z = -0.41 + (z + 0.05) * 0.115
        puddle.z += 0.025 * math.sin(x * 2.05 + y * 1.65) * (0.35 + 0.65 * wing)
        keys["Emerge_Puddle"].data[index].co = puddle

        # The centre stays heavy while two thick wing roots become readable.
        wing_bud = original.copy()
        wing_bud.x *= 1.0 - 0.19 * wing * (0.22 + 0.78 * span)
        wing_bud.y += 0.10 * wing * span
        wing_bud.z += 0.30 * wing * (1.0 - 0.72 * span) + 0.055 * centre
        keys["Emerge_WingBud"].data[index].co = wing_bud

        # The torso rises first, leaving a soft water tether at the tail.
        rise = original.copy()
        rise.z += 0.37 * centre + 0.15 * wing * (1.0 - 0.55 * span)
        rise.y -= 0.07 * centre
        rise.z -= 0.17 * tail * (0.35 + 0.65 * min(1.0, max(0.0, (y - 1.55) / 2.6)))
        keys["Emerge_Rise"].data[index].co = rise

        # A broad upward unfurl rather than a rigid plate rotation.
        unfurl = original.copy()
        unfurl.x *= 1.0 + 0.045 * wing * (0.45 + 0.55 * span)
        unfurl.y -= 0.15 * wing * span
        unfurl.z += 0.31 * wing * (0.30 + 0.70 * span)
        keys["Emerge_Unfurl"].data[index].co = unfurl

        droplets = original.copy()
        surface_wave = math.sin(x * 2.6 + y * 1.9) * math.cos(y * 2.45 - x * 0.8)
        droplets.z += 0.052 * surface_wave * (0.28 + 0.72 * (wing + centre * 0.45))
        droplets.x += side * 0.022 * wing * math.sin(y * 2.2)
        droplets.y += 0.018 * (centre + tail) * math.cos(x * 1.8)
        keys["Emerge_Droplets"].data[index].co = droplets

        stabilize = original.copy()
        stabilize.z += 0.085 * wing * (0.30 + 0.70 * span) + 0.035 * centre
        stabilize.x *= 1.0 + 0.012 * wing
        stabilize.y -= 0.022 * wing * span
        keys["Emerge_Stabilize"].data[index].co = stabilize

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def rig_emergence_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_emergence_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingEmergeArmature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()


def create_emergence_ripple(root: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        location=(0.0, 0.08, -0.39),
        major_segments=72,
        minor_segments=12,
        major_radius=2.30,
        minor_radius=0.055,
    )
    ripple = bpy.context.object
    ripple.name = RIPPLE_NAME
    ripple.scale = (1.0, 0.63, 0.72)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ripple.data.materials.append(material)
    ripple.parent = root
    ripple["semantic"] = "emergence-water-ring"
    return ripple


def create_emergence_droplets(root: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    specs = (
        (-2.18, -0.46, -0.22, 0.12, 0.30),
        (-1.72, -1.18, -0.19, 0.10, 0.24),
        (-1.08, 0.54, -0.14, 0.13, 0.34),
        (-0.54, -1.54, -0.20, 0.09, 0.21),
        (0.46, -1.42, -0.17, 0.10, 0.27),
        (1.04, 0.62, -0.15, 0.12, 0.32),
        (1.68, -1.10, -0.20, 0.10, 0.23),
        (2.22, -0.38, -0.21, 0.12, 0.29),
        (-1.34, 1.05, -0.18, 0.09, 0.20),
        (1.30, 1.12, -0.17, 0.09, 0.22),
    )
    droplets = []
    for x, y, z, radius, height in specs:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=(x, y, z))
        droplet = bpy.context.object
        droplet.scale = (0.84, 0.84, height / radius)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        droplets.append(droplet)

    bpy.ops.object.select_all(action="DESELECT")
    for droplet in droplets:
        droplet.select_set(True)
    bpy.context.view_layer.objects.active = droplets[0]
    bpy.ops.object.join()
    cluster = bpy.context.object
    cluster.name = DROPLETS_NAME
    cluster.data.materials.append(material)
    bpy.context.scene.cursor.location = (0.0, 0.0, -0.18)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
    cluster.parent = root
    cluster["semantic"] = "emergence-condensation-droplets"
    return cluster


def key_bone_rotations(
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

    left_root = (
        (0.015, -0.010, -0.018), (0.025, -0.015, -0.026), (0.035, -0.020, -0.036),
        (0.040, -0.022, -0.042), (0.035, -0.020, -0.034), (0.025, -0.014, -0.024),
        (0.005, -0.005, -0.010), (-0.055, 0.030, 0.065), (-0.018, 0.010, 0.020), zero,
    )
    for side, sign in (("L", 1.0), ("R", -1.0)):
        root_values = tuple((x, y * sign, z * sign) for x, y, z in left_root)
        mid_values = tuple((x * 1.14, y * 1.18, z * 1.22) for x, y, z in root_values)
        tip_values = tuple((x * 1.22, y * 1.28, z * 1.38) for x, y, z in root_values)
        web_values = tuple((x * 0.72, y * 0.78, z * 0.84) for x, y, z in root_values)
        key_bone_rotations(rig.pose.bones[f"wing_{side}_root"], root_values)
        key_bone_rotations(rig.pose.bones[f"wing_{side}_mid"], mid_values)
        key_bone_rotations(rig.pose.bones[f"wing_{side}_tip"], tip_values)
        key_bone_rotations(rig.pose.bones[f"wing_{side}_web"], web_values)

    front_values = (
        (-0.020, 0.0, 0.0), (-0.030, 0.0, 0.0), (-0.040, 0.0, 0.0),
        (-0.045, 0.0, 0.0), (-0.040, 0.0, 0.0), (-0.030, 0.0, 0.0),
        (-0.010, 0.0, 0.0), (0.028, 0.0, 0.0), (0.012, 0.0, 0.0), zero,
    )
    key_bone_rotations(rig.pose.bones["body_front"], front_values)
    key_bone_rotations(
        rig.pose.bones["body_mid"],
        tuple((x * -0.38, 0.0, 0.0) for x, _, _ in front_values),
    )
    key_bone_rotations(
        rig.pose.bones["body_rear"],
        tuple((x * -0.62, 0.0, 0.0) for x, _, _ in front_values),
    )

    tail_values = (
        (0.0, 0.020, -0.015), (0.0, 0.030, -0.020), (0.0, 0.040, -0.025),
        (0.0, 0.045, -0.026), (0.0, 0.042, -0.020), (0.0, 0.032, -0.012),
        (0.0, 0.015, 0.008), (0.0, -0.025, 0.020), (0.0, -0.010, 0.010), zero,
    )
    key_bone_rotations(rig.pose.bones["tail_01"], tail_values)
    key_bone_rotations(
        rig.pose.bones["tail_02"],
        tuple((x, y * 1.22, z * 1.28) for x, y, z in tail_values),
    )
    key_bone_rotations(
        rig.pose.bones["tail_03"],
        tuple((x, y * 1.42, z * 1.52) for x, y, z in tail_values),
    )
    action.use_fake_user = True
    return action


def create_morph_action(body: bpy.types.Object) -> bpy.types.Action:
    values = {
        "Emerge_Puddle": (1.0, 0.90, 0.72, 0.64, 0.38, 0.16, 0.04, 0.0, 0.0, 0.0),
        "Emerge_WingBud": (0.0, 0.58, 1.0, 0.92, 0.68, 0.38, 0.12, 0.0, 0.0, 0.0),
        "Emerge_Rise": (0.0, 0.06, 0.18, 0.30, 0.68, 1.0, 0.72, 0.28, 0.08, 0.0),
        "Emerge_Unfurl": (0.0, 0.0, 0.0, 0.04, 0.12, 0.22, 0.48, 0.82, 0.38, 0.0),
        "Emerge_Droplets": (0.24, 0.68, 1.0, 0.88, 0.72, 0.58, 0.38, 0.22, 0.10, 0.0),
        "Emerge_Stabilize": (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.04, 0.12, 0.26, 0.18),
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


def create_aux_action(
    obj: bpy.types.Object,
    action_name: str,
    scales: tuple[tuple[float, float, float], ...],
    z_offsets: tuple[float, ...],
) -> bpy.types.Action:
    assert len(scales) == len(KEY_FRAMES) == len(z_offsets)
    action = bpy.data.actions.new(action_name)
    obj.animation_data_create()
    obj.animation_data.action = action
    base_z = obj.location.z
    for frame, scale, z_offset in zip(KEY_FRAMES, scales, z_offsets, strict=True):
        obj.scale = scale
        obj.location.z = base_z + z_offset
        obj.keyframe_insert(data_path="scale", frame=frame, group=obj.name)
        obj.keyframe_insert(data_path="location", frame=frame, group=obj.name)
    action.use_fake_user = True
    return action


def push_nla(owner, action: bpy.types.Action) -> None:
    track = owner.animation_data.nla_tracks.new()
    track.name = CLIP_NAME
    strip = track.strips.new(CLIP_NAME, FRAME_START, action)
    strip.action_frame_start = FRAME_START
    strip.action_frame_end = FRAME_END
    strip.frame_start = FRAME_START
    strip.frame_end = FRAME_END
    strip.extrapolation = "NOTHING"
    owner.animation_data.action = None


def animate_emergence(
    body: bpy.types.Object,
    rig: bpy.types.Object,
    core: bpy.types.Object,
    ripple: bpy.types.Object,
    droplets: bpy.types.Object,
) -> None:
    armature_action = create_armature_action(rig)
    morph_action = create_morph_action(body)
    ripple_scales = (
        (0.34, 0.34, 0.55), (0.66, 0.66, 0.72), (0.98, 0.98, 0.90),
        (1.16, 1.16, 1.0), (1.02, 1.02, 0.88), (0.78, 0.78, 0.72),
        (0.53, 0.53, 0.56), (0.31, 0.31, 0.40), (0.12, 0.12, 0.18), (0.001, 0.001, 0.001),
    )
    droplet_scales = (
        (0.05, 0.05, 0.05), (0.42, 0.42, 0.48), (0.92, 0.92, 1.05),
        (1.08, 1.08, 1.18), (0.88, 0.88, 1.02), (0.68, 0.68, 0.86),
        (0.46, 0.46, 0.66), (0.27, 0.27, 0.45), (0.10, 0.10, 0.18), (0.001, 0.001, 0.001),
    )
    ripple_action = create_aux_action(
        ripple,
        f"{CLIP_NAME}_Ripple",
        ripple_scales,
        (0.0, 0.015, 0.028, 0.035, 0.025, 0.015, 0.008, 0.0, 0.0, 0.0),
    )
    droplet_action = create_aux_action(
        droplets,
        f"{CLIP_NAME}_Droplets",
        droplet_scales,
        (-0.04, 0.0, 0.12, 0.26, 0.42, 0.52, 0.39, 0.24, 0.10, 0.0),
    )
    core_action = create_aux_action(
        core,
        f"{CLIP_NAME}_Core",
        (
            (0.001, 0.001, 0.001), (0.04, 0.04, 0.04), (0.12, 0.12, 0.12),
            (0.20, 0.20, 0.20), (0.42, 0.42, 0.42), (0.64, 0.64, 0.64),
            (0.82, 0.82, 0.82), (0.94, 0.94, 0.94), (1.0, 1.0, 1.0), (1.0, 1.0, 1.0),
        ),
        (0.0,) * len(KEY_FRAMES),
    )
    for action in (armature_action, morph_action, ripple_action, droplet_action, core_action):
        configure_animation_curves(action)
    push_nla(rig, armature_action)
    push_nla(body.data.shape_keys, morph_action)
    push_nla(ripple, ripple_action)
    push_nla(droplets, droplet_action)
    push_nla(core, core_action)
    bpy.context.scene.frame_set(FRAME_START)


def write_manifest(path: Path, glb_path: Path, body: bpy.types.Object, rig: bpy.types.Object) -> None:
    bpy.context.scene.frame_set(FRAME_END)
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
        "action": "emerge",
        "clip": CLIP_NAME,
        "fps": FPS,
        "frameRange": [FRAME_START, FRAME_END],
        "durationSeconds": (FRAME_END - FRAME_START) / FPS,
        "loop": False,
        "rootMotion": False,
        "phaseFrames": PHASE_FRAMES,
        "coordinateConvention": {
            "blender": "right-handed Z-up, creature forward -Y",
            "three": "right-handed Y-up, creature forward +Z",
            "mapping": "(x, y, z) -> (x, z, -y)",
        },
        "boundsAtFinalPose": {
            "blender": {"min": minimum, "max": maximum},
            "three": {"min": blender_to_three(minimum), "max": blender_to_three(maximum)},
        },
        "mesh": {"vertices": len(body.data.vertices), "polygons": len(body.data.polygons)},
        "bones": [bone.name for bone in rig.data.bones],
        "morphs": list(MORPH_NAMES),
        "animations": [CLIP_NAME],
        "anchors": anchors,
        "auxiliaryMeshes": [RIPPLE_NAME, DROPLETS_NAME],
        "review": {"frames": list(REVIEW_FRAMES), "views": list(REVIEW_VIEWS)},
        "sha256": sha256_file(glb_path),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    root, body, core = build_geometry()
    scene = bpy.context.scene
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    root["assetVersion"] = ASSET_VERSION
    root["action"] = "emerge"
    body["assetVersion"] = ASSET_VERSION
    core["assetVersion"] = ASSET_VERSION
    rig = create_armature(root)
    rig["assetVersion"] = ASSET_VERSION
    rig["rigContract"] = ASSET_VERSION
    rig_emergence_body(body, rig)
    bind_anchors_and_core(rig, core)
    material = bpy.data.materials["MAT_WaterShell"]
    ripple = create_emergence_ripple(root, material)
    droplets = create_emergence_droplets(root, material)
    animate_emergence(body, rig, core, ripple, droplets)
    save_blend(args.output_blend)
    export_glb(args.output_glb)
    write_manifest(args.manifest, args.output_glb, body, rig)
    print("EMERGENCE_EXPORT_OK", json.dumps({
        "vertices": len(body.data.vertices),
        "polygons": len(body.data.polygons),
        "blend": str(args.output_blend),
        "glb": str(args.output_glb),
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

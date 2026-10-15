"""Build the dedicated non-looping Waterwing lateral-dodge asset."""

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
    smoothstep,
    world_bounds,
)
from waterwing_forward_v1_config import ANCHOR_NAMES, BODY_NAME  # noqa: E402
from waterwing_dodge_v1_config import (  # noqa: E402
    ASSET_VERSION,
    CLIP_NAME,
    DEFAULT_BLEND_PATH,
    DEFAULT_GLB_PATH,
    DEFAULT_MANIFEST_PATH,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_CLIP_NAME,
    MORPH_NAMES,
    REVIEW_FRAMES,
    REVIEW_VIEWS,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--output-glb", type=Path, default=DEFAULT_GLB_PATH)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    return parser.parse_args(argv)


def apply_dodge_neutral(body: bpy.types.Object) -> None:
    """Start from a calm, thick hover silhouette instead of a flat T-pose."""

    for vertex in body.data.vertices:
        x, y, z, span, wing, centre, tail = shape_context(vertex.co)
        vertex.co.z = z + 0.11 * wing * (0.25 + 0.75 * span) + 0.028 * centre
        vertex.co.y = y - 0.035 * wing * span + 0.018 * tail
        vertex.co.x = x * (1.0 + 0.01 * wing)
    body.data.update()


def create_dodge_shape_keys(body: bpy.types.Object) -> None:
    """Author the readable dodge silhouette in morph space.

    The game layer moves the actor through the world.  These targets only form
    the preload, bank, streamlined burst, counter-sweep brake, and hover return.
    """

    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}

    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = shape_context(original)
        side = 1.0 if x >= 0.0 else -1.0
        longitudinal = smoothstep((y + 2.72) / 6.90)
        nose_bias = 1.0 - smoothstep((y + 0.15) / 1.45)
        rear_bias = smoothstep((y - 0.20) / 2.65)

        anticipate = original.copy()
        anticipate.x -= 0.20 * centre * (0.72 + 0.28 * nose_bias)
        anticipate.x += 0.14 * tail**1.25
        anticipate.y += 0.27 * wing * (0.35 + 0.65 * span)
        anticipate.z += 0.24 * wing * (0.25 + 0.75 * span)
        anticipate.z *= 1.0 + 0.045 * centre
        keys["Dodge_Anticipate"].data[index].co = anticipate

        bank = original.copy()
        bank.x += 0.42 * centre * (0.70 * nose_bias - 0.46 * rear_bias)
        bank.x += 0.16 * wing * (1.0 - longitudinal)
        bank.y += 0.10 * side * wing * span
        bank.z -= 0.40 * side * wing * (0.22 + 0.78 * span)
        bank.z -= 0.09 * side * centre
        keys["Dodge_Bank"].data[index].co = bank

        streamline = original.copy()
        streamline.x *= 1.0 - 0.16 * wing * (0.30 + 0.70 * span)
        streamline.y += 0.76 * wing * (0.30 + 0.70 * span)
        streamline.z -= 0.47 * wing * (0.20 + 0.80 * span)
        streamline.z *= 1.0 - 0.075 * centre
        streamline.y = -0.28 + (streamline.y + 0.28) * (1.0 + 0.035 * centre)
        keys["Dodge_Streamline"].data[index].co = streamline

        brake = original.copy()
        brake.x *= 1.0 + 0.075 * wing * (0.20 + 0.80 * span)
        brake.y -= 0.33 * wing * (0.28 + 0.72 * span)
        brake.z += 0.36 * wing * (0.25 + 0.75 * span)
        brake.x -= 0.14 * centre * rear_bias
        brake.z += 0.055 * centre * nose_bias
        keys["Dodge_Brake"].data[index].co = brake

        recovery = original.copy()
        recovery.z += 0.16 * wing * (0.30 + 0.70 * span) + 0.035 * centre
        recovery.y -= 0.045 * wing * span
        recovery.x += side * 0.026 * wing * math.sin(y * 1.7)
        recovery.z += 0.018 * math.sin(x * 1.45 + y * 1.9)
        keys["Dodge_Recovery"].data[index].co = recovery

        fold_left = original.copy()
        left = wing if side > 0.0 else 0.0
        fold_left.x *= 1.0 - 0.20 * left * (0.25 + 0.75 * span)
        fold_left.y += 0.49 * left * span
        fold_left.z -= 0.33 * left * span**1.18
        keys["Wing_Fold_L"].data[index].co = fold_left

        fold_right = original.copy()
        right = wing if side < 0.0 else 0.0
        fold_right.x *= 1.0 - 0.24 * right * (0.25 + 0.75 * span)
        fold_right.y += 0.58 * right * span
        fold_right.z -= 0.40 * right * span**1.18
        keys["Wing_Fold_R"].data[index].co = fold_right

        counter = original.copy()
        counter.x -= 0.88 * tail**1.30
        counter.y += 0.13 * tail
        counter.z += 0.12 * tail * math.sin((y - 1.45) * 1.25)
        counter.x -= 0.10 * centre * rear_bias
        keys["Tail_CounterSweep"].data[index].co = counter

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def rig_dodge_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_dodge_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingDodgeArmature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()


def insert_rotation_curve(
    bone: bpy.types.PoseBone,
    values: tuple[tuple[float, float, float], ...],
) -> None:
    bone.rotation_mode = "XYZ"
    for frame, rotation in zip(KEY_FRAMES, values, strict=True):
        # Shape keys carry the readable silhouette.  Keeping the armature at
        # roughly one quarter of the authored guide angles prevents the broad
        # single-piece membrane from developing weight-driven elbow creases.
        bone.rotation_euler = tuple(component * 0.26 for component in rotation)
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

    body_front = (
        zero,
        (-0.012, 0.018, -0.030),
        (0.010, -0.052, 0.072),
        (0.018, -0.078, 0.105),
        (-0.010, 0.038, -0.052),
        (0.005, -0.012, 0.018),
        (0.003, 0.006, -0.004),
    )
    body_mid = (
        zero,
        (0.008, 0.022, -0.018),
        (-0.006, -0.060, 0.050),
        (-0.012, -0.092, 0.070),
        (0.006, 0.047, -0.038),
        (-0.003, -0.015, 0.012),
        (0.002, 0.005, -0.003),
    )
    body_rear = (
        zero,
        (0.004, 0.015, 0.020),
        (-0.004, -0.038, -0.040),
        (-0.008, -0.054, -0.062),
        (0.006, 0.060, 0.046),
        (-0.003, -0.018, -0.014),
        (0.001, 0.004, 0.002),
    )
    insert_rotation_curve(rig.pose.bones["body_front"], body_front)
    insert_rotation_curve(rig.pose.bones["body_mid"], body_mid)
    insert_rotation_curve(rig.pose.bones["body_rear"], body_rear)

    left_wing = (
        zero,
        (0.036, -0.014, 0.020),
        (-0.058, 0.032, -0.046),
        (-0.082, 0.045, -0.062),
        (0.066, -0.026, 0.044),
        (-0.018, 0.008, -0.012),
        (0.004, -0.002, 0.003),
    )
    right_wing = tuple((x, -y, -z) for x, y, z in left_wing)
    for side, values in (("L", left_wing), ("R", right_wing)):
        insert_rotation_curve(rig.pose.bones[f"wing_{side}_root"], values)
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_mid"],
            tuple((x * 1.08, y * 1.05, z * 1.08) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_tip"],
            tuple((x * 1.16, y * 1.08, z * 1.14) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_web"],
            tuple((x * 0.72, y * 0.78, z * 0.80) for x, y, z in values),
        )

    tail = (
        zero,
        (0.006, 0.020, 0.030),
        (-0.004, -0.028, -0.052),
        (-0.008, -0.038, -0.068),
        (0.010, 0.070, 0.098),
        (-0.004, -0.022, -0.028),
        (0.002, 0.005, 0.006),
    )
    insert_rotation_curve(rig.pose.bones["tail_01"], tail)
    insert_rotation_curve(
        rig.pose.bones["tail_02"],
        tuple((x * 1.04, y * 1.12, z * 1.14) for x, y, z in tail),
    )
    insert_rotation_curve(
        rig.pose.bones["tail_03"],
        tuple((x * 1.08, y * 1.20, z * 1.22) for x, y, z in tail),
    )
    action.use_fake_user = True
    return action


def create_morph_action(body: bpy.types.Object) -> bpy.types.Action:
    values = {
        "Dodge_Anticipate": (0.00, 1.00, 0.28, 0.00, 0.00, 0.00, 0.00),
        "Dodge_Bank": (0.00, 0.12, 0.78, 1.00, 0.24, 0.05, 0.00),
        "Dodge_Streamline": (0.00, 0.06, 0.76, 1.00, 0.18, 0.00, 0.00),
        "Dodge_Brake": (0.00, 0.00, 0.00, 0.05, 1.00, 0.34, 0.00),
        "Dodge_Recovery": (0.08, 0.00, 0.00, 0.00, 0.16, 0.72, 0.36),
        "Wing_Fold_L": (0.00, 0.58, 0.88, 0.72, 0.10, 0.00, 0.02),
        "Wing_Fold_R": (0.00, 0.72, 1.00, 0.94, 0.06, 0.00, 0.02),
        "Tail_CounterSweep": (0.00, 0.00, 0.10, 0.28, 1.00, 0.42, 0.08),
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


def animate_dodge(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    armature_action = create_armature_action(rig)
    morph_action = create_morph_action(body)
    configure_animation_curves(armature_action)
    configure_animation_curves(morph_action)
    push_nla(rig, armature_action)
    push_nla(body.data.shape_keys, morph_action)
    bpy.context.scene.frame_set(FRAME_START)


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
        anchors.append({
            "name": name,
            "blender": [round(value, 6) for value in location],
            "three": blender_to_three(location),
        })
    phases = [
        {"name": "hover", "frame": 1, "timeSeconds": 0.0},
        {"name": "anticipate", "frame": 10, "timeSeconds": 0.3},
        {"name": "burst", "frame": 30, "timeSeconds": 29 / FPS},
        {"name": "brake", "frame": 43, "timeSeconds": 42 / FPS},
        {"name": "recover", "frame": 76, "timeSeconds": 2.5},
    ]
    manifest = {
        "assetVersion": ASSET_VERSION,
        "action": "lateral-dodge",
        "clip": CLIP_NAME,
        "fps": FPS,
        "frameRange": [FRAME_START, FRAME_END],
        "durationSeconds": (FRAME_END - FRAME_START) / FPS,
        "loop": False,
        "rootMotion": False,
        "gameTranslationAxis": "+X",
        "motionPolicy": {
            "root": "static",
            "worldTranslation": "game-layer",
            "primaryDeformation": "shape-keys",
            "boneAssist": "subtle",
        },
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
        "phases": phases,
        "review": {
            "frames": list(REVIEW_FRAMES),
            "views": list(REVIEW_VIEWS),
            "mode": "clay",
            "expectedClayRenders": len(REVIEW_FRAMES) * len(REVIEW_VIEWS),
        },
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
    body["assetVersion"] = ASSET_VERSION
    core["assetVersion"] = ASSET_VERSION
    apply_dodge_neutral(body)
    rig = create_armature(root)
    rig["assetVersion"] = ASSET_VERSION
    rig["rigContract"] = ASSET_VERSION
    rig_dodge_body(body, rig)
    bind_anchors_and_core(rig, core)
    animate_dodge(body, rig)
    save_blend(args.output_blend)
    export_glb(args.output_glb)
    write_manifest(args.manifest, args.output_glb, body, rig)
    print("DODGE_EXPORT_OK", json.dumps({
        "vertices": len(body.data.vertices),
        "polygons": len(body.data.polygons),
        "blend": str(args.output_blend),
        "glb": str(args.output_glb),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

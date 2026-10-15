"""Build the corrected, staged Waterwing lateral-dodge v2 asset."""

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
from waterwing_forward_v1_config import ANCHOR_NAMES, Y_MIN  # noqa: E402
from waterwing_rounded_nose import NOSE_RING_SEGMENTS  # noqa: E402
from waterwing_dodge_v2_config import (  # noqa: E402
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
    """Give the dodge a thick, calm hover basis with broad wing roots."""

    for vertex in body.data.vertices:
        x, y, z, span, wing, centre, tail = shape_context(vertex.co)
        vertex.co.z = z + 0.10 * wing * (0.28 + 0.72 * span) + 0.024 * centre
        vertex.co.y = y - 0.025 * wing * span + 0.012 * tail
        vertex.co.x = x * (1.0 + 0.008 * wing + 0.008 * centre)
    body.data.update()


def local_midline(x: float, y: float, span: float, centre: float, tail: float, wing: float) -> float:
    """Approximate the neutral loft centre surface for thickness-safe offsets."""

    # The rounded nose grows out of the water mass before the wing lift starts.
    # Fading the lift in across the first 56 cm prevents the old raised wedge
    # from folding the small front rings into an angular beak.
    front_blend = smoothstep((y - Y_MIN) / 0.56)
    wing_lift = front_blend * (
        0.54
        * span**2.35
        * (1.0 - tail)
        * (0.86 + 0.14 * math.cos((y + 0.35) * 1.25))
    )
    dorsal = 0.05 * math.exp(-((abs(x) / 1.05) ** 2.0))
    neutral_lift = 0.10 * wing * (0.28 + 0.72 * span) + 0.024 * centre
    return wing_lift + dorsal + neutral_lift


def create_dodge_shape_keys(body: bpy.types.Object) -> None:
    """Create broad, additive silhouettes without collapsing the wing roots."""

    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}

    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = shape_context(original)
        side = 1.0 if x >= 0.0 else -1.0
        nose_bias = 1.0 - smoothstep((y + 0.12) / 1.55)
        rear_bias = smoothstep((y - 0.20) / 2.55)
        inner_wing = wing * (1.0 - smoothstep((span - 0.26) / 0.48))
        front_blend = smoothstep((y - Y_MIN) / 0.56)
        midline = local_midline(x, y, span, centre, tail, wing)
        surface_sign = 1.0 if z >= midline else -1.0

        anticipate = original.copy()
        anticipate.y = -0.30 + (y + 0.30) * (1.0 - 0.035 * centre)
        anticipate.y += 0.14 * wing * (0.30 + 0.70 * span)
        anticipate.z += 0.20 * wing * (0.25 + 0.75 * span)
        anticipate.x *= 1.0 + 0.018 * centre
        anticipate.z += surface_sign * 0.026 * centre
        keys["Dodge_Anticipate"].data[index].co = anticipate

        bank = original.copy()
        bank.x += 0.08 * centre * (0.66 * nose_bias - 0.38 * rear_bias)
        bank.y += 0.055 * side * wing * span
        bank.z -= 0.19 * side * wing * (0.22 + 0.78 * span)
        bank.z -= 0.034 * side * centre
        keys["Dodge_Bank"].data[index].co = bank

        streamline = original.copy()
        streamline.x *= 1.0 - 0.052 * wing * (0.28 + 0.72 * span)
        streamline.y += 0.34 * wing * (0.30 + 0.70 * span)
        streamline.z -= 0.21 * wing * (0.18 + 0.82 * span)
        streamline.y = -0.30 + (streamline.y + 0.30) * (1.0 + 0.018 * centre)
        keys["Dodge_Streamline"].data[index].co = streamline

        # This target is intentionally additive.  It restores the elliptical
        # chest and inner-wing thickness while bank/streamline/sweep overlap.
        corrective = original.copy()
        # Expand around the local centreline instead of adding a fixed signed
        # offset.  The latter moved the x==0 pole to one side and produced a
        # pointed mushroom kink at the exact burst frames.  The front fade
        # keeps the six rounded nose rings cohesive while the chest and inner
        # wings retain their springy water-volume correction.
        corrective.x *= 1.0 + front_blend * (0.070 * centre + 0.030 * inner_wing)
        corrective.z += (
            front_blend
            * surface_sign
            * (0.075 * centre + 0.060 * inner_wing)
        )
        corrective.y -= 0.018 * front_blend * centre * nose_bias
        keys["Dodge_Burst_Corrective"].data[index].co = corrective

        # First of two unfold stages: broaden the silhouette without snapping
        # all the way into the high brake pose.
        buffer_pose = original.copy()
        buffer_pose.x *= 1.0 + 0.025 * wing * (0.22 + 0.78 * span)
        buffer_pose.y += 0.10 * wing * (0.22 + 0.78 * span)
        buffer_pose.z -= 0.055 * wing * (0.18 + 0.82 * span)
        buffer_pose.z += surface_sign * 0.026 * inner_wing
        keys["Dodge_Burst_Buffer"].data[index].co = buffer_pose

        brake = original.copy()
        brake.x *= 1.0 + 0.045 * wing * (0.18 + 0.82 * span)
        brake.y -= 0.22 * wing * (0.28 + 0.72 * span)
        brake.z += 0.22 * wing * (0.24 + 0.76 * span)
        brake.x -= 0.075 * centre * rear_bias
        brake.z += surface_sign * 0.025 * centre
        keys["Dodge_Brake"].data[index].co = brake

        recovery = original.copy()
        recovery.z += 0.085 * wing * (0.30 + 0.70 * span) + surface_sign * 0.018 * centre
        recovery.y -= 0.026 * wing * span
        recovery.x += side * 0.014 * wing * math.sin(y * 1.55)
        recovery.z += 0.012 * math.sin(x * 1.25 + y * 1.70)
        keys["Dodge_Recovery"].data[index].co = recovery

        sweep_left = original.copy()
        left = wing if side > 0.0 else 0.0
        sweep_left.x *= 1.0 - 0.060 * left * (0.24 + 0.76 * span)
        sweep_left.y += 0.24 * left * (0.25 + 0.75 * span)
        sweep_left.z -= 0.17 * left * span**1.12
        keys["Wing_Sweep_L"].data[index].co = sweep_left

        sweep_right = original.copy()
        right = wing if side < 0.0 else 0.0
        sweep_right.x *= 1.0 - 0.066 * right * (0.24 + 0.76 * span)
        sweep_right.y += 0.27 * right * (0.25 + 0.75 * span)
        sweep_right.z -= 0.19 * right * span**1.12
        keys["Wing_Sweep_R"].data[index].co = sweep_right

        counter = original.copy()
        counter.x -= 0.62 * tail**1.28
        counter.y += 0.085 * tail
        counter.z += 0.075 * tail * math.sin((y - 1.45) * 1.18)
        counter.x -= 0.055 * centre * rear_bias
        keys["Tail_CounterSweep"].data[index].co = counter

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def rig_dodge_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_dodge_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingDodgeV2Armature", type="ARMATURE")
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
        # Morphs carry the silhouette.  Bone motion only supplies a tiny organic
        # delay and remains far below the membrane-folding range from v1.
        bone.rotation_euler = tuple(component * 0.10 for component in rotation)
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
        (-0.010, 0.008, -0.018),
        (0.008, -0.026, 0.036),
        (0.006, -0.020, 0.028),
        (-0.005, 0.012, -0.016),
        (-0.004, 0.008, -0.010),
        zero,
    )
    body_mid = tuple((-x * 0.55, y * 0.72, z * 0.62) for x, y, z in body_front)
    body_rear = tuple((-x * 0.72, y * 0.55, -z * 0.58) for x, y, z in body_front)
    insert_rotation_curve(rig.pose.bones["body_front"], body_front)
    insert_rotation_curve(rig.pose.bones["body_mid"], body_mid)
    insert_rotation_curve(rig.pose.bones["body_rear"], body_rear)

    left_wing = (
        zero,
        (0.022, -0.010, 0.016),
        (-0.032, 0.017, -0.026),
        (-0.024, 0.012, -0.020),
        (0.017, -0.008, 0.013),
        (0.011, -0.005, 0.009),
        zero,
    )
    right_wing = tuple((x, -y, -z) for x, y, z in left_wing)
    for side, values in (("L", left_wing), ("R", right_wing)):
        insert_rotation_curve(rig.pose.bones[f"wing_{side}_root"], values)
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_mid"],
            tuple((x * 1.04, y * 1.03, z * 1.04) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_tip"],
            tuple((x * 1.08, y * 1.05, z * 1.07) for x, y, z in values),
        )
        insert_rotation_curve(
            rig.pose.bones[f"wing_{side}_web"],
            tuple((x * 0.68, y * 0.72, z * 0.74) for x, y, z in values),
        )

    tail = (
        zero,
        (0.003, 0.012, 0.018),
        (-0.003, -0.020, -0.030),
        (-0.002, -0.014, -0.022),
        (0.004, 0.030, 0.040),
        (0.006, 0.046, 0.060),
        zero,
    )
    insert_rotation_curve(rig.pose.bones["tail_01"], tail)
    insert_rotation_curve(
        rig.pose.bones["tail_02"],
        tuple((x * 1.04, y * 1.08, z * 1.10) for x, y, z in tail),
    )
    insert_rotation_curve(
        rig.pose.bones["tail_03"],
        tuple((x * 1.06, y * 1.12, z * 1.16) for x, y, z in tail),
    )
    action.use_fake_user = True
    return action


def create_morph_action(body: bpy.types.Object) -> bpy.types.Action:
    values = {
        "Dodge_Anticipate": (0.00, 1.00, 0.14, 0.04, 0.00, 0.00, 0.02),
        "Dodge_Bank": (0.00, 0.10, 0.66, 0.56, 0.32, 0.12, 0.00),
        "Dodge_Streamline": (0.00, 0.04, 0.62, 0.44, 0.18, 0.05, 0.00),
        "Dodge_Burst_Corrective": (0.00, 0.18, 0.96, 0.84, 0.56, 0.26, 0.08),
        "Dodge_Burst_Buffer": (0.00, 0.00, 0.08, 0.72, 0.68, 0.28, 0.04),
        "Dodge_Brake": (0.00, 0.00, 0.00, 0.20, 0.82, 0.68, 0.10),
        "Dodge_Recovery": (0.06, 0.00, 0.00, 0.00, 0.08, 0.34, 0.18),
        "Wing_Sweep_L": (0.00, 0.22, 0.34, 0.22, 0.08, 0.00, 0.00),
        "Wing_Sweep_R": (0.00, 0.28, 0.40, 0.27, 0.11, 0.00, 0.00),
        "Tail_CounterSweep": (0.00, 0.00, 0.08, 0.24, 0.72, 1.00, 0.06),
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
        {"name": "anticipate", "frame": 13, "timeSeconds": 12 / FPS},
        {"name": "burst", "frame": 31, "timeSeconds": 30 / FPS},
        {"name": "burst-buffer", "frame": 43, "timeSeconds": 42 / FPS},
        {"name": "brake", "frame": 55, "timeSeconds": 54 / FPS},
        {"name": "counter-sweep", "frame": 67, "timeSeconds": 66 / FPS},
        {"name": "recover", "frame": 91, "timeSeconds": 3.0},
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
        "gameplayDisplacement": {
            "source": "game-layer",
            "axis": "+X",
            "rootStatic": True,
        },
        "motionPolicy": {
            "root": "static",
            "worldTranslation": "game-layer",
            "primaryDeformation": "shape-keys",
            "boneAssist": "minimal",
            "inertia": "liquid-delayed-follow-through",
            "path": "preload-side-forward-arc-brake-settle",
        },
        "qualityTargets": {
            "preserveEllipticalChest": True,
            "twoStageUnfold": True,
            "roundedCohesiveNose": True,
            "frontDeformationFadeMeters": 0.56,
            "minimumChestThicknessRatio": 0.84,
            "maximumBoneAssistRadians": 0.02,
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
    for obj in (root, body, core):
        obj["assetVersion"] = ASSET_VERSION
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
    print("DODGE_V2_EXPORT_OK", json.dumps({
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

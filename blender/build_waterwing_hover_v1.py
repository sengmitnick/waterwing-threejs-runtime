"""Build a dedicated, slow-breathing Waterwing hover asset."""

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
from waterwing_rounded_nose import NOSE_RING_SEGMENTS  # noqa: E402
from waterwing_hover_v1_config import (  # noqa: E402
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
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--output-glb", type=Path, default=DEFAULT_GLB_PATH)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    return parser.parse_args(argv)


def apply_hover_neutral(body: bpy.types.Object) -> None:
    for vertex in body.data.vertices:
        x, y, z, span, wing, centre, tail = shape_context(vertex.co)
        # The shared body already carries a natural upward water arch. Hover
        # adds only a shallow buoyant lift so the membrane remains one rounded
        # mass instead of folding into two upright plates.
        hover_arch = 0.30 * wing * smoothstep(span) ** 1.45
        vertex.co.z = z + hover_arch + 0.022 * centre
        vertex.co.y = y - 0.018 * wing * span + 0.012 * tail
        vertex.co.x = x * (1.0 + 0.004 * wing)
    body.data.update()


def create_hover_shape_keys(body: bpy.types.Object) -> None:
    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}
    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = shape_context(original)
        side = 1.0 if x >= 0 else -1.0

        lift = original.copy()
        lift.z += 0.070 * wing * (0.3 + 0.7 * span) + 0.016 * centre
        lift.y -= 0.014 * wing * span
        keys["Hover_Lift"].data[index].co = lift

        sink = original.copy()
        sink.z -= 0.055 * wing * (0.25 + 0.75 * span) + 0.014 * centre
        sink.y += 0.012 * wing * span
        keys["Hover_Sink"].data[index].co = sink

        ripple_left = original.copy()
        # Each key influences the entire membrane with a soft side bias. When
        # their staggered weights blend, the crest travels through the body
        # instead of hinging one rigid wing at a time.
        left_bias = 0.72 + 0.28 * side
        wave_left = math.sin(span * math.pi * 1.20 + y * 0.58 + side * 0.34)
        ripple_left.z += 0.040 * wing * left_bias * (0.25 + 0.75 * span) * wave_left
        ripple_left.y += 0.010 * wing * left_bias * span * math.cos(y * 0.82 + side * 0.22)
        keys["Wing_Ripple_L"].data[index].co = ripple_left

        ripple_right = original.copy()
        right_bias = 0.72 - 0.28 * side
        wave_right = math.sin(span * math.pi * 1.20 + y * 0.58 + math.pi * 0.62 - side * 0.34)
        ripple_right.z += 0.040 * wing * right_bias * (0.25 + 0.75 * span) * wave_right
        ripple_right.y += 0.010 * wing * right_bias * span * math.cos(y * 0.82 + math.pi * 0.62 - side * 0.22)
        keys["Wing_Ripple_R"].data[index].co = ripple_right

        breathe = original.copy()
        breathe.x *= 1.0 + 0.009 * centre
        breathe.z = z * (1.0 + 0.010 * centre) + 0.010 * centre
        breathe.y = -0.30 + (y + 0.30) * (1.0 - 0.004 * centre)
        keys["Body_Breathe"].data[index].co = breathe

        tail_left = original.copy()
        tail_left.x += 0.14 * tail**1.35
        tail_left.z += 0.014 * tail * math.sin((y - 1.5) * 1.45)
        keys["Tail_Sway_L"].data[index].co = tail_left

        tail_right = original.copy()
        tail_right.x -= 0.14 * tail**1.35
        tail_right.z -= 0.014 * tail * math.sin((y - 1.5) * 1.45)
        keys["Tail_Sway_R"].data[index].co = tail_right

        wobble = original.copy()
        wobble.z += 0.012 * (0.25 + 0.75 * wing) * math.sin(x * 1.15 + y * 1.72)
        wobble.x += side * 0.005 * wing * math.sin(y * 1.80)
        keys["Surface_Wobble"].data[index].co = wobble

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def rig_hover_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_hover_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingHoverArmature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()


def insert_bone_curve(bone: bpy.types.PoseBone, values: tuple[tuple[float, float, float], ...]) -> None:
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

    wing_values = (
        zero,
        (0.006, -0.004, 0.005),
        (0.002, 0.003, 0.008),
        (-0.004, 0.005, 0.002),
        (-0.006, 0.001, -0.006),
        (-0.002, -0.004, -0.008),
        (0.004, -0.005, -0.002),
        (0.006, -0.002, 0.004),
        zero,
    )
    for side, sign in (("L", 1.0), ("R", -1.0)):
        mirrored = tuple((x, y * sign, z * sign) for x, y, z in wing_values)
        insert_bone_curve(rig.pose.bones[f"wing_{side}_root"], mirrored)
        insert_bone_curve(rig.pose.bones[f"wing_{side}_mid"], tuple((x * 1.15, y, z * 1.1) for x, y, z in mirrored))
        insert_bone_curve(rig.pose.bones[f"wing_{side}_tip"], tuple((x * 1.28, y, z * 1.2) for x, y, z in mirrored))
    action.use_fake_user = True
    return action


def create_morph_action(body: bpy.types.Object) -> bpy.types.Action:
    values = {
        "Hover_Lift": (0.15, 0.62, 0.42, 0.08, 0.0, 0.34, 0.60, 0.30, 0.15),
        "Hover_Sink": (0.10, 0.0, 0.18, 0.58, 0.72, 0.32, 0.0, 0.24, 0.10),
        "Wing_Ripple_L": (0.18, 0.72, 0.34, 0.05, 0.26, 0.80, 0.44, 0.04, 0.18),
        "Wing_Ripple_R": (0.42, 0.12, 0.58, 0.34, 0.02, 0.30, 0.76, 0.54, 0.42),
        "Body_Breathe": (0.22, 0.55, 0.90, 0.62, 0.18, 0.34, 0.82, 0.54, 0.22),
        "Tail_Sway_L": (0.15, 0.62, 0.38, 0.04, 0.08, 0.48, 0.76, 0.40, 0.15),
        "Tail_Sway_R": (0.15, 0.02, 0.32, 0.70, 0.46, 0.08, 0.0, 0.42, 0.15),
        "Surface_Wobble": (0.25, 0.58, 0.18, 0.40, 0.68, 0.28, 0.52, 0.72, 0.25),
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


def animate_hover(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    armature_action = create_armature_action(rig)
    morph_action = create_morph_action(body)
    configure_animation_curves(armature_action)
    configure_animation_curves(morph_action)
    push_nla(rig, armature_action)
    push_nla(body.data.shape_keys, morph_action)
    bpy.context.scene.frame_set(FRAME_START)


def write_manifest(path: Path, glb_path: Path, body: bpy.types.Object, rig: bpy.types.Object) -> None:
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
        "action": "hover",
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
    apply_hover_neutral(body)
    rig = create_armature(root)
    rig["assetVersion"] = ASSET_VERSION
    rig_hover_body(body, rig)
    bind_anchors_and_core(rig, core)
    animate_hover(body, rig)
    save_blend(args.output_blend)
    export_glb(args.output_glb)
    write_manifest(args.manifest, args.output_glb, body, rig)
    print("HOVER_EXPORT_OK", json.dumps({
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

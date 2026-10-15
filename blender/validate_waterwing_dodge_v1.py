"""Validate the dedicated Waterwing lateral-dodge Blender asset."""

from __future__ import annotations

import argparse
import math
import sys
import traceback
from pathlib import Path

import bmesh
import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from waterwing_forward_v1_config import ANCHOR_NAMES, BODY_NAME, BONE_NAMES, RIG_NAME  # noqa: E402
from waterwing_dodge_v1_config import (  # noqa: E402
    CLIP_NAME,
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
    parser.add_argument("--blend", required=True, type=Path)
    return parser.parse_args(argv)


def maximum_shape_displacement(body: bpy.types.Object, name: str) -> float:
    basis = body.data.shape_keys.key_blocks["Basis"]
    target = body.data.shape_keys.key_blocks[name]
    return max((target.data[index].co - point.co).length for index, point in enumerate(basis.data))


def main() -> None:
    args = parse_args()
    assert args.blend.exists(), f"missing blend file: {args.blend}"
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
    body = bpy.data.objects[BODY_NAME]
    rig = bpy.data.objects[RIG_NAME]
    assert 12_000 <= len(body.data.vertices) <= 22_000
    assert set(BONE_NAMES) <= set(rig.data.bones.keys())
    assert set(MORPH_NAMES) <= set(body.data.shape_keys.key_blocks.keys())
    assert all(name in bpy.data.objects for name in ANCHOR_NAMES)

    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    assert not [edge for edge in mesh.edges if not edge.is_manifold]
    mesh.free()

    scene = bpy.context.scene
    assert scene.render.fps == FPS
    assert (scene.frame_start, scene.frame_end) == (FRAME_START, FRAME_END)
    assert bpy.data.actions.get(CLIP_NAME) is not None
    assert bpy.data.actions.get(MORPH_CLIP_NAME) is not None
    assert body.parent == rig
    assert any(modifier.type == "ARMATURE" and modifier.object == rig for modifier in body.modifiers)

    displacements = {name: maximum_shape_displacement(body, name) for name in MORPH_NAMES}
    assert displacements["Dodge_Bank"] >= 0.35, displacements
    assert displacements["Dodge_Streamline"] >= 0.60, displacements
    assert displacements["Tail_CounterSweep"] >= 0.70, displacements

    samples = {}
    max_assist_angle = 0.0
    for frame in KEY_FRAMES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        root = rig.pose.bones["root"]
        assert root.location.length <= 1e-7, (frame, tuple(root.location))
        assert root.rotation_euler.to_matrix().to_quaternion().angle <= 1e-7
        assert rig.location.length <= 1e-7
        assert all(math.isfinite(value) for row in body.matrix_world for value in row)
        for bone in rig.pose.bones:
            if bone.name != "root":
                max_assist_angle = max(max_assist_angle, bone.matrix_basis.to_quaternion().angle)
        samples[frame] = {
            name: body.data.shape_keys.key_blocks[name].value for name in MORPH_NAMES
        }
    assert max_assist_angle <= 0.05, max_assist_angle
    assert samples[10]["Dodge_Anticipate"] >= 0.95
    assert samples[30]["Dodge_Bank"] >= 0.95
    assert samples[30]["Dodge_Streamline"] >= 0.95
    assert samples[43]["Dodge_Brake"] >= 0.95
    assert samples[43]["Tail_CounterSweep"] >= 0.95
    assert samples[76]["Dodge_Recovery"] >= 0.30
    assert samples[FRAME_START] != samples[FRAME_END], "non-looping dodge must settle into hover, not snap to its first pose"
    print("DODGE_VALIDATION_OK", {"maxBoneAssistRadians": round(max_assist_angle, 6), "shapeMax": displacements})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

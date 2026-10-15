"""Structural and motion validation for the Waterwing direct-cast package."""

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

from waterwing_direct_cast_v1_config import (  # noqa: E402
    CLIP_NAME,
    DEFAULT_BLEND_PATH,
    DEFAULT_PROJECTILE_BLEND_PATH,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_NAMES,
    PROJECTILE_ANCHORS,
    PROJECTILE_MESHES,
    PROJECTILE_ROOT,
)
from waterwing_forward_v1_config import (  # noqa: E402
    ANCHOR_NAMES,
    BODY_NAME,
    BONE_NAMES,
    RIG_NAME,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--projectile-blend", type=Path, default=DEFAULT_PROJECTILE_BLEND_PATH)
    return parser.parse_args(argv)


def assert_manifold(obj: bpy.types.Object) -> None:
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    non_manifold = [edge.index for edge in mesh.edges if not edge.is_manifold]
    mesh.free()
    assert not non_manifold, f"{obj.name}: {len(non_manifold)} non-manifold edges"


def validate_character(path: Path) -> None:
    assert path.exists(), f"missing character blend: {path}"
    bpy.ops.wm.open_mainfile(filepath=str(path.resolve()))
    body = bpy.data.objects.get(BODY_NAME)
    rig = bpy.data.objects.get(RIG_NAME)
    assert body is not None and body.type == "MESH"
    assert rig is not None and rig.type == "ARMATURE"
    assert 12_000 <= len(body.data.vertices) <= 22_000
    assert set(BONE_NAMES) <= set(rig.data.bones.keys())
    assert set(MORPH_NAMES) <= set(body.data.shape_keys.key_blocks.keys())
    assert all(name in bpy.data.objects for name in ANCHOR_NAMES)
    assert body.parent == rig
    assert any(modifier.type == "ARMATURE" and modifier.object == rig for modifier in body.modifiers)
    assert_manifold(body)

    scene = bpy.context.scene
    assert scene.render.fps == FPS
    assert (scene.frame_start, scene.frame_end) == (FRAME_START, FRAME_END)
    assert bpy.data.actions.get(CLIP_NAME) is not None
    assert bpy.data.actions.get(f"{CLIP_NAME}_Morphs") is not None

    root = rig.pose.bones["root"]
    muzzle_positions = []
    pose_signatures = []
    for frame in KEY_FRAMES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        assert root.location.length <= 1e-7, (frame, tuple(root.location))
        assert root.rotation_euler.to_matrix().to_quaternion().angle <= 1e-7
        assert all(math.isfinite(value) for row in body.matrix_world for value in row)
        for bone in rig.pose.bones:
            assert bone.matrix_basis.to_quaternion().angle <= 0.52, (frame, bone.name)
        muzzle_positions.append(bpy.data.objects["muzzle-anchor"].matrix_world.translation.copy())
        pose_signatures.append(tuple(
            round(value, 5)
            for bone in rig.pose.bones
            for row in bone.matrix_basis
            for value in row
        ))
    travel = max((position - muzzle_positions[0]).length for position in muzzle_positions)
    assert travel >= 0.18, travel
    assert len(set(pose_signatures)) >= 6, "cast needs distinct phases"

    scene.frame_set(55)
    assert body.data.shape_keys.key_blocks["Cast_Aim"].value >= 0.95
    scene.frame_set(67)
    assert body.data.shape_keys.key_blocks["Cast_Recoil"].value >= 0.45
    scene.frame_set(77)
    assert body.data.shape_keys.key_blocks["Cast_Recoil"].value >= 0.95


def validate_projectile(path: Path) -> None:
    assert path.exists(), f"missing projectile blend: {path}"
    bpy.ops.wm.open_mainfile(filepath=str(path.resolve()))
    root = bpy.data.objects.get(PROJECTILE_ROOT)
    assert root is not None and root.type == "EMPTY"
    assert all(name in bpy.data.objects for name in PROJECTILE_ANCHORS)
    meshes = tuple(bpy.data.objects.get(name) for name in PROJECTILE_MESHES)
    assert all(obj is not None and obj.type == "MESH" for obj in meshes)
    for obj in meshes:
        assert obj.parent == root
        assert_manifold(obj)
    minimum_y = min(obj.matrix_world.translation.y + min(corner[1] for corner in obj.bound_box) for obj in meshes)
    maximum_y = max(obj.matrix_world.translation.y + max(corner[1] for corner in obj.bound_box) for obj in meshes)
    minimum_x = min(obj.matrix_world.translation.x + min(corner[0] for corner in obj.bound_box) for obj in meshes)
    maximum_x = max(obj.matrix_world.translation.x + max(corner[0] for corner in obj.bound_box) for obj in meshes)
    ratio = (maximum_y - minimum_y) / (maximum_x - minimum_x)
    assert 1.25 <= ratio <= 3.4, ratio
    forbidden = ("gun", "rifle", "cannon", "barrel", "weapon")
    assert not any(token in obj.name.lower() for obj in bpy.data.objects for token in forbidden)


def main() -> None:
    args = parse_args()
    validate_character(args.blend)
    validate_projectile(args.projectile_blend)
    print("DIRECT_CAST_VALIDATION_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

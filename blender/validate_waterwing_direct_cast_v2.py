"""Structural and deformation validation for Waterwing direct-cast v2."""

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

from build_waterwing_direct_cast_v2 import (  # noqa: E402
    BONE_ROTATION_LIMIT,
    DOMINANT_MORPH_THRESHOLD,
    MAX_DOMINANT_MORPHS,
)
from waterwing_direct_cast_v2_config import (  # noqa: E402
    CHARGE_NODES,
    CLIP_NAME,
    DEFAULT_BLEND_PATH,
    DEFAULT_PROJECTILE_BLEND_PATH,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_NAMES,
    PHASES,
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


def assert_rounded_front_topology(obj: bpy.types.Object) -> None:
    """Reject the old single-pole fan cap that reads as a rigid front plate."""

    front = min(obj.data.vertices, key=lambda vertex: vertex.co.y)
    front_valence = sum(1 for edge in obj.data.edges if front.index in edge.vertices)
    assert front_valence <= 16, f"front cap is a rigid fan: valence={front_valence}"
    front_edges = [
        (obj.data.vertices[edge.vertices[0]].co - obj.data.vertices[edge.vertices[1]].co).length
        for edge in obj.data.edges
        if min(obj.data.vertices[edge.vertices[0]].co.y, obj.data.vertices[edge.vertices[1]].co.y) < -2.85
    ]
    assert max(front_edges) <= 0.16, f"front transition contains a spike edge: {max(front_edges)}"


def evaluated_positions(body: bpy.types.Object) -> list:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def bounds(points) -> tuple[float, float, float]:
    return tuple(
        max(point[axis] for point in points) - min(point[axis] for point in points)
        for axis in range(3)
    )


def front_profile_metrics(points) -> dict[str, float]:
    minimum_y = min(point.y for point in points)
    # Measure the rounded nose plus the first chest transition, rather than
    # only the tiny terminal tip of a healthy tapered water creature.
    leading = [point for point in points if point.y <= minimum_y + 0.65]
    assert len(leading) >= 24, len(leading)
    width, _, height = bounds(leading)
    return {
        "width": width,
        "height": height,
        "heightToWidth": height / width,
    }


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
    assert all(name in bpy.data.objects for name in (*ANCHOR_NAMES, *CHARGE_NODES))
    assert body.parent == rig
    assert any(modifier.type == "ARMATURE" and modifier.object == rig for modifier in body.modifiers)
    assert_manifold(body)
    assert_rounded_front_topology(body)

    scene = bpy.context.scene
    assert scene.render.fps == FPS
    assert (scene.frame_start, scene.frame_end) == (FRAME_START, FRAME_END)
    assert bpy.data.actions.get(CLIP_NAME) is not None
    assert bpy.data.actions.get(f"{CLIP_NAME}_Morphs") is not None

    root = rig.pose.bones["root"]
    pose_signatures = []
    critical_profiles = {}
    for phase, frame in PHASES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        assert root.location.length <= 1e-7, (frame, tuple(root.location))
        assert root.rotation_euler.to_matrix().to_quaternion().angle <= 1e-7
        assert all(math.isfinite(value) for row in body.matrix_world for value in row)
        for bone in rig.pose.bones:
            angle = bone.matrix_basis.to_quaternion().angle
            assert angle <= BONE_ROTATION_LIMIT + 1e-6, (frame, bone.name, angle)
        active_morphs = [
            name for name in MORPH_NAMES
            if body.data.shape_keys.key_blocks[name].value >= DOMINANT_MORPH_THRESHOLD
        ]
        assert len(active_morphs) <= MAX_DOMINANT_MORPHS, (frame, active_morphs)
        pose_signatures.append(tuple(
            round(value, 5)
            for bone in rig.pose.bones
            for row in bone.matrix_basis
            for value in row
        ))
        if phase in {"release", "recoil", "tail-lag"}:
            profile = front_profile_metrics(evaluated_positions(body))
            assert profile["width"] >= 1.20, (phase, profile)
            assert profile["height"] >= 0.34, (phase, profile)
            assert profile["heightToWidth"] <= 1.05, (phase, profile)
            critical_profiles[phase] = {key: round(value, 5) for key, value in profile.items()}
    assert len(set(pose_signatures)) >= 7, "cast needs distinct organic phases"

    scene.frame_set(73)
    assert body.data.shape_keys.key_blocks["Cast_ChestVolume_Corrective"].value >= 0.50
    scene.frame_set(83)
    assert body.data.shape_keys.key_blocks["Cast_FullBodyRecoil"].value >= 0.95
    assert body.data.shape_keys.key_blocks["Cast_ChestVolume_Corrective"].value >= 0.75
    scene.frame_set(97)
    assert body.data.shape_keys.key_blocks["Cast_TailLag"].value >= 0.95
    print("DIRECT_CAST_V2_PROFILE", critical_profiles)


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
    assert 1.25 <= ratio <= 3.20, ratio
    forbidden = ("gun", "rifle", "cannon", "barrel", "weapon")
    assert not any(token in obj.name.lower() for obj in bpy.data.objects for token in forbidden)


def main() -> None:
    args = parse_args()
    validate_character(args.blend)
    validate_projectile(args.projectile_blend)
    print("DIRECT_CAST_V2_VALIDATION_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

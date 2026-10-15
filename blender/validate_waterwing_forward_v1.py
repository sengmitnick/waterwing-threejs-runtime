"""Structural validation for the authored Waterwing Blender asset."""

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

from waterwing_forward_v1_config import (
    ANCHOR_NAMES,
    BODY_NAME,
    BONE_NAMES,
    CLIP_NAME,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_NAMES,
    RIG_NAME,
    Y_MIN,
)


EXPECTED_ROUNDED_NOSE_RINGS = (
    (-0.280, 16),
    (-0.265, 32),
    (-0.245, 64),
    (-0.215, 128),
    (-0.165, 128),
    (-0.095, 128),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", type=Path)
    parser.add_argument(
        "--stage",
        choices=("geometry", "rig", "animation", "export"),
        default="export",
    )
    return parser.parse_args(argv)


def ensure_loaded(blend_path: Path | None) -> None:
    if blend_path is None:
        assert bpy.data.filepath, "no .blend is loaded"
        return
    assert blend_path.exists(), f"missing blend file: {blend_path}"
    bpy.ops.wm.open_mainfile(filepath=str(blend_path))


def validate_geometry() -> bpy.types.Object:
    body = bpy.data.objects.get(BODY_NAME)
    assert body is not None, f"missing {BODY_NAME}"
    assert body.type == "MESH"
    assert body.data.is_editmode is False
    assert 12_000 <= len(body.data.vertices) <= 22_000, len(body.data.vertices)
    assert len(body.data.polygons) <= 44_000, len(body.data.polygons)
    assert body.dimensions.x > body.dimensions.z * 1.8, tuple(body.dimensions)
    assert body.dimensions.y > body.dimensions.z * 2.2, tuple(body.dimensions)
    assert all(name in bpy.data.objects for name in ANCHOR_NAMES)

    assert body.get("topology") == "closed-rounded-multi-ring-manta-loft-v2"
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    non_manifold = [edge.index for edge in mesh.edges if not edge.is_manifold]
    front = min(mesh.verts, key=lambda vertex: vertex.co.y)
    front_valence = len(front.link_edges)
    mesh.free()
    assert not non_manifold, f"non-manifold edges: {len(non_manifold)}"
    assert front_valence == 16, front_valence

    front_y = min(vertex.co.y for vertex in body.data.vertices)
    front_edges = [
        (body.data.vertices[edge.vertices[0]].co - body.data.vertices[edge.vertices[1]].co).length
        for edge in body.data.edges
        if min(
            body.data.vertices[edge.vertices[0]].co.y,
            body.data.vertices[edge.vertices[1]].co.y,
        ) <= Y_MIN - 0.02
    ]
    assert front_edges and max(front_edges) <= 0.16, max(front_edges)
    leading = [vertex.co for vertex in body.data.vertices if vertex.co.y <= front_y + 0.65]
    leading_width = max(point.x for point in leading) - min(point.x for point in leading)
    leading_height = max(point.z for point in leading) - min(point.z for point in leading)
    assert leading_width >= 1.20, leading_width
    assert leading_height >= 0.34, leading_height
    assert leading_height / leading_width <= 1.05, (leading_height, leading_width)

    for offset, expected_count in EXPECTED_ROUNDED_NOSE_RINGS:
        y = Y_MIN + offset
        actual_count = sum(abs(vertex.co.y - y) <= 1e-5 for vertex in body.data.vertices)
        assert actual_count == expected_count, (y, expected_count, actual_count)
    muzzle = bpy.data.objects["muzzle-anchor"].matrix_world.translation
    assert muzzle.y <= front_y - 0.02, (muzzle.y, front_y)
    assert abs(muzzle.z - 0.03) <= 1e-5, muzzle.z

    bounds = [body.matrix_world @ mathutils_vector(corner) for corner in body.bound_box]
    assert all(math.isfinite(value) for point in bounds for value in point)
    return body


def mathutils_vector(values):
    from mathutils import Vector

    return Vector(values)


def validate_rig(body: bpy.types.Object) -> bpy.types.Object:
    rig = bpy.data.objects.get(RIG_NAME)
    assert rig is not None, f"missing {RIG_NAME}"
    assert rig.type == "ARMATURE"
    assert set(BONE_NAMES) <= set(rig.data.bones.keys())
    assert set(MORPH_NAMES) <= set(body.data.shape_keys.key_blocks.keys())
    assert body.parent == rig, "skinned mesh must be parented to its armature"
    assert any(
        modifier.type == "ARMATURE" and modifier.object == rig
        for modifier in body.modifiers
    )

    deform_names = {bone.name for bone in rig.data.bones if bone.use_deform}
    for vertex in body.data.vertices:
        influences = [
            group
            for group in vertex.groups
            if body.vertex_groups[group.group].name in deform_names and group.weight > 1e-7
        ]
        assert 1 <= len(influences) <= 4, (vertex.index, len(influences))
        total = sum(group.weight for group in influences)
        assert abs(total - 1.0) <= 1e-4, (vertex.index, total)
    return rig


def validate_animation(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    scene = bpy.context.scene
    assert scene.render.fps == FPS
    assert (scene.frame_start, scene.frame_end) == (FRAME_START, FRAME_END)
    action = bpy.data.actions.get(CLIP_NAME)
    assert action is not None, f"missing action {CLIP_NAME}"
    assert len(action.layers) > 0, "armature action has no layers"

    root = rig.pose.bones["root"]
    samples = {}
    for frame in KEY_FRAMES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        assert root.location.length <= 1e-7, (frame, tuple(root.location))
        for bone in rig.pose.bones:
            if bone.name != "root":
                angle = bone.matrix_basis.to_quaternion().angle
                assert angle <= 0.025, (frame, bone.name, angle)
        assert all(
            math.isfinite(value)
            for row in body.matrix_world
            for value in row
        )
        samples[frame] = {
            "bones": {
                bone.name: tuple(value for row in bone.matrix for value in row)
                for bone in rig.pose.bones
            },
            "morphs": {
                name: body.data.shape_keys.key_blocks[name].value for name in MORPH_NAMES
            },
        }

    scene.frame_set(45)
    assert body.data.shape_keys.key_blocks["Propel_Power"].value >= 0.95

    for bone_name in BONE_NAMES:
        for first, last in zip(samples[FRAME_START]["bones"][bone_name], samples[FRAME_END]["bones"][bone_name]):
            assert abs(first - last) <= 1e-5, (bone_name, first, last)
    for morph_name in MORPH_NAMES:
        assert abs(
            samples[FRAME_START]["morphs"][morph_name]
            - samples[FRAME_END]["morphs"][morph_name]
        ) <= 1e-5


def main() -> None:
    args = parse_args()
    ensure_loaded(args.blend)
    body = validate_geometry()
    if args.stage == "geometry":
        print("GEOMETRY_VALIDATION_OK")
        return
    rig = validate_rig(body)
    if args.stage == "rig":
        print("RIG_VALIDATION_OK")
        return
    validate_animation(body, rig)
    print("ANIMATION_VALIDATION_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

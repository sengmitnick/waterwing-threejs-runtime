"""Validate the dedicated hover asset inside Blender."""

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

from waterwing_forward_v1_config import ANCHOR_NAMES, BODY_NAME, BONE_NAMES, RIG_NAME, Y_MIN  # noqa: E402
from waterwing_hover_v1_config import (  # noqa: E402
    CLIP_NAME,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_NAMES,
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
    parser.add_argument("--blend", required=True, type=Path)
    return parser.parse_args(argv)


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
    assert body.get("topology") == "closed-rounded-multi-ring-manta-loft-v2"
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    assert not [edge for edge in mesh.edges if not edge.is_manifold]
    front = min(mesh.verts, key=lambda vertex: vertex.co.y)
    front_valence = len(front.link_edges)
    mesh.free()
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
    scene = bpy.context.scene
    assert scene.render.fps == FPS
    assert (scene.frame_start, scene.frame_end) == (FRAME_START, FRAME_END)
    assert bpy.data.actions.get(CLIP_NAME) is not None

    samples = {}
    pose_metrics = {}
    for frame in KEY_FRAMES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        assert rig.pose.bones["root"].location.length <= 1e-7
        assert all(math.isfinite(value) for row in body.matrix_world for value in row)
        evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        evaluated_mesh = evaluated.to_mesh()
        points = [body.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices]
        width = max(point.x for point in points) - min(point.x for point in points)
        depth = max(point.y for point in points) - min(point.y for point in points)
        height = max(point.z for point in points) - min(point.z for point in points)
        evaluated.to_mesh_clear()
        pose_metrics[frame] = {
            "width": width,
            "depth": depth,
            "height": height,
            "front_ratio": height / width,
            "side_ratio": height / depth,
            "central_height": (
                max(point.z for point in points if abs(point.x) <= 0.90 and -1.75 <= point.y <= 0.75)
                - min(point.z for point in points if abs(point.x) <= 0.90 and -1.75 <= point.y <= 0.75)
            ),
        }
        samples[frame] = {
            "morphs": tuple(body.data.shape_keys.key_blocks[name].value for name in MORPH_NAMES),
            "bones": tuple(value for bone in rig.pose.bones for row in bone.matrix for value in row),
        }
    assert samples[FRAME_START] == samples[FRAME_END]
    assert samples[FRAME_START] != samples[49]
    assert samples[49] != samples[97]
    front_ratios = [sample["front_ratio"] for sample in pose_metrics.values()]
    side_ratios = [sample["side_ratio"] for sample in pose_metrics.values()]
    heights = [sample["height"] for sample in pose_metrics.values()]
    central_heights = [sample["central_height"] for sample in pose_metrics.values()]
    # A hovering water spirit should keep a shallow, cohesive bowl silhouette:
    # the already-lifted base mesh must not be bent into two upright walls.
    assert min(front_ratios) >= 0.155, min(front_ratios)
    assert max(front_ratios) <= 0.235, max(front_ratios)
    assert max(side_ratios) <= 0.370, max(side_ratios)
    # Motion comes from a low-amplitude travelling membrane wave; the torso
    # remains a stable mass instead of inflating and collapsing each cycle.
    assert max(heights) - min(heights) <= 0.220, max(heights) - min(heights)
    assert max(central_heights) - min(central_heights) <= 0.100, (
        max(central_heights) - min(central_heights)
    )
    phase_25 = pose_metrics[25]
    print(
        "HOVER_VALIDATION_OK",
        f"phase25_front_ratio={phase_25['front_ratio']:.4f}",
        f"phase25_height={phase_25['height']:.4f}",
        f"max_side_ratio={max(side_ratios):.4f}",
        f"max_height={max(heights):.4f}",
        f"central_height_delta={max(central_heights) - min(central_heights):.4f}",
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

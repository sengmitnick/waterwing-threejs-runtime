"""Validate Waterwing emergence v2 geometry, staging, and animation contract."""

from __future__ import annotations

import argparse
import json
import math
import sys
import traceback
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from waterwing_forward_v1_config import ANCHOR_NAMES, BODY_NAME, BONE_NAMES, RIG_NAME  # noqa: E402
from waterwing_emerge_v2_config import (  # noqa: E402
    CLIP_NAME,
    DROPLET_COUNT,
    DROPLET_PREFIX,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_CLIP_NAME,
    MORPH_NAMES,
    PHASE_FRAMES,
    POOL_NAME,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", required=True, type=Path)
    return parser.parse_args(argv)


def evaluated_points(obj: bpy.types.Object):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        yield [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices], mesh
    finally:
        evaluated.to_mesh_clear()


def evaluated_metrics(obj: bpy.types.Object) -> dict[str, object]:
    for points, mesh in evaluated_points(obj):
        assert all(math.isfinite(value) for point in points for value in point)
        mesh.calc_loop_triangles()
        assert mesh.loop_triangles, "evaluated mesh has no triangles"
        assert min(triangle.area for triangle in mesh.loop_triangles) > 1e-10, "degenerate evaluated face"
        minimum = tuple(min(point[axis] for point in points) for axis in range(3))
        maximum = tuple(max(point[axis] for point in points) for axis in range(3))
        extents = tuple(maximum[axis] - minimum[axis] for axis in range(3))
        centre = tuple((maximum[axis] + minimum[axis]) * 0.5 for axis in range(3))
        left_span = max(point.x for point in points)
        right_span = abs(min(point.x for point in points))
        return {"extents": extents, "centre": centre, "sideSpans": (left_span, right_span)}
    raise AssertionError("unreachable")


def rounded_nose_metrics(obj: bpy.types.Object, segments: tuple[int, ...]) -> dict[str, tuple[float, ...]]:
    """Measure the ordered rounded rings after all morph and rig deformation."""

    for points, _mesh in evaluated_points(obj):
        offset = 0
        centres = []
        radii = []
        for count in segments:
            ring = points[offset : offset + count]
            assert len(ring) == count
            centre = sum(ring, Vector()) / count
            centres.append(centre)
            radii.append(sum((point - centre).length for point in ring) / count)
            offset += count
        # The shared builder appends the front and rear poles after all rings.
        front_pole = points[-2]
        links = [(front_pole - centres[0]).length]
        links.extend((right - left).length for left, right in zip(centres, centres[1:]))
        return {"radii": tuple(radii), "links": tuple(links)}
    raise AssertionError("unreachable")


def main() -> None:
    args = parse_args()
    assert args.blend.exists(), f"missing blend file: {args.blend}"
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))

    body = bpy.data.objects[BODY_NAME]
    rig = bpy.data.objects[RIG_NAME]
    pool = bpy.data.objects[POOL_NAME]
    droplets = [bpy.data.objects[f"{DROPLET_PREFIX}{index:02d}"] for index in range(1, DROPLET_COUNT + 1)]
    assert 12_000 <= len(body.data.vertices) <= 22_000
    assert len(body.data.polygons) <= 44_000
    assert set(BONE_NAMES) <= set(rig.data.bones.keys())
    assert set(MORPH_NAMES) <= set(body.data.shape_keys.key_blocks.keys())
    assert all(name in bpy.data.objects for name in ANCHOR_NAMES)
    assert body.get("topology") == "closed-rounded-multi-ring-manta-loft-v2"
    assert body.get("frontPoleValence") == 16
    nose_segments = tuple(json.loads(body["noseRingSegments"]))
    assert nose_segments == (16, 32, 64, 128, 128, 128)
    assert pool.type == "MESH" and all(obj.type == "MESH" for obj in droplets)
    assert not any("ring" in obj.name.lower() for obj in bpy.data.objects)

    topology = bmesh.new()
    topology.from_mesh(body.data)
    assert not [edge for edge in topology.edges if not edge.is_manifold]
    topology.free()

    pool_topology = bmesh.new()
    pool_topology.from_mesh(pool.data)
    assert not [edge for edge in pool_topology.edges if not edge.is_manifold]
    pool_topology.free()

    pool_dimensions = tuple(pool.dimensions)
    assert pool_dimensions[0] / pool_dimensions[1] > 1.20, pool_dimensions

    scene = bpy.context.scene
    assert scene.render.fps == FPS
    assert (scene.frame_start, scene.frame_end) == (FRAME_START, FRAME_END)
    assert bpy.data.actions.get(CLIP_NAME) is not None
    assert bpy.data.actions.get(MORPH_CLIP_NAME) is not None

    samples = {}
    morph_samples = {}
    for phase, frame in PHASE_FRAMES.items():
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        root = rig.pose.bones["root"]
        assert root.location.length <= 1e-7
        assert max(abs(value) for value in root.rotation_euler) <= 1e-7
        samples[phase] = evaluated_metrics(body)
        morph_samples[phase] = tuple(round(body.data.shape_keys.key_blocks[name].value, 5) for name in MORPH_NAMES)
        nose = rounded_nose_metrics(body, nose_segments)
        assert max(nose["links"]) < 0.22, (phase, nose)
        assert all(
            outer > inner * 1.06
            for inner, outer in zip(nose["radii"], nose["radii"][1:])
        ), (phase, nose)

    assert len(set(morph_samples.values())) == len(PHASE_FRAMES), "emergence phases are not distinct"
    start = samples["amorphous"]
    roots = samples["wingRoots"]
    lift = samples["bodyLift"]
    release = samples["tailRelease"]
    final = samples["hover"]
    sx, sy, sz = start["extents"]
    fx, fy, fz = final["extents"]
    assert sx < fx * 0.34, (start, final)
    assert sy < fy * 0.34, (start, final)
    assert sz > 0.12 and min(sx, sy) > 0.50, start
    assert roots["extents"][0] > sx * 1.55, (start, roots)
    assert lift["centre"][2] > start["centre"][2] + 0.42, (start, lift)
    assert release["extents"][1] > lift["extents"][1] * 1.10, (lift, release)
    assert min(fx, fy, fz) > 0.25

    # Wing draw must be visibly staggered: positive-X wing opens first at f45,
    # then the negative-X wing catches up by f61.
    scene.frame_set(45)
    bpy.context.view_layer.update()
    left_first = evaluated_metrics(body)["sideSpans"]
    scene.frame_set(61)
    bpy.context.view_layer.update()
    both_drawn = evaluated_metrics(body)["sideSpans"]
    assert left_first[0] > left_first[1] * 1.28, left_first
    assert abs(both_drawn[0] - both_drawn[1]) < max(both_drawn) * 0.16, both_drawn

    # Droplets must be staggered rather than a uniform picket fence.
    scene.frame_set(61)
    bpy.context.view_layer.update()
    droplet_scales = {tuple(round(value, 3) for value in obj.scale) for obj in droplets}
    assert len(droplet_scales) >= 5, droplet_scales

    for frame in KEY_FRAMES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        assert rig.pose.bones["root"].location.length <= 1e-7

    scene.frame_set(FRAME_END)
    bpy.context.view_layer.update()
    assert pool.scale.length < 0.01, "water source must be gone in the final pose"
    assert all(obj.scale.length < 0.01 for obj in droplets), "all droplets must resolve by final pose"
    print("EMERGENCE_V2_VALIDATION_OK", {"samples": samples, "dropletScaleVariants": len(droplet_scales)})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

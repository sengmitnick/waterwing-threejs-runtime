"""Validate the dedicated, non-looping Waterwing emergence asset."""

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

from waterwing_forward_v1_config import (  # noqa: E402
    ANCHOR_NAMES,
    BODY_NAME,
    BONE_NAMES,
    RIG_NAME,
)
from waterwing_emerge_v1_config import (  # noqa: E402
    CLIP_NAME,
    DROPLETS_NAME,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_CLIP_NAME,
    MORPH_NAMES,
    PHASE_FRAMES,
    RIPPLE_NAME,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", required=True, type=Path)
    return parser.parse_args(argv)


def evaluated_extents(obj: bpy.types.Object) -> tuple[float, float, float]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        return tuple(
            max(point[axis] for point in points) - min(point[axis] for point in points)
            for axis in range(3)
        )
    finally:
        evaluated.to_mesh_clear()


def validate_evaluated_mesh(obj: bpy.types.Object) -> None:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        assert all(math.isfinite(value) for vertex in mesh.vertices for value in vertex.co)
        mesh.calc_loop_triangles()
        assert mesh.loop_triangles, "evaluated mesh has no triangles"
        assert min(triangle.area for triangle in mesh.loop_triangles) > 1e-10, "degenerate evaluated face"
    finally:
        evaluated.to_mesh_clear()


def main() -> None:
    args = parse_args()
    assert args.blend.exists(), f"missing blend file: {args.blend}"
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))

    body = bpy.data.objects[BODY_NAME]
    rig = bpy.data.objects[RIG_NAME]
    ripple = bpy.data.objects[RIPPLE_NAME]
    droplets = bpy.data.objects[DROPLETS_NAME]
    assert 12_000 <= len(body.data.vertices) <= 22_000
    assert len(body.data.polygons) <= 44_000
    assert set(BONE_NAMES) <= set(rig.data.bones.keys())
    assert set(MORPH_NAMES) <= set(body.data.shape_keys.key_blocks.keys())
    assert all(name in bpy.data.objects for name in ANCHOR_NAMES)
    assert ripple.type == "MESH" and droplets.type == "MESH"

    topology = bmesh.new()
    topology.from_mesh(body.data)
    assert not [edge for edge in topology.edges if not edge.is_manifold]
    topology.free()

    scene = bpy.context.scene
    assert scene.render.fps == FPS
    assert (scene.frame_start, scene.frame_end) == (FRAME_START, FRAME_END)
    assert bpy.data.actions.get(CLIP_NAME) is not None
    assert bpy.data.actions.get(MORPH_CLIP_NAME) is not None

    phase_samples = {}
    extents = {}
    for phase, frame in PHASE_FRAMES.items():
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        root = rig.pose.bones["root"]
        assert root.location.length <= 1e-7
        assert max(abs(value) for value in root.rotation_euler) <= 1e-7
        validate_evaluated_mesh(body)
        extents[phase] = evaluated_extents(body)
        phase_samples[phase] = (
            tuple(round(body.data.shape_keys.key_blocks[name].value, 6) for name in MORPH_NAMES),
            tuple(
                round(value, 6)
                for bone in rig.pose.bones
                for row in bone.matrix
                for value in row
            ),
        )

    assert len(set(phase_samples.values())) == len(PHASE_FRAMES), "emergence phases are not distinct"
    start_x, start_y, start_z = extents["puddle"]
    final_x, final_y, final_z = extents["hover"]
    assert start_x < final_x * 0.72, (extents["puddle"], extents["hover"])
    assert start_y < final_y * 0.72, (extents["puddle"], extents["hover"])
    assert start_z < final_z * 0.36, (extents["puddle"], extents["hover"])
    assert min(start_x, start_y, start_z, final_x, final_y, final_z) > 0.03

    # Root motion must remain absent at every authored sample, not only the
    # five narrative milestones.
    for frame in KEY_FRAMES:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        assert rig.pose.bones["root"].location.length <= 1e-7

    assert ripple.scale.length < 0.01, "water ring must be gone in the final pose"
    assert droplets.scale.length < 0.01, "condensation droplets must be gone in the final pose"
    print("EMERGENCE_VALIDATION_OK", {"extents": extents, "phases": PHASE_FRAMES})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

"""Validate topology, staging, volume retention, and root policy for dodge v2."""

from __future__ import annotations

import argparse
import json
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
    Y_MIN,
)
from waterwing_dodge_v2_config import (  # noqa: E402
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
    parser.add_argument("--report", type=Path)
    return parser.parse_args(argv)


def maximum_shape_displacement(body: bpy.types.Object, name: str) -> float:
    basis = body.data.shape_keys.key_blocks["Basis"]
    target = body.data.shape_keys.key_blocks[name]
    return max((target.data[index].co - point.co).length for index, point in enumerate(basis.data))


def evaluated_positions(body: bpy.types.Object) -> list:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ vertex.co.copy() for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def extents(points, indices) -> tuple[float, float, float]:
    chosen = [points[index] for index in indices]
    return tuple(max(point[axis] for point in chosen) - min(point[axis] for point in chosen) for axis in range(3))


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
    assert body.get("frontPoleValence") == 16
    assert json.loads(body.get("noseRingSegments")) == [16, 32, 64, 128, 128, 128]

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
    assert displacements["Dodge_Bank"] >= 0.16, displacements
    assert displacements["Dodge_Streamline"] >= 0.28, displacements
    assert displacements["Dodge_Burst_Corrective"] >= 0.08, displacements
    assert displacements["Dodge_Burst_Buffer"] >= 0.08, displacements
    assert displacements["Tail_CounterSweep"] >= 0.50, displacements

    basis = body.data.shape_keys.key_blocks["Basis"]
    chest_indices = [
        index
        for index, point in enumerate(basis.data)
        if abs(point.co.x) <= 0.90 and -1.42 <= point.co.y <= 0.52
    ]
    inner_wing_indices = [
        index
        for index, point in enumerate(basis.data)
        if 0.48 <= abs(point.co.x) <= 1.62 and -1.50 <= point.co.y <= 0.90
    ]
    assert len(chest_indices) > 300
    assert len(inner_wing_indices) > 300

    # The rounded cap is a cohesive water bulb.  Its low-valence pole must
    # follow the first ring rather than being pushed sideways by a signed,
    # constant corrective offset (the previous source of the pointed kink).
    pole_index = min(range(len(basis.data)), key=lambda index: basis.data[index].co.y)
    pole_y = basis.data[pole_index].co.y
    first_ring_y = min(
        point.co.y for point in basis.data if point.co.y > pole_y + 1e-5
    )
    first_ring_indices = [
        index
        for index, point in enumerate(basis.data)
        if abs(point.co.y - first_ring_y) <= 1e-5
    ]
    assert len(first_ring_indices) == 16

    scene.frame_set(FRAME_START)
    bpy.context.view_layer.update()
    baseline_positions = evaluated_positions(body)
    baseline_chest = extents(baseline_positions, chest_indices)
    baseline_inner = extents(baseline_positions, inner_wing_indices)
    baseline_span = extents(baseline_positions, range(len(baseline_positions)))[0]

    samples = {}
    phase_metrics = {}
    nose_pole_offsets = {}
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

        positions = evaluated_positions(body)
        chest = extents(positions, chest_indices)
        inner = extents(positions, inner_wing_indices)
        span = extents(positions, range(len(positions)))[0]
        thickness_ratio = chest[2] / baseline_chest[2]
        chest_width_ratio = chest[0] / baseline_chest[0]
        inner_thickness_ratio = inner[2] / baseline_inner[2]
        span_ratio = span / baseline_span
        first_ring_centre = sum(
            (positions[index] for index in first_ring_indices),
            positions[first_ring_indices[0]] * 0.0,
        ) / len(first_ring_indices)
        pole = positions[pole_index]
        pole_offset = math.hypot(
            pole.x - first_ring_centre.x,
            pole.z - first_ring_centre.z,
        )
        assert thickness_ratio >= 0.84, (frame, thickness_ratio)
        assert chest_width_ratio >= 0.90, (frame, chest_width_ratio)
        assert inner_thickness_ratio >= 0.76, (frame, inner_thickness_ratio)
        assert span_ratio >= 0.80, (frame, span_ratio)
        phase_metrics[frame] = {
            "chestThicknessRatio": thickness_ratio,
            "chestWidthRatio": chest_width_ratio,
            "innerWingThicknessRatio": inner_thickness_ratio,
            "spanRatio": span_ratio,
        }
        nose_pole_offsets[frame] = pole_offset
        samples[frame] = {
            name: body.data.shape_keys.key_blocks[name].value for name in MORPH_NAMES
        }

    assert max_assist_angle <= 0.02, max_assist_angle
    assert samples[13]["Dodge_Anticipate"] >= 0.95
    assert 0.58 <= samples[31]["Dodge_Bank"] <= 0.72
    assert 0.54 <= samples[31]["Dodge_Streamline"] <= 0.68
    assert samples[31]["Dodge_Burst_Corrective"] >= 0.90
    assert samples[31]["Wing_Sweep_L"] <= 0.36
    assert samples[31]["Wing_Sweep_R"] <= 0.42
    assert samples[43]["Dodge_Burst_Buffer"] >= 0.68
    assert samples[55]["Dodge_Burst_Buffer"] >= 0.64
    assert samples[55]["Dodge_Brake"] >= 0.80
    assert samples[67]["Tail_CounterSweep"] >= 0.95
    assert samples[91]["Dodge_Recovery"] >= 0.15
    assert nose_pole_offsets[31] <= 0.025, nose_pole_offsets
    assert nose_pole_offsets[43] <= 0.025, nose_pole_offsets

    # Quantify per-frame continuity through the former v1 snap window.  A
    # sparse but stable surface sample makes this independent of render setup.
    sample_indices = list(range(0, len(body.data.vertices), 83))
    previous = None
    mean_steps = []
    for frame in range(31, 56):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        positions = evaluated_positions(body)
        current = [positions[index] for index in sample_indices]
        if previous is not None:
            mean_step = sum((point - previous[index]).length for index, point in enumerate(current)) / len(current)
            mean_steps.append(mean_step)
        previous = current
    max_mean_step = max(mean_steps)
    assert max_mean_step <= 0.08, max_mean_step

    report = {
        "maxBoneAssistRadians": max_assist_angle,
        "maxMeanVertexStepFrames31To55": max_mean_step,
        "shapeMax": displacements,
        "phaseMetrics": phase_metrics,
        "nosePoleOffsetsXZ": nose_pole_offsets,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("DODGE_V2_VALIDATION_OK", json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

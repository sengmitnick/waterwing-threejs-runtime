"""Shared rounded Waterwing nose topology for the forward-derived assets.

The profile is intentionally short and blunt: six concentric elliptical rings
grow out of a low-valence pole before joining the high-resolution manta body.
Forward and hover share this geometry, while keeping their own animation rigs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


FRONT_POLE_OFFSET = -0.295
FRONT_POLE_Z = 0.030
ROUNDED_NOSE_PROFILE = (
    (-0.280, 16, 0.008, 0.008, 0.030),
    (-0.265, 32, 0.018, 0.018, 0.030),
    (-0.245, 64, 0.038, 0.035, 0.031),
    (-0.215, 128, 0.065, 0.060, 0.032),
    (-0.165, 128, 0.105, 0.090, 0.034),
    (-0.095, 128, 0.150, 0.125, 0.038),
)
NOSE_RING_SEGMENTS = tuple(profile[1] for profile in ROUNDED_NOSE_PROFILE)


@dataclass(frozen=True)
class Ring:
    start: int
    count: int


def append_elliptical_ring(
    vertices: list[tuple[float, float, float]],
    count: int,
    y: float,
    x_radius: float,
    z_radius: float,
    z_center: float,
) -> Ring:
    start = len(vertices)
    for segment in range(count):
        theta = math.tau * segment / count
        vertices.append((
            x_radius * math.cos(theta),
            y,
            z_center + z_radius * math.sin(theta),
        ))
    return Ring(start, count)


def bridge_divisible_rings(
    faces: list[tuple[int, ...]],
    inner: Ring,
    outer: Ring,
) -> None:
    """Bridge power-of-two Waterwing nose rings without high-valence vertices."""

    assert outer.count % inner.count == 0
    ratio = outer.count // inner.count
    for inner_index in range(inner.count):
        current_inner = inner.start + inner_index
        next_inner = inner.start + (inner_index + 1) % inner.count
        outer_group_start = inner_index * ratio
        outer_group_end = (inner_index + 1) * ratio
        for outer_index in range(outer_group_start, outer_group_end):
            current_outer = outer.start + outer_index % outer.count
            next_outer = outer.start + (outer_index + 1) % outer.count
            faces.append((current_inner, current_outer, next_outer))
        boundary_outer = outer.start + outer_group_end % outer.count
        faces.append((current_inner, next_inner, boundary_outer))


def connect_equal_rings(
    faces: list[tuple[int, ...]],
    ring_a: Ring,
    ring_b: Ring,
) -> None:
    assert ring_a.count == ring_b.count
    for segment in range(ring_a.count):
        next_segment = (segment + 1) % ring_a.count
        faces.append((
            ring_a.start + segment,
            ring_b.start + segment,
            ring_b.start + next_segment,
            ring_a.start + next_segment,
        ))


def bridge_arbitrary_rings(
    faces: list[tuple[int, ...]],
    ring_a: Ring,
    ring_b: Ring,
) -> None:
    """Create a manifold annular strip between differently sampled rings."""

    index_a = 0
    index_b = 0
    while index_a < ring_a.count or index_b < ring_b.count:
        current_a = ring_a.start + index_a % ring_a.count
        current_b = ring_b.start + index_b % ring_b.count
        phase_a = (index_a + 1) / ring_a.count
        phase_b = (index_b + 1) / ring_b.count
        if abs(phase_a - phase_b) <= 1e-12:
            next_a = ring_a.start + (index_a + 1) % ring_a.count
            next_b = ring_b.start + (index_b + 1) % ring_b.count
            faces.append((current_a, current_b, next_b, next_a))
            index_a += 1
            index_b += 1
        elif phase_a < phase_b:
            next_a = ring_a.start + (index_a + 1) % ring_a.count
            faces.append((current_a, current_b, next_a))
            index_a += 1
        else:
            next_b = ring_b.start + (index_b + 1) % ring_b.count
            faces.append((current_a, current_b, next_b))
            index_b += 1


def append_rounded_nose(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    y_min: float,
) -> tuple[Ring, ...]:
    rings = tuple(
        append_elliptical_ring(
            vertices,
            count,
            y_min + offset,
            x_radius,
            z_radius,
            z_center,
        )
        for offset, count, x_radius, z_radius, z_center in ROUNDED_NOSE_PROFILE
    )
    bridge_divisible_rings(faces, rings[0], rings[1])
    bridge_divisible_rings(faces, rings[1], rings[2])
    bridge_divisible_rings(faces, rings[2], rings[3])
    connect_equal_rings(faces, rings[3], rings[4])
    connect_equal_rings(faces, rings[4], rings[5])
    return rings


def cap_rounded_nose(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    first_ring: Ring,
    y_min: float,
) -> int:
    assert first_ring.count == 16
    front_pole = len(vertices)
    vertices.append((0.0, y_min + FRONT_POLE_OFFSET, FRONT_POLE_Z))
    for segment in range(first_ring.count):
        next_segment = (segment + 1) % first_ring.count
        faces.append((front_pole, first_ring.start + segment, first_ring.start + next_segment))
    return front_pole

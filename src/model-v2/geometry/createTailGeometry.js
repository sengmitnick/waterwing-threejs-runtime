import * as THREE from 'three';

const CURVE_SAMPLES = 21;
const RADIAL_SEGMENTS = 16;

function centerAt(t, target) {
  const sweep = Math.sin(Math.PI * t);
  return target.set(
    0.055 * sweep * Math.sin(Math.PI * 1.35 * t + 0.2),
    -0.95 * t,
    -0.02 - 0.72 * THREE.MathUtils.smootherstep(t, 0, 1) + 0.045 * Math.sin(Math.PI * 2 * t)
  );
}

function swimDeltaAt(t, target) {
  const anchored = THREE.MathUtils.smootherstep(t, 0.04, 0.38);
  const envelope = anchored * (0.25 + 0.75 * t);
  return target.set(
    0.23 * envelope * Math.sin(Math.PI * (0.15 + 1.05 * t)),
    0.025 * envelope * Math.sin(Math.PI * 2 * t),
    0.065 * envelope * Math.sin(Math.PI * 2 * t)
  );
}

function tailColor(t, angle, target) {
  const deep = new THREE.Color(0x2e8291);
  const bright = new THREE.Color(0xa9ecee);
  const ribbon = 0.5 + 0.5 * Math.sin(angle * 2 - t * 12.7);
  const mix = THREE.MathUtils.clamp(0.22 + ribbon * 0.22 + Math.sin(Math.PI * t) * 0.2, 0, 0.72);
  return target.copy(deep).lerp(bright, mix);
}

/**
 * Curved leaf-drop tail with a swept centre line and elliptical cross-section.
 */
export function createTailGeometry() {
  const positions = [];
  const colors = [];
  const uvs = [];
  const swimDeltas = [];
  const indices = [];
  const center = new THREE.Vector3();
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const depth = new THREE.Vector3();
  const swimDelta = new THREE.Vector3();
  const color = new THREE.Color();

  for (let sample = 0; sample < CURVE_SAMPLES; sample += 1) {
    // A small, non-zero root ring hides inside the torso; the final explicit
    // cap gives the tail a clean tapered point without a degenerate tube ring.
    const t = sample / CURVE_SAMPLES;
    centerAt(t, center);
    centerAt(Math.max(0, t - 0.0025), before);
    centerAt(Math.min(1, t + 0.0025), after);
    tangent.subVectors(after, before).normalize();

    side.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
    depth.crossVectors(tangent, side).normalize();

    const leaf = Math.pow(Math.sin(Math.PI * t), 0.72);
    const width = 0.055 * (1 - t) + 0.15 * leaf * (1 - 0.12 * t);
    const thickness = width * (0.39 + 0.08 * Math.sin(Math.PI * t));
    swimDeltaAt(t, swimDelta);

    for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
      const angle = (segment / RADIAL_SEGMENTS) * Math.PI * 2;
      const ripple = 1 + 0.018 * Math.sin(angle * 3 + t * 8.6);
      const point = center
        .clone()
        .addScaledVector(side, Math.cos(angle) * width * ripple)
        .addScaledVector(depth, Math.sin(angle) * thickness * ripple);
      positions.push(point.x, point.y, point.z);
      swimDeltas.push(swimDelta.x, swimDelta.y, swimDelta.z);
      tailColor(t, angle, color);
      colors.push(color.r, color.g, color.b);
      uvs.push(segment / RADIAL_SEGMENTS, t);
    }
  }

  for (let sample = 0; sample < CURVE_SAMPLES - 1; sample += 1) {
    const current = sample * RADIAL_SEGMENTS;
    const nextRing = (sample + 1) * RADIAL_SEGMENTS;
    for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
      const next = (segment + 1) % RADIAL_SEGMENTS;
      const a = current + segment;
      const b = current + next;
      const c = nextRing + segment;
      const d = nextRing + next;
      indices.push(a, b, c, b, d, c);
    }
  }

  const topIndex = positions.length / 3;
  centerAt(0, center);
  positions.push(center.x, center.y, center.z);
  swimDeltas.push(0, 0, 0);
  tailColor(0, 0, color);
  colors.push(color.r, color.g, color.b);
  uvs.push(0.5, 0);

  const bottomIndex = positions.length / 3;
  centerAt(1, center);
  swimDeltaAt(1, swimDelta);
  positions.push(center.x, center.y, center.z);
  swimDeltas.push(swimDelta.x, swimDelta.y, swimDelta.z);
  tailColor(1, 0, color);
  colors.push(color.r, color.g, color.b);
  uvs.push(0.5, 1);

  const lastRing = (CURVE_SAMPLES - 1) * RADIAL_SEGMENTS;
  for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
    const next = (segment + 1) % RADIAL_SEGMENTS;
    indices.push(topIndex, next, segment);
    indices.push(bottomIndex, lastRing + segment, lastRing + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = 'waterwing-v2-tail-geometry';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.morphTargetsRelative = true;
  const swim = new THREE.Float32BufferAttribute(swimDeltas, 3);
  swim.name = 'swim';
  geometry.morphAttributes.position = [swim];
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

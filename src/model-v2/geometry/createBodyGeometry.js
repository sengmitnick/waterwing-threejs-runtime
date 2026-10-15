import * as THREE from 'three';

const RING_COUNT = 29;
const RADIAL_SEGMENTS = 40;

function bodyColor(t, angle, target) {
  const deep = new THREE.Color(0x4b909d);
  const bright = new THREE.Color(0xd8ffff);
  const caustic = 0.5 + 0.5 * Math.sin(angle * 3 + t * 17.3);
  const upperGlow = THREE.MathUtils.smootherstep(t, 0.34, 0.96);
  const mix = THREE.MathUtils.clamp(0.17 + caustic * 0.18 + upperGlow * 0.42, 0, 0.82);
  return target.copy(deep).lerp(bright, mix);
}

/**
 * Continuous, closed teardrop body for Waterwing V2.
 *
 * The body is deliberately authored from deterministic math rather than either
 * downloaded reference mesh. Anatomical forward is +Y (the pointed crown),
 * while +Z is the combat-facing side seen by the player.
 */
export function createBodyGeometry() {
  const positions = [];
  const colors = [];
  const uvs = [];
  const pulseDeltas = [];
  const streamlineDeltas = [];
  const indices = [];
  const color = new THREE.Color();

  for (let ring = 0; ring < RING_COUNT; ring += 1) {
    // Keep the regular rings away from the singular tips and close them with
    // dedicated cap vertices below. This avoids zero-area rings.
    const t = (ring + 1) / (RING_COUNT + 1);
    const radiusProfile = Math.pow(Math.sin(Math.PI * t), 0.72);
    const lowerTaper = 0.93 - 0.2 * Math.max(0, 0.5 - t);
    const radius = radiusProfile * lowerTaper;
    const ringPhase = 0.014 * Math.sin(t * 11.7) + 0.008 * Math.sin(t * 23.1 + 0.8);
    const y = -1 + t * 2;
    const pulseStrength = 0.04 * THREE.MathUtils.smootherstep(t, 0.38, 0.82);

    for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
      const angle = (segment / RADIAL_SEGMENTS) * Math.PI * 2 + ringPhase;
      const surfaceRipple =
        1 +
        0.014 * Math.sin(angle * 3 + t * 9.1) +
        0.007 * Math.sin(angle * 7 - t * 13.4);
      const x = Math.cos(angle) * radius * 0.58 * surfaceRipple;
      const depthScale = Math.sin(angle) >= 0 ? 0.52 : 0.47;
      const z = Math.sin(angle) * radius * depthScale * surfaceRipple;

      positions.push(x, y, z);
      pulseDeltas.push(x * pulseStrength, 0, z * pulseStrength);
      streamlineDeltas.push(-x * 0.1, y * 0.09, -z * 0.065);
      bodyColor(t, angle, color);
      colors.push(color.r, color.g, color.b);
      uvs.push(segment / RADIAL_SEGMENTS, t);
    }
  }

  for (let ring = 0; ring < RING_COUNT - 1; ring += 1) {
    const lower = ring * RADIAL_SEGMENTS;
    const upper = (ring + 1) * RADIAL_SEGMENTS;
    for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
      const next = (segment + 1) % RADIAL_SEGMENTS;
      const a = lower + segment;
      const b = lower + next;
      const c = upper + segment;
      const d = upper + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const bottomIndex = positions.length / 3;
  positions.push(0, -1, 0);
  pulseDeltas.push(0, 0, 0);
  streamlineDeltas.push(0, -0.09, 0);
  bodyColor(0, 0, color);
  colors.push(color.r, color.g, color.b);
  uvs.push(0.5, 0);

  const topIndex = positions.length / 3;
  positions.push(0, 1, 0);
  pulseDeltas.push(0, 0, 0);
  streamlineDeltas.push(0, 0.09, 0);
  bodyColor(1, 0, color);
  colors.push(color.r, color.g, color.b);
  uvs.push(0.5, 1);

  const lastRing = (RING_COUNT - 1) * RADIAL_SEGMENTS;
  for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
    const next = (segment + 1) % RADIAL_SEGMENTS;
    indices.push(bottomIndex, segment, next);
    indices.push(topIndex, lastRing + next, lastRing + segment);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = 'waterwing-v2-body-geometry';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.morphTargetsRelative = true;
  const pulse = new THREE.Float32BufferAttribute(pulseDeltas, 3);
  pulse.name = 'pulse';
  const streamline = new THREE.Float32BufferAttribute(streamlineDeltas, 3);
  streamline.name = 'streamline';
  geometry.morphAttributes.position = [pulse, streamline];
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

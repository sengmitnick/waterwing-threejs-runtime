import * as THREE from 'three';

function normalizedSeed(seed) {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}
function signedHash(seed, ring, segment) {
  let value = normalizedSeed(seed) ^ Math.imul(ring + 1, 0x9e3779b1) ^ Math.imul(segment + 1, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function dropletColor(t, variation, target) {
  const deep = new THREE.Color(0x3c91a0);
  const bright = new THREE.Color(0xc1f5f4);
  const mix = THREE.MathUtils.clamp(0.28 + 0.42 * t + variation * 0.08, 0.18, 0.82);
  return target.copy(deep).lerp(bright, mix);
}

/**
 * Small, closed, deliberately imperfect lathed tear for sparse wing-edge spray.
 */
export function createDropletGeometry({ radialSegments = 12, heightSegments = 8, seed = 0 } = {}) {
  const radial = Math.max(3, Math.trunc(radialSegments));
  const vertical = Math.max(2, Math.trunc(heightSegments));
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const color = new THREE.Color();
  const phase = signedHash(seed, 101, 211) * 0.18;

  for (let ring = 0; ring < vertical; ring += 1) {
    const t = (ring + 1) / (vertical + 1);
    const tearProfile = Math.pow(Math.sin(Math.PI * t), 0.68) * (1 - 0.38 * t);
    const baseRadius = 0.075 * tearProfile;
    const y = -0.135 + t * 0.315;

    for (let segment = 0; segment < radial; segment += 1) {
      const angle = (segment / radial) * Math.PI * 2 + phase;
      const variation = signedHash(seed, ring, segment);
      const neighbouringWave = Math.sin(angle * 3 + ring * 1.71 + phase * 2);
      const irregularity = 1 + variation * 0.045 + neighbouringWave * 0.025;
      const x = Math.cos(angle) * baseRadius * irregularity;
      const z = Math.sin(angle) * baseRadius * 0.84 * irregularity;
      positions.push(x, y, z);
      dropletColor(t, variation, color);
      colors.push(color.r, color.g, color.b);
      uvs.push(segment / radial, t);
    }
  }

  for (let ring = 0; ring < vertical - 1; ring += 1) {
    const lower = ring * radial;
    const upper = (ring + 1) * radial;
    for (let segment = 0; segment < radial; segment += 1) {
      const next = (segment + 1) % radial;
      const a = lower + segment;
      const b = lower + next;
      const c = upper + segment;
      const d = upper + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const bottomIndex = positions.length / 3;
  const bottomOffset = signedHash(seed, 307, 401) * 0.003;
  positions.push(bottomOffset, -0.135, -bottomOffset * 0.5);
  dropletColor(0, 0, color);
  colors.push(color.r, color.g, color.b);
  uvs.push(0.5, 0);

  const topIndex = positions.length / 3;
  const topOffset = signedHash(seed, 503, 601) * 0.002;
  positions.push(topOffset, 0.18, topOffset * 0.35);
  dropletColor(1, 0, color);
  colors.push(color.r, color.g, color.b);
  uvs.push(0.5, 1);

  const lastRing = (vertical - 1) * radial;
  for (let segment = 0; segment < radial; segment += 1) {
    const next = (segment + 1) % radial;
    indices.push(bottomIndex, segment, next);
    indices.push(topIndex, lastRing + next, lastRing + segment);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = 'waterwing-v2-droplet-geometry';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.seed = normalizedSeed(seed);
  return geometry;
}

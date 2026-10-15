import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { createProjectileWaterMaterial } from './createProjectileWaterMaterial';
import type { WaterProjectileProfile } from './waterProjectileProfiles';

export type ProjectileKind = 'player-pulse' | 'enemy-direct' | 'enemy-lob';
export type ProjectilePathType = 'direct' | 'high-arc';
export type PointLike = THREE.Vector3 | readonly [number, number, number];

export type ProjectileContext = {
  start?: PointLike;
  end?: PointLike;
  arcHeight?: number;
  bend?: number;
  impactHandoff?: boolean;
};

export type WaterProjectileOptions = {
  textureSize?: number;
  textureAnisotropy?: number;
  start?: PointLike;
  end?: PointLike;
  arcHeight?: number;
};

const FORWARD = new THREE.Vector3(0, 0, 1);
const LAUNCH_END = 0.16;
const ARRIVAL_START = 0.88;

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function deterministicUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function tupleLerp(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  weight: number,
): [number, number, number] {
  return [
    THREE.MathUtils.lerp(from[0], to[0], weight),
    THREE.MathUtils.lerp(from[1], to[1], weight),
    THREE.MathUtils.lerp(from[2], to[2], weight),
  ];
}

function vector(value: PointLike | undefined, fallback: readonly [number, number, number]): THREE.Vector3 {
  if (value instanceof THREE.Vector3) return value.clone();
  return new THREE.Vector3(...(value ?? fallback));
}

export function createIrregularWaterGeometry(
  radius: number,
  scale: readonly [number, number, number],
  seed = 0,
  detail = 3,
): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const inverseLength = 1 / Math.max(1e-6, Math.hypot(x, y, z));
    const nx = x * inverseLength;
    const ny = y * inverseLength;
    const nz = z * inverseLength;
    const radial = 1
      + 0.086 * Math.sin(nx * 2.8 + ny * 1.65 - nz * 2.15 + seed * 1.91)
      + 0.056 * Math.sin(nx * 4.1 - ny * 2.3 + nz * 3.2 + seed * 0.73)
      + 0.03 * Math.cos(nx * 5.2 + ny * 3.7 + nz * 4.4 + seed * 2.11);
    position.setXYZ(index, x * radial * scale[0], y * radial * scale[1], z * radial * scale[2]);
  }
  position.needsUpdate = true;
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  const welded = mergeVertices(geometry, 1e-4);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  welded.userData.surfaceFinish = 'welded-organic-water';
  welded.userData.irregularityBand = 'low-frequency-lobed';
  geometry.dispose();
  return welded;
}

function directPoint(start: THREE.Vector3, end: THREE.Vector3, progress: number, bend: number): THREE.Vector3 {
  const point = start.clone().lerp(end, progress);
  point.y += Math.sin(progress * Math.PI) * bend;
  point.x += Math.sin(progress * Math.PI) * bend * 0.18;
  return point;
}

function highArcPoint(start: THREE.Vector3, end: THREE.Vector3, progress: number, height: number): THREE.Vector3 {
  const point = start.clone().lerp(end, progress);
  point.y += Math.sin(progress * Math.PI) * height;
  point.x += Math.sin(progress * Math.PI) * 0.08 * Math.sign(end.x - start.x || -1);
  return point;
}

function phaseAt(progress: number): 'launch' | 'cruise' | 'arrival' | 'complete' {
  if (progress >= 1) return 'complete';
  if (progress >= ARRIVAL_START) return 'arrival';
  if (progress < LAUNCH_END) return 'launch';
  return 'cruise';
}

function buildTrail(profile: WaterProjectileProfile): {
  group: THREE.Group;
  lanes: Array<readonly [number, number, number]>;
} {
  const group = new THREE.Group();
  group.name = 'detached-droplets';
  const lanes: Array<readonly [number, number, number]> = [];
  const gapPattern = [0.58, 1.36, 0.72, 1.12, 0.49, 1.54, 0.84] as const;
  const patternOffset = profile.kind === 'player-pulse' ? 0 : profile.kind === 'enemy-direct' ? 2 : 4;
  const gapWeights = Array.from({ length: Math.max(0, profile.trail.count - 1) }, (_, index) =>
    gapPattern[(index + 1 + patternOffset) % gapPattern.length]);
  const gapTotal = gapWeights.reduce((sum, value) => sum + value, 0) || 1;
  let accumulatedGap = 0;
  for (let index = 0; index < profile.trail.count; index += 1) {
    const normalized = profile.trail.count === 1 ? 0 : index / (profile.trail.count - 1);
    if (index > 0) accumulatedGap += gapWeights[index - 1];
    const distance = 0.1 + profile.trail.length * (accumulatedGap / gapTotal);
    const scatter = 0.68 + deterministicUnit(index * 7.3 + profile.kind.length) * 0.58;
    const side = Math.sin((index + 1) * 2.17 + patternOffset * 0.37)
      * profile.trail.spread * scatter * (0.58 + normalized * 0.5);
    const lift = Math.cos((index + 1) * 1.63 + patternOffset * 0.21)
      * profile.trail.spread * (0.52 + scatter * 0.2) - normalized * profile.trail.fall;
    const lane = [side, lift, -distance] as const;
    lanes.push(lane);
    const radiusPattern = [1, 0.62, 0.88, 0.48, 0.76, 0.41, 0.57] as const;
    const radius = profile.trail.radius
      * radiusPattern[(index + patternOffset) % radiusPattern.length]
      * (1 - normalized * 0.2);
    const droplet = new THREE.Mesh(
      createIrregularWaterGeometry(
        radius,
        [0.7 + scatter * 0.11, 0.62 + (1 - scatter) * 0.17, 1.2 + normalized * 0.72],
        index + profile.kind.length,
        2,
      ),
      createProjectileWaterMaterial({
        tint: profile.tint, attenuation: profile.attenuation, emissive: profile.emissive, role: 'wake',
      }),
    );
    droplet.name = `detached-droplet-${index + 1}`;
    droplet.position.fromArray(lane);
    droplet.userData.sculptComponent = {
      id: `projectile-droplet-${index}`, material: 'clear-water-v10', role: 'detached-droplet',
    };
    const lifetimeStart = 0.02 + ((index * 3 + patternOffset) % 6) * 0.035;
    const lifetimeDuration = 0.34 + ((index * 5 + patternOffset) % 5) * 0.055;
    droplet.userData.fragmentLifetime = {
      start: lifetimeStart,
      end: Math.min(0.88, lifetimeStart + lifetimeDuration),
    };
    droplet.userData.baseFragmentScale = 0.84 + deterministicUnit(index * 4.7 + patternOffset) * 0.34;
    group.add(droplet);
  }
  return { group, lanes };
}

function createOpenWaterStreamGeometry(
  centers: readonly THREE.Vector3[],
  radii: readonly number[],
  radialSegments = 7,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const reference = new THREE.Vector3();
  for (let ring = 0; ring < centers.length; ring += 1) {
    const previous = centers[Math.max(0, ring - 1)];
    const next = centers[Math.min(centers.length - 1, ring + 1)];
    tangent.subVectors(next, previous).normalize();
    reference.set(Math.abs(tangent.y) < 0.86 ? 0 : 1, Math.abs(tangent.y) < 0.86 ? 1 : 0, 0);
    normal.crossVectors(reference, tangent).normalize();
    binormal.crossVectors(tangent, normal).normalize();
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = radial / radialSegments * Math.PI * 2;
      const radius = radii[ring] * (1 + Math.sin(angle * 3 + ring * 0.73) * 0.08);
      vertices.push(
        centers[ring].x + normal.x * Math.cos(angle) * radius + binormal.x * Math.sin(angle) * radius,
        centers[ring].y + normal.y * Math.cos(angle) * radius + binormal.y * Math.sin(angle) * radius,
        centers[ring].z + normal.z * Math.cos(angle) * radius + binormal.z * Math.sin(angle) * radius,
      );
    }
    if (ring < centers.length - 1) {
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const nextRadial = (radial + 1) % radialSegments;
        const cursor = ring * radialSegments + radial;
        const cursorNext = ring * radialSegments + nextRadial;
        const nextRing = (ring + 1) * radialSegments + radial;
        const nextRingNext = (ring + 1) * radialSegments + nextRadial;
        indices.push(cursor, nextRing, cursorNext, cursorNext, nextRing, nextRingNext);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.surfaceFinish = 'broken-volumetric-water-stream';
  geometry.userData.volumeTopology = 'open-curved-volume-stream';
  geometry.userData.openEnds = true;
  geometry.userData.radialSegments = radialSegments;
  return geometry;
}

function createWakeStreamGeometry(
  length: number,
  width: number,
  seed: number,
  branch: number,
): THREE.BufferGeometry {
  const rings = 10;
  const centers: THREE.Vector3[] = [];
  const radii: number[] = [];
  const branchSign = branch % 2 === 0 ? -1 : 1;
  for (let ring = 0; ring < rings; ring += 1) {
    const t = ring / (rings - 1);
    const fork = Math.pow(Math.max(0, (t - 0.26) / 0.74), 1.35);
    centers.push(new THREE.Vector3(
      Math.sin(seed * 1.31 + t * 5.1) * width * (0.09 + t * 0.24)
        + branchSign * fork * width * (0.2 + branch * 0.055),
      Math.cos(seed * 1.77 + t * 4.35) * width * (0.07 + t * 0.2)
        + Math.sin(branch * 1.9 + t * 2.7) * fork * width * 0.12,
      -0.06 - length * (t * 0.8 + t * t * 0.2),
    ));
    radii.push(width
      * (0.34 * Math.pow(1 - t, 0.7) + 0.055)
      * (0.86 + Math.sin(seed * 2.1 + t * 7.4) * 0.14));
  }
  return createOpenWaterStreamGeometry(centers, radii, 7);
}

function buildBrokenWaterSheets(profile: WaterProjectileProfile): THREE.Group {
  const group = new THREE.Group();
  group.name = 'broken-water-sheets';
  const sheetCount = 3;
  for (let index = 0; index < sheetCount; index += 1) {
    const normalized = sheetCount === 1 ? 0 : index / (sheetCount - 1);
    const sheet = new THREE.Mesh(
      createWakeStreamGeometry(
        profile.trail.length * (0.48 + normalized * 0.24),
        profile.baseRadius * (0.46 - normalized * 0.06),
        profile.kind.length + index * 2.3,
        index,
      ),
      createProjectileWaterMaterial({
        tint: profile.tint, attenuation: profile.attenuation, emissive: profile.emissive, role: 'wake-sheet',
      }),
    );
    sheet.name = `curved-water-stream-${index + 1}`;
    sheet.position.set(
      Math.sin((index + 1) * 2.1) * profile.trail.spread * 0.62,
      Math.cos((index + 1) * 1.7) * profile.trail.spread * 0.5,
      -0.04 - normalized * 0.1,
    );
    sheet.rotation.z = -0.16 + normalized * 0.32;
    sheet.userData.baseRotationZ = sheet.rotation.z;
    sheet.userData.baseOffset = sheet.position.toArray();
    sheet.userData.fragmentLifetime = {
      start: 0.018 + index * 0.026,
      end: 0.68 + ((index * 3 + profile.kind.length) % 4) * 0.055,
    };
    group.add(sheet);
  }
  return group;
}

function buildAtomizedMist(profile: WaterProjectileProfile): THREE.Points {
  const count = profile.kind === 'player-pulse' ? 30 : profile.kind === 'enemy-direct' ? 44 : 56;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const normalized = count === 1 ? 0 : index / (count - 1);
    const angle = index * 2.399963229728653 + profile.kind.length * 0.41;
    const radial = profile.trail.spread * (0.3 + (index % 11) / 5.5) * (0.56 + normalized * 0.62);
    positions[index * 3] = Math.cos(angle) * radial;
    positions[index * 3 + 1] = Math.sin(angle) * radial * 0.72 - normalized * profile.trail.fall * 0.55;
    positions[index * 3 + 2] = -0.12 - normalized * profile.trail.length * (0.7 + (index % 5) * 0.035);
    sizes[index] = 0.65 + (index % 5) * 0.1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('mistScale', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.PointsMaterial({
    color: new THREE.Color('#d8fbff').lerp(new THREE.Color(profile.tint), 0.2),
    size: profile.baseRadius * 0.078,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.29,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  material.userData = {
    clearWaterVersion: 'clear-water-v10-projectile',
    texturePolicy: 'textureless-atomized-mist',
    role: 'mist',
  };
  const mist = new THREE.Points(geometry, material);
  mist.name = 'atomized-water-mist';
  mist.userData.baseOpacity = material.opacity;
  return mist;
}

function buildArrivalSpray(profile: WaterProjectileProfile): THREE.Group {
  const spray = new THREE.Group();
  spray.name = 'arrival-water-sheet';
  const fragmentCount = profile.kind === 'player-pulse' ? 5 : profile.kind === 'enemy-direct' ? 7 : 8;
  for (let index = 0; index < fragmentCount; index += 1) {
    const normalized = fragmentCount === 1 ? 0 : index / (fragmentCount - 1);
    const fanAngle = profile.kind === 'enemy-lob'
      ? -0.92 + normalized * 1.24
      : -0.82 + normalized * 1.64;
    const fragmentLength = profile.baseRadius
      * (profile.kind === 'player-pulse' ? 1.6 : profile.kind === 'enemy-direct' ? 2.8 : 2.7)
      * (0.72 + deterministicUnit(index * 3.7 + profile.kind.length) * 0.48);
    const rings = 7;
    const centers: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let ring = 0; ring < rings; ring += 1) {
      const t = ring / (rings - 1);
      const diagonalLift = profile.kind === 'enemy-lob' ? (normalized - 0.5) * fragmentLength * 0.34 : 0;
      centers.push(new THREE.Vector3(
        Math.cos(fanAngle) * fragmentLength * t
          + Math.sin(index * 1.7 + t * 5.2) * profile.baseRadius * 0.045,
        Math.sin(fanAngle) * fragmentLength * t + diagonalLift * t
          + Math.cos(index * 1.3 + t * 4.6) * profile.baseRadius * 0.038,
        Math.sin(index * 2.1 + t * 3.8) * profile.baseRadius * (0.035 + t * 0.028),
      ));
      radii.push(profile.baseRadius
        * (0.12 + (index % 3) * 0.018)
        * (0.32 + Math.sin(t * Math.PI) * 0.68)
        * (0.88 + Math.sin(index + t * 5.7) * 0.12));
    }
    const fragment = new THREE.Mesh(
      createOpenWaterStreamGeometry(centers, radii, 6),
      createProjectileWaterMaterial({
        tint: profile.tint, attenuation: profile.attenuation, emissive: profile.emissive, role: 'arrival-spray',
      }),
    );
    fragment.name = `arrival-fragment-${index + 1}`;
    fragment.userData.arrivalLane = {
      x: Math.sin(index * 2.13) * profile.baseRadius * 0.22,
      y: Math.cos(index * 1.71) * profile.baseRadius * 0.17 - profile.baseRadius * 0.04,
      z: 0.025 + (index % 3) * profile.baseRadius * 0.035,
    };
    fragment.userData.arrivalDelay = index * (profile.kind === 'player-pulse' ? 0.045 : 0.028);
    fragment.visible = false;
    spray.add(fragment);
  }
  return spray;
}

function captureBasePositions(geometry: THREE.BufferGeometry): Float32Array {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  return new Float32Array(positions.array as ArrayLike<number>);
}

function deformCoreSurface(
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
  profile: WaterProjectileProfile,
  progress: number,
  cruiseWeight: number,
  arrivalWeight: number,
  density = 1,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const radius = profile.baseRadius * density;
  for (let index = 0; index < positions.count; index += 1) {
    const cursor = index * 3;
    const x0 = basePositions[cursor];
    const y0 = basePositions[cursor + 1];
    const z0 = basePositions[cursor + 2];
    const nx = x0 / Math.max(1e-6, radius * profile.shape[0]);
    const ny = y0 / Math.max(1e-6, radius * profile.shape[1]);
    const nz = z0 / Math.max(1e-6, radius * profile.shape[2]);
    const front = clamp01(nz * 0.5 + 0.5);
    const launchWeight = 1 - cruiseWeight;
    const cruiseOnly = cruiseWeight * (1 - arrivalWeight);
    const phase = progress * Math.PI * 2;

    let x = x0;
    let y = y0;
    let z = z0;
    const sharedCurl = Math.sin(nz * 4.7 + ny * 2.4 + phase * 0.38 + profile.kind.length);
    x += radius * sharedCurl * (0.025 + cruiseOnly * 0.07);
    y += radius * Math.cos(nx * 3.8 - nz * 3.1 + phase * 0.31) * (0.018 + cruiseOnly * 0.052);

    if (profile.kind === 'player-pulse') {
      z -= radius * launchWeight * front * front * 0.08;
      x += radius * arrivalWeight * Math.sin(ny * 5.4 + nz * 2.1) * 0.1;
      y += radius * arrivalWeight * Math.cos(nx * 4.6 - nz * 2.8) * 0.07;
    } else if (profile.kind === 'enemy-direct') {
      z -= radius * launchWeight * front * front * 0.24;
      x += radius * cruiseOnly * Math.sin(nz * 5.8 + ny * 2.7 + 0.4) * (0.13 + Math.abs(nz) * 0.075);
      y += radius * cruiseOnly * Math.cos(nz * 4.9 - nx * 3.2) * 0.105;
      x += radius * arrivalWeight * Math.sin(ny * 6.1 + nz * 3.3) * (0.12 + Math.abs(nx) * 0.08);
      y += radius * arrivalWeight * Math.cos(nx * 5.3 - nz * 2.5) * 0.11;
    } else {
      z -= radius * launchWeight * front * front * 0.06;
      x += radius * cruiseOnly * Math.sin(nz * 5.3 + ny * 3.1 + 1.2) * 0.15;
      y += radius * cruiseOnly * Math.cos(nz * 4.2 - nx * 2.9 + 0.7) * 0.12;
      const diagonal = (nx * 0.26 + Math.sin(ny * 5.7 + nz * 2.6) * 0.13) * arrivalWeight;
      y += radius * diagonal;
      x += radius * arrivalWeight * Math.sin(ny * 5.2 - nz * 3.7) * 0.15;
    }

    positions.setXYZ(index, x, y, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function createWaterProjectile(
  profile: WaterProjectileProfile,
  options: WaterProjectileOptions = {},
): THREE.Group {
  const root = new THREE.Group();
  root.name = `${profile.kind} water projectile`;

  const primary = new THREE.Mesh(
    createIrregularWaterGeometry(profile.baseRadius, profile.shape, profile.kind.length, 4),
    createProjectileWaterMaterial({
      tint: profile.tint, attenuation: profile.attenuation, emissive: profile.emissive, role: 'core',
    }),
  );
  primary.name = 'irregular-water-mass';
  primary.userData.sculptComponent = { id: 'body', material: 'clear-water-v10', role: 'projectile-core' };
  root.add(primary);
  const primaryBasePositions = captureBasePositions(primary.geometry);

  const pressureCore = new THREE.Mesh(
    createIrregularWaterGeometry(
      profile.baseRadius * 0.76,
      [profile.shape[0] * 0.78, profile.shape[1] * 0.76, profile.shape[2] * 0.82],
      profile.kind.length + 17,
      3,
    ),
    createProjectileWaterMaterial({
      tint: profile.tint, attenuation: profile.attenuation, emissive: profile.emissive, role: 'pressure-core',
    }),
  );
  pressureCore.name = 'dense-pressure-core';
  pressureCore.renderOrder = 1;
  pressureCore.userData.sculptComponent = {
    id: 'pressure-core', material: 'clear-water-v10', role: 'layered-water-density',
  };
  root.add(pressureCore);
  const pressureBasePositions = captureBasePositions(pressureCore.geometry);

  const { group: detached, lanes } = buildTrail(profile);
  root.add(detached);
  const brokenSheets = buildBrokenWaterSheets(profile);
  root.add(brokenSheets);
  const atomizedMist = buildAtomizedMist(profile);
  root.add(atomizedMist);
  const arrivalSpray = buildArrivalSpray(profile);
  root.add(arrivalSpray);

  const defaults = {
    start: vector(options.start, profile.defaultStart),
    end: vector(options.end, profile.defaultEnd),
    arcHeight: options.arcHeight ?? profile.defaultArcHeight ?? 0,
  };
  const tangent = new THREE.Vector3();
  const epsilon = 1 / 600;
  const pointAt = (progress: number, context: ProjectileContext = {}): THREE.Vector3 => {
    const t = clamp01(progress);
    const start = vector(context.start, defaults.start.toArray() as [number, number, number]);
    const end = vector(context.end, defaults.end.toArray() as [number, number, number]);
    if (profile.pathType === 'high-arc') {
      return highArcPoint(start, end, t, context.arcHeight ?? defaults.arcHeight);
    }
    return directPoint(start, end, t, context.bend ?? profile.defaultBend);
  };

  const runtime = {
    kind: profile.kind,
    pathType: profile.pathType,
    launchAxis: profile.pathType === 'high-arc' ? 'upward-then-camera' : 'camera-convergent',
    spinTurns: 0,
    orbitalMotion: false,
    durationSeconds: profile.durationSeconds,
    pointAt,
    phaseAt,
    update(progress: number, context: ProjectileContext = {}) {
      const t = clamp01(progress);
      const before = pointAt(Math.max(0, t - epsilon), context);
      const after = pointAt(Math.min(1, t + epsilon), context);
      tangent.subVectors(after, before);
      if (tangent.lengthSq() < 1e-10) tangent.set(0, 0, 1);
      tangent.normalize();
      root.position.copy(pointAt(t, context));
      root.quaternion.setFromUnitVectors(FORWARD, tangent);

      const launchWeight = smoothstep(t / LAUNCH_END);
      const cruiseWeight = smoothstep((t - LAUNCH_END) / 0.27);
      const impactHandoffEnabled = context.impactHandoff !== false;
      const handoff = impactHandoffEnabled
        ? smoothstep((t - ARRIVAL_START) / (1 - ARRIVAL_START))
        : 0;
      const arrivalShapeWeight = smoothstep(handoff / 0.24);
      const liquidPulse = 1 + Math.sin(t * Math.PI * 2.5) * 0.022 * (1 - handoff);
      const formationScale = THREE.MathUtils.lerp(0.24, 1, launchWeight);
      const flightScale = tupleLerp(profile.launchScale, profile.cruiseScale, cruiseWeight);
      const phaseScale = tupleLerp(flightScale, profile.arrivalScale, arrivalShapeWeight);
      const coreRetention = 1 - 0.86 * smoothstep(handoff / 0.46);
      deformCoreSurface(
        primary.geometry,
        primaryBasePositions,
        profile,
        t,
        cruiseWeight,
        arrivalShapeWeight,
      );
      primary.scale.set(
        phaseScale[0] * formationScale * coreRetention * liquidPulse,
        phaseScale[1] * formationScale * coreRetention / liquidPulse,
        phaseScale[2] * formationScale * coreRetention,
      );
      primary.visible = t < 1 && coreRetention > 0.055;

      const pressurePulse = 1 + Math.sin(t * Math.PI * 3.1 + 0.6) * 0.028 * (1 - handoff);
      const pressureRetention = 1 - 0.97 * smoothstep(handoff / 0.38);
      deformCoreSurface(
        pressureCore.geometry,
        pressureBasePositions,
        profile,
        t,
        cruiseWeight,
        arrivalShapeWeight,
        0.6,
      );
      pressureCore.scale.set(
        phaseScale[0] * formationScale * pressureRetention * 0.9 * pressurePulse,
        phaseScale[1] * formationScale * pressureRetention * 0.88 / pressurePulse,
        phaseScale[2] * formationScale * pressureRetention * 0.92,
      );
      pressureCore.position.set(
        Math.sin(t * Math.PI * 2.2) * profile.baseRadius * 0.035,
        Math.cos(t * Math.PI * 1.7) * profile.baseRadius * 0.025,
        -profile.baseRadius * 0.035,
      );
      pressureCore.visible = t > 0.02 && t < 1 && pressureRetention > 0.08;

      detached.children.forEach((child, index) => {
        const normalized = detached.children.length === 1 ? 0 : index / (detached.children.length - 1);
        const lane = lanes[index];
        const lifetime = child.userData.fragmentLifetime as { start: number; end: number };
        const reveal = smoothstep((t - lifetime.start) / 0.075);
        const release = 1 - smoothstep((t - (lifetime.end - 0.11)) / 0.11);
        const retreat = 1 + t * (0.1 + normalized * 0.12);
        child.position.set(
          lane[0] * (1 + t * 0.18)
            + Math.sin(t * 7.1 + index * 1.9) * profile.trail.spread * 0.09,
          lane[1] - t * profile.trail.fall * (index + 1) * 0.18
            + Math.cos(t * 6.4 + index * 2.3) * profile.trail.spread * 0.065,
          lane[2] * retreat,
        );
        const baseFragmentScale = child.userData.baseFragmentScale as number;
        const tailScale = reveal * release * baseFragmentScale * (1 - handoff * (0.82 + normalized * 0.13));
        child.scale.set(
          Math.max(0.001, tailScale * (0.78 + (index % 2) * 0.13)),
          Math.max(0.001, tailScale * (0.66 + (index % 3) * 0.09)),
          Math.max(0.001, tailScale * (1.08 + normalized * 0.28)),
        );
        child.visible = t < 1 && tailScale > 0.025;
      });

      brokenSheets.children.forEach((child, index) => {
        const normalized = brokenSheets.children.length === 1 ? 0 : index / (brokenSheets.children.length - 1);
        const lifetime = child.userData.fragmentLifetime as { start: number; end: number };
        const reveal = smoothstep((t - lifetime.start) / 0.085);
        const release = 1 - smoothstep((t - (lifetime.end - 0.15)) / 0.15);
        const fade = release * (1 - handoff * (0.84 + normalized * 0.11));
        const sheetScale = Math.max(0.001, reveal * fade);
        const offset = child.userData.baseOffset as [number, number, number];
        child.position.set(
          offset[0] * (1 + t * 0.22),
          offset[1] + Math.sin(t * Math.PI * 2.4 + index) * profile.baseRadius * 0.018,
          offset[2] - t * profile.trail.length * (0.035 + normalized * 0.025),
        );
        child.rotation.z = child.userData.baseRotationZ
          + Math.sin(t * Math.PI * 1.7 + index * 0.8) * 0.045;
        child.scale.set(
          sheetScale * (0.88 + Math.sin(t * 4.1 + index) * 0.05),
          sheetScale * (0.82 + normalized * 0.09),
          sheetScale * (0.96 + Math.cos(t * 3.7 + index) * 0.055),
        );
        child.visible = t > 0.025 && t < 1 && sheetScale > 0.035;
      });

      const mistReveal = smoothstep((launchWeight - 0.08) / 0.86);
      const mistFade = 1 - handoff * 0.88;
      atomizedMist.visible = t > 0.03 && t < 1 && mistReveal * mistFade > 0.04;
      atomizedMist.scale.setScalar(0.76 + t * 0.3);
      (atomizedMist.material as THREE.PointsMaterial).opacity =
        (atomizedMist.userData.baseOpacity as number) * mistReveal * mistFade;

      arrivalSpray.children.forEach((child, index) => {
        const lane = child.userData.arrivalLane as { x: number; y: number; z: number };
        const delay = child.userData.arrivalDelay as number;
        const stagger = smoothstep((handoff - delay) / 0.32);
        child.position.set(lane.x * stagger, lane.y * stagger, lane.z * stagger);
        const fragmentScale = Math.max(0.001, stagger * (1 - handoff * 0.18));
        child.scale.set(
          fragmentScale * (0.9 + (index % 3) * 0.07),
          fragmentScale * (0.86 + ((index + 1) % 3) * 0.06),
          fragmentScale,
        );
        child.visible = stagger > 0.025 && t < 1;
      });

      root.visible = t < 1;
      root.userData.projectileState = {
        progress: t,
        phase: t >= 1
          ? 'complete'
          : impactHandoffEnabled ? phaseAt(t) : t < LAUNCH_END ? 'launch' : 'cruise',
        position: root.position.toArray(),
        tangent: tangent.toArray(),
        launchWeight,
        cruiseWeight,
        arrivalShapeWeight,
        impactHandoffWeight: handoff,
        impactHandoffEnabled,
        closedCoreWeight: coreRetention,
        coreScale: primary.scale.toArray(),
      };
      return runtime;
    },
  };
  root.userData.projectileRuntime = runtime;
  root.userData.projectileContract = {
    archetype: profile.archetype,
    wakeStyle: profile.wakeStyle,
    irregularSilhouette: true,
    detachedDroplets: profile.trail.count,
    layeredVolume: true,
    brokenWakeSheets: true,
    volumetricBranchedWake: true,
    irregularFragmentTiming: true,
    atomizedMist: true,
    phaseDeformation: true,
    arrivalCoreShedding: true,
    lifecycle: ['launch', 'cruise', 'arrival', 'complete'],
    arrivalStart: ARRIVAL_START,
    cylindrical: false,
    perfectSphere: false,
    beam: false,
    selfOrbit: false,
    axialSpin: false,
    deterministic: true,
    materialVersion: 'clear-water-v10-projectile',
  };
  root.userData.aqueousLook = {
    version: 'clear-water-v10-projectile',
    texturePolicy: 'textureless-volume',
  };
  runtime.update(0);
  return root;
}

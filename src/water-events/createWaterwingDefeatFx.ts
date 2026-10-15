import * as THREE from 'three';

import {
  clamp01,
  createEventWaterGeometry,
  createEventWaterMaterial,
  createWaterSurfaceStage,
  waterBand,
  waterSmoothstep,
  waterVector,
  type WaterPointLike,
} from './createWaterSurfaceStage';

export type WaterwingDefeatFxOptions = {
  anchor?: WaterPointLike;
  surfaceNormal?: WaterPointLike;
  impactDirection?: WaterPointLike;
  seed?: number;
  durationSeconds?: number;
};

export type WaterwingDefeatContext = {
  anchor?: WaterPointLike;
  surfaceNormal?: WaterPointLike;
  impactDirection?: WaterPointLike;
};

type DefeatMass = {
  actor: number;
  invertedDrop: number;
  neck: number;
  curtain: number;
  crown: number;
  splash: number;
  ripple: number;
  total: number;
};

const UP = new THREE.Vector3(0, 1, 0);
const MASS_KEYS = ['actor', 'invertedDrop', 'neck', 'curtain', 'crown', 'splash', 'ripple'] as const;

const MASS_KEYFRAMES: Array<{ t: number; mass: Omit<DefeatMass, 'total'> }> = [
  { t: 0, mass: { actor: 1, invertedDrop: 0, neck: 0, curtain: 0, crown: 0, splash: 0, ripple: 0 } },
  { t: 0.18, mass: { actor: 0.82, invertedDrop: 0.14, neck: 0.03, curtain: 0.01, crown: 0, splash: 0, ripple: 0 } },
  { t: 0.42, mass: { actor: 0.48, invertedDrop: 0.31, neck: 0.16, curtain: 0.04, crown: 0.01, splash: 0, ripple: 0 } },
  { t: 0.62, mass: { actor: 0.22, invertedDrop: 0.16, neck: 0.38, curtain: 0.12, crown: 0.08, splash: 0.02, ripple: 0.02 } },
  { t: 0.76, mass: { actor: 0.07, invertedDrop: 0.05, neck: 0.18, curtain: 0.17, crown: 0.36, splash: 0.13, ripple: 0.04 } },
  { t: 0.9, mass: { actor: 0.01, invertedDrop: 0.01, neck: 0.03, curtain: 0.08, crown: 0.14, splash: 0.49, ripple: 0.24 } },
  { t: 1, mass: { actor: 0, invertedDrop: 0, neck: 0, curtain: 0.02, crown: 0.04, splash: 0.12, ripple: 0.82 } },
];

function defeatPhase(progress: number): string {
  if (progress < 0.18) return 'compress';
  if (progress < 0.44) return 'inverted-drop';
  if (progress < 0.64) return 'neck';
  if (progress < 0.78) return 'crown';
  if (progress < 0.92) return 'splash';
  if (progress < 0.99) return 'ripple';
  return 'settled';
}

function defeatMass(progress: number): DefeatMass {
  let left = MASS_KEYFRAMES[0];
  let right = MASS_KEYFRAMES[MASS_KEYFRAMES.length - 1];
  for (let index = 0; index < MASS_KEYFRAMES.length - 1; index += 1) {
    if (progress >= MASS_KEYFRAMES[index].t && progress <= MASS_KEYFRAMES[index + 1].t) {
      left = MASS_KEYFRAMES[index];
      right = MASS_KEYFRAMES[index + 1];
      break;
    }
  }
  const local = waterSmoothstep(left.t, right.t, progress);
  const values = {} as Omit<DefeatMass, 'total'>;
  MASS_KEYS.forEach((key) => {
    values[key] = THREE.MathUtils.lerp(left.mass[key], right.mass[key], local);
  });
  const sum = MASS_KEYS.reduce((total, key) => total + values[key], 0);
  if (sum > 1e-9) MASS_KEYS.forEach((key) => { values[key] /= sum; });
  return { ...values, total: 1 };
}

function seededUnit(seed: number, index: number): number {
  const value = Math.sin((seed + 11) * 69.31 + (index + 7) * 37.77) * 29473.219;
  return value - Math.floor(value);
}

function setOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.opacity = clamp01(opacity);
      material.needsUpdate = true;
    });
  });
}

function createInvertedDropGeometry(seed: number): THREE.BufferGeometry {
  const geometry = createEventWaterGeometry(0.62, [0.88, 1.55, 0.82], seed, 36, 24);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index) / (0.62 * 1.55);
    const taper = THREE.MathUtils.lerp(0.48, 1.08, clamp01((y + 1) * 0.5));
    position.setX(index, position.getX(index) * taper);
    position.setZ(index, position.getZ(index) * taper);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createLiquidNeckGeometry(seed: number): THREE.BufferGeometry {
  const radialSegments = 20;
  const heightSegments = 8;
  const ringStride = radialSegments + 1;
  const height = 1.08;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= heightSegments; row += 1) {
    const v = row / heightSegments;
    const radius = v < 0.46
      ? THREE.MathUtils.lerp(0.26, 0.095, waterSmoothstep(0, 0.46, v))
      : THREE.MathUtils.lerp(0.095, 0.215, waterSmoothstep(0.46, 1, v));
    const centerX = Math.sin(v * Math.PI * 1.45 + seed * 0.37) * 0.045 * v;
    const centerZ = Math.cos(v * Math.PI * 1.2 - seed * 0.29) * 0.035 * v;
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const irregularity = 1
        + 0.13 * Math.sin(angle * 3 + v * 5.2 + seed * 0.31)
        + 0.06 * Math.cos(angle * 7 - v * 3.4 - seed * 0.23);
      positions.push(
        centerX + Math.cos(angle) * radius * irregularity,
        v * height,
        centerZ + Math.sin(angle) * radius * irregularity,
      );
    }
  }

  for (let row = 0; row < heightSegments; row += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const lower = row * ringStride + segment;
      const upper = (row + 1) * ringStride + segment;
      indices.push(lower, lower + 1, upper + 1, lower, upper + 1, upper);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.waterDefeatNeck = true;
  geometry.userData.closedLoop = false;
  geometry.userData.seed = seed;
  return geometry;
}

function createOpenLiquidSheetGeometry(
  width: number,
  height: number,
  depth: number,
  seed: number,
): THREE.BufferGeometry {
  const columns = 10;
  const rows = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const widthProfile = 0.5
      + 0.44 * Math.sin(Math.PI * (0.06 + v * 0.86))
      + 0.055 * Math.sin(v * Math.PI * 5.2 + seed * 0.47);
    const edgeWander = width * (
      0.045 * Math.sin(v * 8.4 + seed * 0.39)
      + 0.025 * Math.cos(v * 13.1 - seed * 0.23)
    );
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const edgeSoftening = Math.sin(Math.PI * u);
      const tornEdge = (1 - edgeSoftening) * edgeWander * (u < 0.5 ? -1 : 1);
      const x = (u - 0.5) * width * widthProfile
        + tornEdge
        + Math.sin(v * 8.1 + seed * 0.51) * width * 0.045 * edgeSoftening;
      const y = v * height
        + Math.sin(u * Math.PI * 2.3 + seed * 0.41) * height * 0.035 * v
        + Math.cos(u * Math.PI * 5.1 - v * 3.4 + seed * 0.29) * height * 0.012;
      const z = depth * (
        Math.sin(u * Math.PI + seed * 0.11) * (0.72 + 0.28 * Math.sin(v * Math.PI))
        + Math.sin(u * Math.PI * 2.4 + v * 2.9 + seed * 0.33) * edgeSoftening * 0.31
        + Math.cos(v * Math.PI * 2.4 - seed * 0.27) * 0.28
      );
      positions.push(x, y, z);
    }
  }
  const stride = columns + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lower = row * stride + column;
      const upper = (row + 1) * stride + column;
      indices.push(lower, lower + 1, upper + 1, lower, upper + 1, upper);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.waterDefeatSheet = true;
  geometry.userData.waterDefeatMembraneCurved = true;
  geometry.userData.closedLoop = false;
  geometry.userData.seed = seed;
  return geometry;
}

function createCrownLobeGeometry(
  width: number,
  height: number,
  depth: number,
  seed: number,
): THREE.BufferGeometry {
  const columns = 6;
  const rows = 7;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    const taper = 0.055 + Math.pow(1 - v, 0.78) * (
      0.9 + 0.08 * Math.sin(v * Math.PI * 3.2 + seed * 0.43)
    );
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const edgeSoftening = Math.sin(Math.PI * u);
      positions.push(
        (u - 0.5) * width * taper,
        v * height + Math.sin(u * Math.PI * 2 + seed * 0.39) * height * 0.022 * v,
        depth * (
          Math.sin(u * Math.PI * 1.8 + seed * 0.31) * edgeSoftening
          + Math.pow(v, 1.3) * 0.58
        ),
      );
    }
  }
  const stride = columns + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lower = row * stride + column;
      const upper = (row + 1) * stride + column;
      indices.push(lower, lower + 1, upper + 1, lower, upper + 1, upper);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.waterDefeatCrownLobe = true;
  geometry.userData.closedLoop = false;
  geometry.userData.taperedCrest = true;
  geometry.userData.seed = seed;
  return geometry;
}

export function createWaterwingDefeatFx(options: WaterwingDefeatFxOptions = {}): THREE.Group {
  const seed = options.seed ?? 0;
  const anchor = waterVector(options.anchor, [0, 0, 0]);
  const surfaceNormal = waterVector(options.surfaceNormal, [0, 1, 0]).normalize();
  const impactDirection = waterVector(options.impactDirection, [-0.6, -0.1, 0.4]).normalize();

  const root = new THREE.Group();
  root.name = 'waterwing-defeat-fx';
  root.position.copy(anchor);
  root.quaternion.setFromUnitVectors(UP, surfaceNormal);

  const stage = createWaterSurfaceStage({ radius: 2.05, seed: seed + 1 });
  stage.name = 'defeat-water-surface-stage';
  root.add(stage);

  const actor = new THREE.Group();
  actor.name = 'defeat-actor-water-core';
  const actorBody = new THREE.Mesh(
    createEventWaterGeometry(0.7, [1.05, 1.22, 0.78], seed + 5, 36, 24),
    createEventWaterMaterial(0.82),
  );
  actorBody.name = 'defeat-actor-body';
  actor.add(actorBody);
  const actorWingGeometry = createEventWaterGeometry(0.57, [1.62, 0.3, 0.55], seed + 7, 30, 18);
  const actorWingLeft = new THREE.Mesh(actorWingGeometry, createEventWaterMaterial(0.74));
  actorWingLeft.name = 'defeat-actor-wing-left';
  actorWingLeft.position.set(-0.78, 0.12, 0);
  actorWingLeft.rotation.z = 0.38;
  actor.add(actorWingLeft);
  const actorWingRight = new THREE.Mesh(actorWingGeometry.clone(), createEventWaterMaterial(0.74));
  actorWingRight.name = 'defeat-actor-wing-right';
  actorWingRight.position.set(0.78, 0.12, 0);
  actorWingRight.rotation.z = -0.38;
  actor.add(actorWingRight);
  actor.position.y = 1.35;
  root.add(actor);

  const invertedDrop = new THREE.Mesh(
    createInvertedDropGeometry(seed + 13),
    createEventWaterMaterial(0.8),
  );
  invertedDrop.name = 'defeat-inverted-drop';
  invertedDrop.position.y = 0.88;
  root.add(invertedDrop);

  const neck = new THREE.Mesh(
    createLiquidNeckGeometry(seed + 15),
    createEventWaterMaterial(0.74),
  );
  neck.name = 'defeat-liquid-neck';
  neck.position.y = 0;
  root.add(neck);

  const fallingSheets = new THREE.Group();
  fallingSheets.name = 'defeat-falling-sheets';
  fallingSheets.userData.legacyName = 'defeat-water-curtain';
  const sheetSeeds = Array.from({ length: 3 }, (_, index) => ({
    x: (seededUnit(seed + 17, index) - 0.5) * 2.7,
    z: (seededUnit(seed + 19, index) - 0.5) * 0.76,
    width: 0.42 + seededUnit(seed + 21, index) * 0.28,
    height: 0.42 + seededUnit(seed + 23, index) * 0.3,
    depth: 0.14 + seededUnit(seed + 25, index) * 0.08,
    rotation: (seededUnit(seed + 27, index) - 0.5) * 0.72,
    tilt: 0.15 + seededUnit(seed + 28, index) * 0.28,
    roll: (seededUnit(seed + 30, index) - 0.5) * 0.66,
    delay: seededUnit(seed + 29, index) * 0.055,
  }));
  sheetSeeds.forEach((entry, index) => {
    const sheet = new THREE.Mesh(
      createOpenLiquidSheetGeometry(entry.width, entry.height, entry.depth, seed + 31 + index),
      createEventWaterMaterial(0.34 + seededUnit(seed + 33, index) * 0.08),
    );
    sheet.name = `defeat-falling-sheet-${index + 1}`;
    sheet.rotation.order = 'YXZ';
    sheet.rotation.y = entry.rotation;
    sheet.rotation.x = entry.tilt;
    sheet.rotation.z = entry.roll;
    fallingSheets.add(sheet);
  });
  root.add(fallingSheets);

  const asymmetricCrown = new THREE.Group();
  asymmetricCrown.name = 'defeat-asymmetric-crown';
  const crownLobes: THREE.Mesh[] = [];
  const crownSeeds = Array.from({ length: 5 }, (_, index) => ({
    angle: seededUnit(seed + 37, index) * Math.PI * 2,
    radius: 0.18 + seededUnit(seed + 39, index) * 0.5,
    width: 0.3 + seededUnit(seed + 41, index) * 0.4,
    height: 0.3 + seededUnit(seed + 43, index) * 0.56,
    depth: 0.025 + seededUnit(seed + 45, index) * 0.075,
    delay: seededUnit(seed + 47, index) * 0.06,
  }));
  crownSeeds.forEach((entry, index) => {
    const lobe = new THREE.Mesh(
      createCrownLobeGeometry(entry.width, entry.height, entry.depth, seed + 51 + index),
      createEventWaterMaterial(0.5 + seededUnit(seed + 53, index) * 0.12, '#b3ecf1'),
    );
    lobe.name = `defeat-crown-lobe-${index + 1}`;
    lobe.position.set(Math.cos(entry.angle) * entry.radius, 0.012, Math.sin(entry.angle) * entry.radius);
    lobe.rotation.y = -entry.angle + Math.PI * 0.5;
    lobe.rotation.x = 0.16 + seededUnit(seed + 54, index) * 0.34;
    lobe.rotation.z = (seededUnit(seed + 55, index) - 0.5) * 0.34;
    asymmetricCrown.add(lobe);
    crownLobes.push(lobe);
  });
  root.add(asymmetricCrown);

  const splash = new THREE.Group();
  splash.name = 'defeat-splash';
  const splashSeeds = Array.from({ length: 15 }, (_, index) => ({
    angle: seededUnit(seed + 59, index) * Math.PI * 2,
    speed: 0.34 + seededUnit(seed + 61, index) * 1.05,
    lift: 0.18 + seededUnit(seed + 63, index) * 0.86,
    size: 0.022 + Math.pow(seededUnit(seed + 65, index), 1.7) * 0.095,
    stretch: 1.08 + seededUnit(seed + 67, index) * 1.8,
    birth: 0.64 + seededUnit(seed + 69, index) * 0.09,
    death: 0.83 + seededUnit(seed + 71, index) * 0.15,
    drift: (seededUnit(seed + 73, index) - 0.5) * 0.32,
  }));
  splashSeeds.forEach((entry, index) => {
    const droplet = new THREE.Mesh(
      createEventWaterGeometry(entry.size, [0.58, entry.stretch, 0.68], seed + 79 + index, 14, 9),
      createEventWaterMaterial(0.7, '#abe8ee'),
    );
    droplet.name = `defeat-splash-droplet-${index + 1}`;
    splash.add(droplet);
  });
  root.add(splash);

  const microSpray = new THREE.Group();
  microSpray.name = 'defeat-micro-spray';
  const microSpraySeeds = Array.from({ length: 22 }, (_, index) => ({
    angle: seededUnit(seed + 97, index) * Math.PI * 2,
    speed: 0.18 + seededUnit(seed + 99, index) * 0.72,
    lift: 0.12 + seededUnit(seed + 101, index) * 0.48,
    size: 0.006 + seededUnit(seed + 103, index) * 0.016,
    stretch: 1.05 + seededUnit(seed + 105, index) * 1.35,
    originX: (seededUnit(seed + 107, index) - 0.5) * 0.84,
    originZ: (seededUnit(seed + 109, index) - 0.5) * 0.52,
    birth: 0.52 + seededUnit(seed + 111, index) * 0.1,
    death: 0.76 + seededUnit(seed + 113, index) * 0.1,
  }));
  microSpraySeeds.forEach((entry, index) => {
    const droplet = new THREE.Mesh(
      createEventWaterGeometry(entry.size, [0.72, entry.stretch, 0.72], seed + 117 + index, 10, 7),
      createEventWaterMaterial(0.26 + seededUnit(seed + 119, index) * 0.08, '#d0f5f7'),
    );
    droplet.name = `defeat-micro-droplet-${index + 1}`;
    microSpray.add(droplet);
  });
  root.add(microSpray);

  const waterThreads = new THREE.Group();
  waterThreads.name = 'defeat-water-threads';
  const threadSeeds = Array.from({ length: 6 }, (_, index) => ({
    x: (seededUnit(seed + 127, index) - 0.5) * 1.1,
    z: (seededUnit(seed + 129, index) - 0.5) * 0.6,
    bend: (seededUnit(seed + 131, index) - 0.5) * 0.34,
    height: 0.16 + seededUnit(seed + 133, index) * 0.24,
    radius: 0.0045 + seededUnit(seed + 135, index) * 0.004,
    birth: 0.53 + seededUnit(seed + 137, index) * 0.08,
    death: 0.75 + seededUnit(seed + 139, index) * 0.1,
  }));
  threadSeeds.forEach((entry, index) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(entry.bend * 0.45, entry.height * 0.48, entry.bend * 0.22),
      new THREE.Vector3(entry.bend, entry.height, -entry.bend * 0.18),
    ]);
    const thread = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 10, entry.radius, 5, false),
      createEventWaterMaterial(0.22 + seededUnit(seed + 141, index) * 0.08, '#c7f1f4'),
    );
    thread.name = `defeat-water-thread-${index + 1}`;
    thread.geometry.userData.waterDefeatThread = true;
    thread.position.set(entry.x, 0.3, entry.z);
    thread.rotation.y = seededUnit(seed + 143, index) * Math.PI * 2;
    waterThreads.add(thread);
  });
  root.add(waterThreads);

  const resolvedAnchor = anchor.clone();
  const resolvedNormal = surfaceNormal.clone();
  const resolvedDirection = impactDirection.clone();
  const eventRuntime = {
    actionId: 'waterwing-defeat-fx',
    durationSeconds: options.durationSeconds ?? 2.45,
    deterministic: true,
    update(progress: number, context: WaterwingDefeatContext = {}) {
      const t = clamp01(progress);
      if (context.anchor) resolvedAnchor.copy(waterVector(context.anchor, resolvedAnchor.toArray() as [number, number, number]));
      if (context.surfaceNormal) resolvedNormal.copy(waterVector(context.surfaceNormal, [0, 1, 0])).normalize();
      if (context.impactDirection) resolvedDirection.copy(waterVector(context.impactDirection, [-0.6, -0.1, 0.4])).normalize();
      root.position.copy(resolvedAnchor);
      root.quaternion.setFromUnitVectors(UP, resolvedNormal);

      const phase = defeatPhase(t);
      const mass = defeatMass(t);
      const yieldEnvelope = waterSmoothstep(0, 0.16, t) * (1 - waterSmoothstep(0.74, 1, t));
      const directionalOffset = resolvedDirection.clone().multiplyScalar(0.34 * yieldEnvelope);
      const inverseRoot = root.quaternion.clone().invert();
      const localDirection = resolvedDirection.clone().applyQuaternion(inverseRoot).normalize();
      const localOffset = localDirection.multiplyScalar(0.34 * yieldEnvelope);

      const collapse = waterSmoothstep(0.08, 0.76, t);
      const fall = waterSmoothstep(0.26, 0.78, t);
      const bodyEnvelope = 1 - waterSmoothstep(0.52, 0.8, t);
      const wingEnvelope = 1 - waterSmoothstep(0.46, 0.72, t);
      const actorEnvelope = Math.max(bodyEnvelope, wingEnvelope);
      actor.visible = actorEnvelope > 0.002;
      actor.scale.set(
        1 - collapse * 0.14,
        1 - collapse * 0.5,
        1 - collapse * 0.1,
      );
      actor.position.set(localOffset.x, 1.35 + localOffset.y - fall * 0.88, localOffset.z);
      actor.rotation.z = -localOffset.x * 0.42 + Math.sin(seed * 0.17) * collapse * 0.08;
      actorBody.scale.set(1 + collapse * 0.08, 1 + collapse * 0.18, 1 - collapse * 0.04);
      actorWingLeft.rotation.z = 0.38 + collapse * 0.72;
      actorWingRight.rotation.z = -0.38 - collapse * 0.58;
      actorWingLeft.rotation.y = -collapse * 0.24;
      actorWingRight.rotation.y = collapse * 0.15;
      setOpacity(actorBody, bodyEnvelope * (0.78 - collapse * 0.15));
      setOpacity(actorWingLeft, wingEnvelope * (0.72 - collapse * 0.12));
      setOpacity(actorWingRight, wingEnvelope * (0.68 - collapse * 0.1));

      const dropAmount = waterBand(t, 0.16, 0.34, 0.62, 0.82);
      invertedDrop.visible = dropAmount > 0.002;
      invertedDrop.scale.set(
        0.62 + dropAmount * 0.32,
        0.36 + dropAmount * 0.7,
        0.66 + dropAmount * 0.28,
      );
      invertedDrop.position.set(
        localOffset.x * 0.86,
        0.96 + localOffset.y - fall * 0.42,
        localOffset.z * 0.86,
      );
      invertedDrop.rotation.z = localOffset.x * 0.26 + (seededUnit(seed + 83, 0) - 0.5) * 0.12;
      setOpacity(invertedDrop, dropAmount * 0.42);

      const neckAmount = waterBand(t, 0.34, 0.54, 0.7, 0.86);
      neck.visible = neckAmount > 0.002;
      neck.scale.set(0.66 + neckAmount * 0.24, 0.08 + neckAmount * 0.92, 0.68 + neckAmount * 0.22);
      neck.position.set(localOffset.x * 0.22, 0, localOffset.z * 0.22);
      neck.rotation.y = (seededUnit(seed + 85, 0) - 0.5) * 0.26;
      setOpacity(neck, neckAmount * 0.62);

      const sheetAmount = waterBand(t, 0.38, 0.55, 0.7, 0.86);
      fallingSheets.visible = sheetAmount > 0.002;
      fallingSheets.children.forEach((child, index) => {
        const entry = sheetSeeds[index];
        const localSheet = waterBand(t, 0.38 + entry.delay, 0.54 + entry.delay, 0.69 + entry.delay, 0.86 + entry.delay);
        const downward = waterSmoothstep(0.46 + entry.delay, 0.86 + entry.delay, t);
        child.scale.set(0.54 + localSheet * 0.46, 0.18 + localSheet * 0.82, 0.62 + localSheet * 0.38);
        child.position.set(
          entry.x + localOffset.x * 0.28,
          0.72 - downward * 0.68,
          entry.z + localOffset.z * 0.28,
        );
        child.rotation.x = entry.tilt + downward * 0.08;
        child.rotation.y = entry.rotation + downward * (index - 1) * 0.12;
        child.rotation.z = entry.roll + downward * (index % 2 ? -0.16 : 0.12);
        setOpacity(child, localSheet * (0.36 + seededUnit(seed + 89, index) * 0.055));
      });

      const crownAmount = waterBand(t, 0.56, 0.68, 0.76, 0.89);
      asymmetricCrown.visible = crownAmount > 0.002;
      crownLobes.forEach((child, index) => {
        const entry = crownSeeds[index];
        const localCrown = waterBand(t, 0.55 + entry.delay, 0.67 + entry.delay, 0.75 + entry.delay, 0.89 + entry.delay);
        child.scale.set(0.48 + localCrown * 0.52, 0.06 + localCrown * 0.94, 0.58 + localCrown * 0.42);
        setOpacity(child, localCrown * (0.42 + seededUnit(seed + 91, index) * 0.12));
      });
      const splashAmount = waterBand(t, 0.6, 0.72, 0.86, 0.99);
      splash.visible = splashAmount > 0.002;
      splash.children.forEach((child, index) => {
        const entry = splashSeeds[index];
        const localLife = waterBand(
          t,
          entry.birth,
          entry.birth + 0.055,
          Math.max(entry.birth + 0.08, entry.death - 0.05),
          entry.death,
        );
        const flight = waterSmoothstep(entry.birth, entry.death, t);
        child.position.set(
          Math.cos(entry.angle) * entry.speed * flight + entry.drift * flight + localOffset.x * 0.12,
          0.035 + entry.lift * Math.sin(flight * Math.PI) - 0.18 * flight * flight,
          Math.sin(entry.angle) * entry.speed * flight + localOffset.z * 0.12,
        );
        child.rotation.z = entry.angle + flight * (index % 2 ? -0.48 : 0.36);
        child.scale.setScalar(0.34 + localLife * 0.96);
        setOpacity(child, localLife * (0.48 + seededUnit(seed + 93, index) * 0.18));
      });

      const microSprayAmount = waterBand(t, 0.48, 0.57, 0.74, 0.88);
      microSpray.visible = microSprayAmount > 0.002;
      microSpray.children.forEach((child, index) => {
        const entry = microSpraySeeds[index];
        const localLife = waterBand(
          t,
          entry.birth,
          entry.birth + 0.035,
          entry.death - 0.035,
          entry.death,
        );
        const flight = waterSmoothstep(entry.birth, entry.death, t);
        child.position.set(
          entry.originX + Math.cos(entry.angle) * entry.speed * flight + localOffset.x * 0.18,
          0.28 + entry.lift * Math.sin(flight * Math.PI) - 0.16 * flight * flight,
          entry.originZ + Math.sin(entry.angle) * entry.speed * flight + localOffset.z * 0.18,
        );
        child.rotation.z = entry.angle + flight * (index % 2 ? -0.34 : 0.28);
        child.scale.setScalar(0.45 + localLife * 0.82);
        setOpacity(child, localLife * (0.2 + seededUnit(seed + 145, index) * 0.09));
      });

      const threadAmount = waterBand(t, 0.5, 0.59, 0.73, 0.87);
      waterThreads.visible = threadAmount > 0.002;
      waterThreads.children.forEach((child, index) => {
        const entry = threadSeeds[index];
        const localLife = waterBand(
          t,
          entry.birth,
          entry.birth + 0.04,
          entry.death - 0.04,
          entry.death,
        );
        const flight = waterSmoothstep(entry.birth, entry.death, t);
        child.position.set(
          entry.x + localOffset.x * 0.16 + entry.bend * flight * 0.3,
          0.22 - flight * 0.12,
          entry.z + localOffset.z * 0.16,
        );
        child.scale.set(0.72 + localLife * 0.28, 0.48 + localLife * 0.52, 0.72 + localLife * 0.28);
        setOpacity(child, localLife * (0.16 + seededUnit(seed + 147, index) * 0.08));
      });

      const surfaceSettle = 1 - waterSmoothstep(0.84, 1, t);
      stage.userData.surfaceRuntime.update(t, {
        ripple: clamp01((mass.ripple * 0.25 + mass.splash * 0.1) * surfaceSettle),
        depression: clamp01((mass.actor + mass.invertedDrop + mass.neck) * 0.16 * surfaceSettle),
        crown: 0,
        foam: clamp01((mass.crown * 0.2 + mass.splash * 0.22 + mass.ripple * 0.08) * surfaceSettle),
        mist: clamp01((mass.curtain * 0.35 + mass.splash * 0.18) * surfaceSettle),
      });

      root.userData.defeatState = {
        progress: t,
        phase,
        surfaceAnchor: resolvedAnchor.toArray(),
        surfaceNormal: resolvedNormal.toArray(),
        impactDirection: resolvedDirection.toArray(),
        directionalOffset: directionalOffset.toArray(),
        visualMassBudget: mass,
        actorCohesion: mass.actor,
        actorScale: actor.scale.toArray(),
        actorOffset: actor.position.toArray(),
        neckConnection: neckAmount,
        globalOpacity: 1,
      };
      return eventRuntime;
    },
  };

  root.userData.eventRuntime = eventRuntime;
  root.userData.eventContract = {
    deterministic: true,
    massConserving: true,
    surfaceCoupled: true,
    inheritsImpactDirection: true,
    mergesIntoSurface: true,
    usesGlobalFade: false,
    worldTranslationOwnedByCaller: true,
    phases: ['compress', 'inverted-drop', 'neck', 'crown', 'splash', 'ripple', 'settled'],
  };
  eventRuntime.update(0);
  return root;
}

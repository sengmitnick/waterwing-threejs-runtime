import * as THREE from 'three';

import {
  clamp01,
  createEventWaterGeometry,
  waterSmoothstep,
  waterVector,
  type WaterPointLike,
} from './createWaterSurfaceStage';

export type WaterwingHitSeverity = 'light' | 'heavy' | number;

export type WaterwingHitFxOptions = {
  contactPoint?: WaterPointLike;
  normal?: WaterPointLike;
  severity?: WaterwingHitSeverity;
  impulse?: number;
  seed?: number;
  durationSeconds?: number;
};

export type WaterwingHitContext = {
  contactPoint?: WaterPointLike;
  normal?: WaterPointLike;
  severity?: WaterwingHitSeverity;
  impulse?: number;
};

const FORWARD = new THREE.Vector3(0, 0, 1);

function resolveSeverity(value: WaterwingHitSeverity | undefined): number {
  if (value === 'heavy') return 0.82;
  if (value === 'light' || value === undefined) return 0.22;
  return clamp01(value);
}

function hitPhase(progress: number): string {
  if (progress < 0.055) return 'contact';
  if (progress < 0.16) return 'hit-stop';
  if (progress < 0.54) return 'spread';
  if (progress < 0.94) return 'recover';
  return 'recovered';
}

function seededUnit(seed: number, index: number): number {
  const value = Math.sin((seed + 3) * 73.17 + (index + 5) * 29.43) * 15431.743;
  return value - Math.floor(value);
}

function createOpenSplashFragmentGeometry(
  length: number,
  width: number,
  seed: number,
  segments = 5,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let segment = 0; segment <= segments; segment += 1) {
    const u = segment / segments;
    const taper = 0.12 + Math.sin(u * Math.PI) ** 0.62 * 0.88;
    const centreCurve = Math.sin(u * Math.PI) * length * (
      0.055 + (seededUnit(seed + 3, segment) - 0.5) * 0.035
    );
    const zRipple = Math.sin(u * Math.PI * 2.4 + seed * 0.31) * width * 0.11;
    for (const side of [-1, 1]) {
      positions.push(
        u * length,
        centreCurve + side * width * taper,
        zRipple + side * width * 0.035,
      );
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const a = segment * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.surfaceFinish = 'open-broken-water-fragment';
  geometry.userData.openSplashFragment = true;
  geometry.userData.waterEventGeometry = true;
  geometry.userData.seed = seed;
  return geometry;
}

function createOpenSplashFragmentMaterial(color = '#e6fafb'): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

function createImpactMistMaterial(color = '#efffff'): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
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

export function createWaterwingHitFx(options: WaterwingHitFxOptions = {}): THREE.Group {
  const seed = options.seed ?? 0;
  const contactPoint = waterVector(options.contactPoint, [0, 0, 0]);
  const normal = waterVector(options.normal, [0, 0, 1]).normalize();
  let severity = resolveSeverity(options.severity);
  let impulse = clamp01(options.impulse ?? 0.8);

  const root = new THREE.Group();
  root.name = 'waterwing-hit-fx';
  root.position.copy(contactPoint);
  root.quaternion.setFromUnitVectors(FORWARD, normal);

  const contactAnchor = new THREE.Object3D();
  contactAnchor.name = 'hit-contact-anchor';
  contactAnchor.userData.role = 'impact-contact';
  root.add(contactAnchor);

  const bloom = new THREE.Group();
  bloom.name = 'hit-wet-bloom';
  bloom.position.z = 0.025;
  for (let index = 0; index < 9; index += 1) {
    const angle = -2.52 + seededUnit(seed + 5, index) * 4.05;
    const fragment = new THREE.Mesh(
      createOpenSplashFragmentGeometry(
        0.11 + seededUnit(seed + 11, index) * 0.09,
        0.004 + seededUnit(seed + 17, index) * 0.004,
        seed + 23 + index,
      ),
      createOpenSplashFragmentMaterial(index % 3 === 0 ? '#f2ffff' : '#ebfbfc'),
    );
    fragment.name = `hit-crown-fragment-${index + 1}`;
    fragment.rotation.z = angle;
    fragment.position.set(
      Math.cos(angle) * (0.015 + seededUnit(seed + 29, index) * 0.025),
      Math.sin(angle) * (0.015 + seededUnit(seed + 31, index) * 0.025),
      (seededUnit(seed + 37, index) - 0.5) * 0.018,
    );
    bloom.add(fragment);
  }
  root.add(bloom);

  const wave = new THREE.Group();
  wave.name = 'hit-surface-wave';
  wave.position.z = 0.022;
  wave.renderOrder = 3;
  for (let index = 0; index < 4; index += 1) {
    const angle = -2.05 + seededUnit(seed + 43, index) * 3.62;
    const fragment = new THREE.Mesh(
      createOpenSplashFragmentGeometry(
        0.14 + seededUnit(seed + 47, index) * 0.08,
        0.004 + seededUnit(seed + 53, index) * 0.003,
        seed + 59 + index,
      ),
      createOpenSplashFragmentMaterial('#ecfbfc'),
    );
    fragment.name = `hit-wet-film-fragment-${index + 1}`;
    fragment.rotation.z = angle;
    fragment.position.z = index * 0.002;
    wave.add(fragment);
  }
  root.add(wave);

  const shear = new THREE.Group();
  shear.name = 'hit-directional-shear';
  shear.position.z = 0.04;
  for (let index = 0; index < 3; index += 1) {
    const fragment = new THREE.Mesh(
      createOpenSplashFragmentGeometry(
        0.17 + seededUnit(seed + 67, index) * 0.07,
        0.0035 + seededUnit(seed + 71, index) * 0.0025,
        seed + 73 + index,
      ),
      createOpenSplashFragmentMaterial('#ebfbfc'),
    );
    fragment.name = `hit-directional-streak-${index + 1}`;
    fragment.position.set(-0.04, (index - 1) * 0.055, index * 0.004);
    fragment.rotation.z = (index - 1) * 0.12;
    shear.add(fragment);
  }
  root.add(shear);

  const droplets = new THREE.Group();
  droplets.name = 'hit-directional-droplets';
  const dropletSeeds = Array.from({ length: 20 }, (_, index) => ({
    angle: -2.48 + seededUnit(seed, index) * 4.02,
    radial: 0.18 + seededUnit(seed + 7, index) * 0.28,
    forward: 0.08 + seededUnit(seed + 13, index) * 0.22,
    fall: 0.06 + seededUnit(seed + 17, index) * 0.12,
  }));
  dropletSeeds.forEach((entry, index) => {
    const droplet = new THREE.Mesh(
      createEventWaterGeometry(0.014 + seededUnit(seed + 23, index) * 0.014, [0.68, 1.42, 0.68], seed + 31 + index, 12, 8),
      createImpactMistMaterial(index % 4 === 0 ? '#ffffff' : '#edfdfd'),
    );
    droplet.name = `hit-directional-droplet-${index + 1}`;
    droplets.add(droplet);
  });
  root.add(droplets);

  const resolvedPoint = contactPoint.clone();
  const resolvedNormal = normal.clone();
  const eventRuntime = {
    actionId: 'waterwing-hit-fx',
    durationSeconds: options.durationSeconds ?? 0.76,
    deterministic: true,
    update(progress: number, context: WaterwingHitContext = {}) {
      const t = clamp01(progress);
      if (context.contactPoint) resolvedPoint.copy(waterVector(context.contactPoint, resolvedPoint.toArray() as [number, number, number]));
      if (context.normal) resolvedNormal.copy(waterVector(context.normal, [0, 0, 1])).normalize();
      if (context.severity !== undefined) severity = resolveSeverity(context.severity);
      if (context.impulse !== undefined) impulse = clamp01(context.impulse);
      root.position.copy(resolvedPoint);
      root.quaternion.setFromUnitVectors(FORWARD, resolvedNormal);

      const phase = hitPhase(t);
      const hitStop = t >= 0.055 && t < 0.16;
      let deformationEnvelope: number;
      if (t < 0.055) deformationEnvelope = waterSmoothstep(0, 0.055, t);
      else if (t < 0.16) deformationEnvelope = 1;
      else deformationEnvelope = 1 - waterSmoothstep(0.16, 0.92, t);
      const bloomEnvelope = t < 0.055
        ? waterSmoothstep(0, 0.055, t)
        : 1 - waterSmoothstep(0.22, 0.76, t);
      const waveEnvelope = t < 0.08
        ? waterSmoothstep(0.02, 0.08, t)
        : 1 - waterSmoothstep(0.36, 0.82, t);
      const dropletEnvelope = t < 0.12
        ? waterSmoothstep(0.05, 0.12, t)
        : 1 - waterSmoothstep(0.5, 0.92, t);
      const strength = severity * impulse;
      const compression = t >= 0.94 ? 0 : strength * 0.34 * deformationEnvelope;
      const actorCohesion = t >= 0.94 ? 1 : 1 - strength * 0.24 * deformationEnvelope;
      const wetBloom = bloomEnvelope * (0.72 + severity * 0.28);
      const surfaceWave = waveEnvelope * (0.65 + severity * 0.35);
      const dropletMass = dropletEnvelope * (0.34 + severity * 0.52);

      bloom.visible = wetBloom > 0.002;
      bloom.scale.set(
        0.42 + wetBloom * (0.5 + severity * 0.1),
        0.42 + wetBloom * (0.46 + severity * 0.08),
        0.72 + wetBloom * 0.18,
      );
      setOpacity(bloom, wetBloom * (0.14 + severity * 0.035));

      wave.visible = surfaceWave > 0.002;
      const wetPatchScale = 0.52 + surfaceWave * (0.62 + severity * 0.08);
      wave.scale.set(
        wetPatchScale * (1.02 + 0.025 * Math.sin(t * Math.PI * 2.1)),
        wetPatchScale * (0.9 + 0.035 * Math.sin(t * Math.PI * 1.7 + 0.6)),
        1,
      );
      wave.rotation.z = (seededUnit(seed + 61, 0) - 0.5) * 0.28 + surfaceWave * 0.08;
      setOpacity(wave, surfaceWave * (0.1 + severity * 0.018));

      shear.visible = compression > 0.002;
      shear.scale.set(
        0.52 + compression * 1.15,
        0.62 + compression * 0.7,
        0.78 + compression * 0.25,
      );
      shear.position.x = compression * 0.18;
      shear.position.y = -compression * 0.08;
      shear.position.z = 0.03 + compression * 0.08;
      setOpacity(shear, deformationEnvelope * (0.11 + severity * 0.035));

      droplets.visible = dropletMass > 0.002;
      droplets.children.forEach((child, index) => {
        const entry = dropletSeeds[index];
        const travel = t < 0.08 ? 0 : (t - 0.08) / 0.92;
        child.position.set(
          Math.cos(entry.angle) * entry.radial * travel * (0.7 + severity * 0.5),
          Math.sin(entry.angle) * entry.radial * travel - entry.fall * travel * travel,
          entry.forward * travel * (0.8 + severity * 0.55),
        );
        child.scale.setScalar(0.36 + dropletMass * 0.82);
        setOpacity(child, dropletMass * (0.36 + severity * 0.06));
      });

      const offset = resolvedNormal.clone().multiplyScalar(-compression * 0.42);
      const actorTransform = {
        offset: offset.toArray(),
        scale: [1 - compression, 1 + compression * 0.34, 1 - compression * 0.18],
      };
      root.userData.hitState = {
        progress: t,
        phase,
        contactPoint: resolvedPoint.toArray(),
        normal: resolvedNormal.toArray(),
        severity,
        impulse,
        hitStop,
        compression,
        actorCohesion,
        actorTransform,
        wetBloom,
        surfaceWave,
        dropletMass,
        recovery: t >= 0.16 ? waterSmoothstep(0.16, 0.94, t) : 0,
        globalOpacity: 1,
      };
      return eventRuntime;
    },
  };

  root.userData.eventRuntime = eventRuntime;
  root.userData.eventContract = {
    deterministic: true,
    usesContactPoint: true,
    usesImpactNormal: true,
    survives: true,
    triggersDefeat: false,
    usesGlobalFade: false,
    localizedWetPatch: true,
    geometricRing: false,
    closedGelShell: false,
    brokenWaterCrown: true,
    phases: ['contact', 'hit-stop', 'spread', 'recover', 'recovered'],
  };
  eventRuntime.update(0);
  return root;
}

import * as THREE from 'three';

import { loadWaterwingBlenderAsset } from '../blender-forward/loadWaterwingBlenderAsset.js';
import { createWaterwingDefeatFx } from './createWaterwingDefeatFx';
import {
  clamp01,
  createEventWaterMaterial,
  waterBand,
  waterSmoothstep,
  waterVector,
  type WaterPointLike,
} from './createWaterSurfaceStage';

export type WaterwingDefeatTransitionOptions = {
  anchor?: WaterPointLike;
  surfaceNormal?: WaterPointLike;
  impactDirection?: WaterPointLike;
  seed?: number;
  durationSeconds?: number;
  actorScale?: number;
  hoverHeight?: number;
};

type WaterwingSource = Awaited<ReturnType<typeof loadWaterwingBlenderAsset>>;

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_DURATION_SECONDS = 3.8;

function stableOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Sprite)) return;
    const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
    for (const material of materials) {
      const record = material.userData as Record<string, unknown>;
      if (!Number.isFinite(record.defeatBaseOpacity)) record.defeatBaseOpacity = Number(material.opacity ?? 1);
      material.transparent = true;
      material.opacity = Number(record.defeatBaseOpacity) * opacity;
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  });
}

function keepProxyHidden(effectRoot: THREE.Object3D): number {
  let visibleCount = 0;
  const proxy = effectRoot.getObjectByName('defeat-actor-water-core');
  if (proxy) {
    proxy.visible = false;
    proxy.traverse((child) => {
      child.visible = false;
      if (child.visible && child instanceof THREE.Mesh && child.material?.opacity > 0.001) visibleCount += 1;
    });
  }
  return visibleCount;
}

function suppressDetachedSubstituteMass(effectRoot: THREE.Object3D): void {
  for (const name of ['defeat-actor-water-core', 'defeat-inverted-drop', 'defeat-liquid-neck']) {
    const object = effectRoot.getObjectByName(name);
    if (!object) continue;
    object.visible = false;
    object.traverse(child => { child.visible = false; });
  }
}

function createRunoffRibbonGeometry(width: number, height: number, depth: number, seed: number): THREE.BufferGeometry {
  const segments = 14;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const falloff = t * t * (3 - 2 * t);
    const shoulder = 1 + 0.12 * Math.sin(t * Math.PI * 2.2 + seed * 0.31) * (1 - t);
    const taper = THREE.MathUtils.lerp(1, 0.075, falloff) * shoulder;
    const centreX = (
      Math.sin(t * Math.PI * 1.4 + seed * 0.42) * 0.16
      + Math.sin(t * Math.PI * 3.1 - seed * 0.19) * 0.055
    ) * width * t;
    const centreZ = (
      Math.sin(t * Math.PI * 1.9 - seed * 0.31) * 0.38
      + Math.sin(t * Math.PI * 4.2 + seed * 0.13) * 0.12
    ) * depth;
    const localWidth = width * taper;
    const y = -height * t - Math.sin(t * Math.PI * 1.7 + seed * 0.11) * height * 0.025 * t;
    positions.push(centreX - localWidth, y, centreZ - depth * (0.24 + 0.08 * Math.sin(t * 5 + seed)));
    positions.push(centreX + localWidth, y, centreZ + depth * (0.24 + 0.08 * Math.cos(t * 4 - seed)));
  }
  for (let index = 0; index < segments; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.waterDefeatRunoff = true;
  geometry.userData.silhouette = 'branching-runoff-veil';
  geometry.userData.sourceConnected = true;
  geometry.userData.openSplashFragment = true;
  geometry.userData.closedLoop = false;
  return geometry;
}

function averageVisibleSheetY(root: THREE.Object3D): number {
  const sheets = root.getObjectByName('defeat-falling-sheets');
  if (!sheets) return 0;
  const active = sheets.children.filter((child) => {
    const material = child instanceof THREE.Mesh ? child.material : null;
    const opacity = Array.isArray(material) ? Math.max(...material.map(entry => entry.opacity)) : material?.opacity ?? 0;
    return child.visible && opacity > 0.01;
  });
  if (!active.length) return 0;
  return active.reduce((sum, child) => sum + child.position.y, 0) / active.length;
}

function createTransition(sourceAsset: WaterwingSource, options: WaterwingDefeatTransitionOptions): THREE.Group {
  const anchor = waterVector(options.anchor, [0, -1.05, 0]);
  const normal = waterVector(options.surfaceNormal, [0, 1, 0]).normalize();
  const impactDirection = waterVector(options.impactDirection, [-0.6, -0.1, 0.4]).normalize();
  const hoverHeight = options.hoverHeight ?? 1.05;
  const actorScale = options.actorScale ?? 1;

  const root = new THREE.Group();
  root.name = 'waterwing-defeat-transition';
  root.position.copy(anchor);
  root.quaternion.setFromUnitVectors(UP, normal);

  const actorCarrier = new THREE.Group();
  actorCarrier.name = 'defeat-approved-waterwing';
  actorCarrier.position.y = hoverHeight;
  actorCarrier.scale.setScalar(actorScale);
  root.add(actorCarrier);

  const actorInstance = sourceAsset.createInstance();
  actorInstance.root.name = 'defeat-approved-waterwing-source';
  actorInstance.setMaterialMode('water');
  const approvedWaterMaterialProfile = actorInstance.getWaterMaterialProfile();
  const approvedCoreMaterialProfile = actorInstance.getCoreMaterialProfile();
  actorCarrier.add(actorInstance.root);

  const waterFx = createWaterwingDefeatFx({
    seed: options.seed ?? 47,
    anchor: [0, 0, 0],
    surfaceNormal: [0, 1, 0],
    impactDirection: impactDirection.toArray() as [number, number, number],
    durationSeconds: options.durationSeconds ?? DEFAULT_DURATION_SECONDS,
  });
  waterFx.name = 'defeat-transferred-water';
  root.add(waterFx);
  keepProxyHidden(waterFx);

  const runoff = new THREE.Group();
  runoff.name = 'defeat-source-runoff-stains';
  const runoffSeeds = [-1.28, -0.78, -0.31, 0.13, 0.58, 1.08].map((x, index) => ({
    x,
    width: 0.225 + (index % 3) * 0.05,
    height: 1.02 + (index % 4) * 0.14,
    depth: 0.12 + (index % 2) * 0.045,
    delay: index * 0.018,
    rotation: (index % 2 ? -1 : 1) * (0.04 + index * 0.012),
  }));
  runoffSeeds.forEach((entry, index) => {
    const ribbon = new THREE.Mesh(
      createRunoffRibbonGeometry(entry.width, entry.height, entry.depth, 53 + index),
      createEventWaterMaterial(0.38 + (index % 3) * 0.035, '#a9e3e9'),
    );
    ribbon.name = `defeat-runoff-stain-${index + 1}`;
    ribbon.position.set(entry.x, hoverHeight - 0.06 - Math.abs(entry.x) * 0.06, (index % 3 - 1) * 0.06);
    ribbon.rotation.z = entry.rotation;
    runoff.add(ribbon);
  });
  root.add(runoff);

  let materialMode: 'water' | 'clay' = 'water';
  const eventRuntime = {
    actionId: 'waterwing-defeat-transition',
    durationSeconds: options.durationSeconds ?? DEFAULT_DURATION_SECONDS,
    deterministic: true,
    update(progress: number) {
      const t = clamp01(progress);
      root.position.copy(anchor);
      root.quaternion.setFromUnitVectors(UP, normal);

      const sourceProgress = 0.18 + 0.08 * waterSmoothstep(0, 0.28, t);
      actorInstance.setProgress(sourceProgress);

      const yielding = waterSmoothstep(0.12, 0.58, t);
      const transfer = waterSmoothstep(0.18, 0.82, t);
      const actorOpacity = (1 - 0.06 * waterSmoothstep(0.12, 0.42, t))
        * (1 - waterSmoothstep(0.46, 0.9, t));
      actorCarrier.visible = actorOpacity > 0.002;
      actorCarrier.position.set(
        impactDirection.x * 0.14 * yielding,
        hoverHeight - 0.52 * transfer,
        impactDirection.z * 0.1 * yielding,
      );
      actorCarrier.rotation.set(-0.06 * yielding, 0.04 * yielding, 0.13 * yielding);
      actorCarrier.scale.set(
        actorScale * (1 + transfer * 0.075),
        actorScale * (1 - transfer * 0.36),
        actorScale * (1 - transfer * 0.04),
      );
      stableOpacity(actorCarrier, actorOpacity);

      const fxProgress = clamp01((t - 0.1) / 0.88);
      waterFx.userData.eventRuntime.update(fxProgress, {
        anchor: [0, 0, 0],
        surfaceNormal: [0, 1, 0],
        impactDirection: impactDirection.toArray(),
      });
      suppressDetachedSubstituteMass(waterFx);
      const proxyVisibleCount = keepProxyHidden(waterFx);

      let activeRunoffCount = 0;
      runoff.children.forEach((child, index) => {
        const entry = runoffSeeds[index];
        const local = waterSmoothstep(0.22 + entry.delay, 0.72 + entry.delay, t);
        const life = waterBand(t, 0.18 + entry.delay, 0.3 + entry.delay, 0.8, 0.98);
        child.visible = life > 0.002;
        child.position.set(
          entry.x * (1 - transfer * 0.12) + impactDirection.x * transfer * 0.08,
          hoverHeight - 0.06 - Math.abs(entry.x) * 0.06 - local * 0.12,
          (index % 3 - 1) * 0.06 + impactDirection.z * transfer * 0.045,
        );
        child.scale.set(
          0.66 + local * 0.34,
          0.04 + local * 1.06,
          0.64 + local * 0.36,
        );
        child.rotation.z = entry.rotation + Math.sin(t * Math.PI + index) * 0.035 * local;
        stableOpacity(child, life * (0.72 + (index % 3) * 0.07));
        if (child.visible && child instanceof THREE.Mesh && child.material.opacity > 0.01) activeRunoffCount += 1;
      });

      root.userData.defeatState = {
        progress: t,
        phase: t < 0.12 ? 'hold' : t < 0.42 ? 'yield' : t < 0.79 ? 'transfer' : t < 0.96 ? 'falling-water' : 'settled',
        sourceProgress,
        usesApprovedActor: true,
        sourceAssetVersion: sourceAsset.manifest.assetVersion,
        actorVisible: actorCarrier.visible,
        actorOpacity: actorOpacity < 0.002 ? 0 : actorOpacity,
        transferredMass: transfer > 0.998 ? 1 : transfer,
        actorOffset: actorCarrier.position.toArray(),
        actorScale: actorCarrier.scale.toArray(),
        surfaceAnchor: anchor.toArray(),
        averageFallingWaterY: averageVisibleSheetY(waterFx),
        activeRunoffCount,
        proxyVisibleCount,
      };
      root.updateMatrixWorld(true);
      return eventRuntime;
    },
    setMaterialMode(mode: 'water' | 'clay') {
      materialMode = mode;
      actorInstance.setMaterialMode(mode);
      const opacity = Number(root.userData.defeatState?.actorOpacity ?? 1);
      stableOpacity(actorCarrier, opacity);
    },
    getPoseFingerprint() {
      return `${actorInstance.getPoseFingerprint()}|${Number(root.userData.defeatState?.actorOpacity ?? 1).toFixed(4)}`;
    },
    // Review metadata describes the approved source look; the runtime fade is an
    // event-state modulation and must not masquerade as a different material asset.
    getWaterMaterialProfile: () => ({ ...approvedWaterMaterialProfile }),
    getWaterRegionProfiles: actorInstance.getWaterRegionProfiles,
    getCoreMaterialProfile: () => ({ ...approvedCoreMaterialProfile }),
    getMaterialMode: () => materialMode,
  };

  root.userData.eventRuntime = eventRuntime;
  root.userData.reviewActorInstance = actorInstance;
  root.userData.defeatActorInstance = actorInstance;
  root.userData.eventContract = {
    deterministic: true,
    heroSource: sourceAsset.manifest.assetVersion,
    usesApprovedActor: true,
    usesProceduralCreatureProxy: false,
    continuousActorToWaterTransfer: true,
    surfaceCoupled: true,
    worldTranslationOwnedByCaller: true,
  };
  eventRuntime.update(0);
  return root;
}

export async function prepareWaterwingDefeatTransitionFactory(
  defaultOptions: WaterwingDefeatTransitionOptions = {},
) {
  const sourceAsset = await loadWaterwingBlenderAsset('hover');
  const durationSeconds = defaultOptions.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  return Object.freeze({
    sourceAction: 'hover',
    sourceAssetVersion: sourceAsset.manifest.assetVersion,
    sourceClip: sourceAsset.clip.name,
    durationSeconds,
    actorAssetFamily: 'blender-clear-water-v10',
    createInstance(overrides: WaterwingDefeatTransitionOptions = {}) {
      return createTransition(sourceAsset, {
        ...defaultOptions,
        ...overrides,
        durationSeconds: overrides.durationSeconds ?? durationSeconds,
      });
    },
  });
}

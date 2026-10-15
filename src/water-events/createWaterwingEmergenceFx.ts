import * as THREE from 'three';

import { loadWaterwingBlenderAsset } from '../blender-forward/loadWaterwingBlenderAsset.js';
import {
  clamp01,
  createWaterSurfaceStage,
  waterBand,
  waterVector,
  type WaterPointLike,
} from './createWaterSurfaceStage';

export type WaterwingEmergenceFxOptions = {
  anchor?: WaterPointLike;
  surfaceNormal?: WaterPointLike;
  seed?: number;
  durationSeconds?: number;
  actorScale?: number;
  hoverHeight?: number;
};

export type WaterwingEmergenceContext = {
  anchor?: WaterPointLike;
  surfaceNormal?: WaterPointLike;
  hoverHeight?: number;
};

type WaterwingBlenderSource = Awaited<ReturnType<typeof loadWaterwingBlenderAsset>>;

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_DURATION_SECONDS = 6;
const DEFAULT_ACTOR_SCALE = 0.42;
const DEFAULT_HOVER_HEIGHT = 0;

const SOURCE_SEGMENTS = Object.freeze([
  Object.freeze({ start: 0.12, end: 0.28, from: 0, to: 0.16, phase: 'amorphous-gather' }),
  Object.freeze({ start: 0.28, end: 0.58, from: 0.16, to: 0.42, phase: 'wing-root-draw' }),
  Object.freeze({ start: 0.58, end: 0.83, from: 0.42, to: 0.76, phase: 'body-lift' }),
  Object.freeze({ start: 0.83, end: 1, from: 0.76, to: 1, phase: 'hover-settle' }),
]);

const CARRIER_OFFSETS = Object.freeze([-1.05, -1.05, -0.92, -0.32, 0.04, 0]);

function quinticSmootherstep(value: number): number {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function mapWaterwingEmergenceProgress(progress: number) {
  const t = clamp01(progress);
  if (t <= SOURCE_SEGMENTS[0].start) {
    return {
      phase: 'surface-onset',
      sourceProgress: 0,
      segmentProgress: 0,
      carrierOffset: CARRIER_OFFSETS[0],
    };
  }

  for (const [index, segment] of SOURCE_SEGMENTS.entries()) {
    if (t <= segment.end) {
      const local = clamp01((t - segment.start) / Math.max(1e-6, segment.end - segment.start));
      const segmentProgress = quinticSmootherstep(local);
      return {
        phase: t >= 1 ? 'complete' : segment.phase,
        sourceProgress: THREE.MathUtils.lerp(segment.from, segment.to, segmentProgress),
        segmentProgress,
        carrierOffset: THREE.MathUtils.lerp(
          CARRIER_OFFSETS[index + 1],
          CARRIER_OFFSETS[index + 2],
          segmentProgress,
        ),
      };
    }
  }

  return { phase: 'complete', sourceProgress: 1, segmentProgress: 1, carrierOffset: 0 };
}

function localPoseFingerprint(root: THREE.Object3D): string {
  const values: Array<string | number> = [];
  const stable = (value: number) => (Math.abs(value) < 0.00005 ? '0.0000' : value.toFixed(4));
  root.traverse((object) => {
    if (object instanceof THREE.Bone && /wing_|tail_|body_/.test(object.name)) {
      values.push(
        object.name,
        ...object.position.toArray().map(stable),
        ...object.quaternion.toArray().map(stable),
        ...object.scale.toArray().map(stable),
      );
    }
    if (object instanceof THREE.Mesh && object.morphTargetInfluences) {
      values.push(object.name, ...object.morphTargetInfluences.map(stable));
    }
  });
  return values.join('|');
}

function hideRejectedAuthoredWater(instance: ReturnType<WaterwingBlenderSource['createInstance']>): string[] {
  const hidden: string[] = [];
  for (const name of instance.manifest.auxiliaryMeshes ?? []) {
    const object = instance.root.getObjectByName(name);
    if (!object) continue;
    object.visible = false;
    object.userData.replacedByHybridSurfaceOnset = true;
    hidden.push(name);
  }
  return hidden;
}

function boostSurfaceLayerOpacity(
  stage: THREE.Object3D,
  layerName: string,
  factor: number,
  maximum: number,
): void {
  stage.getObjectByName(layerName)?.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material.transparent) continue;
      material.opacity = Math.min(maximum, material.opacity * factor);
    }
  });
}

function createHybridEmergenceFx(
  sourceAsset: WaterwingBlenderSource,
  options: WaterwingEmergenceFxOptions,
): THREE.Group {
  const seed = options.seed ?? 0;
  const resolvedAnchor = waterVector(options.anchor, [0, 0, 0]);
  const resolvedNormal = waterVector(options.surfaceNormal, [0, 1, 0]).normalize();
  const actorScale = options.actorScale ?? DEFAULT_ACTOR_SCALE;
  let hoverHeight = options.hoverHeight ?? DEFAULT_HOVER_HEIGHT;

  const root = new THREE.Group();
  root.name = 'waterwing-emergence-fx';
  root.position.copy(resolvedAnchor);
  root.quaternion.setFromUnitVectors(UP, resolvedNormal);

  const stage = createWaterSurfaceStage({ radius: 1.36, seed: seed + 1 });
  stage.name = 'emergence-water-surface-stage';
  root.add(stage);

  const actorCarrier = new THREE.Group();
  actorCarrier.name = 'emergence-approved-waterwing';
  actorCarrier.scale.setScalar(actorScale);
  root.add(actorCarrier);

  const actorInstance = sourceAsset.createInstance();
  actorInstance.root.name = 'emergence-approved-waterwing-source';
  actorInstance.setMaterialMode('water');
  actorCarrier.add(actorInstance.root);
  const hiddenAuxiliaryNames = hideRejectedAuthoredWater(actorInstance);

  function keepRejectedWaterHidden() {
    for (const name of hiddenAuxiliaryNames) {
      const object = actorInstance.root.getObjectByName(name);
      if (object) object.visible = false;
    }
  }

  const eventRuntime = {
    actionId: 'waterwing-emergence-fx',
    durationSeconds: options.durationSeconds ?? DEFAULT_DURATION_SECONDS,
    deterministic: true,
    update(progress: number, context: WaterwingEmergenceContext = {}) {
      const t = clamp01(progress);
      if (context.anchor) {
        resolvedAnchor.copy(waterVector(context.anchor, resolvedAnchor.toArray() as [number, number, number]));
      }
      if (context.surfaceNormal) {
        resolvedNormal.copy(waterVector(context.surfaceNormal, [0, 1, 0])).normalize();
      }
      if (Number.isFinite(context.hoverHeight)) hoverHeight = Number(context.hoverHeight);
      root.position.copy(resolvedAnchor);
      root.quaternion.setFromUnitVectors(UP, resolvedNormal);

      const mapped = mapWaterwingEmergenceProgress(t);
      const actorLift = hoverHeight + mapped.carrierOffset;

      // AnimationMixer treats an exact LoopOnce end-time differently depending on
      // whether the action has already advanced. Sample the terminal keyframe just
      // inside the clip so random-access review and sequential playback land on the
      // same authored final pose.
      const sampledSourceProgress = mapped.sourceProgress >= 1
        ? 1 - 1e-6
        : mapped.sourceProgress;
      actorInstance.setProgress(sampledSourceProgress);
      keepRejectedWaterHidden();
      actorCarrier.visible = t > 0.12;
      actorCarrier.position.set(0, actorLift, 0);

      const onset = waterBand(t, 0, 0.055, 0.27, 0.52);
      const secondaryRipple = waterBand(t, 0.14, 0.24, 0.43, 0.66);
      const surfaceChannels = {
        ripple: clamp01(onset * 0.68 + secondaryRipple * 0.08),
        depression: waterBand(t, 0.015, 0.085, 0.23, 0.46) * 0.4,
        crown: 0,
        foam: waterBand(t, 0.075, 0.15, 0.31, 0.5) * 0.17,
        mist: 0,
      };
      stage.userData.surfaceRuntime.update(t, surfaceChannels);
      // The real waterfall is much brighter and more detailed than the neutral
      // review stage. Lift only the short-lived open surface fragments enough
      // to locate the gathering point; do not reintroduce an opaque pool plate.
      boostSurfaceLayerOpacity(stage, 'water-surface-ripples', 2.15, 0.23);
      boostSurfaceLayerOpacity(stage, 'water-surface-depression', 2.2, 0.09);
      boostSurfaceLayerOpacity(stage, 'water-surface-foam', 2.3, 0.16);

      const poseFingerprint = localPoseFingerprint(actorInstance.root);
      root.userData.emergenceState = {
        progress: t,
        phase: mapped.phase,
        sourceProgress: mapped.sourceProgress,
        carrierOffset: mapped.carrierOffset,
        actorLift,
        actorVisible: actorCarrier.visible,
        actorScale,
        surfaceAnchor: resolvedAnchor.toArray(),
        surfaceNormal: resolvedNormal.toArray(),
        surfaceChannels: { ...surfaceChannels },
        poseFingerprint,
        sourceAssetVersion: sourceAsset.manifest.assetVersion,
        sourceClip: sourceAsset.clip.name,
        hiddenAuxiliaryNames: [...hiddenAuxiliaryNames],
      };
      root.updateMatrixWorld(true);
      return eventRuntime;
    },
    setMaterialMode(mode: 'water' | 'clay') {
      actorInstance.setMaterialMode(mode);
    },
    getPoseFingerprint() {
      return localPoseFingerprint(actorInstance.root);
    },
    getWaterMaterialProfile() {
      return actorInstance.getWaterMaterialProfile();
    },
    getWaterRegionProfiles() {
      return actorInstance.getWaterRegionProfiles();
    },
    getCoreMaterialProfile() {
      return actorInstance.getCoreMaterialProfile();
    },
  };

  root.userData.eventRuntime = eventRuntime;
  root.userData.emergenceActorInstance = actorInstance;
  root.userData.eventContract = {
    deterministic: true,
    surfaceCoupled: true,
    heroSource: sourceAsset.manifest.assetVersion,
    heroClip: sourceAsset.clip.name,
    replacesAuthoredAuxiliaryWater: true,
    usesProceduralCreatureProxy: false,
    usesGlobalFade: false,
    worldTranslationOwnedByCaller: true,
    durationSeconds: eventRuntime.durationSeconds,
    sourceMapping: SOURCE_SEGMENTS.map(segment => ({ ...segment })),
  };
  eventRuntime.update(0);
  return root;
}

export async function prepareWaterwingEmergenceFxFactory(
  defaultOptions: WaterwingEmergenceFxOptions = {},
) {
  const sourceAsset = await loadWaterwingBlenderAsset('emerge');
  const preparedOptions = { ...defaultOptions };
  const durationSeconds = preparedOptions.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  return Object.freeze({
    sourceAction: 'emerge',
    sourceAssetVersion: sourceAsset.manifest.assetVersion,
    sourceClip: sourceAsset.clip.name,
    durationSeconds,
    actorAssetFamily: 'blender-clear-water-v10',
    createInstance(overrides: WaterwingEmergenceFxOptions = {}) {
      return createHybridEmergenceFx(sourceAsset, {
        ...preparedOptions,
        ...overrides,
        durationSeconds: overrides.durationSeconds ?? durationSeconds,
      });
    },
  });
}

export async function loadWaterwingEmergenceFx(
  options: WaterwingEmergenceFxOptions = {},
): Promise<THREE.Group> {
  const prepared = await prepareWaterwingEmergenceFxFactory(options);
  return prepared.createInstance();
}

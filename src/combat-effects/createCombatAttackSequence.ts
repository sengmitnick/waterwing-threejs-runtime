import * as THREE from 'three';

import { loadWaterwingBlenderAsset } from '../blender-forward/loadWaterwingBlenderAsset.js';
import { createEnemyDirectWaterball } from '../projectiles/createEnemyDirectWaterball';
import { createEnemyLobWaterball } from '../projectiles/createEnemyLobWaterball';
import { createPlayerWaterPulse } from '../projectiles/createPlayerWaterPulse';
import { createLensWaterImpact, createMonsterWaterImpact } from '../projectiles/createWaterImpacts';

export type CombatAttackSequenceId = 'player-miss' | 'player-hit' | 'enemy-direct-hit' | 'enemy-lob-hit';

type WaterwingSource = Awaited<ReturnType<typeof loadWaterwingBlenderAsset>>;

const clamp01 = (value: number) => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
const smooth01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function hideEmbeddedProjectiles(root: THREE.Object3D): number {
  let visibleCount = 0;
  root.traverse(object => {
    const name = object.name.toLowerCase();
    if (name.includes('waterball') || name.includes('projectile') || object.name === 'released-water') {
      object.visible = false;
    }
    if (object.visible && (name.includes('waterball') || name.includes('projectile'))) visibleCount += 1;
  });
  return visibleCount;
}

const CONFIG = Object.freeze({
  'player-miss': Object.freeze({ durationSeconds: 1.8, sourceAction: 'hover', outcome: 'miss', trajectory: 'direct' }),
  'player-hit': Object.freeze({ durationSeconds: 2.05, sourceAction: 'hover', outcome: 'hit', trajectory: 'direct' }),
  'enemy-direct-hit': Object.freeze({ durationSeconds: 2.2, sourceAction: 'directCast', outcome: 'pov-hit', trajectory: 'direct' }),
  'enemy-lob-hit': Object.freeze({ durationSeconds: 2.8, sourceAction: 'directCast', outcome: 'pov-hit', trajectory: 'high-arc' }),
});

function createSequence(kind: CombatAttackSequenceId, sourceAsset: WaterwingSource): THREE.Group {
  const config = CONFIG[kind];
  const isPlayer = kind.startsWith('player-');
  const isHit = kind !== 'player-miss';
  const isLob = kind === 'enemy-lob-hit';
  const playerHitPoint: [number, number, number] = [0.02, 0.34, 1.08];

  const root = new THREE.Group();
  root.name = `combat-attack-sequence-${kind}`;

  const actorCarrier = new THREE.Group();
  actorCarrier.name = isPlayer ? 'attack-sequence-target-waterwing' : 'attack-sequence-attacker-waterwing';
  root.add(actorCarrier);
  const actorInstance = sourceAsset.createInstance();
  actorInstance.root.name = 'attack-sequence-approved-waterwing-source';
  actorCarrier.add(actorInstance.root);

  const projectile = isPlayer
    ? createPlayerWaterPulse()
    : isLob ? createEnemyLobWaterball() : createEnemyDirectWaterball();
  projectile.name = 'attack-sequence-projectile';
  root.add(projectile);
  const projectileRuntime = projectile.userData.projectileRuntime;

  const impact = isPlayer ? createMonsterWaterImpact() : createLensWaterImpact();
  impact.name = 'attack-sequence-impact';
  if (isPlayer) {
    impact.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => { material.depthTest = false; material.needsUpdate = true; });
    });
  }
  root.add(impact);
  const impactRuntime = impact.userData.impactRuntime;

  const projectileContext = isPlayer
    ? {
        start: [-1.05, -0.72, 5.2] as [number, number, number],
        end: (kind === 'player-hit' ? playerHitPoint : [1.95, 0.12, -0.38]) as [number, number, number],
        ...(kind === 'player-miss' ? { impactHandoff: false } : {}),
      }
    : {
        start: [0, 0.36, -0.4] as [number, number, number],
        end: [0, -0.08, 5.35] as [number, number, number],
        ...(isLob ? { arcHeight: 2.8 } : {}),
      };

  let materialMode: 'water' | 'clay' = 'water';
  const eventRuntime = {
    actionId: kind,
    durationSeconds: config.durationSeconds,
    deterministic: true,
    update(progress: number) {
      const t = clamp01(progress);

      if (isPlayer) {
        actorInstance.setProgress(0.18 + 0.12 * t);
      } else {
        actorInstance.setProgress(clamp01(t / 0.46) * 0.8);
      }
      const embeddedProjectileVisibleCount = hideEmbeddedProjectiles(actorInstance.root);

      const impactStart = isPlayer ? 0.61 : 0.7;
      const impactProgress = isHit ? clamp01((t - impactStart) / (1 - impactStart)) : 0;
      const hitConfirmed = isHit && t >= impactStart;
      const actorRecoil = kind === 'player-hit'
        ? Math.sin(impactProgress * Math.PI) * (1 - smooth01((impactProgress - 0.72) / 0.28))
        : 0;

      actorCarrier.position.set(
        kind === 'player-hit' ? actorRecoil * 0.18 : 0,
        kind === 'player-hit' ? actorRecoil * 0.05 : 0,
        isPlayer ? 0 : -0.7,
      );
      actorCarrier.rotation.set(
        isPlayer ? -actorRecoil * 0.05 : 0,
        0,
        kind === 'player-hit' ? actorRecoil * 0.16 : 0,
      );
      actorCarrier.scale.setScalar(isPlayer ? 0.78 : 0.72);

      const projectileStart = isPlayer ? 0.02 : 0.22;
      const projectileEnd = isPlayer ? 0.68 : 0.74;
      const projectileProgress = clamp01((t - projectileStart) / (projectileEnd - projectileStart));
      projectileRuntime.update(projectileProgress, projectileContext);
      projectile.visible = t >= projectileStart && t < projectileEnd + 0.025;

      if (isHit) {
        if (isPlayer) {
          impactRuntime.update(impactProgress, {
            impactPoint: playerHitPoint,
            normal: [0.08, 0.04, 1],
            impulse: [0.58, 0.16, 1],
          });
          impact.scale.setScalar(2.35);
        } else {
          impactRuntime.update(impactProgress, {
            impactPoint: [0, -0.02, 5.42],
            normal: [0, 0, 1],
            impulse: isLob ? [-0.4, -0.72, 1] : [0.62, -0.28, 1],
          });
          impact.scale.setScalar(3.45);
        }
        impact.visible = hitConfirmed && impactProgress < 1;
      } else {
        impact.visible = false;
      }

      root.userData.attackSequenceState = {
        progress: t,
        id: kind,
        outcome: config.outcome,
        trajectory: config.trajectory,
        projectileProgress,
        projectilePosition: projectile.position.toArray(),
        projectileVisible: projectile.visible,
        hitConfirmed,
        impactProgress,
        impactVisible: impact.visible,
        impactStyle: isPlayer && isHit ? 'broad-water-slash' : isHit ? 'lens-water-sheet' : 'none',
        impactPoint: isPlayer && isHit ? [...playerHitPoint] : [0, -0.02, 5.42],
        impactScale: impact.scale.x,
        actorRecoil,
        embeddedProjectileVisibleCount,
        lensOpacityBudget: !isPlayer && isHit
          ? Number(impact.userData.impactState?.compositedOpacityBudget ?? 0)
          : 0,
      };
      root.updateMatrixWorld(true);
      return eventRuntime;
    },
    setMaterialMode(mode: 'water' | 'clay') {
      materialMode = mode;
      actorInstance.setMaterialMode(mode);
    },
    getMaterialMode: () => materialMode,
    getPoseFingerprint() {
      const state = root.userData.attackSequenceState;
      return `${actorInstance.getPoseFingerprint()}|${state?.projectileProgress?.toFixed(4) ?? '0'}|${state?.impactProgress?.toFixed(4) ?? '0'}`;
    },
    getWaterMaterialProfile: actorInstance.getWaterMaterialProfile,
    getWaterRegionProfiles: actorInstance.getWaterRegionProfiles,
    getCoreMaterialProfile: actorInstance.getCoreMaterialProfile,
  };

  root.userData.eventRuntime = eventRuntime;
  root.userData.reviewActorInstance = actorInstance;
  root.userData.eventContract = {
    deterministic: true,
    completeAttackResult: true,
    outcome: config.outcome,
    projectileAndImpactCoupled: isHit,
    standaloneImpactListing: false,
  };
  eventRuntime.update(0);
  return root;
}

export async function prepareCombatAttackSequenceFactory(kind: CombatAttackSequenceId) {
  const config = CONFIG[kind];
  if (!config) throw new Error(`Unknown combat attack sequence ${kind}`);
  const sourceAsset = await loadWaterwingBlenderAsset(config.sourceAction);
  return Object.freeze({
    id: kind,
    sourceAction: config.sourceAction,
    sourceAssetVersion: sourceAsset.manifest.assetVersion,
    actorAssetFamily: 'blender-clear-water-v10',
    durationSeconds: config.durationSeconds,
    createInstance() {
      return createSequence(kind, sourceAsset);
    },
  });
}

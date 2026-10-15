import * as THREE from 'three';

import { attachActionContract } from '../actions/actionContract.js';
import {
  createDirectActionGeometry,
  smoothstep,
  type WaterwingActionOptions,
} from './directActionGeometry.ts';

export function createWaterwingDirectCastModel(options: WaterwingActionOptions = {}) {
  const { root, parts } = createDirectActionGeometry('direct-cast-release', options);
  const muzzlePosition = new THREE.Vector3(0, 0.24, 0.88);

  const runtime = attachActionContract(root, {
    actionId: 'cast-direct',
    durationSeconds: 0.92,
    anchors: {
      'health-anchor': [0, 1.58, 0],
      'muzzle-anchor': muzzlePosition.toArray(),
      'impact-anchor': [0, 0.08, 0.36],
      'waterline-anchor': [0, -1.52, 0],
    },
    update(progress: number, context: { intensity?: number; frame?: number; fps?: number; actorId?: string } = {}) {
      const intensity = Math.max(0, Math.min(1.25, context.intensity ?? 1));
      const releasePulse = Math.sin(Math.PI * Math.min(1, progress / 0.52)) * intensity;
      const recover = smoothstep(0.48, 0.92, progress);
      root.position.set(0, 0.012 * Math.sin(progress * Math.PI * 2), -0.16 * releasePulse * (1 - 0.1 * recover));
      root.rotation.set(0.055 * releasePulse, 0, 0);

      parts.body.scale.set(1 - 0.02 * releasePulse, 1 + 0.035 * releasePulse, 1 - 0.025 * releasePulse);
      parts.body.position.set(0, 0.025 * releasePulse, -0.04 * releasePulse);
      const rearPress = 0.12 - 0.64 * releasePulse;
      parts.leftWing.rotation.set(-0.04 * releasePulse, rearPress, 0.16 - 0.05 * releasePulse);
      parts.rightWing.rotation.set(-0.04 * releasePulse, -rearPress, -0.16 + 0.05 * releasePulse);
      parts.tail.rotation.set(-0.18 * releasePulse, 0, 0);

      const chargeFade = Math.max(0, 1 - smoothstep(0.07, 0.3, progress));
      parts.muzzleCharge.visible = chargeFade > 0.015;
      parts.muzzleCharge.scale.setScalar(0.82 * chargeFade);
      for (const droplet of parts.feederDroplets) droplet.visible = false;

      const flight = THREE.MathUtils.clamp((progress - 0.08) / 0.58, 0, 1);
      parts.releasedWater.visible = progress >= 0.08 && progress < 0.66;
      parts.releasedWater.position.set(
        muzzlePosition.x,
        muzzlePosition.y + 0.07 * Math.sin(flight * Math.PI),
        muzzlePosition.z + 0.2 + 2.2 * flight,
      );
      parts.releasedWater.scale.set(
        0.92 - 0.16 * flight,
        0.92 - 0.1 * flight,
        1 + 0.7 * Math.sin(flight * Math.PI),
      );
      parts.releasedWater.rotation.set(0, 0, 0);
    },
  });
  runtime.update(0);
  root.userData.combatRole = 'frontline-direct-caster';
  root.userData.releaseAxis = [0, 0, 1];
  return root;
}

export type { WaterwingActionOptions } from './directActionGeometry.ts';

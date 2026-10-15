import * as THREE from 'three';

import { attachActionContract } from '../actions/actionContract.js';
import {
  createLobActionGeometry,
  smoothstep,
  type WaterwingLobActionOptions,
} from './lobActionGeometry.ts';

export function createWaterwingLobCastModel(options: WaterwingLobActionOptions = {}) {
  const { root, parts } = createLobActionGeometry('lob-cast-high-release', options);
  const muzzlePosition = new THREE.Vector3(0, 0.98, 0.72);

  const runtime = attachActionContract(root, {
    actionId: 'cast-lob',
    durationSeconds: 1.3,
    anchors: {
      'health-anchor': [0, 1.76, 0],
      'muzzle-anchor': muzzlePosition.toArray(),
      'impact-anchor': [0, 0.14, 0.35],
      'waterline-anchor': [0, -1.6, 0],
    },
    update(progress: number, context: {
      intensity?: number;
      recoveryStrafe?: number;
      aimOffsetX?: number;
      frame?: number;
      fps?: number;
      actorId?: string;
    } = {}) {
      const intensity = Math.max(0, Math.min(1.25, context.intensity ?? 1));
      const launchPulse = Math.sin(Math.PI * Math.min(1, progress / 0.58)) * intensity;
      const recover = smoothstep(0.52, 0.92, progress);
      const recoveryStrafe = context.recoveryStrafe ?? 0.18;
      root.position.set(recoveryStrafe * recover, 0.17 * (1 - 0.72 * recover), -0.065 * recover - 0.075 * launchPulse);
      root.rotation.set(-0.09 + 0.16 * launchPulse - 0.03 * recover, 0, 0);

      parts.body.scale.set(1 - 0.025 * launchPulse, 1 + 0.035 * launchPulse, 1 - 0.02 * launchPulse);
      const rearPress = 0.13 - 0.56 * launchPulse;
      parts.leftWing.rotation.set(-0.06 * launchPulse, rearPress, 0.34 - 0.16 * launchPulse);
      parts.rightWing.rotation.set(-0.06 * launchPulse, -rearPress, -0.34 + 0.16 * launchPulse);
      parts.tail.rotation.set(-0.34 + 0.3 * launchPulse - 0.08 * recover, 0, 0);

      const chargeFade = Math.max(0, 1 - smoothstep(0.05, 0.25, progress));
      parts.muzzleCharge.visible = chargeFade > 0.015;
      parts.muzzleCharge.scale.setScalar(0.92 * chargeFade);
      for (const droplet of parts.feederDroplets) droplet.visible = false;

      const flight = THREE.MathUtils.clamp((progress - 0.06) / 0.6, 0, 1);
      const aimOffsetX = context.aimOffsetX ?? 0;
      parts.releasedWater.visible = progress >= 0.06 && progress < 0.72;
      parts.releasedWater.position.set(
        muzzlePosition.x + aimOffsetX * flight,
        muzzlePosition.y + 2.2 * flight - 1.2 * flight * flight,
        muzzlePosition.z + 0.15 + 2 * flight,
      );
      parts.releasedWater.scale.set(
        0.98 - 0.12 * flight,
        1 + 0.35 * Math.sin(flight * Math.PI),
        1 + 0.48 * Math.sin(flight * Math.PI),
      );
      parts.releasedWater.rotation.set(0, 0, 0);
    },
  });
  runtime.update(0);
  root.userData.combatRole = 'rear-high-lob-caster';
  root.userData.releaseAxis = [0, 0.72, 0.69];
  return root;
}

export type { WaterwingLobActionOptions } from './lobActionGeometry.ts';

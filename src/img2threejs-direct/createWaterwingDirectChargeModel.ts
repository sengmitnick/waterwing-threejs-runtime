import { attachActionContract } from '../actions/actionContract.js';
import {
  createDirectActionGeometry,
  smoothstep,
  type WaterwingActionOptions,
} from './directActionGeometry.ts';

export function createWaterwingDirectChargeModel(options: WaterwingActionOptions = {}) {
  const { root, parts } = createDirectActionGeometry('direct-charge-compact', options);
  const feederStarts = parts.feederDroplets.map((droplet) => droplet.position.clone());

  const runtime = attachActionContract(root, {
    actionId: 'charge-direct',
    durationSeconds: 1.05,
    anchors: {
      'health-anchor': [0, 1.55, 0],
      'muzzle-anchor': [0, 0.24, 0.88],
      'impact-anchor': [0, 0.08, 0.34],
      'waterline-anchor': [0, -1.5, 0],
    },
    update(progress: number, context: { intensity?: number; frame?: number; fps?: number; actorId?: string } = {}) {
      const intensity = Math.max(0, Math.min(1.25, context.intensity ?? 1));
      const load = smoothstep(0.08, 0.82, progress) * intensity;
      const settle = 0.012 * Math.sin(progress * Math.PI * 4);
      root.position.set(0, settle - 0.025 * load, 0);
      root.rotation.set(-0.025 * load, 0, 0);

      parts.body.scale.set(1 + 0.052 * load, 1 - 0.12 * load, 1 + 0.035 * load);
      parts.body.position.set(0, -0.045 * load, -0.012 * load);
      const cup = 0.14 + 0.27 * load;
      parts.leftWing.rotation.set(0.025 * load, cup, 0.19 + 0.055 * load);
      parts.rightWing.rotation.set(0.025 * load, -cup, -0.19 - 0.055 * load);
      parts.tail.rotation.set(0.09 * load, 0, 0.025 * Math.sin(progress * Math.PI));

      const coreScale = 0.1 + 0.82 * load;
      parts.muzzleCharge.visible = load > 0.02;
      parts.muzzleCharge.scale.set(coreScale * 0.9, coreScale, coreScale * 1.08);
      parts.muzzleCharge.rotation.set(0, 0, 0);
      parts.releasedWater.visible = false;

      for (let index = 0; index < parts.feederDroplets.length; index += 1) {
        const droplet = parts.feederDroplets[index];
        const phaseOffset = index * 0.055;
        const converge = Math.max(0, Math.min(1, load - phaseOffset));
        droplet.visible = progress < 0.98;
        droplet.position.lerpVectors(feederStarts[index], parts.muzzleCharge.position, converge * 0.76);
        const size = 0.9 - 0.42 * converge;
        droplet.scale.set(size, size, size * 1.18);
      }
    },
  });
  runtime.update(0);
  root.userData.combatRole = 'frontline-direct-caster';
  root.userData.releaseAxis = [0, 0, 1];
  return root;
}

export type { WaterwingActionOptions } from './directActionGeometry.ts';

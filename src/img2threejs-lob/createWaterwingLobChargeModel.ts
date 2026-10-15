import { attachActionContract } from '../actions/actionContract.js';
import {
  createLobActionGeometry,
  smoothstep,
  type WaterwingLobActionOptions,
} from './lobActionGeometry.ts';

export function createWaterwingLobChargeModel(options: WaterwingLobActionOptions = {}) {
  const { root, parts } = createLobActionGeometry('lob-charge-heavy', options);
  const feederStarts = parts.feederDroplets.map((droplet) => droplet.position.clone());

  const runtime = attachActionContract(root, {
    actionId: 'charge-lob',
    durationSeconds: 1.5,
    anchors: {
      'health-anchor': [0, 1.72, 0],
      'muzzle-anchor': [0, 0.98, 0.72],
      'impact-anchor': [0, 0.14, 0.34],
      'waterline-anchor': [0, -1.58, 0],
    },
    update(progress: number, context: { intensity?: number; frame?: number; fps?: number; actorId?: string } = {}) {
      const intensity = Math.max(0, Math.min(1.25, context.intensity ?? 1));
      const rise = smoothstep(0.04, 0.34, progress);
      const load = smoothstep(0.08, 0.78, progress) * intensity;
      root.position.set(0, 0.19 * rise + 0.015 * Math.sin(progress * Math.PI * 3), -0.035 * load);
      root.rotation.set(-0.08 * rise, 0, 0);

      parts.body.scale.set(1 + 0.055 * load, 1 - 0.065 * load, 1 + 0.045 * load);
      parts.body.position.set(0, -0.02 * load, -0.025 * load);
      const cup = 0.12 + 0.23 * load;
      parts.leftWing.rotation.set(-0.08 * load, cup, 0.34 + 0.17 * load);
      parts.rightWing.rotation.set(-0.08 * load, -cup, -0.34 - 0.17 * load);
      parts.tail.rotation.set(-0.04 - 0.28 * load, 0, 0);

      const coreScale = 0.12 + 0.88 * load;
      parts.muzzleCharge.visible = load > 0.015;
      parts.muzzleCharge.scale.set(coreScale * 0.94, coreScale * 1.06, coreScale);
      parts.releasedWater.visible = false;
      for (let index = 0; index < parts.feederDroplets.length; index += 1) {
        const droplet = parts.feederDroplets[index];
        const converge = Math.max(0, Math.min(1, load - index * 0.035));
        droplet.visible = progress < 0.98;
        droplet.position.lerpVectors(feederStarts[index], parts.muzzleCharge.position, converge * 0.82);
        const size = 1 - 0.48 * converge;
        droplet.scale.set(size, size * 1.12, size);
      }
    },
  });
  runtime.update(0);
  root.userData.combatRole = 'rear-high-lob-caster';
  root.userData.releaseAxis = [0, 0.72, 0.69];
  return root;
}

export type { WaterwingLobActionOptions } from './lobActionGeometry.ts';

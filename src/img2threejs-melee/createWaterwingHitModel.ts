import * as THREE from 'three';

import { attachActionContract } from '../actions/actionContract.js';
import { createMeleeBase, createSmallWaterDroplet, type MeleeModelOptions } from './createMeleeBase';

export function createWaterwingHitModel(options: MeleeModelOptions = {}): THREE.Group {
  const { model, body, leftWing, rightWing, tail, base } = createMeleeBase(options);
  const hitSide: -1 | 1 = options.hitSide === -1 ? -1 : 1;
  model.name = 'Waterwing Local Hit Action Model';

  const droplets = new THREE.Group();
  droplets.name = 'hit-droplets';
  for (let index = 0; index < 6; index += 1) droplets.add(createSmallWaterDroplet(index));
  model.add(droplets);

  model.userData.meleeContract = {
    action: 'hit',
    localShear: true,
    localCompression: true,
    detachedDroplets: droplets.children.length,
    survives: true,
    recovery: true,
    globalScaleCollapse: false,
  };

  attachActionContract(model, {
    actionId: 'hit',
    durationSeconds: 1.05,
    anchors: {
      'health-anchor': [0, 1.58, 0],
      'muzzle-anchor': [0, 0.18, 0.88],
      'impact-anchor': [hitSide * 0.42, 0.12, 0.38],
      'waterline-anchor': [0, -1.02, 0],
    },
    update(progress: number) {
      const impulse = Math.exp(-Math.pow((progress - 0.32) / 0.17, 2));
      const recoil = Math.sin(Math.min(1, progress / 0.68) * Math.PI) * (1 - Math.max(0, progress - 0.68) / 0.32);
      model.position.set(0, 0.018 * Math.sin(progress * Math.PI * 4), -0.1 * recoil);
      model.rotation.set(0, -hitSide * 0.055 * recoil, -hitSide * 0.07 * recoil);
      model.scale.set(1, 1, 1);

      body.position.copy(base.bodyPosition).add(new THREE.Vector3(hitSide * 0.225 * impulse, -0.025 * impulse, 0));
      body.rotation.set(base.bodyRotation.x, base.bodyRotation.y - hitSide * 0.16 * impulse, base.bodyRotation.z - hitSide * 0.08 * impulse);
      body.scale.set(
        base.bodyScale.x * (1 - 0.155 * impulse),
        base.bodyScale.y * (1 - 0.055 * impulse),
        base.bodyScale.z * (1 + 0.11 * impulse),
      );
      leftWing.rotation.set(
        base.leftRotation.x + (hitSide > 0 ? 0.08 : 0.24) * impulse,
        base.leftRotation.y,
        base.leftRotation.z + (hitSide > 0 ? -0.05 : -0.18) * impulse,
      );
      rightWing.rotation.set(
        base.rightRotation.x + (hitSide > 0 ? 0.24 : 0.08) * impulse,
        base.rightRotation.y,
        base.rightRotation.z + (hitSide > 0 ? 0.18 : 0.05) * impulse,
      );
      leftWing.scale.copy(base.leftScale);
      rightWing.scale.copy(base.rightScale);
      tail.rotation.set(base.tailRotation.x, base.tailRotation.y, base.tailRotation.z + hitSide * 0.22 * recoil);

      const flight = THREE.MathUtils.clamp((progress - 0.18) / 0.58, 0, 1);
      droplets.visible = progress >= 0.14 && progress < 0.84;
      droplets.children.forEach((child, index) => {
        const lane = index - (droplets.children.length - 1) * 0.5;
        child.visible = droplets.visible;
        child.position.set(
          hitSide * (0.48 + flight * (0.48 + index * 0.085)),
          0.2 + lane * 0.075 + flight * (0.22 + (index % 3) * 0.13),
          0.3 + flight * (0.2 - index * 0.025),
        );
        const material = (child as THREE.Mesh).material;
        if (material instanceof THREE.Material) {
          material.opacity = 0.82 * (1 - flight * flight);
          material.needsUpdate = true;
        }
      });

      model.userData.actionState = {
        phase: progress < 0.18 ? 'brace' : progress < 0.52 ? 'local-impact' : progress < 0.9 ? 'recovering' : 'recovered',
        progress,
        hitSide,
        survived: true,
      };
    },
  });
  model.userData.actionRuntime.update(0);
  return model;
}

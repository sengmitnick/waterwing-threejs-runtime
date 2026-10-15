import * as THREE from 'three';

import { attachActionContract } from '../actions/actionContract.js';
import { createMeleeBase, smooth01, type MeleeModelOptions } from './createMeleeBase';

export function createWaterwingDodgeModel(options: MeleeModelOptions = {}): THREE.Group {
  const { model, body, leftWing, rightWing, tail, base } = createMeleeBase(options);
  const direction: -1 | 1 = options.direction === -1 ? -1 : 1;
  model.name = 'Waterwing Dodge Action Model';
  model.userData.meleeContract = {
    action: 'dodge',
    sideSlip: true,
    asymmetricWings: true,
    tailCounterSteer: true,
    exitsAwayFromPov: true,
    axialSpin: false,
    globalScaleCollapse: false,
  };

  attachActionContract(model, {
    actionId: 'dodge',
    durationSeconds: 1.25,
    anchors: {
      'health-anchor': [0, 1.58, 0],
      'muzzle-anchor': [0, 0.18, 0.9],
      'impact-anchor': [0, 0.08, 0.2],
      'waterline-anchor': [0, -1.02, 0],
    },
    update(progress: number) {
      const travel = smooth01(progress);
      const bankEnvelope = Math.sin(progress * Math.PI);
      const bank = -direction * 0.44 * bankEnvelope;
      model.position.set(direction * 1.78 * travel, 0.16 * bankEnvelope, -0.82 * travel);
      model.rotation.set(0.06 * bankEnvelope, direction * 0.1 * bankEnvelope, bank);
      model.scale.set(1, 1, 1);

      body.position.copy(base.bodyPosition).add(new THREE.Vector3(direction * 0.06 * bankEnvelope, 0, 0));
      body.rotation.set(base.bodyRotation.x, base.bodyRotation.y + direction * 0.08 * bankEnvelope, base.bodyRotation.z);
      body.scale.copy(base.bodyScale);

      leftWing.rotation.set(
        base.leftRotation.x + (direction > 0 ? 0.36 : 0.08) * bankEnvelope,
        base.leftRotation.y,
        base.leftRotation.z + (direction > 0 ? -0.62 : -0.16) * bankEnvelope,
      );
      rightWing.rotation.set(
        base.rightRotation.x + (direction > 0 ? 0.08 : 0.36) * bankEnvelope,
        base.rightRotation.y,
        base.rightRotation.z + (direction > 0 ? 0.16 : 0.62) * bankEnvelope,
      );
      leftWing.scale.copy(base.leftScale);
      rightWing.scale.copy(base.rightScale);
      tail.rotation.set(
        base.tailRotation.x,
        base.tailRotation.y - direction * 0.18 * bankEnvelope,
        base.tailRotation.z + direction * 0.5 * bankEnvelope,
      );
      model.userData.actionState = {
        phase: progress < 0.2 ? 'break' : progress < 0.78 ? 'side-slip' : 'clear',
        progress,
        direction,
        awayFromPov: model.position.z < 0,
      };
    },
  });
  model.userData.actionRuntime.update(0);
  return model;
}

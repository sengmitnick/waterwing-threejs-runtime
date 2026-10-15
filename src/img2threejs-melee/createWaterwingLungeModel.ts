import * as THREE from 'three';

import { attachActionContract } from '../actions/actionContract.js';
import { createMeleeBase, smooth01, type MeleeModelOptions } from './createMeleeBase';

export function createWaterwingLungeModel(options: MeleeModelOptions = {}): THREE.Group {
  // The accepted propulsion sculpt is the correct starting silhouette for a lunge:
  // broad heavy wings trail down/back instead of becoming the hover model's raised fans.
  const { model, body, leftWing, rightWing, tail, base } = createMeleeBase(options, 'forward');
  model.name = 'Waterwing Lunge Action Model';

  model.userData.meleeContract = {
    action: 'lunge',
    readableTell: true,
    thickWingsLockedBack: true,
    forwardAxis: '+z',
    speedCurve: 'quadratic-acceleration',
    axialSpin: false,
    globalScaleCollapse: false,
  };

  attachActionContract(model, {
    actionId: 'lunge',
    durationSeconds: 1.7,
    anchors: {
      'health-anchor': [0, 1.58, 0],
      'muzzle-anchor': [0, 0.18, 0.92],
      'impact-anchor': [0, 0.08, 0.68],
      'waterline-anchor': [0, -1.02, 0],
    },
    update(progress: number) {
      const isTell = progress < 0.22;
      const tell = isTell ? Math.sin((progress / 0.22) * Math.PI * 0.5) : 1;
      const burst = THREE.MathUtils.clamp((progress - 0.22) / 0.56, 0, 1);
      const recovery = smooth01((progress - 0.78) / 0.22);
      const lock = THREE.MathUtils.lerp(tell, 0.92, recovery);

      model.position.set(0, 0.025 * Math.sin(progress * Math.PI * 3), -0.18 * tell + 2.75 * burst * burst);
      model.rotation.set(-0.035 * burst, 0, 0);
      model.scale.set(1, 1, 1);

      body.position.copy(base.bodyPosition).add(new THREE.Vector3(0, -0.065 * tell, -0.075 * tell));
      body.rotation.set(base.bodyRotation.x - 0.12 * tell, base.bodyRotation.y, base.bodyRotation.z);
      body.scale.set(
        base.bodyScale.x * (1 + 0.035 * burst),
        base.bodyScale.y * (1 - 0.075 * tell),
        base.bodyScale.z * (1 + 0.09 * tell),
      );

      // One heavy propulsive surface on each side: both fans fold backward in depth
      // and press down. They never read as two upright arms.
      leftWing.rotation.set(base.leftRotation.x + 0.94 * lock, base.leftRotation.y - 0.08, base.leftRotation.z + 0.38 * lock);
      rightWing.rotation.set(base.rightRotation.x + 0.94 * lock, base.rightRotation.y + 0.08, base.rightRotation.z - 0.38 * lock);
      leftWing.scale.set(base.leftScale.x, base.leftScale.y * 0.94, base.leftScale.z * 1.18);
      rightWing.scale.set(base.rightScale.x, base.rightScale.y * 0.94, base.rightScale.z * 1.18);
      tail.rotation.set(
        base.tailRotation.x - 0.12 * burst,
        base.tailRotation.y,
        base.tailRotation.z + 0.08 * Math.sin(progress * Math.PI),
      );

      model.userData.actionState = {
        phase: isTell ? 'tell' : progress < 0.78 ? 'accelerating-burst' : 'commit',
        progress,
        speed: burst * 2,
        exitsTowardPov: true,
      };
    },
  });
  model.userData.actionRuntime.update(0);
  return model;
}

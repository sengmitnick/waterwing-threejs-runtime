import * as THREE from 'three';

type ForwardRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
};

export const FORWARD_PROPEL_CLIP_NAME = 'propel_loop';
export const FORWARD_PROPEL_DURATION_SECONDS = 2;
export const FORWARD_PROPEL_SAMPLE_COUNT = 33;

function requiredNode(runtime: ForwardRuntime, id: string): THREE.Object3D {
  const node = runtime.nodes[id];
  if (!node) throw new Error(`Missing forward-propulsion animation node: ${id}`);
  return node;
}

function appendQuaternion(target: number[], euler: THREE.Euler): void {
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  target.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

/**
 * Bakes the approved preview motion into a reusable, root-motion-free glTF clip.
 * Both wings share one temporal phase and use mirrored Y/Z signs. The tail trails
 * the drive phase, while the body only compresses/bobs inside the stationary root.
 */
export function createForwardPropulsionAnimation(runtime: ForwardRuntime): THREE.AnimationClip {
  const body = requiredNode(runtime, 'body');
  const leftWing = requiredNode(runtime, 'wing-left');
  const rightWing = requiredNode(runtime, 'wing-right');
  const tail = requiredNode(runtime, 'tail-leaf');
  const leftWingMesh = runtime.meshes['wing-left'];
  const rightWingMesh = runtime.meshes['wing-right'];
  if (typeof leftWingMesh?.morphTargetDictionary?.powerStroke !== 'number' || !leftWingMesh.morphTargetInfluences) {
    throw new Error('Left propulsion wing is missing the powerStroke morph target');
  }
  if (typeof rightWingMesh?.morphTargetDictionary?.powerStroke !== 'number' || !rightWingMesh.morphTargetInfluences) {
    throw new Error('Right propulsion wing is missing the powerStroke morph target');
  }

  const base = {
    bodyPosition: body.position.clone(),
    bodyRotation: body.rotation.clone(),
    leftRotation: leftWing.rotation.clone(),
    rightRotation: rightWing.rotation.clone(),
    tailRotation: tail.rotation.clone(),
  };

  const times: number[] = [];
  const bodyPositions: number[] = [];
  const bodyQuaternions: number[] = [];
  const leftQuaternions: number[] = [];
  const rightQuaternions: number[] = [];
  const tailQuaternions: number[] = [];
  const powerStrokeWeights: number[] = [];

  for (let index = 0; index < FORWARD_PROPEL_SAMPLE_COUNT; index += 1) {
    // Use phase 0 for both endpoints so every channel closes bit-for-bit.
    const normalized = index === FORWARD_PROPEL_SAMPLE_COUNT - 1
      ? 0
      : index / (FORWARD_PROPEL_SAMPLE_COUNT - 1);
    const angle = normalized * Math.PI * 2;
    const drive = Math.sin(angle);
    const secondary = Math.sin(angle - 0.55);
    const compression = 0.5 + 0.5 * Math.cos(angle);
    const powerStroke = 0.5 + 0.5 * Math.sin(angle);

    times.push(index * FORWARD_PROPEL_DURATION_SECONDS / (FORWARD_PROPEL_SAMPLE_COUNT - 1));
    bodyPositions.push(
      base.bodyPosition.x,
      base.bodyPosition.y - 0.035 * compression,
      base.bodyPosition.z + 0.045 * drive,
    );
    appendQuaternion(bodyQuaternions, new THREE.Euler(
      base.bodyRotation.x + 0.025 * secondary,
      base.bodyRotation.y,
      base.bodyRotation.z,
      base.bodyRotation.order,
    ));
    appendQuaternion(leftQuaternions, new THREE.Euler(
      base.leftRotation.x + 0.06 * secondary,
      base.leftRotation.y - 0.055 * drive,
      base.leftRotation.z + 0.13 * drive,
      base.leftRotation.order,
    ));
    appendQuaternion(rightQuaternions, new THREE.Euler(
      base.rightRotation.x + 0.06 * secondary,
      base.rightRotation.y + 0.055 * drive,
      base.rightRotation.z - 0.13 * drive,
      base.rightRotation.order,
    ));
    appendQuaternion(tailQuaternions, new THREE.Euler(
      base.tailRotation.x + 0.035 * Math.sin(angle - 0.8),
      base.tailRotation.y + 0.085 * Math.sin(angle - 0.9),
      base.tailRotation.z,
      base.tailRotation.order,
    ));
    powerStrokeWeights.push(powerStroke);
  }

  return new THREE.AnimationClip(FORWARD_PROPEL_CLIP_NAME, FORWARD_PROPEL_DURATION_SECONDS, [
    new THREE.VectorKeyframeTrack(`${body.name}.position`, times, bodyPositions),
    new THREE.QuaternionKeyframeTrack(`${body.name}.quaternion`, times, bodyQuaternions),
    new THREE.QuaternionKeyframeTrack(`${leftWing.name}.quaternion`, times, leftQuaternions),
    new THREE.QuaternionKeyframeTrack(`${rightWing.name}.quaternion`, times, rightQuaternions),
    new THREE.QuaternionKeyframeTrack(`${tail.name}.quaternion`, times, tailQuaternions),
    new THREE.NumberKeyframeTrack(
      `${leftWingMesh.name}.morphTargetInfluences[powerStroke]`,
      times,
      powerStrokeWeights,
    ),
    new THREE.NumberKeyframeTrack(
      `${rightWingMesh.name}.morphTargetInfluences[powerStroke]`,
      times,
      powerStrokeWeights,
    ),
  ]);
}

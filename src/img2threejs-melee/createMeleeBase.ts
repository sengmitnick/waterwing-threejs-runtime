import * as THREE from 'three';

import { createWaterwingForwardPropulsionModel } from '../img2threejs-forward/createFinishedWaterwingForwardModel';
import { createWaterwingHoverModel, type ProceduralModelOptions } from '../img2threejs-hover/createFinishedWaterwingHoverModel';

export type MeleeModelOptions = ProceduralModelOptions & {
  direction?: -1 | 1;
  hitSide?: -1 | 1;
};

export type MeleeParts = {
  model: THREE.Group;
  body: THREE.Object3D;
  leftWing: THREE.Object3D;
  rightWing: THREE.Object3D;
  tail: THREE.Object3D;
  base: {
    bodyPosition: THREE.Vector3;
    bodyRotation: THREE.Euler;
    bodyScale: THREE.Vector3;
    leftRotation: THREE.Euler;
    rightRotation: THREE.Euler;
    leftScale: THREE.Vector3;
    rightScale: THREE.Vector3;
    tailRotation: THREE.Euler;
  };
};

export function smooth01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function createMeleeBase(
  options: MeleeModelOptions = {},
  source: 'hover' | 'forward' = 'hover',
): MeleeParts {
  const model = source === 'forward'
    ? createWaterwingForwardPropulsionModel(options)
    : createWaterwingHoverModel(options);
  const sculpt = model.userData.sculptRuntime as {
    nodes: Record<string, THREE.Object3D>;
    meshes: Record<string, THREE.Mesh>;
  };
  const body = sculpt.nodes.body;
  const leftWing = sculpt.nodes['wing-left'];
  const rightWing = sculpt.nodes['wing-right'];
  const tail = sculpt.nodes['tail-leaf'];

  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);

  return {
    model,
    body,
    leftWing,
    rightWing,
    tail,
    base: {
      bodyPosition: body.position.clone(),
      bodyRotation: body.rotation.clone(),
      bodyScale: body.scale.clone(),
      leftRotation: leftWing.rotation.clone(),
      rightRotation: rightWing.rotation.clone(),
      leftScale: leftWing.scale.clone(),
      rightScale: rightWing.scale.clone(),
      tailRotation: tail.rotation.clone(),
    },
  };
}

export function createSmallWaterDroplet(index: number): THREE.Mesh {
  const geometry = new THREE.IcosahedronGeometry(0.095 + index * 0.008, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    const ripple = 1 + Math.sin(x * 23 + y * 17 + z * 29 + index * 1.7) * 0.1;
    position.setXYZ(vertex, x * ripple, y * ripple * 1.22, z * ripple * 0.82);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalMaterial({
    color: '#8da3a9',
    roughness: 0.28,
    metalness: 0,
    transmission: 0.22,
    thickness: 0.12,
    ior: 1.333,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
    emissive: '#203c44',
    emissiveIntensity: 0.04,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const droplet = new THREE.Mesh(geometry, material);
  droplet.name = `hit-droplet-${index + 1}`;
  droplet.userData.sculptComponent = { id: 'hit-droplet', role: 'detached-water' };
  return droplet;
}

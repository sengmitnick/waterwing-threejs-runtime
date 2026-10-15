import * as THREE from 'three';

import { createBodyGeometry } from './geometry/createBodyGeometry.js';
import { createDropletGeometry } from './geometry/createDropletGeometry.js';
import { createTailGeometry } from './geometry/createTailGeometry.js';
import { createWingGeometry } from './geometry/createWingGeometry.js';
import { createWaterwingMaterials } from './createWaterwingMaterials.js';

function addAnchor(parent, name, position) {
  const anchor = new THREE.Object3D();
  anchor.name = name;
  anchor.position.fromArray(position);
  parent.add(anchor);
  return anchor;
}

function createWingAssembly({ side, seed, material, dropletGeometry, dropletMaterial }) {
  const sign = side === 'left' ? -1 : 1;
  const pivotPosition = new THREE.Vector3(sign * 0.51, -0.08, -0.025);

  const pivot = new THREE.Group();
  pivot.name = `wing-${side}-pivot`;
  pivot.position.copy(pivotPosition);

  // The membrane is authored in creature coordinates. Rebase it around the
  // broad wing root so each wing articulates from the torso rather than from
  // the scene origin.
  const geometry = createWingGeometry({ side, seed });
  geometry.translate(-pivotPosition.x, -pivotPosition.y, -pivotPosition.z);

  const wing = new THREE.Mesh(geometry, material);
  wing.name = `wing-${side}`;
  wing.updateMorphTargets();
  pivot.add(wing);

  const droplets = new THREE.Group();
  droplets.name = `wing-${side}-droplets`;
  const placements = [
    [0.99, 1.43, -0.47, 0.105],
    [0.92, 0.88, -0.39, 0.078],
    [0.73, 0.2, -0.26, 0.088],
    [0.47, -0.43, -0.13, 0.062]
  ];
  placements.forEach(([x, y, z, scale], index) => {
    const droplet = new THREE.Mesh(dropletGeometry, dropletMaterial);
    droplet.name = `edge-water-drop-${side}-${String(index + 1).padStart(2, '0')}`;
    droplet.position.set(sign * x, y, z);
    droplet.scale.set(scale * 0.72, scale, scale * 0.64);
    droplet.rotation.set(
      0.08 * Math.sin(index + seed),
      0.2 * Math.cos(index * 0.8 + seed),
      sign * 0.32
    );
    droplets.add(droplet);
  });
  pivot.add(droplets);

  return pivot;
}

export function createWaterwingV2() {
  const root = new THREE.Group();
  root.name = 'WaterwingSpirit';
  root.userData.assetVersion = 2;
  root.userData.kind = 'waterwing-spirit';
  root.userData.anatomicalForward = [0, 1, 0];
  root.userData.combatFacing = [0, 0, 1];

  const poseRoot = new THREE.Group();
  poseRoot.name = 'pose-root';
  root.add(poseRoot);

  const materials = createWaterwingMaterials();
  const dropletGeometry = createDropletGeometry({ radialSegments: 12, heightSegments: 8, seed: 5 });

  const body = new THREE.Mesh(createBodyGeometry(), materials.body);
  body.name = 'body';
  body.updateMorphTargets();
  poseRoot.add(body);

  poseRoot.add(createWingAssembly({
    side: 'left',
    seed: 3,
    material: materials.wing,
    dropletGeometry,
    dropletMaterial: materials.droplet
  }));
  poseRoot.add(createWingAssembly({
    side: 'right',
    seed: 11,
    material: materials.wing,
    dropletGeometry,
    dropletMaterial: materials.droplet
  }));

  const tailPivot = new THREE.Group();
  tailPivot.name = 'tail-pivot';
  tailPivot.position.set(0, -0.82, -0.08);
  const tail = new THREE.Mesh(createTailGeometry(), materials.tail);
  tail.name = 'tail';
  tail.updateMorphTargets();
  tailPivot.add(tail);
  poseRoot.add(tailPivot);

  const coreGeometry = new THREE.BufferGeometry().copy(new THREE.IcosahedronGeometry(0.032, 2));
  coreGeometry.type = 'BufferGeometry';
  const core = new THREE.Mesh(coreGeometry, materials.core);
  core.name = 'weak-core';
  core.position.set(0, 0.1, 0.51);
  core.scale.set(0.72, 0.86, 0.54);
  poseRoot.add(core);

  // Health remains stable while combat anchors follow the local animated pose.
  addAnchor(root, 'health-anchor', [0, 1.82, 0]);
  addAnchor(poseRoot, 'muzzle-anchor', [0, 0.16, 0.62]);
  addAnchor(poseRoot, 'impact-anchor', [0, 0.04, 0.52]);
  addAnchor(poseRoot, 'emerge-anchor', [0, -1.44, -0.16]);

  root.updateMatrixWorld(true);
  return root;
}

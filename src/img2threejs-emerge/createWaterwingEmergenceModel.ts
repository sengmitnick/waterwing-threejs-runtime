import * as THREE from 'three';

import { attachActionContract } from '../actions/actionContract.js';
import {
  applyWaterwingAqueousLook,
  type WaterwingAqueousLookOptions,
} from '../img2threejs-forward/applyWaterwingAqueousLook';

export type WaterwingEmergenceOptions = WaterwingAqueousLookOptions & {
  castShadow?: boolean;
  receiveShadow?: boolean;
};

type EmergenceContext = {
  frame?: number;
  fps?: number;
  actorId?: string;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function smoothRange(value: number, start: number, end: number): number {
  const t = clamp01((value - start) / Math.max(1e-6, end - start));
  return t * t * (3 - 2 * t);
}

function waterMaterial(color = '#6f98a3'): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.28,
    metalness: 0,
    transmission: 0.2,
    ior: 1.333,
    thickness: 0.36,
  });
}

function tagMesh(
  mesh: THREE.Mesh,
  id: string,
  material: 'water-shell' | 'wing-membrane' | 'water-rim' | 'inner-water' | 'eye-cyan',
  role: string,
): THREE.Mesh {
  mesh.name = id;
  mesh.userData.sculptComponent = { id, material, role };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createTorsoGeometry(): THREE.LatheGeometry {
  const profile = [
    new THREE.Vector2(0.055, -1.05),
    new THREE.Vector2(0.22, -0.84),
    new THREE.Vector2(0.48, -0.5),
    new THREE.Vector2(0.67, -0.08),
    new THREE.Vector2(0.7, 0.28),
    new THREE.Vector2(0.56, 0.62),
    new THREE.Vector2(0.3, 0.87),
    new THREE.Vector2(0.1, 1.04),
    new THREE.Vector2(0.03, 1.13),
  ];
  const geometry = new THREE.LatheGeometry(profile, 64);
  geometry.scale(1, 1, 0.79);
  geometry.computeVertexNormals();
  return geometry;
}

function createWingGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0.02, -0.18);
  shape.bezierCurveTo(0.18, 0.08, 0.33, 0.38, 0.5, 0.72);
  shape.bezierCurveTo(0.72, 1.12, 1.08, 1.53, 1.5, 1.72);
  shape.bezierCurveTo(1.66, 1.38, 1.58, 0.96, 1.43, 0.52);
  shape.bezierCurveTo(1.3, 0.08, 1.14, -0.36, 0.84, -0.78);
  shape.bezierCurveTo(0.55, -1.04, 0.25, -0.76, 0.02, -0.18);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.34,
    steps: 2,
    curveSegments: 24,
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: 0.07,
    bevelThickness: 0.07,
  });
  geometry.translate(0, 0, -0.17);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const spanX = Math.max(1e-6, bounds.max.x - bounds.min.x);
  const spanY = Math.max(1e-6, bounds.max.y - bounds.min.y);
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    uv[index * 2] = (position.getX(index) - bounds.min.x) / spanX;
    uv[index * 2 + 1] = (position.getY(index) - bounds.min.y) / spanY;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function createTailGroup(material: THREE.Material): THREE.Group {
  const tail = new THREE.Group();
  tail.name = 'tail-leaf';
  const drops = [
    { position: [0, -0.22, 0] as const, scale: [0.2, 0.34, 0.16] as const, rotation: 0.05 },
    { position: [0.06, -0.53, 0] as const, scale: [0.27, 0.4, 0.18] as const, rotation: -0.12 },
    { position: [-0.025, -0.86, 0.01] as const, scale: [0.19, 0.37, 0.14] as const, rotation: 0.14 },
    { position: [0.045, -1.14, 0] as const, scale: [0.095, 0.26, 0.075] as const, rotation: -0.12 },
  ];
  drops.forEach((drop, index) => {
    const mesh = tagMesh(
      new THREE.Mesh(new THREE.SphereGeometry(1, 30, 22), material),
      index === 0 ? 'tail-leaf' : `tail-flow-${index}`,
      'water-shell',
      'tail',
    );
    mesh.position.fromArray(drop.position);
    mesh.scale.fromArray(drop.scale);
    mesh.rotation.z = drop.rotation;
    tail.add(mesh);
  });
  return tail;
}

function createFragment(
  index: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = tagMesh(
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.11 + (index % 4) * 0.018, 2), material),
    `flow-fragment-${index}`,
    'water-rim',
    'emergence-flow-fragment',
  );
  mesh.scale.set(0.7 + (index % 3) * 0.18, 1.35 + (index % 5) * 0.14, 0.72 + (index % 2) * 0.18);
  return mesh;
}

/**
 * Dedicated one-shot formation model. The geometry is authored for an upward
 * waterline assembly: it is not the hover or propulsion model with a reveal shader.
 */
export function createWaterwingEmergenceModel(
  options: WaterwingEmergenceOptions = {},
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'root';
  root.userData.actionVariant = 'waterline-assembly-v1';

  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'torso';
  const torso = tagMesh(
    new THREE.Mesh(createTorsoGeometry(), waterMaterial('#759ba5')),
    'body',
    'water-shell',
    'forming-torso',
  );
  torsoGroup.add(torso);
  root.add(torsoGroup);

  const innerFlow = tagMesh(
    new THREE.Mesh(new THREE.SphereGeometry(0.48, 36, 24), waterMaterial('#2d6775')),
    'inner-water-vein',
    'inner-water',
    'weak-inner-flow',
  );
  innerFlow.scale.set(0.52, 1.25, 0.48);
  innerFlow.position.set(0, 0.08, 0.03);
  torsoGroup.add(innerFlow);

  const eye = tagMesh(
    new THREE.Mesh(new THREE.SphereGeometry(0.095, 28, 20), waterMaterial('#6de7ee')),
    'eye-center',
    'eye-cyan',
    'eye',
  );
  eye.position.set(0, 0.3, 0.53);
  eye.scale.set(1, 0.82, 0.5);
  torsoGroup.add(eye);

  const wingGeometry = createWingGeometry();
  const wingMaterial = waterMaterial('#94abb1');
  const leftWing = new THREE.Group();
  leftWing.name = 'wing-left';
  leftWing.position.set(-0.38, 0.2, -0.03);
  const leftWingMesh = tagMesh(
    new THREE.Mesh(wingGeometry.clone(), wingMaterial),
    'wing-left',
    'wing-membrane',
    'forming-wing',
  );
  leftWingMesh.scale.x = -1;
  leftWing.add(leftWingMesh);
  root.add(leftWing);

  const rightWing = new THREE.Group();
  rightWing.name = 'wing-right';
  rightWing.position.set(0.38, 0.2, -0.03);
  const rightWingMesh = tagMesh(
    new THREE.Mesh(wingGeometry, wingMaterial),
    'wing-right',
    'wing-membrane',
    'forming-wing',
  );
  rightWing.add(rightWingMesh);
  root.add(rightWing);

  const tail = createTailGroup(waterMaterial('#7899a2'));
  tail.position.set(0, -0.86, -0.035);
  root.add(tail);

  const fragmentGroup = new THREE.Group();
  fragmentGroup.name = 'flow-fragments';
  const fragmentMaterial = waterMaterial('#b2d6dc');
  const fragmentStarts: THREE.Vector3[] = [];
  const fragmentTargets: THREE.Vector3[] = [];
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    const radius = 0.55 + (index % 5) * 0.15;
    const mesh = createFragment(index, fragmentMaterial);
    const start = new THREE.Vector3(
      Math.cos(angle) * radius,
      -1.2 + Math.sin(index * 1.73) * 0.09,
      Math.sin(angle) * radius * 0.42,
    );
    const target = new THREE.Vector3(
      Math.cos(angle * 1.7) * (0.25 + (index % 3) * 0.08),
      -0.7 + (index / 17) * 1.45,
      0.1 + Math.sin(angle * 1.3) * 0.3,
    );
    mesh.position.copy(start);
    mesh.userData.start = start;
    mesh.userData.target = target;
    fragmentStarts.push(start);
    fragmentTargets.push(target);
    fragmentGroup.add(mesh);
  }
  root.add(fragmentGroup);

  const waterlineDroplets = new THREE.Group();
  waterlineDroplets.name = 'waterline-droplets';
  const dropletMaterial = waterMaterial('#c2e3e7');
  for (let index = 0; index < 12; index += 1) {
    const droplet = tagMesh(
      new THREE.Mesh(new THREE.SphereGeometry(0.075 + (index % 3) * 0.018, 20, 14), dropletMaterial),
      `waterline-droplet-${index}`,
      'water-rim',
      'persistent-waterline-droplet',
    );
    const angle = (index / 12) * Math.PI * 2;
    droplet.userData.basePosition = new THREE.Vector3(
      Math.cos(angle) * (0.48 + (index % 4) * 0.12),
      -1.18,
      Math.sin(angle) * 0.3,
    );
    droplet.position.copy(droplet.userData.basePosition);
    droplet.scale.set(0.72, 1.45 + (index % 4) * 0.15, 0.72);
    waterlineDroplets.add(droplet);
  }
  root.add(waterlineDroplets);

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = options.castShadow ?? true;
    object.receiveShadow = options.receiveShadow ?? true;
  });
  applyWaterwingAqueousLook(root, options);

  const nodes: Record<string, THREE.Object3D> = {
    root,
    torso: torsoGroup,
    'wing-left': leftWing,
    'wing-right': rightWing,
    'tail-leaf': tail,
    'flow-fragments': fragmentGroup,
    'waterline-droplets': waterlineDroplets,
  };
  const meshes: Record<string, THREE.Mesh> = {
    body: torso,
    'inner-water-vein': innerFlow,
    'eye-center': eye,
    'wing-left': leftWingMesh,
    'wing-right': rightWingMesh,
  };
  root.userData.sculptRuntime = { nodes, meshes, sockets: {}, colliders: {}, destructionGroups: {} };

  const update = (progress: number, context: EmergenceContext = {}): void => {
    const torsoFormation = smoothRange(progress, 0.16, 0.42);
    const wingFormation = smoothRange(progress, 0.36, 0.66);
    const tailFormation = smoothRange(progress, 0.56, 0.88);
    const gather = smoothRange(progress, 0.035, 0.7);
    const consumed = smoothRange(progress, 0.48, 0.79);

    torsoGroup.visible = torsoFormation > 0;
    torsoGroup.position.y = THREE.MathUtils.lerp(-1.16, 0, torsoFormation);
    torsoGroup.scale.set(
      0.24 + torsoFormation * 0.76,
      0.035 + torsoFormation * 0.965,
      0.24 + torsoFormation * 0.76,
    );
    torsoGroup.rotation.y = (1 - torsoFormation) * 0.3;

    leftWing.visible = wingFormation > 0;
    rightWing.visible = wingFormation > 0;
    leftWing.scale.setScalar(0.075 + wingFormation * 0.925);
    rightWing.scale.copy(leftWing.scale);
    leftWing.rotation.z = THREE.MathUtils.lerp(-0.72, 0.08, wingFormation);
    rightWing.rotation.z = THREE.MathUtils.lerp(0.72, -0.08, wingFormation);
    leftWing.rotation.y = THREE.MathUtils.lerp(-0.42, 0.02, wingFormation);
    rightWing.rotation.y = THREE.MathUtils.lerp(0.42, -0.02, wingFormation);

    tail.visible = tailFormation > 0;
    tail.scale.set(0.12 + tailFormation * 0.88, 0.035 + tailFormation * 0.965, 0.12 + tailFormation * 0.88);
    tail.rotation.z = (1 - tailFormation) * -0.3;

    let visibleFlowFragments = 0;
    fragmentGroup.children.forEach((child, index) => {
      const mesh = child as THREE.Mesh;
      const start = fragmentStarts[index];
      const target = fragmentTargets[index];
      const stagger = smoothRange(gather, index * 0.012, 0.63 + index * 0.012);
      mesh.position.lerpVectors(start, target, stagger);
      mesh.position.y += Math.sin(progress * 8 + index * 1.37) * 0.055 * (1 - consumed);
      const fragmentLife = 1 - smoothRange(consumed, index * 0.018, 0.54 + index * 0.018);
      mesh.visible = fragmentLife > 0.015;
      mesh.scale.setScalar(Math.max(0.03, fragmentLife));
      mesh.rotation.set(progress * (0.7 + (index % 3) * 0.25), progress * (0.4 + index * 0.02), index * 0.31);
      if (mesh.visible) visibleFlowFragments += 1;
    });

    let visibleWaterlineDroplets = 0;
    waterlineDroplets.children.forEach((child, index) => {
      const droplet = child as THREE.Mesh;
      const base = droplet.userData.basePosition as THREE.Vector3;
      droplet.visible = true;
      droplet.position.copy(base);
      droplet.position.y += Math.sin(progress * 7.5 + index * 0.82) * 0.045;
      droplet.position.x += Math.sin(progress * 4.3 + index) * 0.02;
      visibleWaterlineDroplets += 1;
    });

    root.userData.emergenceState = {
      progress,
      frame: context.frame ?? null,
      phase: progress < 0.16 ? 'water-gather' : progress < 0.36 ? 'torso-form' : progress < 0.56 ? 'wing-form' : progress < 0.88 ? 'tail-form' : 'formed',
      torsoFormation,
      wingFormation,
      tailFormation,
      visibleFlowFragments,
      visibleWaterlineDroplets,
    };
  };

  const runtime = attachActionContract(root, {
    actionId: 'emerge',
    durationSeconds: 3.1,
    anchors: {
      'health-anchor': [0, 1.48, 0],
      'muzzle-anchor': [0, 0.28, 0.72],
      'impact-anchor': [0, 0.08, 0.15],
      'waterline-anchor': [0, -1.18, 0],
    },
    update,
  });
  Object.assign(nodes, runtime.anchors);
  runtime.update(0, {});
  return root;
}

/** Stable scenario-facing name matching the `emerge` action id. */
export const createWaterwingEmergeModel = createWaterwingEmergenceModel;

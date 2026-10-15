import * as THREE from 'three';

import { attachActionContract } from '../actions/actionContract.js';
import {
  applyWaterwingAqueousLook,
  type WaterwingAqueousLookOptions,
} from '../img2threejs-forward/applyWaterwingAqueousLook';

export type WaterwingDefeatOptions = WaterwingAqueousLookOptions & {
  castShadow?: boolean;
  receiveShadow?: boolean;
};

type DefeatContext = {
  frame?: number;
  fps?: number;
  actorId?: string;
  hitDirection?: THREE.Vector3 | readonly [number, number, number];
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function smoothRange(value: number, start: number, end: number): number {
  const t = clamp01((value - start) / Math.max(1e-6, end - start));
  return t * t * (3 - 2 * t);
}

function waterMaterial(color = '#7096a0'): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.28,
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
    new THREE.Vector2(0.06, -1.02),
    new THREE.Vector2(0.24, -0.78),
    new THREE.Vector2(0.52, -0.4),
    new THREE.Vector2(0.69, 0.02),
    new THREE.Vector2(0.66, 0.42),
    new THREE.Vector2(0.48, 0.73),
    new THREE.Vector2(0.24, 0.98),
    new THREE.Vector2(0.045, 1.11),
  ];
  const geometry = new THREE.LatheGeometry(profile, 64);
  geometry.scale(1, 1, 0.8);
  geometry.computeVertexNormals();
  return geometry;
}

function createSlackWingGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0.02, -0.1);
  shape.bezierCurveTo(0.26, 0.18, 0.5, 0.58, 0.72, 0.94);
  shape.bezierCurveTo(0.98, 1.33, 1.28, 1.51, 1.55, 1.5);
  shape.bezierCurveTo(1.52, 1.12, 1.4, 0.63, 1.27, 0.17);
  shape.bezierCurveTo(1.12, -0.31, 0.86, -0.77, 0.57, -1.01);
  shape.bezierCurveTo(0.31, -0.82, 0.13, -0.48, 0.02, -0.1);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.38,
    steps: 2,
    curveSegments: 24,
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: 0.075,
    bevelThickness: 0.075,
  });
  geometry.translate(0, 0, -0.19);
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

function createTail(material: THREE.Material): THREE.Group {
  const tail = new THREE.Group();
  tail.name = 'tail-leaf';
  const pieces = [
    { p: [0, -0.18, 0] as const, s: [0.2, 0.3, 0.16] as const, r: 0.05 },
    { p: [0.05, -0.47, 0] as const, s: [0.28, 0.4, 0.18] as const, r: -0.12 },
    { p: [-0.03, -0.79, 0.01] as const, s: [0.2, 0.36, 0.14] as const, r: 0.14 },
    { p: [0.04, -1.07, 0] as const, s: [0.09, 0.25, 0.07] as const, r: -0.11 },
  ];
  pieces.forEach((piece, index) => {
    const mesh = tagMesh(
      new THREE.Mesh(new THREE.SphereGeometry(1, 30, 20), material),
      index === 0 ? 'tail-leaf' : `tail-collapse-${index}`,
      'water-shell',
      'defeat-tail',
    );
    mesh.position.fromArray(piece.p);
    mesh.scale.fromArray(piece.s);
    mesh.rotation.z = piece.r;
    tail.add(mesh);
  });
  return tail;
}

function setObjectFade(object: THREE.Object3D, fade: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.opacity = fade;
      material.transparent = fade < 0.999;
      material.depthWrite = fade > 0.22;
      material.needsUpdate = true;
    }
    child.visible = fade > 0.008;
  });
}

/** Dedicated one-shot defeat model: impact hold, tension loss, then liquid breakup. */
export function createWaterwingDefeatModel(
  options: WaterwingDefeatOptions = {},
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'root';
  root.userData.actionVariant = 'falling-water-defeat-v1';

  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'action-body';
  bodyGroup.rotation.z = 0.1;
  root.add(bodyGroup);

  const body = tagMesh(
    new THREE.Mesh(createTorsoGeometry(), waterMaterial('#759aa4')),
    'body',
    'water-shell',
    'defeat-torso',
  );
  bodyGroup.add(body);

  const innerFlow = tagMesh(
    new THREE.Mesh(new THREE.SphereGeometry(0.48, 36, 24), waterMaterial('#275d6a')),
    'inner-water-vein',
    'inner-water',
    'weak-inner-flow',
  );
  innerFlow.scale.set(0.5, 1.25, 0.46);
  innerFlow.position.set(0, 0.06, 0.03);
  bodyGroup.add(innerFlow);

  const eye = tagMesh(
    new THREE.Mesh(new THREE.SphereGeometry(0.09, 26, 18), waterMaterial('#6de7ee')),
    'eye-center',
    'eye-cyan',
    'eye',
  );
  eye.position.set(0, 0.28, 0.53);
  eye.scale.set(1, 0.82, 0.5);
  bodyGroup.add(eye);

  const wingGeometry = createSlackWingGeometry();
  const wingMaterial = waterMaterial('#94aab0');
  const leftWing = new THREE.Group();
  leftWing.name = 'wing-left';
  leftWing.position.set(-0.38, 0.2, -0.03);
  const leftWingMesh = tagMesh(
    new THREE.Mesh(wingGeometry.clone(), wingMaterial),
    'wing-left',
    'wing-membrane',
    'defeat-wing',
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
    'defeat-wing',
  );
  rightWing.add(rightWingMesh);
  root.add(rightWing);

  const tail = createTail(waterMaterial('#7698a1'));
  tail.position.set(0, -0.83, -0.04);
  root.add(tail);

  const impactSpray = new THREE.Group();
  impactSpray.name = 'impact-spray';
  const rimMaterial = waterMaterial('#c8e5e8');
  for (let index = 0; index < 10; index += 1) {
    const droplet = tagMesh(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.06 + (index % 3) * 0.018, 2), rimMaterial),
      `impact-spray-${index}`,
      'water-rim',
      'hit-stop-spray',
    );
    const angle = (index / 10) * Math.PI * 2;
    droplet.userData.direction = new THREE.Vector3(
      Math.cos(angle) * (0.65 + (index % 3) * 0.14),
      Math.sin(angle) * 0.45 + 0.08,
      0.42 + (index % 4) * 0.08,
    );
    impactSpray.add(droplet);
  }
  root.add(impactSpray);

  const curtain = new THREE.Group();
  curtain.name = 'water-curtain';
  const curtainMaterial = waterMaterial('#90b0b7');
  for (let index = 0; index < 12; index += 1) {
    const strand = tagMesh(
      new THREE.Mesh(new THREE.CapsuleGeometry(0.045 + (index % 3) * 0.012, 0.55, 8, 14), curtainMaterial),
      `curtain-strand-${index}`,
      index % 4 === 0 ? 'water-rim' : 'water-shell',
      'falling-water-curtain',
    );
    const x = ((index % 6) - 2.5) * 0.2;
    const row = Math.floor(index / 6);
    strand.userData.basePosition = new THREE.Vector3(x, 0.3 - row * 0.38, -0.08 + row * 0.16);
    strand.position.copy(strand.userData.basePosition);
    strand.scale.set(0.8 + (index % 2) * 0.25, 0.8, 0.8);
    curtain.add(strand);
  }
  root.add(curtain);

  const defeatDroplets = new THREE.Group();
  defeatDroplets.name = 'defeat-droplets';
  const dropletMaterial = waterMaterial('#b4d3d8');
  const dropletStarts: THREE.Vector3[] = [];
  for (let index = 0; index < 20; index += 1) {
    const droplet = tagMesh(
      new THREE.Mesh(new THREE.SphereGeometry(0.055 + (index % 4) * 0.012, 18, 12), dropletMaterial),
      `defeat-droplet-${index}`,
      index % 5 === 0 ? 'water-rim' : 'water-shell',
      'falling-defeat-droplet',
    );
    const angle = (index / 20) * Math.PI * 2;
    const start = new THREE.Vector3(
      Math.cos(angle) * (0.22 + (index % 5) * 0.12),
      0.74 - (index % 6) * 0.27,
      Math.sin(angle) * 0.24,
    );
    dropletStarts.push(start);
    droplet.position.copy(start);
    droplet.scale.set(0.72, 1.45 + (index % 3) * 0.25, 0.72);
    defeatDroplets.add(droplet);
  }
  root.add(defeatDroplets);

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = options.castShadow ?? true;
    object.receiveShadow = options.receiveShadow ?? true;
  });
  applyWaterwingAqueousLook(root, options);

  const nodes: Record<string, THREE.Object3D> = {
    root,
    'action-body': bodyGroup,
    'wing-left': leftWing,
    'wing-right': rightWing,
    'tail-leaf': tail,
    'impact-spray': impactSpray,
    'water-curtain': curtain,
    'defeat-droplets': defeatDroplets,
  };
  const meshes: Record<string, THREE.Mesh> = {
    body,
    'inner-water-vein': innerFlow,
    'eye-center': eye,
    'wing-left': leftWingMesh,
    'wing-right': rightWingMesh,
  };
  root.userData.sculptRuntime = { nodes, meshes, sockets: {}, colliders: {}, destructionGroups: {} };

  const update = (progress: number, context: DefeatContext = {}): void => {
    const hitStop = progress <= 0.11;
    const collapse = smoothRange(progress, 0.11, 0.72);
    const wingTension = 1 - smoothRange(progress, 0.12, 0.7);
    const curtainReveal = smoothRange(progress, 0.27, 0.52);
    const fall = smoothRange(progress, 0.28, 0.96);
    const fade = 1 - smoothRange(progress, 0.84, 1);

    bodyGroup.position.set(collapse * 0.14, -collapse * 0.42, collapse * -0.04);
    bodyGroup.rotation.set(collapse * -0.08, collapse * 0.08, 0.1 + collapse * 0.24);
    body.scale.set(1 - collapse * 0.2, 1 - collapse * 0.13, 1 - collapse * 0.12);
    innerFlow.scale.set(0.5 - collapse * 0.14, 1.25 - collapse * 0.42, 0.46 - collapse * 0.1);

    leftWing.rotation.set(collapse * 0.16, collapse * -0.18, THREE.MathUtils.lerp(0.08, 1.24, 1 - wingTension));
    rightWing.rotation.set(collapse * 0.16, collapse * 0.18, THREE.MathUtils.lerp(-0.08, -1.24, 1 - wingTension));
    leftWing.position.y = 0.2 - collapse * 0.44;
    rightWing.position.y = leftWing.position.y;
    leftWing.position.x = -0.38 + collapse * 0.08;
    rightWing.position.x = 0.38 - collapse * 0.08;

    tail.rotation.z = THREE.MathUtils.lerp(-0.04, 0.48, collapse);
    tail.rotation.x = collapse * -0.17;
    tail.position.y = -0.83 - collapse * 0.2;

    impactSpray.children.forEach((child, index) => {
      const droplet = child as THREE.Mesh;
      const direction = droplet.userData.direction as THREE.Vector3;
      const sprayProgress = smoothRange(progress, 0, 0.22);
      droplet.position.copy(direction).multiplyScalar(sprayProgress);
      droplet.position.z += 0.44;
      const life = 1 - smoothRange(progress, 0.16 + index * 0.004, 0.34 + index * 0.006);
      droplet.visible = life > 0.02;
      droplet.scale.setScalar(Math.max(0.03, life));
    });

    let visibleCurtainStrands = 0;
    curtain.children.forEach((child, index) => {
      const strand = child as THREE.Mesh;
      const base = strand.userData.basePosition as THREE.Vector3;
      const stagger = smoothRange(curtainReveal, index * 0.018, 0.58 + index * 0.018);
      strand.visible = stagger > 0.015 && fade > 0.008;
      strand.position.copy(base);
      strand.position.y -= fall * (0.58 + (index % 4) * 0.15);
      strand.position.x += Math.sin(progress * 5.2 + index * 0.91) * 0.045 * collapse;
      strand.scale.set(0.76 + (index % 2) * 0.2, 0.08 + stagger * (1.15 + (index % 3) * 0.16), 0.76);
      if (strand.visible) visibleCurtainStrands += 1;
    });

    let averageDropletY = 0;
    let visibleDropletCount = 0;
    defeatDroplets.children.forEach((child, index) => {
      const droplet = child as THREE.Mesh;
      const start = dropletStarts[index];
      const localFall = smoothRange(progress, 0.3 + (index % 5) * 0.012, 0.94 + (index % 5) * 0.008);
      droplet.position.copy(start);
      droplet.position.x += Math.sin(index * 1.7 + progress * 3.4) * localFall * 0.2;
      droplet.position.z += Math.cos(index * 1.23) * localFall * 0.18;
      droplet.position.y -= localFall * (1.45 + (index % 6) * 0.14);
      droplet.visible = curtainReveal > 0.05 && fade > 0.008;
      if (droplet.visible) {
        averageDropletY += droplet.position.y;
        visibleDropletCount += 1;
      }
    });
    averageDropletY = visibleDropletCount > 0 ? averageDropletY / visibleDropletCount : 0;

    setObjectFade(bodyGroup, fade);
    setObjectFade(leftWing, fade);
    setObjectFade(rightWing, fade);
    setObjectFade(tail, fade);
    setObjectFade(curtain, fade);
    setObjectFade(defeatDroplets, fade);

    root.userData.defeatState = {
      progress,
      frame: context.frame ?? null,
      hitStop,
      phase: hitStop ? 'hit-stop' : progress < 0.28 ? 'tension-loss' : progress < 0.84 ? 'waterfall-collapse' : 'dissolve',
      bodyTransform: [
        bodyGroup.position.x,
        bodyGroup.position.y,
        bodyGroup.position.z,
        bodyGroup.rotation.x,
        bodyGroup.rotation.y,
        bodyGroup.rotation.z,
      ],
      wingTension,
      visibleCurtainStrands,
      averageDropletY,
      visibleDropletCount,
      fade,
      fall,
    };
  };

  const runtime = attachActionContract(root, {
    actionId: 'defeat',
    durationSeconds: 2.4,
    anchors: {
      'health-anchor': [0, 1.46, 0],
      'muzzle-anchor': [0, 0.28, 0.72],
      'impact-anchor': [0, 0.1, 0.58],
      'waterline-anchor': [0, -1.18, 0],
    },
    update,
  });
  Object.assign(nodes, runtime.anchors);
  runtime.update(0, {});
  return root;
}

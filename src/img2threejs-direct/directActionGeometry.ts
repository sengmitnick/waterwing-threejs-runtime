import * as THREE from 'three';

import { applyWaterwingAqueousLook } from '../img2threejs-forward/applyWaterwingAqueousLook.ts';

export type WaterwingActionOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
};

export type DirectActionParts = {
  body: THREE.Mesh;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  tail: THREE.Mesh;
  eye: THREE.Mesh;
  innerFlow: THREE.Mesh;
  muzzleCharge: THREE.Mesh;
  releasedWater: THREE.Group;
  feederDroplets: THREE.Mesh[];
};

type DirectGeometryProfile = 'direct-charge-compact' | 'direct-cast-release';

function physical(color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0,
    transmission: 0.2,
    thickness: 0.32,
    ior: 1.333,
    clearcoat: 0.08,
  });
}

function mark(
  mesh: THREE.Mesh,
  id: string,
  material: 'water-shell' | 'wing-membrane' | 'inner-water' | 'eye-cyan' | 'water-rim',
): THREE.Mesh {
  mesh.name = id;
  mesh.userData.sculptComponent = { id, material, role: id };
  return mesh;
}

function createBody(profile: DirectGeometryProfile): THREE.Mesh {
  const points = profile === 'direct-charge-compact'
    ? [
      [0.045, -1.22], [0.18, -1.12], [0.42, -0.78], [0.61, -0.2],
      [0.65, 0.26], [0.54, 0.72], [0.28, 1.08], [0.09, 1.26], [0.02, 1.28],
    ]
    : [
      [0.04, -1.28], [0.16, -1.16], [0.38, -0.82], [0.57, -0.28],
      [0.62, 0.28], [0.5, 0.76], [0.25, 1.12], [0.075, 1.31], [0.018, 1.33],
    ];
  const geometry = new THREE.LatheGeometry(
    points.map(([radius, y]) => new THREE.Vector2(radius, y)),
    profile === 'direct-charge-compact' ? 48 : 56,
  );
  geometry.scale(1, 1, profile === 'direct-charge-compact' ? 0.88 : 0.82);
  geometry.computeVertexNormals();
  return mark(new THREE.Mesh(geometry, physical('#78949b')), 'body', 'water-shell');
}

function wingOutline(profile: DirectGeometryProfile): THREE.Vector2[] {
  if (profile === 'direct-charge-compact') {
    return [
      new THREE.Vector2(0, -0.12), new THREE.Vector2(0.48, -0.2),
      new THREE.Vector2(1.1, -0.33), new THREE.Vector2(1.55, -0.21),
      new THREE.Vector2(1.72, 0.08), new THREE.Vector2(1.5, 0.46),
      new THREE.Vector2(0.78, 0.35), new THREE.Vector2(0, 0.15),
    ];
  }
  return [
    new THREE.Vector2(0, -0.1), new THREE.Vector2(0.34, -0.18),
    new THREE.Vector2(0.76, -0.33), new THREE.Vector2(1.2, -0.36),
    new THREE.Vector2(1.58, -0.2), new THREE.Vector2(1.78, 0.04),
    new THREE.Vector2(1.61, 0.34), new THREE.Vector2(1.2, 0.48),
    new THREE.Vector2(0.58, 0.31), new THREE.Vector2(0, 0.13),
  ];
}

function createWing(profile: DirectGeometryProfile, side: -1 | 1): THREE.Mesh {
  let points = wingOutline(profile).map((point) => new THREE.Vector2(point.x * side, point.y));
  if (side < 0) points = points.reverse();
  const shape = new THREE.Shape(points);
  const depth = profile === 'direct-charge-compact' ? 0.34 : 0.3;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: profile === 'direct-charge-compact' ? 0.07 : 0.055,
    bevelSize: 0.055,
    bevelSegments: profile === 'direct-charge-compact' ? 3 : 2,
    curveSegments: profile === 'direct-charge-compact' ? 8 : 10,
  });
  geometry.translate(0, 0, -depth * 0.5);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  let maxAbsX = 0;
  for (let index = 0; index < position.count; index += 1) maxAbsX = Math.max(maxAbsX, Math.abs(position.getX(index)));
  for (let index = 0; index < position.count; index += 1) {
    const reach = Math.abs(position.getX(index)) / Math.max(1e-5, maxAbsX);
    const cup = profile === 'direct-charge-compact' ? 0.2 : -0.08;
    position.setZ(index, position.getZ(index) + cup * reach * reach);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return mark(
    new THREE.Mesh(geometry, physical('#8da3a9')),
    side < 0 ? 'wing-left' : 'wing-right',
    'wing-membrane',
  );
}

function createTail(profile: DirectGeometryProfile): THREE.Mesh {
  const points = profile === 'direct-charge-compact'
    ? [
      new THREE.Vector2(-0.11, 0.12), new THREE.Vector2(-0.27, -0.25),
      new THREE.Vector2(-0.23, -0.75), new THREE.Vector2(-0.06, -1.06),
      new THREE.Vector2(0.06, -1.06), new THREE.Vector2(0.25, -0.72),
      new THREE.Vector2(0.25, -0.25), new THREE.Vector2(0.11, 0.12),
    ]
    : [
      new THREE.Vector2(-0.1, 0.13), new THREE.Vector2(-0.24, -0.18),
      new THREE.Vector2(-0.28, -0.58), new THREE.Vector2(-0.15, -0.94),
      new THREE.Vector2(0, -1.16), new THREE.Vector2(0.17, -0.92),
      new THREE.Vector2(0.29, -0.53), new THREE.Vector2(0.22, -0.14),
      new THREE.Vector2(0.1, 0.13),
    ];
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), {
    depth: 0.25,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.035,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -0.125);
  geometry.computeVertexNormals();
  return mark(new THREE.Mesh(geometry, physical('#78949b')), 'tail-leaf', 'water-shell');
}

function createReleasedWater(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'released-water';
  const core = mark(
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 3), physical('#b6dce4')),
    'released-water-core',
    'water-rim',
  );
  core.scale.set(0.72, 0.82, 1.34);
  group.add(core);
  const offsets = [
    [-0.16, 0.08, -0.14], [0.14, -0.09, -0.2], [0.08, 0.17, -0.25],
  ];
  for (let index = 0; index < offsets.length; index += 1) {
    const droplet = mark(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.055 + index * 0.008, 2), physical('#b6dce4')),
      `released-water-droplet-${index}`,
      'water-rim',
    );
    droplet.position.fromArray(offsets[index] as [number, number, number]);
    droplet.scale.z = 1.35;
    group.add(droplet);
  }
  return group;
}

function configureAccentMaterial(mesh: THREE.Mesh, opacity: number, emissiveIntensity: number): void {
  const material = mesh.material;
  if (!(material instanceof THREE.MeshPhysicalMaterial)) return;
  material.emissive.set('#207d89');
  material.emissiveIntensity = emissiveIntensity;
  material.opacity = opacity;
  material.transparent = opacity < 1;
  material.depthWrite = opacity >= 1;
  material.needsUpdate = true;
}

export function createDirectActionGeometry(
  profile: DirectGeometryProfile,
  options: WaterwingActionOptions = {},
): { root: THREE.Group; parts: DirectActionParts } {
  const root = new THREE.Group();
  root.name = 'root';

  const body = createBody(profile);
  const leftWing = createWing(profile, -1);
  const rightWing = createWing(profile, 1);
  const tail = createTail(profile);
  leftWing.position.set(-0.33, 0.3, -0.02);
  rightWing.position.set(0.33, 0.3, -0.02);
  tail.position.set(0, -1.08, -0.08);

  const eye = mark(
    new THREE.Mesh(new THREE.SphereGeometry(0.076, 24, 16), physical('#6aeaf2')),
    'eye-center',
    'eye-cyan',
  );
  eye.position.set(0, 0.33, 0.56);

  const innerFlow = mark(
    new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.54, 8, 16), physical('#245f70')),
    'inner-water-vein',
    'inner-water',
  );
  innerFlow.position.set(0, -0.03, 0.23);
  innerFlow.scale.set(0.8, 1, 0.62);

  const muzzleCharge = mark(
    new THREE.Mesh(new THREE.IcosahedronGeometry(profile === 'direct-charge-compact' ? 0.31 : 0.28, 3), physical('#b6dce4')),
    'muzzle-charge',
    'water-rim',
  );
  muzzleCharge.position.set(0, 0.24, 0.88);

  const feederDroplets = Array.from({ length: 5 }, (_, index) => {
    const droplet = mark(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.045 + (index % 2) * 0.012, 2), physical('#8da3a9')),
      `muzzle-feeder-${index}`,
      'water-rim',
    );
    const angle = (index / 5) * Math.PI * 2;
    droplet.position.set(Math.cos(angle) * 0.58, 0.2 + Math.sin(angle) * 0.42, 0.48 - index * 0.025);
    root.add(droplet);
    return droplet;
  });

  const releasedWater = createReleasedWater();
  releasedWater.visible = false;
  root.add(body, leftWing, rightWing, tail, eye, innerFlow, muzzleCharge, releasedWater);

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = options.castShadow ?? true;
    object.receiveShadow = options.receiveShadow ?? true;
  });
  applyWaterwingAqueousLook(root, {
    textureSize: options.textureSize ?? 512,
    textureAnisotropy: options.textureAnisotropy ?? 8,
  });
  configureAccentMaterial(innerFlow, 0.34, 0.03);
  configureAccentMaterial(eye, 1, 0.5);
  configureAccentMaterial(muzzleCharge, 0.92, 0.15);
  releasedWater.traverse((object) => {
    if (object instanceof THREE.Mesh) configureAccentMaterial(object, 0.94, 0.08);
  });

  const parts: DirectActionParts = {
    body, leftWing, rightWing, tail, eye, innerFlow, muzzleCharge, releasedWater, feederDroplets,
  };
  root.userData.actionParts = parts;
  root.userData.actionGeometryProfile = profile;
  return { root, parts };
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

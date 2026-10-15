import * as THREE from 'three';

import { applyWaterwingAqueousLook } from '../img2threejs-forward/applyWaterwingAqueousLook.ts';

export type WaterwingLobActionOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
};

export type LobActionParts = {
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

type LobGeometryProfile = 'lob-charge-heavy' | 'lob-cast-high-release';

function physical(color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0,
    transmission: 0.2,
    thickness: 0.34,
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

function createBody(profile: LobGeometryProfile): THREE.Mesh {
  const points = profile === 'lob-charge-heavy'
    ? [
      [0.045, -1.27], [0.2, -1.15], [0.45, -0.76], [0.66, -0.16],
      [0.68, 0.38], [0.55, 0.84], [0.27, 1.17], [0.08, 1.34], [0.018, 1.36],
    ]
    : [
      [0.04, -1.3], [0.17, -1.18], [0.4, -0.82], [0.61, -0.23],
      [0.64, 0.35], [0.5, 0.83], [0.24, 1.2], [0.07, 1.38], [0.015, 1.4],
    ];
  const geometry = new THREE.LatheGeometry(
    points.map(([radius, y]) => new THREE.Vector2(radius, y)),
    profile === 'lob-charge-heavy' ? 52 : 60,
  );
  geometry.scale(profile === 'lob-charge-heavy' ? 1.04 : 0.98, 1, 0.88);
  geometry.computeVertexNormals();
  return mark(new THREE.Mesh(geometry, physical('#78949b')), 'body', 'water-shell');
}

function wingOutline(profile: LobGeometryProfile): THREE.Vector2[] {
  if (profile === 'lob-charge-heavy') {
    return [
      new THREE.Vector2(0, -0.12), new THREE.Vector2(0.38, -0.04),
      new THREE.Vector2(0.88, 0.1), new THREE.Vector2(1.38, 0.36),
      new THREE.Vector2(1.67, 0.76), new THREE.Vector2(1.48, 1.02),
      new THREE.Vector2(0.9, 0.77), new THREE.Vector2(0.36, 0.36),
      new THREE.Vector2(0, 0.15),
    ];
  }
  return [
    new THREE.Vector2(0, -0.11), new THREE.Vector2(0.3, -0.04),
    new THREE.Vector2(0.67, 0.08), new THREE.Vector2(1.02, 0.24),
    new THREE.Vector2(1.42, 0.52), new THREE.Vector2(1.72, 0.87),
    new THREE.Vector2(1.56, 1.09), new THREE.Vector2(1.08, 0.94),
    new THREE.Vector2(0.62, 0.61), new THREE.Vector2(0.22, 0.29),
    new THREE.Vector2(0, 0.14),
  ];
}

function createWing(profile: LobGeometryProfile, side: -1 | 1): THREE.Mesh {
  let points = wingOutline(profile).map((point) => new THREE.Vector2(point.x * side, point.y));
  if (side < 0) points = points.reverse();
  const depth = profile === 'lob-charge-heavy' ? 0.38 : 0.32;
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), {
    depth,
    bevelEnabled: true,
    bevelThickness: profile === 'lob-charge-heavy' ? 0.075 : 0.055,
    bevelSize: 0.055,
    bevelSegments: profile === 'lob-charge-heavy' ? 3 : 2,
    curveSegments: profile === 'lob-charge-heavy' ? 8 : 10,
  });
  geometry.translate(0, 0, -depth * 0.5);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  let maxAbsX = 0;
  for (let index = 0; index < position.count; index += 1) maxAbsX = Math.max(maxAbsX, Math.abs(position.getX(index)));
  for (let index = 0; index < position.count; index += 1) {
    const reach = Math.abs(position.getX(index)) / Math.max(1e-5, maxAbsX);
    const loadedDepth = profile === 'lob-charge-heavy' ? 0.16 : -0.04;
    position.setZ(index, position.getZ(index) + loadedDepth * reach * reach);
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

function createCounterweightTail(profile: LobGeometryProfile): THREE.Mesh {
  const points = profile === 'lob-charge-heavy'
    ? [
      new THREE.Vector2(-0.14, 0.15), new THREE.Vector2(-0.31, -0.2),
      new THREE.Vector2(-0.36, -0.64), new THREE.Vector2(-0.2, -1.05),
      new THREE.Vector2(0, -1.3), new THREE.Vector2(0.22, -1.02),
      new THREE.Vector2(0.37, -0.6), new THREE.Vector2(0.3, -0.17),
      new THREE.Vector2(0.14, 0.15),
    ]
    : [
      new THREE.Vector2(-0.12, 0.14), new THREE.Vector2(-0.28, -0.18),
      new THREE.Vector2(-0.33, -0.58), new THREE.Vector2(-0.22, -0.94),
      new THREE.Vector2(-0.04, -1.26), new THREE.Vector2(0.08, -1.35),
      new THREE.Vector2(0.25, -0.92), new THREE.Vector2(0.34, -0.5),
      new THREE.Vector2(0.26, -0.13), new THREE.Vector2(0.12, 0.14),
    ];
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), {
    depth: profile === 'lob-charge-heavy' ? 0.32 : 0.28,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.04,
    bevelSegments: 3,
  });
  geometry.translate(0, 0, profile === 'lob-charge-heavy' ? -0.16 : -0.14);
  geometry.computeVertexNormals();
  return mark(new THREE.Mesh(geometry, physical('#78949b')), 'tail-leaf', 'water-shell');
}

function createReleasedWater(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'released-water';
  const core = mark(
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 3), physical('#b6dce4')),
    'released-water-core',
    'water-rim',
  );
  core.scale.set(0.88, 1.1, 1.2);
  group.add(core);
  const offsets = [
    [-0.18, -0.1, -0.12], [0.16, -0.13, -0.18], [-0.07, -0.22, -0.25], [0.09, 0.17, -0.2],
  ];
  for (let index = 0; index < offsets.length; index += 1) {
    const droplet = mark(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.052 + (index % 2) * 0.012, 2), physical('#b6dce4')),
      `released-water-droplet-${index}`,
      'water-rim',
    );
    droplet.position.fromArray(offsets[index] as [number, number, number]);
    droplet.scale.set(0.9, 1.25, 0.9);
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

export function createLobActionGeometry(
  profile: LobGeometryProfile,
  options: WaterwingLobActionOptions = {},
): { root: THREE.Group; parts: LobActionParts } {
  const root = new THREE.Group();
  root.name = 'root';
  const body = createBody(profile);
  const leftWing = createWing(profile, -1);
  const rightWing = createWing(profile, 1);
  const tail = createCounterweightTail(profile);
  leftWing.position.set(-0.34, 0.31, -0.04);
  rightWing.position.set(0.34, 0.31, -0.04);
  tail.position.set(0, -1.1, -0.1);

  const eye = mark(
    new THREE.Mesh(new THREE.SphereGeometry(0.078, 24, 16), physical('#6aeaf2')),
    'eye-center',
    'eye-cyan',
  );
  eye.position.set(0, 0.35, 0.58);
  const innerFlow = mark(
    new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.62, 8, 18), physical('#245f70')),
    'inner-water-vein',
    'inner-water',
  );
  innerFlow.position.set(0, 0.04, 0.25);
  innerFlow.scale.set(0.82, 1, 0.62);

  const muzzleCharge = mark(
    new THREE.Mesh(new THREE.IcosahedronGeometry(profile === 'lob-charge-heavy' ? 0.36 : 0.32, 3), physical('#b6dce4')),
    'muzzle-charge',
    'water-rim',
  );
  muzzleCharge.position.set(0, 0.98, 0.72);

  const feederDroplets = Array.from({ length: 7 }, (_, index) => {
    const droplet = mark(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.046 + (index % 3) * 0.007, 2), physical('#8da3a9')),
      `muzzle-feeder-${index}`,
      'water-rim',
    );
    const angle = (index / 7) * Math.PI * 2;
    droplet.position.set(Math.cos(angle) * 0.72, 0.43 + Math.sin(angle) * 0.62, 0.34 - index * 0.018);
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
  configureAccentMaterial(muzzleCharge, 0.94, 0.14);
  releasedWater.traverse((object) => {
    if (object instanceof THREE.Mesh) configureAccentMaterial(object, 0.95, 0.08);
  });

  const parts: LobActionParts = {
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

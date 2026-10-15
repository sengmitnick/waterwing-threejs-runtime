import * as THREE from 'three';

import { createDropletGeometry } from './geometry/createDropletGeometry.js';

function wave3(x, y, z, seed) {
  return (
    Math.sin(x * 4.7 + seed * 1.31) * 0.075 +
    Math.sin(y * 6.1 - z * 2.3 + seed * 0.73) * 0.055 +
    Math.cos(z * 5.3 + x * 1.7 - seed * 0.41) * 0.045
  );
}

function createMassGeometry(owner) {
  const seed = owner === 'player' ? 2.17 : 5.43;
  const radialSegments = 36;
  const latitudeSegments = 22;
  const positions = [];
  const colors = [];
  const pulse = [];
  const impact = [];
  const lob = [];
  const indices = [];
  const scale = owner === 'player'
    ? new THREE.Vector3(0.66, 0.59, 0.94)
    : new THREE.Vector3(0.84, 0.77, 0.92);
  const colorDeep = new THREE.Color(owner === 'player' ? 0x6bcbd7 : 0x4aa5b7);
  const colorLight = new THREE.Color(owner === 'player' ? 0xe0fffb : 0xbff7f4);
  const color = new THREE.Color();

  function appendVertex(normal) {
    // Water should wobble subtly but still read as a continuous liquid mass.
    // The previous full wave amplitude made a faceted crystal silhouette.
    const irregular = 1 + wave3(normal.x, normal.y, normal.z, seed) * 0.4;
    const forwardSign = owner === 'player' ? -1 : 1;
    const forwardBias = 1 + Math.max(0, normal.z * forwardSign) * 0.055;
    const x = normal.x * scale.x * irregular;
    const y = normal.y * scale.y * irregular * (1 + 0.035 * Math.sin(normal.z * 8 + seed));
    const z = normal.z * scale.z * irregular * forwardBias;
    positions.push(x, y, z);

    const light = THREE.MathUtils.clamp(0.28 + 0.48 * (normal.y * 0.5 + 0.5) + 0.18 * Math.max(0, -normal.z), 0, 1);
    color.copy(colorDeep).lerp(colorLight, light);
    colors.push(color.r, color.g, color.b);

    const swell = 0.055 + wave3(normal.z, normal.x, normal.y, seed + 2.8) * 0.18;
    pulse.push(normal.x * swell, normal.y * swell, normal.z * swell);

    const impactAngle = Math.atan2(y, x);
    const impactLobe = Math.pow(0.5 + 0.5 * Math.sin(impactAngle * 5 + seed), 3);
    impact.push(
      x * (0.08 + impactLobe * 0.24),
      y * (0.06 + impactLobe * 0.2),
      -z * 0.78
    );
    lob.push(normal.x * 0.07, normal.y * 0.065, -normal.z * 0.055);
  }

  for (let latitude = 1; latitude < latitudeSegments; latitude += 1) {
    const theta = (latitude / latitudeSegments) * Math.PI;
    const ringRadius = Math.sin(theta);
    const normalY = Math.cos(theta);
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const phi = (radial / radialSegments) * Math.PI * 2;
      appendVertex(new THREE.Vector3(
        Math.cos(phi) * ringRadius,
        normalY,
        Math.sin(phi) * ringRadius
      ));
    }
  }

  const northIndex = positions.length / 3;
  appendVertex(new THREE.Vector3(0, 1, 0));
  const southIndex = positions.length / 3;
  appendVertex(new THREE.Vector3(0, -1, 0));

  const ringIndex = (latitude, radial) =>
    (latitude - 1) * radialSegments + ((radial + radialSegments) % radialSegments);
  for (let latitude = 1; latitude < latitudeSegments - 1; latitude += 1) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      const a = ringIndex(latitude, radial);
      const b = ringIndex(latitude, next);
      const c = ringIndex(latitude + 1, radial);
      const d = ringIndex(latitude + 1, next);
      indices.push(a, c, b, b, c, d);
    }
  }
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(northIndex, ringIndex(1, next), ringIndex(1, radial));
    indices.push(southIndex, ringIndex(latitudeSegments - 1, radial), ringIndex(latitudeSegments - 1, next));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.type = 'BufferGeometry';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const pulseAttribute = new THREE.Float32BufferAttribute(pulse, 3);
  pulseAttribute.name = 'pulse';
  const impactAttribute = new THREE.Float32BufferAttribute(impact, 3);
  impactAttribute.name = 'impact';
  const lobAttribute = new THREE.Float32BufferAttribute(lob, 3);
  lobAttribute.name = 'lob';
  geometry.morphAttributes.position = [pulseAttribute, impactAttribute, lobAttribute];
  geometry.morphTargetsRelative = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createProjectileMaterial(owner, opacity = 0.78) {
  return new THREE.MeshPhysicalMaterial({
    name: `${owner}-waterball-pbr`,
    color: owner === 'player' ? 0x78dbe4 : 0x3ca0b3,
    vertexColors: true,
    transparent: true,
    opacity,
    transmission: owner === 'player' ? 0.68 : 0.6,
    roughness: owner === 'player' ? 0.08 : 0.1,
    metalness: 0,
    ior: 1.333,
    thickness: owner === 'player' ? 0.3 : 0.46,
    attenuationColor: new THREE.Color(owner === 'player' ? 0x4a9fac : 0x236d83),
    attenuationDistance: owner === 'player' ? 4.1 : 3.5,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    depthWrite: false
  });
}

function directTrailLayout(owner) {
  const count = owner === 'player' ? 7 : 5;
  const behindSign = owner === 'player' ? 1 : -1;
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 2.399963229728653 + (owner === 'player' ? 0.37 : 0.91);
    const ring = 0.17 + (index % 3) * 0.055;
    const behind = behindSign * (0.72 + index * (owner === 'player' ? 0.12 : 0.13));
    return {
      position: new THREE.Vector3(
        Math.cos(angle) * ring,
        Math.sin(angle) * ring * 0.78,
        behind
      ),
      scale: (owner === 'player' ? 0.105 : 0.11) * (0.76 + (index % 4) * 0.09),
      rotation: angle * 0.23
    };
  });
}

function lobSatelliteLayout() {
  return Array.from({ length: 7 }, (_, index) => {
    const angle = index * 2.399963229728653 + 0.43;
    const ring = 0.98 + (index % 3) * 0.12;
    return {
      position: new THREE.Vector3(
        Math.cos(angle) * ring,
        Math.sin(angle) * ring * 0.9,
        -0.16 + (index % 4) * 0.11
      ),
      scale: 0.13 * (0.82 + (index % 4) * 0.08),
      rotation: angle * 0.31
    };
  });
}

function addDroplets(group, layout, geometry, material, prefix) {
  layout.forEach((entry, index) => {
    const droplet = new THREE.Mesh(geometry, material);
    droplet.name = `${prefix}-${String(index + 1).padStart(2, '0')}`;
    droplet.position.copy(entry.position);
    droplet.scale.set(entry.scale * 0.72, entry.scale, entry.scale * 0.68);
    droplet.rotation.set(0.18 * Math.sin(index), entry.rotation, 0.2 * Math.cos(index * 0.7));
    group.add(droplet);
  });
}

export function createWaterProjectile({ owner = 'enemy' } = {}) {
  if (owner !== 'player' && owner !== 'enemy') {
    throw new RangeError(`Unsupported projectile owner: ${owner}`);
  }

  const root = new THREE.Group();
  root.name = owner === 'player' ? 'WaterballPlayer' : 'WaterballEnemy';
  root.userData.owner = owner;

  const mass = new THREE.Mesh(
    createMassGeometry(owner),
    createProjectileMaterial(owner, owner === 'player' ? 0.6 : 0.64)
  );
  mass.name = 'water-mass';
  mass.updateMorphTargets();
  root.add(mass);

  const dropletGroup = new THREE.Group();
  dropletGroup.name = 'droplet-group';
  const dropletGeometry = createDropletGeometry({ radialSegments: 12, heightSegments: 8, seed: owner === 'player' ? 3 : 9 });
  const dropletMaterial = createProjectileMaterial(owner, owner === 'player' ? 0.54 : 0.58);
  const directTrail = new THREE.Group();
  directTrail.name = 'direct-trail';
  addDroplets(directTrail, directTrailLayout(owner), dropletGeometry, dropletMaterial, 'direct-drop');
  dropletGroup.add(directTrail);

  const lobSatellites = new THREE.Group();
  lobSatellites.name = 'lob-satellites';
  if (owner === 'enemy') {
    addDroplets(lobSatellites, lobSatelliteLayout(), dropletGeometry, dropletMaterial, 'lob-drop');
  }
  dropletGroup.add(lobSatellites);
  root.add(dropletGroup);

  const trailAnchor = new THREE.Object3D();
  trailAnchor.name = 'trail-anchor';
  trailAnchor.position.set(0, 0, owner === 'player' ? 1.34 : -1.28);
  root.add(trailAnchor);

  const impactAnchor = new THREE.Object3D();
  impactAnchor.name = 'impact-anchor';
  impactAnchor.position.set(0, 0, owner === 'player' ? -1.08 : 1.1);
  root.add(impactAnchor);

  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.name = 'muzzle-anchor';
  muzzleAnchor.position.set(0, 0, 0);
  root.add(muzzleAnchor);

  root.userData.forwardAxis = Object.freeze(owner === 'player' ? [0, 0, -1] : [0, 0, 1]);
  root.scale.setScalar(owner === 'player' ? 0.72 : 0.9);
  root.updateMatrixWorld(true);
  return root;
}

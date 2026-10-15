import * as THREE from 'three';

export type WaterPointLike = THREE.Vector3 | readonly [number, number, number];

export type WaterSurfaceStageOptions = {
  anchor?: WaterPointLike;
  surfaceNormal?: WaterPointLike;
  radius?: number;
  seed?: number;
  color?: THREE.ColorRepresentation;
};

export type WaterSurfaceChannels = {
  ripple?: number;
  depression?: number;
  crown?: number;
  foam?: number;
  mist?: number;
  anchor?: WaterPointLike;
  surfaceNormal?: WaterPointLike;
};

const UP = new THREE.Vector3(0, 1, 0);

export function waterVector(value: WaterPointLike | undefined, fallback: readonly [number, number, number]): THREE.Vector3 {
  if (value instanceof THREE.Vector3) return value.clone();
  return new THREE.Vector3(...(value ?? fallback));
}

export function clamp01(value: number): number {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

export function waterSmoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function waterBand(
  value: number,
  riseStart: number,
  riseEnd: number,
  fallStart: number,
  fallEnd: number,
): number {
  return waterSmoothstep(riseStart, riseEnd, value) * (1 - waterSmoothstep(fallStart, fallEnd, value));
}

function seededUnit(seed: number, index: number): number {
  const value = Math.sin((seed + 1) * 91.713 + (index + 1) * 43.117) * 43758.5453123;
  return value - Math.floor(value);
}

function createLocalSurfaceArcGeometry(
  radius: number,
  width: number,
  seed: number,
  segments = 24,
  angularSpan = 0.9,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const startAngle = seededUnit(seed + 11, 0) * Math.PI * 2;
  for (let index = 0; index <= segments; index += 1) {
    const arcT = index / segments;
    const angle = startAngle
      + (arcT - 0.5) * angularSpan
      + 0.035 * Math.sin(arcT * Math.PI * 3 + seed * 0.29);
    const radialNoise = 1
      + 0.07 * Math.sin(angle * 3 + seed * 0.71)
      + 0.036 * Math.cos(angle * 5 - seed * 0.43)
      + 0.018 * Math.sin(angle * 9 + seed * 1.17);
    const centerRadius = radius * radialNoise;
    const localWidth = width * (
      0.72
      + 0.2 * Math.sin(angle * 4 - seed * 0.63)
      + 0.08 * Math.cos(angle * 7 + seed * 0.29)
    );
    const lift = radius * (
      0.0025
      + 0.005 * Math.sin(angle * 2 + seed * 0.41)
      + 0.0025 * Math.cos(angle * 6 - seed * 0.37)
    );
    const innerRadius = centerRadius - localWidth * 0.5;
    const outerRadius = centerRadius + localWidth * 0.5;
    positions.push(Math.cos(angle) * innerRadius, lift, Math.sin(angle) * innerRadius);
    positions.push(Math.cos(angle) * outerRadius, lift + radius * 0.0015, Math.sin(angle) * outerRadius);
    if (index < segments) {
      const offset = index * 2;
      indices.push(offset, offset + 3, offset + 1, offset, offset + 2, offset + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.waterSurfaceWave = true;
  geometry.userData.closedLoop = false;
  geometry.userData.openArc = true;
  geometry.userData.angularSpan = angularSpan;
  geometry.userData.seed = seed;
  return geometry;
}

export function createEventWaterGeometry(
  radius = 1,
  scale: readonly [number, number, number] = [1, 1, 1],
  seed = 0,
  widthSegments = 28,
  heightSegments = 18,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const length = Math.max(1e-6, Math.hypot(x, y, z));
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const ripple = 1
      + 0.035 * Math.sin(nx * 3.1 + ny * 2.2 - nz * 2.7 + seed * 0.83)
      + 0.018 * Math.cos(nx * 6.2 - ny * 4.3 + nz * 3.8 + seed * 1.37);
    position.setXYZ(index, x * ripple * scale[0], y * ripple * scale[1], z * ripple * scale[2]);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.waterEventGeometry = true;
  geometry.userData.seed = seed;
  return geometry;
}

export function createEventWaterMaterial(
  opacity = 0.78,
  color: THREE.ColorRepresentation = '#9adfe9',
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.075,
    metalness: 0,
    transmission: 0.9,
    thickness: 0.34,
    ior: 1.333,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    attenuationColor: new THREE.Color('#70c7d6'),
    attenuationDistance: 2.6,
    emissive: new THREE.Color('#286f80'),
    emissiveIntensity: 0.055,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createFoamMaterial(opacity = 0.65): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: '#d9fbff',
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

function createSurfaceWaveMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: '#bcecf1',
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}

function orientToNormal(object: THREE.Object3D, normal: THREE.Vector3): void {
  const resolved = normal.lengthSq() > 1e-10 ? normal.normalize() : UP.clone();
  object.quaternion.setFromUnitVectors(UP, resolved);
}

export function createWaterSurfaceStage(options: WaterSurfaceStageOptions = {}): THREE.Group {
  const radius = Math.max(0.25, options.radius ?? 1.7);
  const seed = options.seed ?? 0;
  const color = options.color ?? '#98dce7';
  const anchor = waterVector(options.anchor, [0, 0, 0]);
  const normal = waterVector(options.surfaceNormal, [0, 1, 0]).normalize();

  const root = new THREE.Group();
  root.name = 'water-surface-stage';
  root.position.copy(anchor);
  orientToNormal(root, normal);

  const anchorNode = new THREE.Object3D();
  anchorNode.name = 'water-surface-anchor';
  anchorNode.userData.role = 'surface-anchor';
  root.add(anchorNode);

  const planeMaterial = createEventWaterMaterial(0.11, color);
  planeMaterial.transmission = 0.96;
  planeMaterial.thickness = 0.04;
  const plane = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), planeMaterial);
  plane.name = 'water-surface-plane';
  plane.rotation.x = -Math.PI / 2;
  plane.visible = false;
  plane.renderOrder = 1;
  root.add(plane);

  const depression = new THREE.Group();
  depression.name = 'water-surface-depression';
  const depressionSlices = [
    { radius: 0.16, width: 0.075, x: -0.055, z: 0.018, rotation: -0.16 },
    { radius: 0.27, width: 0.062, x: 0.04, z: -0.035, rotation: 0.23 },
    { radius: 0.39, width: 0.048, x: -0.02, z: 0.055, rotation: -0.31 },
  ];
  depressionSlices.forEach((slice, index) => {
    const disturbance = new THREE.Mesh(
      createLocalSurfaceArcGeometry(
        radius * slice.radius,
        radius * slice.width,
        seed + 3 + index * 11,
        22,
        0.62 + index * 0.16,
      ),
      createSurfaceWaveMaterial(0.08 - index * 0.012),
    );
    disturbance.name = `water-surface-depression-slice-${index + 1}`;
    disturbance.position.set(radius * slice.x, index * 0.002, radius * slice.z);
    disturbance.rotation.y = slice.rotation;
    depression.add(disturbance);
  });
  depression.position.y = 0.004;
  depression.renderOrder = 2;
  root.add(depression);

  const ripples = new THREE.Group();
  ripples.name = 'water-surface-ripples';
  const rippleRadiusFractions = [0.2, 0.37, 0.58];
  const rippleArcSpans = [0.72, 1.06, 0.58];
  for (let index = 0; index < 3; index += 1) {
    const wave = new THREE.Mesh(
      createLocalSurfaceArcGeometry(
        radius * rippleRadiusFractions[index],
        radius * (0.035 - index * 0.004),
        seed + 61 + index * 7,
        24,
        rippleArcSpans[index],
      ),
      createSurfaceWaveMaterial(0.13 - index * 0.02),
    );
    wave.name = `water-surface-ripple-${index + 1}`;
    wave.position.set(
      radius * (seededUnit(seed + 67, index) - 0.5) * 0.075,
      0.009 + index * 0.003,
      radius * (seededUnit(seed + 71, index) - 0.5) * 0.075,
    );
    wave.userData.axisBias = (seededUnit(seed + 73, index) - 0.5) * 0.08;
    wave.renderOrder = 3;
    ripples.add(wave);
  }
  root.add(ripples);

  const crown = new THREE.Group();
  crown.name = 'water-surface-crown';
  const crownRing = new THREE.Mesh(
    createLocalSurfaceArcGeometry(radius * 0.27, radius * 0.07, seed + 83, 28, 1.08),
    createSurfaceWaveMaterial(0.18),
  );
  crownRing.name = 'water-surface-crown-ring';
  crown.add(crownRing);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + seededUnit(seed, index) * 0.16;
    const spike = new THREE.Mesh(
      createEventWaterGeometry(radius * (0.035 + seededUnit(seed + 7, index) * 0.018), [0.72, 2.5, 0.72], seed + index + 11, 16, 10),
      createEventWaterMaterial(0.72, color),
    );
    spike.name = `water-surface-crown-spike-${index + 1}`;
    spike.position.set(Math.cos(angle) * radius * 0.27, radius * 0.08, Math.sin(angle) * radius * 0.27);
    crown.add(spike);
  }
  crown.position.y = 0.016;
  crown.renderOrder = 4;
  root.add(crown);

  const foam = new THREE.Group();
  foam.name = 'water-surface-foam';
  for (let index = 0; index < 8; index += 1) {
    const angle = index * 2.3999632297 + seededUnit(seed + 19, index) * 0.55;
    const distance = radius * (0.15 + seededUnit(seed + 23, index) * 0.27);
    const bead = new THREE.Mesh(
      createEventWaterGeometry(radius * (0.018 + seededUnit(seed + 29, index) * 0.02), [1.55, 0.24, 0.8], seed + 31 + index, 14, 9),
      createFoamMaterial(0.38),
    );
    bead.name = `water-surface-foam-bead-${index + 1}`;
    bead.position.set(Math.cos(angle) * distance, 0.018, Math.sin(angle) * distance);
    bead.rotation.y = -angle;
    foam.add(bead);
  }
  root.add(foam);

  const mist = new THREE.Group();
  mist.name = 'water-surface-mist';
  for (let index = 0; index < 10; index += 1) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(radius * (0.018 + seededUnit(seed + 41, index) * 0.018), 12, 8),
      createFoamMaterial(0.22),
    );
    particle.name = `water-surface-mist-${index + 1}`;
    particle.userData.angle = seededUnit(seed + 43, index) * Math.PI * 2;
    particle.userData.distance = radius * (0.08 + seededUnit(seed + 47, index) * 0.27);
    particle.userData.lift = radius * (0.06 + seededUnit(seed + 53, index) * 0.2);
    mist.add(particle);
  }
  root.add(mist);

  const runtime = {
    actionId: 'water-surface-stage',
    deterministic: true,
    update(progress: number, channels: WaterSurfaceChannels = {}) {
      const t = clamp01(progress);
      const resolved = {
        ripple: clamp01(channels.ripple ?? 0),
        depression: clamp01(channels.depression ?? 0),
        crown: clamp01(channels.crown ?? 0),
        foam: clamp01(channels.foam ?? 0),
        mist: clamp01(channels.mist ?? 0),
      };
      if (channels.anchor) {
        root.position.copy(waterVector(channels.anchor, root.position.toArray() as [number, number, number]));
      }
      if (channels.surfaceNormal) {
        orientToNormal(root, waterVector(channels.surfaceNormal, [0, 1, 0]));
      }

      plane.scale.setScalar(1 + resolved.ripple * 0.055);
      plane.visible = false;
      planeMaterial.opacity = 0;

      depression.visible = resolved.depression > 0.001;
      depression.scale.set(
        0.52 + resolved.depression * 0.68,
        1,
        0.48 + resolved.depression * 0.62,
      );
      depression.position.y = -radius * resolved.depression * 0.012;
      depression.children.forEach((child, index) => {
        const material = (child as THREE.Mesh).material as THREE.Material;
        material.opacity = resolved.depression * (0.08 - index * 0.012);
      });

      ripples.visible = resolved.ripple > 0.001;
      ripples.children.forEach((child, index) => {
        const wave = clamp01(resolved.ripple * 1.22 - index * 0.14);
        const outward = 0.72 + wave * (0.55 + index * 0.18) + t * resolved.ripple * 0.055;
        const axisBias = child.userData.axisBias as number;
        child.scale.set(outward * (1 + axisBias), 1, outward * (1 - axisBias));
        const material = (child as THREE.Mesh).material as THREE.Material;
        material.opacity = wave * (0.13 - index * 0.02);
      });

      crown.visible = resolved.crown > 0.001;
      crown.scale.set(0.65 + resolved.crown * 0.55, 0.08 + resolved.crown * 0.92, 0.65 + resolved.crown * 0.55);
      crown.children.forEach((child, index) => {
        const material = (child as THREE.Mesh).material as THREE.Material;
        material.opacity = resolved.crown * (index === 0 ? 0.18 : 0.58);
      });

      foam.visible = resolved.foam > 0.001;
      foam.children.forEach((child, index) => {
        const flutter = 1 + 0.08 * Math.sin(t * Math.PI * 2 + index * 1.7);
        child.scale.setScalar((0.42 + resolved.foam * 0.74) * flutter);
        ((child as THREE.Mesh).material as THREE.Material).opacity = resolved.foam * (0.28 + (index % 3) * 0.035);
      });

      mist.visible = resolved.mist > 0.001;
      mist.children.forEach((child, index) => {
        const angle = child.userData.angle as number;
        const distance = child.userData.distance as number;
        const lift = child.userData.lift as number;
        const drift = t * (0.1 + (index % 4) * 0.025);
        child.position.set(
          Math.cos(angle) * distance * (0.65 + resolved.mist * 0.55),
          lift * resolved.mist + drift,
          Math.sin(angle) * distance * (0.65 + resolved.mist * 0.55),
        );
        child.scale.setScalar(0.45 + resolved.mist * 0.72);
        ((child as THREE.Mesh).material as THREE.Material).opacity = resolved.mist * (0.13 + (index % 3) * 0.025);
      });

      root.userData.surfaceState = {
        progress: t,
        anchor: root.position.toArray(),
        normal: new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion).normalize().toArray(),
        channels: resolved,
      };
      return runtime;
    },
  };

  root.userData.surfaceRuntime = runtime;
  root.userData.surfaceContract = {
    deterministic: true,
    hasSurfaceAnchor: true,
    hasPlaneProxy: true,
    worldTranslationOwnedByCaller: true,
    channels: ['ripple', 'depression', 'crown', 'foam', 'mist'],
  };
  runtime.update(0);
  return root;
}

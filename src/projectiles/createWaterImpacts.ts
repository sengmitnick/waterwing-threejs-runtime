import * as THREE from 'three';

import { createIrregularWaterGeometry } from './createWaterProjectileCore';

function impactMaterial(opacity: number, lens = false): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: lens ? '#e9fbfc' : '#a9e3e9',
    roughness: lens ? 0.09 : 0.16,
    metalness: 0,
    transmission: lens ? 0.96 : 0.78,
    thickness: lens ? 0.012 : 0.065,
    ior: 1.333,
    clearcoat: lens ? 0.52 : 0.72,
    clearcoatRoughness: lens ? 0.07 : 0.08,
    attenuationColor: lens ? '#efffff' : '#9bdde3',
    attenuationDistance: lens ? 7.4 : 3.2,
    emissive: lens ? '#86b5b8' : '#69bec8',
    emissiveIntensity: lens ? 0.012 : 0.04,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function deterministicUnit(seed: number, index: number): number {
  const value = Math.sin((seed + 5) * 61.73 + (index + 3) * 37.19) * 18973.412;
  return value - Math.floor(value);
}

function setMeshOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.opacity = Math.max(0, opacity);
      material.needsUpdate = true;
    });
  });
}

function createCurtainGeometry(): THREE.BufferGeometry {
  const columns = 12;
  const rows = 5;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const edgeTaper = Math.sin(u * Math.PI) ** 0.42;
      const rowWidth = 2.66 * (
        0.94
        + 0.07 * Math.sin(v * Math.PI * 2 + 0.35)
        + 0.04 * Math.cos(v * Math.PI * 4 - 0.2)
      );
      const halfHeight = (
        0.43
        + 0.065 * Math.sin(u * Math.PI * 5 + 0.45)
        + 0.035 * Math.sin(u * Math.PI * 11 - 0.65)
      ) * edgeTaper;
      const centreLift = edgeTaper * (
        0.045 * Math.sin(u * Math.PI * 3.4 - 0.25)
        + 0.022 * Math.cos(u * Math.PI * 8.2 + 0.5)
      );
      positions.push(
        (u - 0.5) * rowWidth,
        centreLift + (v - 0.5) * 2 * halfHeight,
        0.026 * Math.sin(u * Math.PI * 4.2 + v * 2.6)
          + 0.014 * Math.cos(v * Math.PI * 4.4 - u * 1.7),
      );
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.surfaceFinish = 'scalloped-thin-lens-splash';
  geometry.userData.edgeProfile = 'broken-splash-lobes';
  geometry.userData.gridColumns = columns;
  geometry.userData.gridRows = rows;
  return geometry;
}

function createOpenLensStreakGeometry(
  length: number,
  width: number,
  seed: number,
  segments = 8,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const curvatureRatio = 0.052 + deterministicUnit(seed, 2) * 0.043;
  const curveDirection = deterministicUnit(seed, 4) > 0.5 ? 1 : -1;
  const widthVariation = 0.28 + deterministicUnit(seed, 6) * 0.22;
  const terminalBeadRatio = 0.24 + deterministicUnit(seed, 8) * 0.16;
  for (let segment = 0; segment <= segments; segment += 1) {
    const u = segment / segments;
    const bell = Math.sin(u * Math.PI) ** 0.64;
    const necking = 1 - widthVariation * (
      0.5 + 0.5 * Math.sin(u * Math.PI * 2.6 + seed * 0.47)
    );
    const terminalBead = terminalBeadRatio * Math.exp(-(((u - 0.78) / 0.115) ** 2));
    const taper = (0.08 + bell * 0.92) * necking + terminalBead;
    const bend = curveDirection * length * curvatureRatio * (
      Math.sin(u * Math.PI * 0.86) ** 1.25
      + 0.2 * Math.sin(u * Math.PI * 2.2 + seed * 0.31) * bell
    );
    const ripple = Math.sin(u * Math.PI * 2.3 + seed * 0.53) * width * 0.16;
    for (const side of [-1, 1]) {
      positions.push(
        u * length,
        bend + side * width * taper,
        ripple + side * width * 0.028,
      );
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const a = segment * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.surfaceFinish = 'open-lens-water-streak';
  geometry.userData.openSplashFragment = true;
  geometry.userData.pathStyle = 'curved-variable-width-runoff';
  geometry.userData.curvatureAmplitude = curvatureRatio;
  geometry.userData.widthVariation = widthVariation;
  geometry.userData.terminalBeadRatio = terminalBeadRatio;
  geometry.userData.seed = seed;
  return geometry;
}

function createLensDropletGeometry(
  width: number,
  height: number,
  seed: number,
): THREE.BufferGeometry {
  const boundaryCount = 13;
  const positions: number[] = [0, -height * 0.08, 0.006];
  const indices: number[] = [];
  const asymmetry = 0.2 + deterministicUnit(seed, 1) * 0.2;
  const lean = (deterministicUnit(seed, 3) - 0.5) * width * 0.42;
  for (let index = 0; index < boundaryCount; index += 1) {
    const angle = index / boundaryCount * Math.PI * 2;
    const vertical = Math.cos(angle);
    const horizontal = Math.sin(angle);
    const lowerBulb = 0.72 + 0.28 * (1 - vertical) * 0.5;
    const topNeck = vertical > 0 ? 0.16 + 0.84 * (1 - vertical) ** 0.72 : 1;
    const contourNoise = 0.86
      + 0.1 * Math.sin(angle * 3 + seed * 0.37)
      + 0.055 * Math.sin(angle * 5 - seed * 0.21);
    const y01 = (1 - vertical) * 0.5;
    const x = horizontal * width * lowerBulb * topNeck * contourNoise
      + lean * (0.1 + y01 * 0.9)
      + asymmetry * width * 0.16 * Math.sin(angle * 2.1 + seed);
    const y = vertical * height * (0.5 + 0.04 * Math.sin(angle * 3.7 + seed * 0.2))
      - height * 0.055;
    const z = 0.004 + 0.009 * Math.sin(angle * 2 + seed * 0.33);
    positions.push(x, y, z);
  }
  for (let index = 0; index < boundaryCount; index += 1) {
    indices.push(0, 1 + index, 1 + ((index + 1) % boundaryCount));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.surfaceFinish = 'broken-hanging-water-drop';
  geometry.userData.silhouette = 'asymmetric-teardrop';
  geometry.userData.contourId = `tear-${seed}-${Math.round(width * 1000)}-${Math.round(height * 1000)}`;
  geometry.userData.asymmetry = asymmetry;
  return geometry;
}

function createLensStreakMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: '#efffff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

function createLensOverlayMaterial(opacity = 0): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: '#f3ffff',
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

function createLensSheenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Lens water sheen requires a 2D canvas context');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // One connected diagonal film with scalloped, broken banks instead of parallel scratches.
  context.fillStyle = 'rgb(96, 96, 96)';
  context.beginPath();
  context.moveTo(-18, 12);
  context.bezierCurveTo(22, 4, 55, 18, 91, 30);
  context.bezierCurveTo(121, 40, 145, 43, 178, 58);
  context.lineTo(178, 75);
  context.bezierCurveTo(145, 64, 119, 62, 86, 49);
  context.bezierCurveTo(48, 34, 18, 34, -18, 43);
  context.closePath();
  context.fill();

  context.fillStyle = '#000';
  for (let index = 0; index < 9; index += 1) {
    const x = -4 + index * 22 + 5 * Math.sin(index * 1.8);
    const y = 24 + index * 4.1 + 4 * Math.cos(index * 1.37);
    const radius = 2.5 + (index % 3) * 1.7;
    context.beginPath();
    context.moveTo(x - radius * 1.4, y);
    context.quadraticCurveTo(x - radius * 0.3, y - radius * 1.15, x + radius * 0.45, y - radius * 0.42);
    context.quadraticCurveTo(x + radius * 1.4, y + radius * 0.25, x + radius * 0.2, y + radius * 0.86);
    context.quadraticCurveTo(x - radius * 0.72, y + radius * 0.7, x - radius * 1.4, y);
    context.fill();
  }

  for (let index = 0; index < 7; index += 1) {
    const startX = -10 + index * 14;
    const startY = 15 + index * 5.4 + 2.5 * Math.sin(index * 1.4);
    const intensity = 118 + (index % 3) * 30;
    context.strokeStyle = `rgb(${intensity}, ${intensity}, ${intensity})`;
    context.lineWidth = 1.2 + (index % 4) * 0.48;
    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + 28,
      startY - 5 - (index % 2) * 4,
      startX + 52,
      startY + 13 + (index % 3) * 2,
      startX + 88,
      startY + 16,
    );
    context.bezierCurveTo(
      startX + 109,
      startY + 18 + (index % 2) * 5,
      startX + 132,
      startY + 28 - (index % 3) * 3,
      startX + 162,
      startY + 25,
    );
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.userData.pattern = 'deterministic-broken-diagonal-water-film-v2';
  texture.needsUpdate = true;
  return texture;
}

function createLensImpact(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'lens-impact';

  const curtain = new THREE.Mesh(createCurtainGeometry(), impactMaterial(0, true));
  curtain.name = 'lens-water-curtain';
  curtain.rotation.z = -0.42;
  root.add(curtain);

  const sheenMaterial = createLensOverlayMaterial(0);
  sheenMaterial.alphaMap = createLensSheenTexture();
  sheenMaterial.needsUpdate = true;
  const sheen = new THREE.Mesh(curtain.geometry.clone(), sheenMaterial);
  sheen.name = 'lens-water-sheen';
  sheen.rotation.z = -0.42;
  sheen.position.z = 0.004;
  sheen.renderOrder = curtain.renderOrder + 1;
  root.add(sheen);

  const droplets = new THREE.Group();
  droplets.name = 'lens-sparse-droplets';
  const dropletSeeds = [
    { x: -1.05, y: 0.36, z: 0.03, width: 0.052, height: 0.15, rotation: 0.18, fadeStart: 0.82, fadeEnd: 0.98 },
    { x: -0.72, y: -0.54, z: 0.01, width: 0.078, height: 0.105, rotation: -0.31, fadeStart: 0.45, fadeEnd: 0.64 },
    { x: -0.38, y: 0.62, z: -0.01, width: 0.048, height: 0.135, rotation: 0.37, fadeStart: 0.48, fadeEnd: 0.67 },
    { x: 0.52, y: -0.58, z: 0.02, width: 0.095, height: 0.115, rotation: -0.12, fadeStart: 0.44, fadeEnd: 0.63 },
    { x: 0.84, y: 0.34, z: -0.02, width: 0.062, height: 0.102, rotation: 0.29, fadeStart: 0.5, fadeEnd: 0.69 },
    { x: 1.14, y: -0.16, z: 0, width: 0.044, height: 0.122, rotation: -0.24, fadeStart: 0.82, fadeEnd: 0.98 },
    { x: -1.24, y: -0.08, z: 0.015, width: 0.082, height: 0.11, rotation: 0.08, fadeStart: 0.46, fadeEnd: 0.66 },
    { x: 1.02, y: 0.62, z: -0.015, width: 0.049, height: 0.16, rotation: -0.38, fadeStart: 0.49, fadeEnd: 0.68 },
  ] as const;
  dropletSeeds.forEach((seed, index) => {
    const mesh = new THREE.Mesh(
      createLensDropletGeometry(seed.width, seed.height, 90 + index),
      createLensOverlayMaterial(0),
    );
    mesh.name = `lens-droplet-${index + 1}`;
    droplets.add(mesh);
  });
  root.add(droplets);

  const mist = new THREE.Group();
  mist.name = 'lens-edge-mist';
  const edgeStreakSeeds = Array.from({ length: 12 }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const lane = Math.floor(index / 2);
    const lingers = index === 1 || index === 6 || index === 10;
    const downwardAngle = lingers ? 1.15 : 0.58 + lane * 0.045;
    return {
      side,
      x: 0.78 + lane * 0.075,
      y: -0.66 + lane * 0.245 + side * 0.05,
      length: 0.21 + (index % 4) * 0.052 + lane * 0.008,
      width: (0.004 + (index % 5) * 0.00105) * (lingers ? 1.62 : 1),
      angle: side > 0 ? -downwardAngle : Math.PI + downwardAngle,
      fadeStart: lingers ? 0.82 : 0.43 + (index % 3) * 0.025,
      fadeEnd: lingers ? 0.98 : 0.61 + (index % 3) * 0.035,
    };
  });
  edgeStreakSeeds.forEach((entry, index) => {
    const mesh = new THREE.Mesh(
      createOpenLensStreakGeometry(entry.length, entry.width, 118 + index),
      createLensStreakMaterial(),
    );
    mesh.name = `lens-edge-mist-${index + 1}`;
    mesh.rotation.z = entry.angle;
    mist.add(mesh);
  });
  root.add(mist);

  const durationSeconds = 0.86;
  const zAxis = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3();
  const runtime = {
    kind: 'lens-impact' as const,
    durationSeconds,
    deterministic: true,
    update(progress: number, context: {
      impactPoint?: readonly [number, number, number];
      normal?: readonly [number, number, number];
      impulse?: readonly [number, number, number];
    } = {}) {
      const t = THREE.MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
      root.visible = t < 1;
      root.position.fromArray(context.impactPoint ?? [0, 0, 0]);
      root.scale.set(1, 1, 1);
      normal.fromArray(context.normal ?? [0, 0, 1]);
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
      normal.normalize();
      root.quaternion.setFromUnitVectors(zAxis, normal);

      const enter = smoothstep(0, 0.14, t);
      const curtainExit = 1 - smoothstep(0.4, 0.58, t);
      const curtainOpacity = 0.095 * enter * curtainExit;
      const sheenOpacity = 0.095 * enter * curtainExit;
      curtain.visible = curtainOpacity > 0.001;
      sheen.visible = sheenOpacity > 0.001;
      curtain.position.set(THREE.MathUtils.lerp(0.24, -0.16, t), 0.02 + 0.08 * Math.sin(t * Math.PI), 0);
      curtain.rotation.set(0.08 * Math.sin(t * Math.PI), 0, -0.42 + 0.12 * t);
      curtain.scale.set(
        THREE.MathUtils.lerp(0.68, 1.22, smoothstep(0, 0.58, t)),
        THREE.MathUtils.lerp(0.46, 0.86, smoothstep(0, 0.52, t)),
        1,
      );
      setMeshOpacity(curtain, curtainOpacity);
      sheen.position.copy(curtain.position);
      sheen.position.z += 0.004;
      sheen.rotation.copy(curtain.rotation);
      sheen.scale.copy(curtain.scale);
      setMeshOpacity(sheen, sheenOpacity);

      let maximumDropletOpacity = 0;
      droplets.children.forEach((child, index) => {
        const entry = dropletSeeds[index];
        const drift = 0.28 + 0.035 * (index % 3);
        child.position.set(
          entry.x + Math.sign(entry.x || 1) * drift * t,
          entry.y - (0.1 + 0.022 * index) * t - 0.22 * t * t,
          entry.z + 0.025 * Math.sin(t * Math.PI + index),
        );
        child.rotation.set(0.03 * Math.sin(t * Math.PI), 0, entry.rotation + 0.08 * Math.sin(t * Math.PI + index));
        child.scale.setScalar(0.76 + 0.38 * Math.sin(Math.min(1, t / 0.72) * Math.PI * 0.72));
        const fade = enter * (1 - smoothstep(entry.fadeStart, entry.fadeEnd, t));
        const opacity = (0.058 + 0.009 * (index % 3)) * fade;
        maximumDropletOpacity = Math.max(maximumDropletOpacity, opacity);
        setMeshOpacity(child, opacity);
      });

      const mistEnter = smoothstep(0.06, 0.2, t);
      let maximumMistOpacity = 0;
      mist.children.forEach((child, index) => {
        const entry = edgeStreakSeeds[index];
        child.position.set(
          entry.side * (entry.x + 0.3 * t),
          entry.y - 0.12 * t - 0.1 * t * t,
          -0.025 + 0.012 * Math.sin(t * Math.PI + index * 0.7),
        );
        child.rotation.set(0, 0, entry.angle + entry.side * 0.055 * Math.sin(t * Math.PI));
        child.scale.set(0.76 + 0.48 * t, 0.7 + 0.2 * t, 1);
        const fade = mistEnter * (1 - smoothstep(entry.fadeStart, entry.fadeEnd, t));
        const opacity = (0.12 + 0.006 * (index % 5)) * fade;
        maximumMistOpacity = Math.max(maximumMistOpacity, opacity);
        setMeshOpacity(child, opacity);
      });

      root.userData.impactState = {
        progress: t,
        visible: root.visible,
        centerCoverage: 0.48 * enter * curtainExit,
        compositedOpacityBudget: Math.max(
          curtainOpacity + sheenOpacity,
          maximumDropletOpacity + maximumMistOpacity,
        ),
      };
      return runtime;
    },
  };
  root.userData.impactRuntime = runtime;
  root.userData.impactContract = {
    volumetricFragments: true,
    planePlate: false,
    ring: false,
    deterministicLifetime: true,
    maximumOpacity: 0.095,
    continuousDiagonalCurtain: true,
    centerClearsEarly: true,
    sparseDroplets: true,
    opacityBudget: 0.32,
    highTransmission: true,
    brokenSplashEdges: true,
    edgeStreaks: true,
    backgroundIndependentSheen: true,
    naturalDropletContours: true,
    curvedRunoff: true,
    lateEdgeResidueOnly: true,
  };
  runtime.update(0);
  return root;
}

function createWaterSlashGeometry(width: number, height: number, depth: number, seed: number): THREE.BufferGeometry {
  const columns = 24;
  const rows = 4;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows * 2 - 1;
    for (let column = 0; column <= columns; column += 1) {
      const s = column / columns;
      const u = s * 2 - 1;
      const endTaper = Math.sin(s * Math.PI) ** 0.56;
      const tornWidth = 0.8
        + 0.12 * Math.sin(column * 1.31 + seed * 0.7)
        + 0.065 * Math.sin(column * 2.77 - seed * 0.31);
      const bandHalf = height * endTaper * tornWidth;
      const centreLift = height * (
        1.12 * Math.sin(s * Math.PI)
        + 0.34 * u
        + 0.11 * Math.sin(s * Math.PI * 3.2 + seed * 0.41)
      );
      const tangentSlope = height / Math.max(width, 1e-5) * (
        1.12 * Math.PI * Math.cos(s * Math.PI) * 0.5
        + 0.34
        + 0.176 * Math.PI * Math.cos(s * Math.PI * 3.2 + seed * 0.41)
      );
      const normalLength = Math.hypot(1, tangentSlope);
      const normalX = -tangentSlope / normalLength;
      const normalY = 1 / normalLength;
      positions.push(
        u * width + normalX * v * bandHalf,
        centreLift + normalY * v * bandHalf,
        depth * endTaper * (0.32 + 0.68 * (1 - v * v))
          + Math.sin(s * 8.2 + v * 1.7 + seed) * depth * 0.1,
      );
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.impactStyle = 'broad-water-slash';
  geometry.userData.pathStyle = 'curved-surface-shear';
  geometry.userData.profile = 'open-crescent-ribbon';
  geometry.userData.openSplashFragment = true;
  geometry.userData.closedLoop = false;
  geometry.userData.seed = seed;
  return geometry;
}

function createMonsterImpact(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'monster-impact';

  const slashes = new THREE.Group();
  slashes.name = 'monster-impact-slashes';
  const slashSeeds = [
    { width: 0.62, height: 0.105, depth: 0.095, angle: 0.24, delay: 0 },
    { width: 0.47, height: 0.08, depth: 0.072, angle: -0.18, delay: 0.055 },
  ];
  slashSeeds.forEach((entry, index) => {
    const slash = new THREE.Mesh(
      createWaterSlashGeometry(entry.width, entry.height, entry.depth, 211 + index * 7),
      impactMaterial(0, false),
    );
    slash.name = `monster-water-slash-${index + 1}`;
    slash.rotation.z = entry.angle;
    slash.position.set(index * 0.045 - 0.018, index * 0.055 - 0.012, index * 0.018);
    slash.renderOrder = 8 + index;
    slashes.add(slash);
  });
  root.add(slashes);

  const spray = new THREE.Group();
  spray.name = 'monster-directional-spray';
  const spraySeeds = Array.from({ length: 18 }, (_, index) => ({
    sideA: (deterministicUnit(301, index) - 0.5) * 0.42,
    sideB: (deterministicUnit(307, index) - 0.5) * 0.34,
    speed: 0.72 + deterministicUnit(313, index) * 0.82,
    size: 0.032 + deterministicUnit(317, index) * 0.055,
    stretch: 1.2 + deterministicUnit(331, index) * 1.25,
    delay: deterministicUnit(337, index) * 0.08,
  }));
  spraySeeds.forEach((seed, index) => {
    const mesh = new THREE.Mesh(
      createIrregularWaterGeometry(seed.size, [0.68, 0.72, seed.stretch], 240 + index, 2),
      impactMaterial(0, false),
    );
    mesh.name = `monster-spray-${index + 1}`;
    mesh.renderOrder = 12 + index;
    spray.add(mesh);
  });
  root.add(spray);

  const zAxis = new THREE.Vector3(0, 0, 1);
  const worldNormal = new THREE.Vector3();
  const worldImpulse = new THREE.Vector3();
  const localImpulse = new THREE.Vector3();
  const tangentA = new THREE.Vector3();
  const tangentB = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const inverseSurface = new THREE.Quaternion();
  const durationSeconds = 0.72;
  const runtime = {
    kind: 'monster-impact' as const,
    durationSeconds,
    deterministic: true,
    update(progress: number, context: {
      impactPoint?: readonly [number, number, number];
      normal?: readonly [number, number, number];
      impulse?: readonly [number, number, number];
    } = {}) {
      const t = THREE.MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
      root.visible = t < 1;
      root.position.fromArray(context.impactPoint ?? [0, 0, 0]);
      root.scale.set(1, 1, 1);

      worldNormal.fromArray(context.normal ?? [0, 0, 1]);
      if (worldNormal.lengthSq() < 1e-8) worldNormal.set(0, 0, 1);
      worldNormal.normalize();
      root.quaternion.setFromUnitVectors(zAxis, worldNormal);

      worldImpulse.fromArray(context.impulse ?? [0.32, 0.12, 1]);
      if (worldImpulse.lengthSq() < 1e-8) worldImpulse.copy(worldNormal);
      worldImpulse.normalize();
      inverseSurface.copy(root.quaternion).invert();
      localImpulse.copy(worldImpulse).applyQuaternion(inverseSurface).normalize();
      tangentA.set(0, 1, 0).cross(localImpulse);
      if (tangentA.lengthSq() < 1e-6) tangentA.set(1, 0, 0).cross(localImpulse);
      tangentA.normalize();
      tangentB.crossVectors(localImpulse, tangentA).normalize();

      const enter = smoothstep(0, 0.075, t);
      let maximumSlashOpacity = 0;
      slashes.children.forEach((child, index) => {
        const entry = slashSeeds[index];
        const localT = THREE.MathUtils.clamp((t - entry.delay) / Math.max(0.01, 1 - entry.delay), 0, 1);
        const spread = smoothstep(0, 0.42, localT);
        const fade = 1 - smoothstep(0.52, 0.88, localT);
        const opacity = (0.46 - index * 0.07) * enter * fade;
        child.position.set(
          localImpulse.x * (0.025 + localT * 0.075) + tangentA.x * (index - 0.5) * 0.05,
          localImpulse.y * (0.025 + localT * 0.075) + tangentA.y * (index - 0.5) * 0.05,
          localImpulse.z * (0.025 + localT * 0.09),
        );
        child.rotation.z = entry.angle + (index - 1) * 0.07 * spread;
        child.scale.set(
          THREE.MathUtils.lerp(0.12, 1.12 - index * 0.08, spread),
          THREE.MathUtils.lerp(0.16, 1 - index * 0.08, spread),
          THREE.MathUtils.lerp(0.42, 0.88, spread),
        );
        setMeshOpacity(child, opacity);
        maximumSlashOpacity = Math.max(maximumSlashOpacity, opacity);
      });

      const sprayFade = smoothstep(0.05, 0.19, t) * (1 - smoothstep(0.62, 0.98, t));
      const travel = smoothstep(0.04, 0.88, t);
      spray.children.forEach((child, index) => {
        const entry = spraySeeds[index];
        const localTravel = smoothstep(entry.delay, 0.92, t);
        direction.copy(localImpulse)
          .addScaledVector(tangentA, entry.sideA)
          .addScaledVector(tangentB, entry.sideB)
          .normalize();
        const distance = 0.05 + entry.speed * (0.12 + 0.62 * localTravel);
        child.position.copy(direction).multiplyScalar(distance);
        child.quaternion.setFromUnitVectors(zAxis, direction);
        child.scale.setScalar(0.46 + 0.62 * Math.sin(Math.min(1, localTravel / 0.82) * Math.PI * 0.72));
        setMeshOpacity(child, (0.3 - 0.014 * (index % 5)) * sprayFade);
      });

      root.userData.impactState = {
        progress: t,
        visible: root.visible,
        localized: true,
        broadWaterSlash: true,
        surfaceWave: false,
        directionalSpray: true,
        slashOpacity: maximumSlashOpacity,
      };
      return runtime;
    },
  };
  root.userData.impactRuntime = runtime;
  root.userData.impactContract = {
    volumetricFragments: true,
    planePlate: false,
    ring: false,
    deterministicLifetime: true,
    maximumOpacity: 0.34,
    localizedWetBurst: false,
    broadWaterSlash: true,
    surfaceWave: false,
    directionalSpray: true,
    radialFragmentRing: false,
  };
  runtime.update(0);
  return root;
}

export function createMonsterWaterImpact(): THREE.Group {
  return createMonsterImpact();
}

export function createLensWaterImpact(): THREE.Group {
  return createLensImpact();
}

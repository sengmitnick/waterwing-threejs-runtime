import * as THREE from 'three';

import { PALETTE, WATERWING } from '../config.js';
import { animateWaterMaterial, createWaterMaterial } from './waterMaterial.js';

const partRegistry = new WeakMap();

function createBodyGeometry() {
  const profile = [
    new THREE.Vector2(0.07, -0.72),
    new THREE.Vector2(0.31, -0.48),
    new THREE.Vector2(0.48, -0.06),
    new THREE.Vector2(0.44, 0.28),
    new THREE.Vector2(0.29, 0.58),
    new THREE.Vector2(0.08, 0.82),
    new THREE.Vector2(0.012, 0.88)
  ];
  const geometry = new THREE.LatheGeometry(profile, 64);
  geometry.scale(0.8, 1, 0.56);
  geometry.computeVertexNormals();
  return geometry;
}

function createWingShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0.08, 0.42);
  shape.bezierCurveTo(0.38, 0.08, 0.84, 0.34, 1.4, 1.12);
  shape.bezierCurveTo(1.55, 0.78, 1.48, 0.31, 1.27, 0.04);
  shape.bezierCurveTo(1.36, -0.12, 1.16, -0.45, 0.91, -0.5);
  shape.bezierCurveTo(0.72, -0.68, 0.42, -0.56, 0.06, -0.44);
  shape.bezierCurveTo(0.16, -0.08, 0.17, 0.16, 0.08, 0.42);
  return shape;
}

function createWingGeometry() {
  const shape = createWingShape();
  const geometry = new THREE.ShapeGeometry(shape, 32);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    position.setZ(index, Math.sin(x * 2.3) * 0.045 + Math.cos(y * 3.1) * 0.02);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createWingRim(name) {
  const points = createWingShape()
    .getSpacedPoints(96)
    .map(point =>
      new THREE.Vector3(
        point.x,
        point.y,
        Math.sin(point.x * 2.3) * 0.045 + Math.cos(point.y * 3.1) * 0.02 + 0.012
      )
    );
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  const rim = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 128, 0.006, 5, true),
    new THREE.MeshBasicMaterial({
      name: 'water-wing-rim-material',
      color: PALETTE.waterHighlight,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  rim.name = name;
  return rim;
}

function createTailGeometry() {
  const profile = [
    new THREE.Vector2(0.012, -0.34),
    new THREE.Vector2(0.105, -0.25),
    new THREE.Vector2(0.17, -0.07),
    new THREE.Vector2(0.145, 0.13),
    new THREE.Vector2(0.075, 0.28),
    new THREE.Vector2(0.012, 0.35)
  ];
  const geometry = new THREE.LatheGeometry(profile, 32);
  geometry.scale(0.78, 1, 0.56);
  geometry.computeVertexNormals();
  return geometry;
}

function createEdgeShell(geometry, scale, name) {
  const material = new THREE.MeshBasicMaterial({
    name: 'water-fresnel-fallback',
    color: PALETTE.waterEdge,
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const shell = new THREE.Mesh(geometry.clone(), material);
  shell.name = name;
  shell.scale.setScalar(scale);
  shell.renderOrder = -1;
  return shell;
}

export function createWaterwing({ variant = 'standard' } = {}) {
  const root = new THREE.Group();
  root.name = 'waterwing';
  root.userData.variant = variant;

  const bodyGeometry = createBodyGeometry();
  const body = new THREE.Mesh(bodyGeometry, createWaterMaterial({ opacity: 0.5, phase: 0.15 }));
  body.name = 'body';
  body.add(createEdgeShell(bodyGeometry, 1.018, 'body-fresnel'));
  root.add(body);

  const wingGeometry = createWingGeometry();
  const leftWing = new THREE.Mesh(wingGeometry, createWaterMaterial({ opacity: 0.46, wing: true, phase: 0.85 }));
  leftWing.name = 'wing-left';
  leftWing.position.set(-0.08, 0.08, -0.015);
  leftWing.scale.x = -1;
  leftWing.add(createEdgeShell(wingGeometry, 1.012, 'wing-left-fresnel'));
  leftWing.add(createWingRim('wing-left-rim'));
  root.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeometry.clone(), createWaterMaterial({ opacity: 0.46, wing: true, phase: 1.45 }));
  rightWing.name = 'wing-right';
  rightWing.position.set(0.08, 0.08, -0.015);
  rightWing.add(createEdgeShell(wingGeometry, 1.012, 'wing-right-fresnel'));
  rightWing.add(createWingRim('wing-right-rim'));
  root.add(rightWing);

  const tailGeometry = createTailGeometry();
  const tail = new THREE.Mesh(tailGeometry, createWaterMaterial({ opacity: 0.48, phase: 2.1 }));
  tail.name = 'tail';
  tail.position.y = -0.74;
  tail.add(createEdgeShell(tailGeometry, 1.015, 'tail-fresnel'));
  root.add(tail);

  const coreRadius = 0.025;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(coreRadius, 24, 16),
    new THREE.MeshPhysicalMaterial({
      name: 'weak-core-material',
      color: PALETTE.waterEdge,
      emissive: new THREE.Color(PALETTE.waterEdge).multiplyScalar(0.24),
      transparent: true,
      opacity: 0.58,
      roughness: 0.08,
      transmission: 0,
      depthWrite: false
    })
  );
  core.name = 'weak-core';
  core.position.set(0, 0.04, 0.31);
  root.add(core);

  if (variant === 'caster') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.052, 0.004, 8, 36),
      new THREE.MeshBasicMaterial({
        name: 'caster-core-ring-material',
        color: PALETTE.waterEdge,
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      })
    );
    ring.name = 'caster-core-ring';
    ring.position.copy(core.position);
    root.add(ring);
  }

  const healthAnchor = new THREE.Object3D();
  healthAnchor.name = 'health-anchor';
  healthAnchor.position.set(0, WATERWING.healthAnchorY, 0);
  root.add(healthAnchor);

  partRegistry.set(root, { body, leftWing, rightWing, tail, core });
  return root;
}

export function setWaterwingPose(root, { frame, fps, state, bank = 0, damage = 0 }) {
  const time = frame / fps;
  const parts = partRegistry.get(root) ?? {
    body: root.getObjectByName('body'),
    leftWing: root.getObjectByName('wing-left'),
    rightWing: root.getObjectByName('wing-right'),
    tail: root.getObjectByName('tail'),
    core: root.getObjectByName('weak-core')
  };
  const { body, leftWing, rightWing, tail, core } = parts;
  if (!body || !leftWing || !rightWing || !tail || !core) return;
  const wingPulse = Math.sin(time * Math.PI * 1.45);
  const charge = state === 'charge' ? 1 : 0;
  const cast = state === 'cast' ? 1 : 0;
  const stagger = state === 'stagger' ? 1 : 0;

  root.rotation.set(
    Math.sin(time * 1.1) * 0.025 - cast * 0.08,
    Math.max(-0.42, Math.min(0.42, bank * 0.45)),
    Math.max(-0.52, Math.min(0.52, bank * 0.78 + stagger * 0.16))
  );

  leftWing.rotation.set(0, 0.09 + wingPulse * 0.1 + charge * 0.12, -0.018 - charge * 0.06);
  rightWing.rotation.set(0, -0.09 - wingPulse * 0.1 - charge * 0.12, 0.018 + charge * 0.06);
  leftWing.scale.y = 1 + wingPulse * 0.035 - stagger * 0.04;
  rightWing.scale.y = 1 + wingPulse * 0.035 - stagger * 0.04;
  tail.rotation.z = Math.sin(time * 1.8 + 0.7) * 0.065 + bank * 0.06;
  body.scale.set(1 - stagger * 0.035, 1 + charge * 0.035 - stagger * 0.02, 1 + cast * 0.045);
  const corePulse = 1 + Math.sin(time * 2.2) * 0.035 + charge * 0.08;
  core.scale.setScalar(corePulse);

  root.traverse(node => {
    if (node.material) animateWaterMaterial(node.material, time, damage);
  });
}

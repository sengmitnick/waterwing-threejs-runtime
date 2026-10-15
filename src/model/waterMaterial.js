import * as THREE from 'three';

import { PALETTE } from '../config.js';

const materialState = new WeakMap();

export function createWaterMaterial({ opacity = 0.58, wing = false, phase = 0 } = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    name: wing ? 'water-wing-material' : 'water-body-material',
    color: PALETTE.waterDeep,
    emissive: new THREE.Color(PALETTE.waterEdge).multiplyScalar(0.055),
    transparent: true,
    opacity: wing ? opacity * 0.84 : opacity,
    transmission: 0,
    thickness: wing ? 0.26 : 0.72,
    attenuationColor: new THREE.Color(PALETTE.waterDeep),
    attenuationDistance: 1.9,
    ior: 1.333,
    roughness: wing ? 0.2 : 0.13,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.18,
    iridescence: 0.18,
    iridescenceIOR: 1.3,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending
  });
  materialState.set(material, {
    baseOpacity: material.opacity,
    baseColor: material.color.clone(),
    phase
  });
  return material;
}

export function animateWaterMaterial(material, timeSeconds, damage = 0) {
  if (!materialState.has(material) && material?.color) {
    materialState.set(material, {
      baseOpacity: material.opacity,
      baseColor: material.color.clone(),
      phase: 0
    });
  }
  const state = materialState.get(material);
  if (!state) return;
  const shimmer = 0.035 * Math.sin(timeSeconds * 2.4 + state.phase);
  const damageTint = Math.max(0, Math.min(1, damage)) * 0.12;
  material.color.copy(state.baseColor).offsetHSL(0, shimmer, shimmer + damageTint);
  material.opacity = state.baseOpacity * (1 - damageTint * 0.32);
}

import * as THREE from 'three';

function waterMaterial(options) {
  return new THREE.MeshPhysicalMaterial({
    transparent: true,
    depthWrite: false,
    metalness: 0,
    ior: 1.333,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    ...options
  });
}

/**
 * Standard physical materials only: every property has a glTF PBR mapping or
 * a safe Three.js runtime fallback. No additive glow or custom shader is used.
 */
export function createWaterwingMaterials() {
  return {
    body: waterMaterial({
      name: 'waterwing-body-pbr',
      color: 0x86c4cb,
      vertexColors: true,
      opacity: 0.66,
      transmission: 0.56,
      roughness: 0.12,
      thickness: 0.38,
      attenuationColor: new THREE.Color(0x6bb4bf),
      attenuationDistance: 4.2,
      clearcoat: 0.86,
      clearcoatRoughness: 0.1
    }),
    wing: waterMaterial({
      name: 'waterwing-wing-pbr',
      color: 0x9bd2d7,
      vertexColors: true,
      opacity: 0.55,
      transmission: 0.62,
      roughness: 0.1,
      thickness: 0.17,
      attenuationColor: new THREE.Color(0x7cc3cc),
      attenuationDistance: 5.1,
      clearcoat: 0.92,
      clearcoatRoughness: 0.07
    }),
    tail: waterMaterial({
      name: 'waterwing-tail-pbr',
      color: 0x8bc8ce,
      vertexColors: true,
      opacity: 0.6,
      transmission: 0.57,
      roughness: 0.11,
      thickness: 0.22,
      attenuationColor: new THREE.Color(0x70b7c0),
      attenuationDistance: 4.5,
      clearcoat: 0.88,
      clearcoatRoughness: 0.09
    }),
    core: waterMaterial({
      name: 'waterwing-weak-core-pbr',
      color: 0x60939a,
      emissive: new THREE.Color(0x142d31),
      emissiveIntensity: 0.22,
      opacity: 0.42,
      transmission: 0.14,
      roughness: 0.3,
      thickness: 0.08,
      attenuationColor: new THREE.Color(0x315e65),
      attenuationDistance: 1.8,
      clearcoat: 0.48,
      clearcoatRoughness: 0.2
    }),
    droplet: waterMaterial({
      name: 'waterwing-droplet-pbr',
      color: 0xa0d9dc,
      opacity: 0.58,
      transmission: 0.61,
      roughness: 0.09,
      thickness: 0.12,
      attenuationColor: new THREE.Color(0x4a8d96),
      attenuationDistance: 4.4,
      clearcoat: 0.88,
      clearcoatRoughness: 0.1
    })
  };
}

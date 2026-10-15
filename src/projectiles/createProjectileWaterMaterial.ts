import * as THREE from 'three';

export type ProjectileWaterMaterialRole =
  | 'core'
  | 'pressure-core'
  | 'wake'
  | 'wake-sheet'
  | 'arrival-spray';

export type ProjectileWaterMaterialOptions = {
  tint: THREE.ColorRepresentation;
  attenuation: THREE.ColorRepresentation;
  emissive: THREE.ColorRepresentation;
  role?: ProjectileWaterMaterialRole;
};

export function createProjectileWaterMaterial({
  tint,
  attenuation,
  emissive,
  role = 'core',
}: ProjectileWaterMaterialOptions): THREE.MeshPhysicalMaterial {
  const secondary = role !== 'core';
  const isPressureCore = role === 'pressure-core';
  const isSheet = role === 'wake-sheet';
  const isWake = role === 'wake';
  const isArrival = role === 'arrival-spray';
  const clearBase = new THREE.Color(tint).lerp(
    new THREE.Color(attenuation),
    isPressureCore ? 0.42 : isSheet ? 0.4 : role === 'core' ? 0.29 : 0.24,
  );
  const material = new THREE.MeshPhysicalMaterial({
    color: clearBase,
    metalness: 0,
    roughness: isPressureCore ? 0.2 : isSheet ? 0.18 : isWake ? 0.16 : role === 'core' ? 0.16 : 0.18,
    transmission: isPressureCore ? 0.46 : isSheet ? 0.82 : isWake ? 0.88 : role === 'core' ? 0.88 : 0.86,
    thickness: isPressureCore ? 0.3 : role === 'core' ? 0.42 : isSheet ? 0.08 : 0.16,
    ior: 1.333,
    attenuationDistance: isPressureCore ? 0.82 : role === 'core' ? 1.65 : isSheet ? 1.3 : 2.1,
    attenuationColor: new THREE.Color(attenuation),
    clearcoat: role === 'core' ? 0.045 : isPressureCore ? 0.035 : 0.055,
    clearcoatRoughness: isPressureCore ? 0.1 : 0.07,
    specularIntensity: role === 'core' ? 0.7 : isPressureCore ? 0.56 : 0.74,
    specularColor: new THREE.Color('#e8fdff'),
    envMapIntensity: role === 'core' ? 0.88 : isPressureCore ? 0.58 : 0.76,
    emissive,
    emissiveIntensity: isPressureCore ? 0.1 : role === 'core' ? 0.065 : 0.03,
    transparent: secondary,
    opacity: isPressureCore ? 0.4 : isSheet ? 0.56 : isWake ? 0.56 : isArrival ? 0.78 : 1,
    depthWrite: !secondary,
    side: isSheet || isArrival ? THREE.DoubleSide : THREE.FrontSide,
    dithering: true,
  });
  material.map = null;
  material.normalMap = null;
  material.roughnessMap = null;
  material.thicknessMap = null;
  material.transmissionMap = null;
  material.alphaMap = null;
  material.userData = {
    clearWaterVersion: 'clear-water-v10-projectile',
    texturePolicy: 'textureless-volume',
    role,
  };
  material.needsUpdate = true;
  return material;
}

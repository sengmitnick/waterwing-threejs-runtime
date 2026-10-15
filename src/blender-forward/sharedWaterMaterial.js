import * as THREE from 'three';

export const WATERWING_CLEAR_WATER_PROFILE = Object.freeze({
  name: 'waterwing-clear-water-flight-forward-v10',
  baseColor: '#edfafa',
  roughness: 0.06,
  clearcoat: 0.08,
  clearcoatRoughness: 0.065,
  envMapIntensity: 0.88,
  normalScale: 0.022,
  ior: 1.333,
  specularIntensity: 0.92,
  specularColor: '#f7ffff',
  edgeTint: '#eafcff',
  edgeStrength: 0.14,
  edgePower: 3.35,
});

export const WATERWING_REGION_PROFILES = [
  {
    id: 'body', color: WATERWING_CLEAR_WATER_PROFILE.baseColor,
    transmission: 0.98, thickness: 0.52,
    attenuationColor: '#4f9faa', attenuationDistance: 0.82,
  },
  {
    id: 'wing', color: WATERWING_CLEAR_WATER_PROFILE.baseColor,
    transmission: 1, thickness: 0.22,
    attenuationColor: '#76b8c0', attenuationDistance: 1.02,
  },
  {
    id: 'tail', color: WATERWING_CLEAR_WATER_PROFILE.baseColor,
    transmission: 0.99, thickness: 0.34,
    attenuationColor: '#68b0ba', attenuationDistance: 0.95,
  },
].map(region => Object.freeze({
  ...region,
  roughness: WATERWING_CLEAR_WATER_PROFILE.roughness,
  envMapIntensity: WATERWING_CLEAR_WATER_PROFILE.envMapIntensity,
  clearcoat: WATERWING_CLEAR_WATER_PROFILE.clearcoat,
  clearcoatRoughness: WATERWING_CLEAR_WATER_PROFILE.clearcoatRoughness,
  normalScale: WATERWING_CLEAR_WATER_PROFILE.normalScale,
}));

function hash2(x, y, period) {
  const px = ((x % period) + period) % period;
  const py = ((y % period) + period) % period;
  const value = Math.sin(px * 127.1 + py * 311.7 + 18.17) * 43758.5453123;
  return value - Math.floor(value);
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function periodicValueNoise(x, y, period) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy, period);
  const b = hash2(ix + 1, iy, period);
  const c = hash2(ix, iy + 1, period);
  const d = hash2(ix + 1, iy + 1, period);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, fx),
    THREE.MathUtils.lerp(c, d, fx),
    fy,
  );
}

function fbm(u, v) {
  let total = 0;
  let amplitude = 0.58;
  let normalizer = 0;
  for (const frequency of [4, 8, 16]) {
    total += periodicValueNoise(u * frequency, v * frequency, frequency) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.48;
  }
  return total / normalizer;
}

let weakWaterNormalTexture;

function getWeakWaterNormalTexture(size = 256) {
  if (weakWaterNormalTexture) return weakWaterNormalTexture;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      heights[y * size + x] = fbm(x / size, y / size);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const x0 = (x - 1 + size) % size;
      const x1 = (x + 1) % size;
      const y0 = (y - 1 + size) % size;
      const y1 = (y + 1) % size;
      const dx = heights[y * size + x1] - heights[y * size + x0];
      const dy = heights[y1 * size + x] - heights[y0 * size + x];
      const nx = -dx * 0.55;
      const ny = -dy * 0.55;
      const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round(inverseLength * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  weakWaterNormalTexture = texture;
  return weakWaterNormalTexture;
}

function regionForBoneName(name) {
  if (name.startsWith('wing_')) return 1;
  if (name.startsWith('tail_')) return 2;
  return 0;
}

function ensureLongitudinalUv(body) {
  const geometry = body.geometry;
  if (geometry.getAttribute('uv')) return;
  const position = geometry.getAttribute('position');
  if (!position) return;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;
  const span = Math.max(1e-6, bounds.max.z - bounds.min.z);
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    uv[index * 2] = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
    uv[index * 2 + 1] = (z - bounds.min.z) / span;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

function installRegionWeights(body) {
  const geometry = body.geometry;
  const cached = geometry.userData.waterwingMaterialRegions;
  if (cached) return cached;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const index = geometry.getIndex();
  if (!skinIndex || !skinWeight || !index || !body.skeleton) {
    throw new Error('Waterwing body cannot derive smooth water regions');
  }

  const boneRegions = body.skeleton.bones.map(bone => regionForBoneName(bone.name));
  const regionWeights = new Float32Array(skinIndex.count * 2);
  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    let wingWeight = 0;
    let tailWeight = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const boneIndex = skinIndex.getComponent(vertex, channel);
      const weight = skinWeight.getComponent(vertex, channel);
      const region = boneRegions[boneIndex] ?? 0;
      if (region === 1) wingWeight += weight;
      else if (region === 2) tailWeight += weight;
    }
    regionWeights[vertex * 2] = wingWeight;
    regionWeights[vertex * 2 + 1] = tailWeight;
  }

  geometry.setAttribute('wwRegionWeight', new THREE.Float32BufferAttribute(regionWeights, 2));
  const triangleCounts = [0, 0, 0];
  for (let offset = 0; offset < index.count; offset += 3) {
    const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const scores = [0, 0, 0];
    for (const vertex of triangle) {
      const wingWeight = regionWeights[vertex * 2];
      const tailWeight = regionWeights[vertex * 2 + 1];
      scores[0] += Math.max(0, 1 - wingWeight - tailWeight);
      scores[1] += wingWeight;
      scores[2] += tailWeight;
    }
    let region = 0;
    if (scores[1] > scores[region]) region = 1;
    if (scores[2] > scores[region]) region = 2;
    triangleCounts[region] += 1;
  }
  const counts = {};
  for (let region = 0; region < triangleCounts.length; region += 1) {
    counts[WATERWING_REGION_PROFILES[region].id] = triangleCounts[region];
  }
  const partition = { counts, indexCount: index.count, smoothWeights: true };
  geometry.userData.waterwingMaterialRegions = partition;
  return partition;
}

export function installWaterwingRegionalShader(material, profiles = WATERWING_REGION_PROFILES) {
  const [body, wing, tail] = profiles;
  const edgeColor = new THREE.Color(WATERWING_CLEAR_WATER_PROFILE.edgeTint);
  const bodyAttenuation = new THREE.Color(body.attenuationColor);
  const wingAttenuation = new THREE.Color(wing.attenuationColor);
  const tailAttenuation = new THREE.Color(tail.attenuationColor);

  material.onBeforeCompile = shader => {
    shader.uniforms.wwEdgeColor = { value: edgeColor };
    shader.uniforms.wwEdgeStrength = { value: WATERWING_CLEAR_WATER_PROFILE.edgeStrength };
    shader.uniforms.wwEdgePower = { value: WATERWING_CLEAR_WATER_PROFILE.edgePower };
    shader.uniforms.wwTransmission = { value: new THREE.Vector3(
      body.transmission,
      wing.transmission,
      tail.transmission,
    ) };
    shader.uniforms.wwThickness = { value: new THREE.Vector3(
      body.thickness,
      wing.thickness,
      tail.thickness,
    ) };
    shader.uniforms.wwAttenuationDistance = { value: new THREE.Vector3(
      body.attenuationDistance,
      wing.attenuationDistance,
      tail.attenuationDistance,
    ) };
    shader.uniforms.wwBodyAttenuation = { value: bodyAttenuation };
    shader.uniforms.wwWingAttenuation = { value: wingAttenuation };
    shader.uniforms.wwTailAttenuation = { value: tailAttenuation };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 wwRegionWeight;\nvarying vec2 vWwRegionWeight;',
      )
      .replace(
        '#include <begin_vertex>',
        'vWwRegionWeight = wwRegionWeight;\n#include <begin_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 wwEdgeColor;\nuniform float wwEdgeStrength;\nuniform float wwEdgePower;\nuniform vec3 wwTransmission;\nuniform vec3 wwThickness;\nuniform vec3 wwAttenuationDistance;\nuniform vec3 wwBodyAttenuation;\nuniform vec3 wwWingAttenuation;\nuniform vec3 wwTailAttenuation;\nvarying vec2 vWwRegionWeight;',
      )
      .replace(
        'material.attenuationColor = attenuationColor;',
        'material.attenuationColor = attenuationColor;\nvec3 wwRegionMix = vec3(max(0.0, 1.0 - vWwRegionWeight.x - vWwRegionWeight.y), vWwRegionWeight.x, vWwRegionWeight.y);\nwwRegionMix /= max(dot(wwRegionMix, vec3(1.0)), 0.0001);\nmaterial.transmission = dot(wwRegionMix, wwTransmission);\nmaterial.thickness = dot(wwRegionMix, wwThickness);\nmaterial.attenuationDistance = dot(wwRegionMix, wwAttenuationDistance);\nmaterial.attenuationColor = wwBodyAttenuation * wwRegionMix.x + wwWingAttenuation * wwRegionMix.y + wwTailAttenuation * wwRegionMix.z;',
      )
      .replace(
        '#include <opaque_fragment>',
        'float wwFresnel = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), wwEdgePower);\noutgoingLight += wwEdgeColor * wwFresnel * wwEdgeStrength;\n#include <opaque_fragment>',
      );
  };
  material.customProgramCacheKey = () => WATERWING_CLEAR_WATER_PROFILE.name;
}

function configureRegionalMaterial(material, profiles, triangleCounts) {
  const profile = profiles[0];
  material.name = `MAT_Waterwing_${profile.id}`;
  material.map = null;
  material.roughnessMap = null;
  material.normalMap = getWeakWaterNormalTexture();
  material.thicknessMap = null;
  material.transmissionMap = null;
  material.color.set(WATERWING_CLEAR_WATER_PROFILE.baseColor);
  material.metalness = 0;
  material.roughness = WATERWING_CLEAR_WATER_PROFILE.roughness;
  material.normalScale.setScalar(WATERWING_CLEAR_WATER_PROFILE.normalScale);
  material.transmission = profile.transmission;
  material.thickness = profile.thickness;
  material.attenuationColor.set(profile.attenuationColor);
  material.attenuationDistance = profile.attenuationDistance;
  material.ior = WATERWING_CLEAR_WATER_PROFILE.ior;
  material.clearcoat = WATERWING_CLEAR_WATER_PROFILE.clearcoat;
  material.clearcoatRoughness = WATERWING_CLEAR_WATER_PROFILE.clearcoatRoughness;
  material.specularIntensity = WATERWING_CLEAR_WATER_PROFILE.specularIntensity;
  material.specularColor.set(WATERWING_CLEAR_WATER_PROFILE.specularColor);
  material.envMapIntensity = WATERWING_CLEAR_WATER_PROFILE.envMapIntensity;
  material.emissive.set('#000000');
  material.emissiveIntensity = 0;
  material.opacity = 1;
  material.transparent = false;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.dithering = true;
  material.userData = {
    ...material.userData,
    aqueousLookVersion: WATERWING_CLEAR_WATER_PROFILE.name,
    flowContrast: 0,
    regionalBlend: 'skin-weight-smooth',
    normalPattern: 'periodic-fbm-no-directional-bands',
    edgeTint: WATERWING_CLEAR_WATER_PROFILE.edgeTint,
    edgeStrength: WATERWING_CLEAR_WATER_PROFILE.edgeStrength,
    edgePower: WATERWING_CLEAR_WATER_PROFILE.edgePower,
    forwardRegionProfiles: profiles.map((region, materialIndex) => ({
      id: region.id,
      materialIndex,
      triangleCount: triangleCounts[region.id],
      baseColor: region.color,
      transmission: region.transmission,
      thickness: region.thickness,
      attenuationColor: region.attenuationColor,
      attenuationDistance: region.attenuationDistance,
      roughness: region.roughness,
      envMapIntensity: region.envMapIntensity,
      clearcoat: region.clearcoat,
      normalScale: region.normalScale,
    })),
    reviewScope: 'approved-action-family-v10',
  };
  installWaterwingRegionalShader(material, profiles);
  material.needsUpdate = true;
}

export function applySharedWaterwingCrystalMaterial(body) {
  const sourceMaterial = Array.isArray(body.material) ? body.material[0] : body.material;
  if (!sourceMaterial?.isMeshPhysicalMaterial) return false;
  ensureLongitudinalUv(body);
  const partition = installRegionWeights(body);
  configureRegionalMaterial(sourceMaterial, WATERWING_REGION_PROFILES, partition.counts);
  body.material = sourceMaterial;
  return true;
}

export function createSharedWaterFxMaterial(source = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    name: source.name || 'MAT_WaterShell',
    color: new THREE.Color(WATERWING_CLEAR_WATER_PROFILE.baseColor),
    roughness: 0.09,
    metalness: 0,
    transmission: 0.82,
    thickness: 0.3,
    ior: WATERWING_CLEAR_WATER_PROFILE.ior,
    clearcoat: 0.14,
    clearcoatRoughness: 0.08,
    attenuationColor: new THREE.Color(0x77bec7),
    attenuationDistance: 1.1,
    envMapIntensity: 0.92,
    transparent: true,
    opacity: 0.82,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  material.userData.semantic = 'water-shell';
  material.userData.aqueousLookVersion = `${WATERWING_CLEAR_WATER_PROFILE.name}-fx`;
  return material;
}

let coreGlowTexture;

function getCoreGlowTexture() {
  if (coreGlowTexture || typeof document === 'undefined') return coreGlowTexture ?? null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(222, 255, 255, 0.55)');
  gradient.addColorStop(0.12, 'rgba(128, 236, 242, 0.22)');
  gradient.addColorStop(0.46, 'rgba(78, 194, 205, 0.06)');
  gradient.addColorStop(1, 'rgba(65, 174, 190, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  coreGlowTexture = new THREE.CanvasTexture(canvas);
  coreGlowTexture.colorSpace = THREE.SRGBColorSpace;
  coreGlowTexture.needsUpdate = true;
  return coreGlowTexture;
}

export function createWeakWaterCoreGlow() {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    name: 'MAT_CoreSoftGlow',
    map: getCoreGlowTexture(),
    color: new THREE.Color(0xb9fbff),
    transparent: true,
    opacity: 0.29,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  }));
  sprite.name = 'WeakWaterCoreGlow';
  sprite.scale.setScalar(0.34);
  sprite.renderOrder = 12;
  sprite.userData.coreGlow = true;
  return sprite;
}

export function createWeakWaterCoreCarrierMaterial() {
  const material = new THREE.MeshBasicMaterial({
    name: 'MAT_CoreHiddenCarrier',
    color: new THREE.Color(0x5bd4df),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  material.userData.semantic = 'weak-water-core';
  return material;
}

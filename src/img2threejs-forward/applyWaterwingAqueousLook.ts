import * as THREE from 'three';

type FlowAxis = 'horizontal' | 'vertical';

type TextureProfile = {
  id: 'body' | 'wing' | 'tail' | 'rim' | 'inner' | 'eye';
  axis: FlowAxis;
  deep: THREE.ColorRepresentation;
  mid: THREE.ColorRepresentation;
  pale: THREE.ColorRepresentation;
  roughnessMin: number;
  roughnessMax: number;
  normalScale: number;
  edgeThickness: number;
  centreThickness: number;
};

type WaterTextureSet = {
  albedo: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  thickness: THREE.CanvasTexture;
};

export type WaterwingAqueousLookOptions = {
  textureSize?: number;
  textureAnisotropy?: number;
};

const TAU = Math.PI * 2;

const PROFILES: Record<TextureProfile['id'], TextureProfile> = {
  body: {
    id: 'body', axis: 'vertical', deep: '#315866', mid: '#78949b', pale: '#cadde1',
    roughnessMin: 0.2, roughnessMax: 0.38, normalScale: 0.22,
    edgeThickness: 0.18, centreThickness: 0.72,
  },
  wing: {
    id: 'wing', axis: 'horizontal', deep: '#466a75', mid: '#8da3a9', pale: '#dbe8ea',
    roughnessMin: 0.22, roughnessMax: 0.42, normalScale: 0.28,
    edgeThickness: 0.12, centreThickness: 0.58,
  },
  tail: {
    id: 'tail', axis: 'vertical', deep: '#456b76', mid: '#8aa2a8', pale: '#d9e7e9',
    roughnessMin: 0.2, roughnessMax: 0.4, normalScale: 0.24,
    edgeThickness: 0.1, centreThickness: 0.5,
  },
  rim: {
    id: 'rim', axis: 'vertical', deep: '#79b5c2', mid: '#b6dce4', pale: '#e5f7fa',
    roughnessMin: 0.04, roughnessMax: 0.11, normalScale: 0.045,
    edgeThickness: 0.08, centreThickness: 0.24,
  },
  inner: {
    id: 'inner', axis: 'vertical', deep: '#0d3d4c', mid: '#176174', pale: '#55aebe',
    roughnessMin: 0.12, roughnessMax: 0.24, normalScale: 0.055,
    edgeThickness: 0.2, centreThickness: 0.82,
  },
  eye: {
    id: 'eye', axis: 'vertical', deep: '#0d7182', mid: '#39c7d2', pale: '#c8fbff',
    roughnessMin: 0.035, roughnessMax: 0.085, normalScale: 0.035,
    edgeThickness: 0.08, centreThickness: 0.34,
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mixColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, clamp01(t));
}

function flowFields(u: number, v: number, profile: TextureProfile): { colour: number; height: number; roughness: number } {
  const along = profile.axis === 'horizontal' ? u : v;
  const across = profile.axis === 'horizontal' ? v : u;

  // All across-axis frequencies are integers so the cylindrical body texture closes
  // without a visible seam. The slower along-axis phase creates root-to-tip flow.
  const warp = (
    Math.sin(TAU * (across * 2 + along * 0.72) + 0.9) * 0.055
    + Math.sin(TAU * (across * 5 - along * 1.16) + 2.2) * 0.022
    + Math.sin(TAU * (across * 9 + along * 2.05) + 4.1) * 0.009
  );
  const broad = 0.5 + 0.5 * Math.sin(TAU * (across * 2 + along * 0.34 + warp) + 0.45);
  const folded = 0.5 + 0.5 * Math.sin(TAU * (across * 4 - along * 0.61 + warp * 1.7) + 1.65);
  const filament = 0.5 + 0.5 * Math.sin(TAU * (across * 8 + along * 1.42 + warp * 2.5) + 3.4);
  const eddy = 0.5 + 0.5 * Math.sin(
    TAU * (across * 6 + along * 0.48 + Math.sin(along * TAU * 2.7 + 0.8) * 0.16) + 2.15,
  );
  const cell = 0.5 + 0.5 * Math.sin(
    TAU * (along * 6.2 + across * 3 + Math.sin(across * TAU * 4 + 1.4) * 0.19) + 0.75,
  );
  const ripple = 0.5 + 0.5 * Math.sin(
    TAU * (along * 13 + across * 11 + Math.sin((along - across) * TAU * 3.2) * 0.18) + 4.55,
  );
  const cloud = clamp01(
    0.5
    + Math.sin(TAU * (across + along * 0.23) + 0.2) * 0.18
    + Math.sin(TAU * (across * 3 - along * 0.41) + 2.8) * 0.1
    + Math.sin(TAU * (across * 7 + along * 0.93) + 5.1) * 0.045
  );
  const broadRidge = Math.pow(broad, 5.2);
  const foldedRidge = Math.pow(folded, 7.5);
  const filamentRidge = Math.pow(filament, 12);
  const eddyRidge = Math.pow(eddy, 8.5);
  const cellRidge = Math.pow(cell, 7.2);
  const rippleRidge = Math.pow(ripple, 10);
  const colour = clamp01(
    0.16 + cloud * 0.38 + broadRidge * 0.17 + foldedRidge * 0.14
    + filamentRidge * 0.08 + eddyRidge * 0.1 + cellRidge * 0.14 + rippleRidge * 0.045,
  );
  const height = clamp01(
    0.2 + cloud * 0.2 + broadRidge * 0.16 + foldedRidge * 0.15
    + filamentRidge * 0.1 + eddyRidge * 0.12 + cellRidge * 0.16 + rippleRidge * 0.1,
  );

  // Independent frequencies keep roughness from being a repurposed albedo/height channel.
  const roughSignal = clamp01(
    0.5
    + Math.sin(TAU * (across * 3 + along * 1.17) + 4.2) * 0.24
    + Math.sin(TAU * (across * 11 - along * 2.31) + 0.6) * 0.08
  );
  const roughness = THREE.MathUtils.lerp(profile.roughnessMin, profile.roughnessMax, roughSignal);
  return { colour, height, roughness };
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function makeTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace, anisotropy: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = anisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function putGray(data: Uint8ClampedArray, offset: number, value: number): void {
  const byte = Math.round(clamp01(value) * 255);
  data[offset] = byte;
  data[offset + 1] = byte;
  data[offset + 2] = byte;
  data[offset + 3] = 255;
}

function createWaterTextureSet(profile: TextureProfile, size: number, anisotropy: number): WaterTextureSet | null {
  if (typeof document === 'undefined') return null;
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    normal: makeCanvas(size),
    thickness: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    thickness: canvases.thickness.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.normal || !contexts.thickness) return null;

  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    thickness: contexts.thickness.createImageData(size, size),
  };
  const heights = new Float32Array(size * size);
  const deep = new THREE.Color(profile.deep);
  const mid = new THREE.Color(profile.mid);
  const pale = new THREE.Color(profile.pale);

  for (let y = 0; y < size; y += 1) {
    const v = y / Math.max(1, size - 1);
    for (let x = 0; x < size; x += 1) {
      const u = x / Math.max(1, size - 1);
      const index = y * size + x;
      const offset = index * 4;
      const fields = flowFields(u, v, profile);
      heights[index] = fields.height;
      const colour = fields.colour < 0.58
        ? mixColor(deep, mid, fields.colour / 0.58)
        : mixColor(mid, pale, (fields.colour - 0.58) / 0.42);
      images.albedo.data[offset] = Math.round(colour.r * 255);
      images.albedo.data[offset + 1] = Math.round(colour.g * 255);
      images.albedo.data[offset + 2] = Math.round(colour.b * 255);
      images.albedo.data[offset + 3] = 255;
      putGray(images.roughness.data, offset, fields.roughness);

      const along = profile.axis === 'horizontal' ? u : v;
      const across = profile.axis === 'horizontal' ? v : u;
      const alongEdge = Math.pow(Math.sin(Math.PI * along), 0.42);
      const acrossEdge = profile.id === 'body'
        ? 1
        : Math.pow(Math.sin(Math.PI * across), 0.38);
      const centre = clamp01(alongEdge * acrossEdge);
      const thickness = THREE.MathUtils.lerp(profile.edgeThickness, profile.centreThickness, centre);
      putGray(images.thickness.data, offset, thickness);
    }
  }

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(size - 1, y + 1);
    for (let x = 0; x < size; x += 1) {
      // Wrap horizontally so the cylindrical body normal also closes cleanly.
      const x0 = (x - 1 + size) % size;
      const x1 = (x + 1) % size;
      const dx = heights[y * size + x1] - heights[y * size + x0];
      const dy = heights[y1 * size + x] - heights[y0 * size + x];
      const nx = -dx * 3.2;
      const ny = -dy * 3.2;
      const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const offset = (y * size + x) * 4;
      images.normal.data[offset] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
      images.normal.data[offset + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
      images.normal.data[offset + 2] = Math.round(inverseLength * 255);
      images.normal.data[offset + 3] = 255;
    }
  }

  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.thickness.putImageData(images.thickness, 0, 0);
  return {
    albedo: makeTexture(canvases.albedo, THREE.SRGBColorSpace, anisotropy),
    roughness: makeTexture(canvases.roughness, THREE.NoColorSpace, anisotropy),
    normal: makeTexture(canvases.normal, THREE.NoColorSpace, anisotropy),
    thickness: makeTexture(canvases.thickness, THREE.NoColorSpace, anisotropy),
  };
}

function ensureLongitudinalUv(mesh: THREE.Mesh, axis: 'z' | 'y' = 'z'): void {
  const geometry = mesh.geometry;
  if (geometry.getAttribute('uv')) return;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;
  const minAlong = axis === 'z' ? bounds.min.z : bounds.min.y;
  const maxAlong = axis === 'z' ? bounds.max.z : bounds.max.y;
  const span = Math.max(1e-6, maxAlong - minAlong);
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    uv[index * 2] = (Math.atan2(y, x) / TAU + 1) % 1;
    uv[index * 2 + 1] = ((axis === 'z' ? z : y) - minAlong) / span;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

function materialIdFor(mesh: THREE.Mesh): string {
  const component = mesh.userData.sculptComponent as { material?: string } | undefined;
  return component?.material ?? '';
}

function componentIdFor(mesh: THREE.Mesh): string {
  const component = mesh.userData.sculptComponent as { id?: string } | undefined;
  return component?.id ?? '';
}

function profileFor(mesh: THREE.Mesh): TextureProfile {
  const componentId = componentIdFor(mesh);
  const materialId = materialIdFor(mesh);
  if (componentId === 'wing-left' || componentId === 'wing-right' || materialId === 'wing-membrane') return PROFILES.wing;
  if (componentId === 'tail-leaf') return PROFILES.tail;
  if (materialId === 'water-rim') return PROFILES.rim;
  if (materialId === 'inner-water') return PROFILES.inner;
  if (materialId === 'eye-cyan') return PROFILES.eye;
  return PROFILES.body;
}

function configurePhysicalMaterial(
  material: THREE.MeshPhysicalMaterial,
  profile: TextureProfile,
  textures: WaterTextureSet | null,
): void {
  const isBody = profile.id === 'body';
  const isWing = profile.id === 'wing';
  const isTail = profile.id === 'tail';

  // Reference extractions remain evidence only. They contain the photographed outline,
  // background and highlights, so using them as tiled PBR maps creates scratches and a
  // frosted-plastic surface. The maps below are dedicated, seam-aware water-flow bakes.
  material.map = textures?.albedo ?? null;
  material.roughnessMap = textures?.roughness ?? null;
  material.normalMap = textures?.normal ?? null;
  material.thicknessMap = textures?.thickness ?? null;
  material.aoMap = null;
  material.aoMapIntensity = 0;
  material.bumpMap = null;
  // GLTFExporter treats a non-default bumpScale as an EXT_materials_bump request
  // even when bumpMap is null. Keep the default scalar so the portable GLB emits
  // no empty bump extension.
  material.bumpScale = 1;
  material.displacementMap = null;
  material.displacementScale = 0;
  material.alphaMap = null;
  material.metalnessMap = null;
  material.transmissionMap = null;

  material.color.set(textures ? 0xffffff : profile.mid);
  material.metalness = 0;
  material.roughness = textures ? 1 : (isBody ? 0.12 : isWing ? 0.15 : 0.14);
  material.transmission = isBody ? 0.2 : isWing ? 0.28 : isTail ? 0.26 : profile.id === 'inner' ? 0.38 : 0.3;
  material.ior = 1.333;
  material.thickness = isBody ? 0.46 : isWing ? 0.34 : isTail ? 0.28 : profile.id === 'inner' ? 0.4 : 0.16;
  material.attenuationDistance = isBody ? 1.35 : isWing ? 1.5 : isTail ? 0.95 : 1.1;
  material.attenuationColor.set(isBody ? '#668a94' : isWing ? '#71949d' : isTail ? '#668b94' : '#7199a1');
  material.clearcoat = isBody ? 0.055 : isWing ? 0.04 : 0.045;
  material.clearcoatRoughness = isBody ? 0.14 : 0.16;
  material.specularIntensity = 0.64;
  material.specularColor.set('#d8f5fa');
  material.envMapIntensity = isBody ? 0.38 : isWing ? 0.34 : 0.36;
  material.normalScale.setScalar(profile.normalScale);
  material.emissive.set(isBody ? '#253e45' : isWing ? '#21383e' : '#233b42');
  material.emissiveIntensity = isBody ? 0.055 : 0.04;
  material.opacity = 1;
  material.transparent = false;
  material.alphaTest = 0;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.dithering = true;
  material.userData = {
    ...material.userData,
    aqueousLookVersion: 'waterwing-reference-water-v2',
    runtimeTexturePolicy: 'dedicated-flow-bake',
    referenceExtractionUsage: 'evidence-only',
    textureProfile: profile.id,
  };
  material.needsUpdate = true;
}

export function applyWaterwingAqueousLook(
  model: THREE.Object3D,
  options: WaterwingAqueousLookOptions = {},
): void {
  const requestedSize = options.textureSize ?? 512;
  const textureSize = Math.max(256, Math.min(1024, 2 ** Math.round(Math.log2(requestedSize))));
  const anisotropy = Math.max(1, Math.min(16, Math.round(options.textureAnisotropy ?? 8)));
  const cache = new Map<TextureProfile['id'], WaterTextureSet | null>();

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const profile = profileFor(object);
    if (profile.id === 'body' && !object.geometry.getAttribute('uv')) ensureLongitudinalUv(object, 'z');
    if (profile.id === 'tail' && !object.geometry.getAttribute('uv')) ensureLongitudinalUv(object, 'y');
    if (!cache.has(profile.id)) cache.set(profile.id, createWaterTextureSet(profile, textureSize, anisotropy));
    const textures = cache.get(profile.id) ?? null;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshPhysicalMaterial) configurePhysicalMaterial(material, profile, textures);
    }
  });
  model.userData.aqueousLook = {
    version: 'waterwing-reference-water-v2',
    textureSize,
    textureChannels: ['albedo', 'roughness', 'normal', 'thickness'],
    referenceExtractionUsage: 'evidence-only',
  };
}

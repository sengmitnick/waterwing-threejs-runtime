import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import forwardGlbUrl from '../../../assets/blender/waterwing-forward-v1/waterwing-forward-v1.glb?url';

const MATERIAL_PROFILE = Object.freeze({
  name: 'waterwing-clear-water-diagnostic-d',
  body: Object.freeze({
    transmission: 0.98,
    thickness: 0.52,
    attenuationColor: '#4f9faa',
    attenuationDistance: 0.82,
  }),
  wing: Object.freeze({
    transmission: 1,
    thickness: 0.22,
    attenuationColor: '#76b8c0',
    attenuationDistance: 1.02,
  }),
  tail: Object.freeze({
    transmission: 0.99,
    thickness: 0.34,
    attenuationColor: '#68b0ba',
    attenuationDistance: 0.95,
  }),
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
  opacity: 1,
  transparent: false,
  depthWrite: true,
  side: 'front',
});

const stage = document.querySelector('#stage');
const waterfallVideo = document.querySelector('#waterfall');
const phaseInput = document.querySelector('#phase');
const phaseValue = document.querySelector('#phase-value');
const playButton = document.querySelector('#play');
const backgroundButton = document.querySelector('#background');
const status = document.querySelector('#status b');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.append(renderer.domElement);

const scene = new THREE.Scene();
const waterfallTexture = new THREE.VideoTexture(waterfallVideo);
waterfallTexture.colorSpace = THREE.SRGBColorSpace;
waterfallTexture.minFilter = THREE.LinearFilter;
waterfallTexture.magFilter = THREE.LinearFilter;
waterfallTexture.generateMipmaps = false;
const studioBackground = new THREE.Color(0x071720);
scene.background = waterfallTexture;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.045).texture;

const camera = new THREE.PerspectiveCamera(39, stage.clientWidth / stage.clientHeight, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 4;
controls.maxDistance = 34;
controls.target.set(0, 0.08, 0);

const views = {
  front: { position: [0, 1.8, 16.2], target: [0, 0.06, 0] },
  flight: { position: [9.4, 5.7, 12.6], target: [0, 0.02, -0.25] },
  side: { position: [16.4, 2.4, 0.2], target: [0, 0.04, -0.25] },
  rear: { position: [0, 1.8, -16.2], target: [0, 0.06, 0] },
};

scene.add(new THREE.HemisphereLight(0xe7f7f8, 0x19333d, 0.34));
const key = new THREE.DirectionalLight(0xedffff, 1.04);
key.position.set(-4.5, 6.4, 5.7);
scene.add(key);
const fill = new THREE.DirectionalLight(0x79b9c4, 0.16);
fill.position.set(5, 2.5, 4);
scene.add(fill);
const silverRim = new THREE.DirectionalLight(0xf4ffff, 1.46);
silverRim.position.set(0.2, 4.2, -6.5);
scene.add(silverRim);
const oppositeRim = new THREE.DirectionalLight(0xc8f5fa, 0.74);
oppositeRim.position.set(-5.5, 1.2, -4.8);
scene.add(oppositeRim);

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

function createWeakWaterNormalTexture(size = 256) {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      heights[y * size + x] = fbm(u, v);
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
      const invLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((nx * invLength * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((ny * invLength * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round(invLength * 255);
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
  return texture;
}

function makeClearWaterMaterial(normalMap) {
  const material = new THREE.MeshPhysicalMaterial({
    name: 'MAT_ClearWaterDiagnosticD',
    color: new THREE.Color(MATERIAL_PROFILE.baseColor),
    roughness: MATERIAL_PROFILE.roughness,
    metalness: 0,
    transmission: MATERIAL_PROFILE.body.transmission,
    thickness: MATERIAL_PROFILE.body.thickness,
    attenuationColor: new THREE.Color(MATERIAL_PROFILE.body.attenuationColor),
    attenuationDistance: MATERIAL_PROFILE.body.attenuationDistance,
    ior: MATERIAL_PROFILE.ior,
    clearcoat: MATERIAL_PROFILE.clearcoat,
    clearcoatRoughness: MATERIAL_PROFILE.clearcoatRoughness,
    specularIntensity: MATERIAL_PROFILE.specularIntensity,
    specularColor: new THREE.Color(MATERIAL_PROFILE.specularColor),
    envMapIntensity: MATERIAL_PROFILE.envMapIntensity,
    normalMap,
    normalScale: new THREE.Vector2(MATERIAL_PROFILE.normalScale, MATERIAL_PROFILE.normalScale),
    opacity: MATERIAL_PROFILE.opacity,
    transparent: MATERIAL_PROFILE.transparent,
    depthWrite: MATERIAL_PROFILE.depthWrite,
    side: THREE.FrontSide,
    dithering: true,
  });
  const edgeColor = new THREE.Color(MATERIAL_PROFILE.edgeTint);
  const bodyAttenuation = new THREE.Color(MATERIAL_PROFILE.body.attenuationColor);
  const wingAttenuation = new THREE.Color(MATERIAL_PROFILE.wing.attenuationColor);
  const tailAttenuation = new THREE.Color(MATERIAL_PROFILE.tail.attenuationColor);
  material.onBeforeCompile = shader => {
    shader.uniforms.wwEdgeColor = { value: edgeColor };
    shader.uniforms.wwEdgeStrength = { value: MATERIAL_PROFILE.edgeStrength };
    shader.uniforms.wwEdgePower = { value: MATERIAL_PROFILE.edgePower };
    shader.uniforms.wwTransmission = { value: new THREE.Vector3(
      MATERIAL_PROFILE.body.transmission,
      MATERIAL_PROFILE.wing.transmission,
      MATERIAL_PROFILE.tail.transmission,
    ) };
    shader.uniforms.wwThickness = { value: new THREE.Vector3(
      MATERIAL_PROFILE.body.thickness,
      MATERIAL_PROFILE.wing.thickness,
      MATERIAL_PROFILE.tail.thickness,
    ) };
    shader.uniforms.wwAttenuationDistance = { value: new THREE.Vector3(
      MATERIAL_PROFILE.body.attenuationDistance,
      MATERIAL_PROFILE.wing.attenuationDistance,
      MATERIAL_PROFILE.tail.attenuationDistance,
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
  material.customProgramCacheKey = () => MATERIAL_PROFILE.name;
  material.userData = { materialProfile: MATERIAL_PROFILE };
  return material;
}

function regionForBoneName(name) {
  if (/^wing_[LR]_/.test(name)) return 1;
  if (/^tail_/.test(name)) return 2;
  return 0;
}

function addContinuousSkinRegionWeights(mesh) {
  const geometry = mesh.geometry.clone();
  mesh.geometry = geometry;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const position = geometry.getAttribute('position');
  if (!skinIndex || !skinWeight || !mesh.skeleton) return { wingVertices: 0, tailVertices: 0 };
  const regionWeights = new Float32Array(position.count * 2);
  let wingVertices = 0;
  let tailVertices = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    let wingWeight = 0;
    let tailWeight = 0;
    for (let influence = 0; influence < 4; influence += 1) {
      const boneIndex = skinIndex.getComponent(vertex, influence);
      const weight = skinWeight.getComponent(vertex, influence);
      const region = regionForBoneName(mesh.skeleton.bones[boneIndex]?.name ?? '');
      if (region === 1) wingWeight += weight;
      else if (region === 2) tailWeight += weight;
    }
    regionWeights[vertex * 2] = wingWeight;
    regionWeights[vertex * 2 + 1] = tailWeight;
    if (wingWeight > 0.5) wingVertices += 1;
    if (tailWeight > 0.5) tailVertices += 1;
  }
  geometry.setAttribute('wwRegionWeight', new THREE.BufferAttribute(regionWeights, 2));
  return { wingVertices, tailVertices, totalVertices: position.count };
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(48, 48, 0, 48, 48, 48);
  gradient.addColorStop(0, 'rgba(222, 255, 255, .55)');
  gradient.addColorStop(0.12, 'rgba(128, 236, 242, .22)');
  gradient.addColorStop(0.46, 'rgba(78, 194, 205, .06)');
  gradient.addColorStop(1, 'rgba(65, 174, 190, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 96, 96);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function replaceMaterials(root) {
  const normalMap = createWeakWaterNormalTexture();
  const material = makeClearWaterMaterial(normalMap);
  let body = null;
  let regionCounts = null;
  root.traverse(object => {
    if (!object.isMesh) return;
    object.frustumCulled = false;
    object.castShadow = true;
    object.receiveShadow = true;
    const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    if (object.name === 'WaterwingBody') {
      body = object;
      regionCounts = addContinuousSkinRegionWeights(object);
      object.material = material;
      return;
    }
    if (object.name === 'WeakWaterCore' || sourceMaterial?.name === 'MAT_CoreWeak') {
      object.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xb9fbff,
        transparent: true,
        opacity: 0.29,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: true,
      }));
      glow.name = 'DiagnosticWeakCoreGlow';
      glow.scale.setScalar(0.34);
      glow.renderOrder = 8;
      object.add(glow);
      return;
    }
    object.material = new THREE.MeshPhysicalMaterial({
      color: 0xbfe6e9,
      roughness: 0.1,
      transmission: 0.68,
      thickness: 0.18,
      attenuationColor: 0x7fc6ce,
      attenuationDistance: 1.3,
      clearcoat: 0.2,
      envMapIntensity: 0.8,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      side: THREE.FrontSide,
    });
  });
  if (!body) throw new Error('WaterwingBody missing');
  return { body, material, regionCounts };
}

let root;
let mixer;
let clip;
let materialDiagnostic;
let currentPhase = Number(phaseInput.value);
let playing = true;
let waterfallMode = true;

function updateBackgroundCover() {
  const mediaAspect = (waterfallVideo.videoWidth || 1920) / Math.max(1, waterfallVideo.videoHeight || 1080);
  const viewportAspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  waterfallTexture.repeat.set(1, 1);
  waterfallTexture.offset.set(0, 0);
  if (viewportAspect < mediaAspect) {
    const visibleWidth = viewportAspect / mediaAspect;
    waterfallTexture.repeat.x = visibleWidth;
    waterfallTexture.offset.x = (1 - visibleWidth) * 0.5;
  } else {
    const visibleHeight = mediaAspect / viewportAspect;
    waterfallTexture.repeat.y = visibleHeight;
    waterfallTexture.offset.y = (1 - visibleHeight) * 0.5;
  }
  waterfallTexture.updateMatrix();
}

function setView(name) {
  const preset = views[name];
  if (!preset) throw new Error(`Unknown view ${name}`);
  camera.position.fromArray(preset.position);
  controls.target.fromArray(preset.target);
  controls.update();
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
}

function setPhase(value, pause = true) {
  currentPhase = THREE.MathUtils.clamp(Number(value), 0, 1);
  if (pause) playing = false;
  if (mixer && clip) mixer.setTime(currentPhase * clip.duration);
  if (root) root.updateMatrixWorld(true);
  phaseInput.value = String(currentPhase);
  phaseValue.textContent = `${Math.round(currentPhase * 100)}%`;
  playButton.textContent = playing ? '暂停' : '播放';
  playButton.classList.toggle('active', playing);
}

function setBackground(mode) {
  waterfallMode = mode === 'waterfall';
  scene.background = waterfallMode ? waterfallTexture : studioBackground;
  backgroundButton.textContent = waterfallMode ? '暗底审阅' : '瀑布实景';
  if (waterfallMode) waterfallVideo.play().catch(() => {});
  else waterfallVideo.pause();
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
phaseInput.addEventListener('input', () => setPhase(phaseInput.value));
playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.textContent = playing ? '暂停' : '播放';
  playButton.classList.toggle('active', playing);
});
backgroundButton.addEventListener('click', () => setBackground(waterfallMode ? 'studio' : 'waterfall'));
waterfallVideo.addEventListener('loadedmetadata', updateBackgroundCover);

window.addEventListener('resize', () => {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  updateBackgroundCover();
});

function getState() {
  return {
    ready: Boolean(root),
    phase: currentPhase,
    playing,
    waterfallMode,
    materialProfile: MATERIAL_PROFILE,
    bodyMaterial: root?.getObjectByName('WaterwingBody')?.material?.name ?? null,
    regionCounts: materialDiagnostic?.regionCounts ?? null,
    tailThroughBodyPolicy: 'opaque-render-pass-with-physical-transmission',
  };
}

window.waterwingClearWaterLab = { ready: false, setView, setPhase, setBackground, getState };

try {
  const gltf = await new GLTFLoader().loadAsync(forwardGlbUrl);
  root = gltf.scene;
  root.name = 'DiagnosticClearWaterForward';
  materialDiagnostic = replaceMaterials(root);
  scene.add(root);
  clip = THREE.AnimationClip.findByName(gltf.animations, 'WW_forward_loop_v1') ?? gltf.animations[0];
  mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();
  setView('front');
  setPhase(currentPhase, false);
  updateBackgroundCover();
  setBackground('waterfall');
  status.textContent = 'READY';
  window.waterwingClearWaterLab = { ready: true, setView, setPhase, setBackground, getState };
} catch (error) {
  console.error(error);
  status.textContent = `ERROR: ${error.message}`;
  window.waterwingClearWaterLab = { ready: false, error: error.message };
}

const clock = new THREE.Clock();
function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (playing && clip) setPhase((currentPhase + delta / clip.duration) % 1, false);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();

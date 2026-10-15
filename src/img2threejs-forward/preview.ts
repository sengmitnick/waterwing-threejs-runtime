import * as THREE from 'three';
import {
  configureWaterwingForwardPropulsionRenderer,
  createWaterwingForwardPropulsionEnvironment,
  createWaterwingForwardPropulsionInspectControls,
  createWaterwingForwardPropulsionLookDevLights,
  createWaterwingForwardPropulsionModel,
  frameWaterwingForwardPropulsionCamera,
} from './createFinishedWaterwingForwardModel';

type PreviewView = 'forward' | 'front' | 'side' | 'rear' | 'top';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const motionToggle = document.querySelector<HTMLButtonElement>('#motion-toggle')!;
const backgroundToggle = document.querySelector<HTMLButtonElement>('#background-toggle')!;
const viewControls = document.querySelector<HTMLElement>('#view-controls')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
configureWaterwingForwardPropulsionRenderer(renderer);
renderer.toneMappingExposure = 0.94;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1f3440');
scene.environment = createWaterwingForwardPropulsionEnvironment(renderer);
scene.add(createWaterwingForwardPropulsionLookDevLights('neutral'));

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 80);
const model = createWaterwingForwardPropulsionModel({
  qualityPriority: 'reference-fidelity',
  castShadow: true,
  receiveShadow: true,
  textureAnisotropy: 8,
});
scene.add(model);

type TextureSlots = {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  thicknessMap: THREE.Texture | null;
  aoMap: THREE.Texture | null;
  bumpMap: THREE.Texture | null;
  displacementMap: THREE.Texture | null;
  alphaMap: THREE.Texture | null;
};

const materialTextureState = new Map<THREE.MeshStandardMaterial, TextureSlots>();
model.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    if (!(material instanceof THREE.MeshStandardMaterial) || materialTextureState.has(material)) continue;
    materialTextureState.set(material, {
      map: material.map,
      normalMap: material.normalMap,
      roughnessMap: material.roughnessMap,
      thicknessMap: material instanceof THREE.MeshPhysicalMaterial ? material.thicknessMap : null,
      aoMap: material.aoMap,
      bumpMap: material.bumpMap,
      displacementMap: material.displacementMap,
      alphaMap: material.alphaMap,
    });
    material.needsUpdate = true;
  }
});

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
};
const body = runtime.nodes.body;
const leftWing = runtime.nodes['wing-left'];
const rightWing = runtime.nodes['wing-right'];
const tail = runtime.nodes['tail-leaf'];
const leftWingMesh = runtime.meshes['wing-left'];
const rightWingMesh = runtime.meshes['wing-right'];

const base = {
  bodyPosition: body.position.clone(),
  bodyRotation: body.rotation.clone(),
  leftRotation: leftWing.rotation.clone(),
  rightRotation: rightWing.rotation.clone(),
  tailRotation: tail.rotation.clone(),
};

const controls = createWaterwingForwardPropulsionInspectControls(camera, canvas);
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 14;

const viewPreset: Record<PreviewView, { azimuthDeg: number; elevationDeg: number; margin: number }> = {
  forward: { azimuthDeg: 36, elevationDeg: 70, margin: 0.9 },
  front: { azimuthDeg: 0, elevationDeg: 3, margin: 1.2 },
  side: { azimuthDeg: 90, elevationDeg: 7, margin: 1.22 },
  rear: { azimuthDeg: 180, elevationDeg: 10, margin: 1.2 },
  top: { azimuthDeg: 0, elevationDeg: 88, margin: 1.28 },
};

let selectedView: PreviewView = 'forward';
let motionEnabled = true;
let fixedPhase: number | null = null;
let lightBackground = false;
const clock = new THREE.Clock();

function frame(view: PreviewView): void {
  selectedView = view;
  const preset = viewPreset[view];
  frameWaterwingForwardPropulsionCamera(camera, model, preset);
  const box = new THREE.Box3().setFromObject(model);
  controls.target.copy(box.getCenter(new THREE.Vector3()));
  controls.update();
  viewControls.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.view === view);
  });
}

function frameAngles(azimuthDeg: number, elevationDeg: number, margin = 1.22): void {
  frameWaterwingForwardPropulsionCamera(camera, model, { azimuthDeg, elevationDeg, margin });
  const box = new THREE.Box3().setFromObject(model);
  controls.target.copy(box.getCenter(new THREE.Vector3()));
  controls.update();
}

function setPhase(phase: number): void {
  const cycle = ((phase % 1) + 1) % 1;
  const angle = cycle * Math.PI * 2;
  const drive = Math.sin(angle);
  const secondary = Math.sin(angle - 0.55);
  const compression = 0.5 + 0.5 * Math.cos(angle);
  const powerStroke = 0.5 + 0.5 * Math.sin(angle);

  // Same temporal phase, mirrored rotation signs: both paddles press water down/back together.
  leftWing.rotation.set(
    base.leftRotation.x + 0.06 * secondary,
    base.leftRotation.y - 0.055 * drive,
    base.leftRotation.z + 0.13 * drive,
  );
  rightWing.rotation.set(
    base.rightRotation.x + 0.06 * secondary,
    base.rightRotation.y + 0.055 * drive,
    base.rightRotation.z - 0.13 * drive,
  );
  body.position.set(
    base.bodyPosition.x,
    base.bodyPosition.y - 0.035 * compression,
    base.bodyPosition.z + 0.045 * drive,
  );
  body.rotation.set(
    base.bodyRotation.x + 0.025 * secondary,
    base.bodyRotation.y,
    base.bodyRotation.z,
  );
  tail.rotation.set(
    base.tailRotation.x + 0.035 * Math.sin(angle - 0.8),
    base.tailRotation.y + 0.085 * Math.sin(angle - 0.9),
    base.tailRotation.z,
  );
  if (leftWingMesh.morphTargetInfluences) leftWingMesh.morphTargetInfluences[0] = powerStroke;
  if (rightWingMesh.morphTargetInfluences) rightWingMesh.morphTargetInfluences[0] = powerStroke;
}

function resize(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    frame(selectedView);
  }
}

function render(): void {
  resize();
  const elapsed = clock.getElapsedTime();
  setPhase(fixedPhase ?? (motionEnabled ? elapsed / 2 : 0.16));
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function setMotion(enabled: boolean): void {
  motionEnabled = enabled;
  fixedPhase = null;
  motionToggle.classList.toggle('active', enabled);
  motionToggle.textContent = `推进循环：${enabled ? '开' : '关'}`;
}

function setBackground(light: boolean): void {
  lightBackground = light;
  document.body.classList.toggle('light', light);
  scene.background = new THREE.Color(light ? '#E6EFF0' : '#1F3440');
  backgroundToggle.textContent = light ? '深色背景' : '浅色背景';
}

function setDiagnosticMode(mapStripped: boolean): void {
  for (const [material, state] of materialTextureState) {
    material.normalMap = mapStripped ? null : state.normalMap;
    material.roughnessMap = mapStripped ? null : state.roughnessMap;
    if (material instanceof THREE.MeshPhysicalMaterial) {
      material.thicknessMap = mapStripped ? null : state.thicknessMap;
    }
    material.aoMap = mapStripped ? null : state.aoMap;
    material.bumpMap = mapStripped ? null : state.bumpMap;
    material.displacementMap = mapStripped ? null : state.displacementMap;
    material.alphaMap = mapStripped ? null : state.alphaMap;
    material.needsUpdate = true;
  }
}

viewControls.addEventListener('click', (event) => {
  const view = (event.target as HTMLElement).dataset.view as PreviewView | undefined;
  if (view && viewPreset[view]) frame(view);
});
motionToggle.addEventListener('click', () => setMotion(!motionEnabled));
backgroundToggle.addEventListener('click', () => setBackground(!lightBackground));

const query = new URLSearchParams(location.search);
const queryView = query.get('view') as PreviewView | null;
if (query.has('phase')) {
  fixedPhase = Number(query.get('phase')) || 0;
  motionEnabled = false;
}
if (query.get('background') === 'light') setBackground(true);
frame(queryView && viewPreset[queryView] ? queryView : 'forward');

const api = {
  ready: true,
  model,
  runtime,
  setView: frame,
  setCameraAngles: frameAngles,
  setMotion,
  setPhase: (phase: number) => { fixedPhase = phase; motionEnabled = false; },
  setBackground,
  setDiagnosticMode,
  getState: () => ({ selectedView, motionEnabled, fixedPhase, lightBackground, components: Object.keys(runtime.nodes) }),
};
(window as typeof window & { waterwingForwardPreview?: typeof api }).waterwingForwardPreview = api;

status.innerHTML = '<strong>推进专用模型 · 深层水体材质 V2</strong><br />已改为独立纵向水流纹、厚度吸收与低粗糙湿面；明暗背景均可切换检查。';
render();

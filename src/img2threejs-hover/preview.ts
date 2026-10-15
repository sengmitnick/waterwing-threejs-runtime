import * as THREE from 'three';
import {
  configureWaterwingHoverRenderer,
  createWaterwingHoverEnvironment,
  createWaterwingHoverInspectControls,
  createWaterwingHoverLookDevLights,
  createWaterwingHoverModel,
  frameWaterwingHoverCamera,
} from './createFinishedWaterwingHoverModel';

type PreviewView = 'front' | 'quarter' | 'side' | 'rear' | 'top';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const motionToggle = document.querySelector<HTMLButtonElement>('#motion-toggle')!;
const backgroundToggle = document.querySelector<HTMLButtonElement>('#background-toggle')!;
const viewControls = document.querySelector<HTMLElement>('#view-controls')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
configureWaterwingHoverRenderer(renderer);
renderer.toneMappingExposure = 0.94;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1f3440');
scene.environment = createWaterwingHoverEnvironment(renderer);
scene.add(createWaterwingHoverLookDevLights('neutral'));

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 80);
const model = createWaterwingHoverModel({
  qualityPriority: 'reference-fidelity',
  castShadow: true,
  receiveShadow: true,
  textureAnisotropy: 8,
});
scene.add(model);

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
};
const body = runtime.nodes.body;
const leftWing = runtime.nodes['wing-left'];
const rightWing = runtime.nodes['wing-right'];
const tail = runtime.nodes['tail-leaf'];

const base = {
  bodyPosition: body.position.clone(),
  bodyRotation: body.rotation.clone(),
  leftRotation: leftWing.rotation.clone(),
  rightRotation: rightWing.rotation.clone(),
  tailRotation: tail.rotation.clone(),
};

type MaterialState = {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  aoMap: THREE.Texture | null;
  bumpMap: THREE.Texture | null;
  displacementMap: THREE.Texture | null;
  transmission: number | null;
  opacity: number;
  transparent: boolean;
};
const materialState = new Map<THREE.MeshStandardMaterial, MaterialState>();
model.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    if (!(material instanceof THREE.MeshStandardMaterial) || materialState.has(material)) continue;
    material.side = THREE.FrontSide;
    materialState.set(material, {
      color: material.color.clone(),
      emissive: material.emissive.clone(),
      emissiveIntensity: material.emissiveIntensity,
      map: material.map,
      normalMap: material.normalMap,
      roughnessMap: material.roughnessMap,
      aoMap: material.aoMap,
      bumpMap: material.bumpMap,
      displacementMap: material.displacementMap,
      transmission: material instanceof THREE.MeshPhysicalMaterial ? material.transmission : null,
      opacity: material.opacity,
      transparent: material.transparent,
    });
  }
});

const controls = createWaterwingHoverInspectControls(camera, canvas);
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 14;

const viewPreset: Record<PreviewView, { azimuthDeg: number; elevationDeg: number; margin: number }> = {
  front: { azimuthDeg: 0, elevationDeg: 0, margin: 1.36 },
  quarter: { azimuthDeg: 35, elevationDeg: 10, margin: 1.38 },
  side: { azimuthDeg: 90, elevationDeg: 3, margin: 1.24 },
  rear: { azimuthDeg: 180, elevationDeg: 0, margin: 1.36 },
  top: { azimuthDeg: 0, elevationDeg: 82, margin: 1.34 },
};

let selectedView: PreviewView = 'front';
let motionEnabled = true;
let fixedPhase: number | null = null;
let lightBackground = false;
const clock = new THREE.Clock();
const durationSeconds = 3.8;

function frame(view: PreviewView): void {
  selectedView = view;
  frameWaterwingHoverCamera(camera, model, viewPreset[view]);
  const box = new THREE.Box3().setFromObject(model);
  controls.target.copy(box.getCenter(new THREE.Vector3()));
  controls.update();
  viewControls.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.view === view);
  });
}

function frameAngles(azimuthDeg: number, elevationDeg: number, margin = 1.34): void {
  frameWaterwingHoverCamera(camera, model, { azimuthDeg, elevationDeg, margin });
  const box = new THREE.Box3().setFromObject(model);
  controls.target.copy(box.getCenter(new THREE.Vector3()));
  controls.update();
}

function setPhase(phase: number): void {
  const cycle = ((phase % 1) + 1) % 1;
  const angle = cycle * Math.PI * 2;
  const wingPress = Math.sin(angle);
  const buoyancy = Math.sin(angle - 0.38);
  const tailAngle = angle - Math.PI * 2 * 0.17;

  // One temporal phase, mirrored signs: both fan wings press and recover together.
  // The base geometry remains high and broad; the loop never folds into the propulsion pose.
  leftWing.rotation.set(
    base.leftRotation.x + 0.025 * wingPress,
    base.leftRotation.y,
    base.leftRotation.z + 0.1 * wingPress,
  );
  rightWing.rotation.set(
    base.rightRotation.x + 0.025 * wingPress,
    base.rightRotation.y,
    base.rightRotation.z - 0.1 * wingPress,
  );
  body.position.set(
    base.bodyPosition.x,
    base.bodyPosition.y + 0.048 * buoyancy,
    base.bodyPosition.z + 0.012 * Math.sin(angle - 0.62),
  );
  body.rotation.set(
    base.bodyRotation.x + 0.018 * Math.sin(angle - 0.55),
    base.bodyRotation.y,
    base.bodyRotation.z + 0.01 * Math.sin(angle + 0.25),
  );
  tail.rotation.set(
    base.tailRotation.x + 0.025 * Math.sin(tailAngle - 0.18),
    base.tailRotation.y + 0.045 * Math.sin(tailAngle),
    base.tailRotation.z + 0.09 * Math.sin(tailAngle),
  );
}

function poseSnapshot(): number[] {
  return [
    ...body.position.toArray(),
    body.rotation.x, body.rotation.y, body.rotation.z,
    leftWing.rotation.x, leftWing.rotation.y, leftWing.rotation.z,
    rightWing.rotation.x, rightWing.rotation.y, rightWing.rotation.z,
    tail.rotation.x, tail.rotation.y, tail.rotation.z,
  ];
}

function resize(): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frame(selectedView);
  }
}

function render(): void {
  resize();
  const phase = fixedPhase ?? (motionEnabled ? clock.getElapsedTime() / durationSeconds : 0);
  setPhase(phase);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function setMotion(enabled: boolean): void {
  motionEnabled = enabled;
  fixedPhase = null;
  motionToggle.classList.toggle('active', enabled);
  motionToggle.textContent = `悬浮循环：${enabled ? '开' : '关'}`;
}

function setBackground(light: boolean): void {
  lightBackground = light;
  document.body.classList.toggle('light', light);
  scene.background = new THREE.Color(light ? '#E6EFF0' : '#1F3440');
  backgroundToggle.textContent = light ? '深色背景' : '浅色背景';
}

function setDiagnosticMode(mapStripped: boolean): void {
  for (const [material, saved] of materialState) {
    material.normalMap = mapStripped ? null : saved.normalMap;
    material.roughnessMap = mapStripped ? null : saved.roughnessMap;
    material.aoMap = mapStripped ? null : saved.aoMap;
    material.bumpMap = mapStripped ? null : saved.bumpMap;
    material.displacementMap = mapStripped ? null : saved.displacementMap;
    material.needsUpdate = true;
  }
}

function setSilhouetteMode(enabled: boolean): void {
  for (const [material, saved] of materialState) {
    material.color.copy(enabled ? new THREE.Color(0x153640) : saved.color);
    material.emissive.copy(enabled ? new THREE.Color(0x000000) : saved.emissive);
    material.emissiveIntensity = enabled ? 0 : saved.emissiveIntensity;
    material.map = enabled ? null : saved.map;
    material.normalMap = enabled ? null : saved.normalMap;
    material.roughnessMap = enabled ? null : saved.roughnessMap;
    material.aoMap = enabled ? null : saved.aoMap;
    material.bumpMap = enabled ? null : saved.bumpMap;
    material.displacementMap = enabled ? null : saved.displacementMap;
    if (material instanceof THREE.MeshPhysicalMaterial && saved.transmission !== null) {
      material.transmission = enabled ? 0 : saved.transmission;
    }
    material.opacity = enabled ? 1 : saved.opacity;
    material.transparent = enabled ? false : saved.transparent;
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
frame(queryView && viewPreset[queryView] ? queryView : 'front');

const api = {
  ready: true,
  model,
  runtime,
  durationSeconds,
  setView: frame,
  setCameraAngles: frameAngles,
  setMotion,
  setPhase: (phase: number) => { fixedPhase = phase; motionEnabled = false; setPhase(phase); },
  setBackground,
  setDiagnosticMode,
  setSilhouetteMode,
  getPoseSnapshot: () => poseSnapshot(),
  getState: () => ({ selectedView, motionEnabled, fixedPhase, lightBackground, durationSeconds, components: Object.keys(runtime.nodes) }),
};
(window as typeof window & { waterwingHoverPreview?: typeof api }).waterwingHoverPreview = api;

status.innerHTML = '<strong>悬浮专用模型 · 深层水体材质 V2</strong><br />保留独立悬浮几何与 3.8 秒同相运动学，并同步纵向水流纹、厚度吸收和湿面高光。';
render();

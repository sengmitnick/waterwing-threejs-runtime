import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { createWaterwingDirectChargeModel } from './createWaterwingDirectChargeModel.ts';
import { createWaterwingDirectCastModel } from './createWaterwingDirectCastModel.ts';

type DirectAction = 'charge' | 'cast';
type PreviewView = 'front' | 'quarter' | 'side';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const actionControls = document.querySelector<HTMLElement>('#action-controls')!;
const viewControls = document.querySelector<HTMLElement>('#view-controls')!;
const motionToggle = document.querySelector<HTMLButtonElement>('#motion-toggle')!;
const backgroundToggle = document.querySelector<HTMLButtonElement>('#background-toggle')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1f3440');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
scene.add(new THREE.HemisphereLight('#d8edf2', '#10222c', 0.32));
const key = new THREE.DirectionalLight('#d6edf4', 1.65);
key.position.set(-4.5, 6.5, 5.5);
key.castShadow = true;
scene.add(key);
const rim = new THREE.DirectionalLight('#a9f3ff', 1.15);
rim.position.set(4.5, 2.2, -5.5);
scene.add(rim);
const oppositeRim = new THREE.DirectionalLight('#d2f8ff', 0.62);
oppositeRim.position.set(-5.2, 1.6, -4.8);
scene.add(oppositeRim);

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 80);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 4.5;
controls.maxDistance = 13;
controls.target.set(0, 0, 0.2);

const models = {
  charge: createWaterwingDirectChargeModel({ textureSize: 256, textureAnisotropy: 8 }),
  cast: createWaterwingDirectCastModel({ textureSize: 256, textureAnisotropy: 8 }),
};
let activeAction: DirectAction = 'charge';
let activeModel = models.charge;
let selectedView: PreviewView = 'front';
let motionEnabled = true;
let fixedPhase: number | null = null;
let lightBackground = false;
const clock = new THREE.Clock();

const viewPositions: Record<PreviewView, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.3, 7.8),
  quarter: new THREE.Vector3(4.5, 1.35, 7),
  side: new THREE.Vector3(8.2, 0.35, 0.15),
};

function setView(view: PreviewView): void {
  selectedView = view;
  camera.position.copy(viewPositions[view]);
  camera.lookAt(controls.target);
  controls.update();
  viewControls.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.view === view);
  });
}

function actionStatus(): string {
  return activeAction === 'charge'
    ? '<strong>前排直射 · 蓄力专用模型</strong><br />短促压缩、双翼向前合杯，水量沿直线汇聚到口前；没有环绕旋转。'
    : '<strong>前排直射 · 发射专用模型</strong><br />双翼同步后压，水团沿镜头轴释放，身体向后受力并在同一注册点恢复。';
}

function setAction(action: DirectAction): void {
  scene.remove(activeModel);
  activeAction = action;
  activeModel = models[action];
  scene.add(activeModel);
  actionControls.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.action === action);
  });
  status.innerHTML = actionStatus();
  if (fixedPhase !== null) activeModel.userData.actionRuntime.update(fixedPhase, { intensity: 1 });
}

function setPhase(phase: number): void {
  fixedPhase = THREE.MathUtils.clamp(phase, 0, 1);
  motionEnabled = false;
  motionToggle.classList.remove('active');
  activeModel.userData.actionRuntime.update(fixedPhase, { intensity: 1 });
}

function setMotion(enabled: boolean): void {
  motionEnabled = enabled;
  fixedPhase = null;
  clock.start();
  motionToggle.classList.toggle('active', enabled);
  motionToggle.textContent = `动作循环：${enabled ? '开' : '关'}`;
}

function setBackground(light: boolean): void {
  lightBackground = light;
  document.body.classList.toggle('light', light);
  scene.background = new THREE.Color(light ? '#e6eff0' : '#1f3440');
  backgroundToggle.textContent = light ? '深色背景' : '浅色背景';
}

function resize(): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const ratio = renderer.getPixelRatio();
  if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(height * ratio)) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function render(): void {
  resize();
  const duration = activeModel.userData.actionRuntime.durationSeconds;
  const phase = fixedPhase ?? (motionEnabled ? (clock.getElapsedTime() / duration) % 1 : 0);
  activeModel.userData.actionRuntime.update(phase, { intensity: 1 });
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

actionControls.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).dataset.action as DirectAction | undefined;
  if (action && models[action]) setAction(action);
});
viewControls.addEventListener('click', (event) => {
  const view = (event.target as HTMLElement).dataset.view as PreviewView | undefined;
  if (view && viewPositions[view]) setView(view);
});
motionToggle.addEventListener('click', () => setMotion(!motionEnabled));
backgroundToggle.addEventListener('click', () => setBackground(!lightBackground));

const query = new URLSearchParams(location.search);
const requestedAction = query.get('action') as DirectAction | null;
if (requestedAction && models[requestedAction]) activeAction = requestedAction;
activeModel = models[activeAction];
scene.add(activeModel);
if (query.has('phase')) setPhase(Number(query.get('phase')) || 0);
if (query.get('background') === 'light') setBackground(true);
setView((query.get('view') as PreviewView | null) ?? 'front');
setAction(activeAction);

const api = {
  ready: true,
  models,
  get activeModel() { return activeModel; },
  setAction,
  setPhase,
  setMotion,
  setView,
  setBackground,
  getState: () => ({ action: activeAction, phase: fixedPhase, motionEnabled, selectedView, lightBackground }),
};
(window as typeof window & { waterwingDirectPreview?: typeof api }).waterwingDirectPreview = api;
render();

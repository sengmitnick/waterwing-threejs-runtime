import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { createWaterwingDefeatModel } from './createWaterwingDefeatModel';

declare global {
  interface Window {
    waterwingDefeatPreview?: any;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
if (!canvas) throw new Error('Missing #viewport canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const pmrem = new THREE.PMREMGenerator(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#07151d');
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
camera.position.set(0.4, 0.05, 7.55);
camera.lookAt(0, -0.2, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, -0.2, 0);
controls.enableDamping = true;
controls.minDistance = 4.4;
controls.maxDistance = 10;

scene.add(new THREE.HemisphereLight('#d9f1f5', '#102630', 1.55));
const key = new THREE.DirectionalLight('#e4fbff', 4.2);
key.position.set(-4.5, 5.5, 5.2);
key.castShadow = true;
scene.add(key);
const rim = new THREE.DirectionalLight('#65cad8', 3.1);
rim.position.set(4.5, 2.2, -4.8);
scene.add(rim);

const basin = new THREE.Mesh(
  new THREE.CircleGeometry(1.75, 96),
  new THREE.MeshPhysicalMaterial({
    color: '#315d69',
    roughness: 0.24,
    metalness: 0,
    transmission: 0.12,
    ior: 1.333,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
  }),
);
basin.rotation.x = -Math.PI / 2;
basin.position.y = -1.75;
basin.receiveShadow = true;
scene.add(basin);

const model = createWaterwingDefeatModel({ textureSize: 512, textureAnisotropy: 8 });
scene.add(model);
const runtime = model.userData.actionRuntime;

const query = new URLSearchParams(location.search);
const initialProgress = query.has('progress') ? THREE.MathUtils.clamp(Number(query.get('progress')) || 0, 0, 1) : 0;
let progress = initialProgress;
let playing = !query.has('progress');
let playStart = performance.now() - progress * runtime.durationSeconds * 1000;
let lightBackground = false;

const slider = document.querySelector<HTMLInputElement>('#progress');
const playButton = document.querySelector<HTMLButtonElement>('#play-toggle');
const backgroundButton = document.querySelector<HTMLButtonElement>('#background-toggle');
const status = document.querySelector<HTMLElement>('#status');

function setProgress(value: number): void {
  progress = THREE.MathUtils.clamp(value, 0, 1);
  runtime.update(progress, { frame: Math.round(progress * runtime.durationSeconds * 30) });
  if (slider) slider.value = String(progress);
  const state = model.userData.defeatState;
  if (status) {
    status.innerHTML = `<strong>${state.phase}</strong><br />进度 ${(progress * 100).toFixed(0)}% · 翼张力 ${(state.wingTension * 100).toFixed(0)}% · 水幕 ${state.visibleCurtainStrands}`;
  }
}

function setView(view: string): void {
  const positions: Record<string, [number, number, number]> = {
    front: [0.4, 0.05, 7.55],
    quarter: [5.15, 2.0, 5.95],
    side: [7.35, 0.15, 0.25],
    top: [0.1, 7.85, 0.5],
  };
  camera.position.fromArray(positions[view] ?? positions.front);
  controls.target.set(0, -0.2, 0);
  controls.update();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
}

slider?.addEventListener('input', () => {
  playing = false;
  playButton?.classList.remove('active');
  if (playButton) playButton.textContent = '播放一次';
  setProgress(Number(slider.value));
});

playButton?.addEventListener('click', () => {
  if (progress >= 0.999) setProgress(0);
  playing = !playing;
  playStart = performance.now() - progress * runtime.durationSeconds * 1000;
  playButton.classList.toggle('active', playing);
  playButton.textContent = playing ? '暂停' : '播放一次';
});

backgroundButton?.addEventListener('click', () => {
  lightBackground = !lightBackground;
  document.body.classList.toggle('light', lightBackground);
  scene.background = new THREE.Color(lightBackground ? '#d9e8eb' : '#07151d');
  backgroundButton.textContent = lightBackground ? '深色背景' : '浅色背景';
});

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view ?? 'front'));
});

function resize(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width === Math.round(width * renderer.getPixelRatio()) && canvas.height === Math.round(height * renderer.getPixelRatio())) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function render(time: number): void {
  if (playing) {
    const elapsed = (time - playStart) / 1000;
    setProgress(Math.min(1, elapsed / runtime.durationSeconds));
    if (progress >= 1) {
      playing = false;
      playButton?.classList.remove('active');
      if (playButton) playButton.textContent = '重新播放';
    }
  }
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

setView(query.get('view') ?? 'front');
setProgress(initialProgress);

window.waterwingDefeatPreview = {
  ready: true,
  model,
  runtime,
  renderer,
  scene,
  camera,
  setProgress: (value: number) => {
    playing = false;
    setProgress(value);
  },
  getState: () => ({ progress, playing, lightBackground, durationSeconds: runtime.durationSeconds }),
  getActionState: () => ({ ...model.userData.defeatState }),
};

requestAnimationFrame(render);

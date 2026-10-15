import * as THREE from 'three';

import { createEnemyDirectWaterball } from './createEnemyDirectWaterball';
import { createEnemyLobWaterball } from './createEnemyLobWaterball';
import { createPlayerWaterPulse } from './createPlayerWaterPulse';
import { createLensWaterImpact, createMonsterWaterImpact } from './createWaterImpacts';

type PreviewKind = 'player-pulse' | 'enemy-direct' | 'enemy-lob' | 'monster-impact' | 'lens-impact';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const controls = document.querySelector<HTMLElement>('#kind-controls')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#172f39');
scene.add(new THREE.HemisphereLight(0xdff8ff, 0x18313b, 1.25));
const key = new THREE.DirectionalLight(0xe8fbff, 3.2);
key.position.set(-4, 6, 7);
scene.add(key);
const rim = new THREE.DirectionalLight(0x55d2e2, 1.6);
rim.position.set(5, 1, -4);
scene.add(rim);
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
camera.position.set(0, 2.25, 9.2);
camera.lookAt(0, 0.7, 1.7);

const factories = {
  'player-pulse': createPlayerWaterPulse,
  'enemy-direct': createEnemyDirectWaterball,
  'enemy-lob': createEnemyLobWaterball,
  'monster-impact': createMonsterWaterImpact,
  'lens-impact': createLensWaterImpact,
};
const contexts = {
  'player-pulse': { start: [-1.45, -0.85, 4.8], end: [-0.4, 0.38, -0.2] },
  'enemy-direct': { start: [1.2, 0.25, -0.6], end: [0, -0.2, 4.8] },
  'enemy-lob': { start: [1.7, 0.6, -1.4], end: [0, -0.2, 4.8], arcHeight: 2.8 },
  'monster-impact': { normal: [0.2, 0.1, 1] },
  'lens-impact': { normal: [0.15, 0.05, 1] },
} as const;

const query = new URLSearchParams(location.search);
let kind: PreviewKind = (query.get('kind') as PreviewKind) in factories ? query.get('kind') as PreviewKind : 'enemy-direct';
let fixedPhase = query.has('phase') ? THREE.MathUtils.clamp(Number(query.get('phase')) || 0, 0, 1) : null;
let object: THREE.Group;
let startTime = performance.now();

function rebuild(next: PreviewKind): void {
  if (object) scene.remove(object);
  kind = next;
  object = factories[kind]();
  scene.add(object);
  if (kind === 'enemy-lob') {
    camera.position.set(0, 2.7, 12.8);
    camera.lookAt(0, 1.2, 1.7);
  } else {
    camera.position.set(0, 2.25, 9.2);
    camera.lookAt(0, 0.7, 1.7);
  }
  startTime = performance.now();
  controls.querySelectorAll('button').forEach((button) => button.classList.toggle('active', (button as HTMLElement).dataset.kind === kind));
  const path = object.userData.projectileRuntime?.pathType ?? object.userData.impactRuntime?.kind;
  status.textContent = `${kind.toUpperCase()} · ${path} · IRREGULAR WATER`;
}

controls.addEventListener('click', (event) => {
  const next = (event.target as HTMLElement).dataset.kind as PreviewKind | undefined;
  if (!next || !factories[next]) return;
  fixedPhase = null;
  rebuild(next);
});

function resize(): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const ratio = renderer.getPixelRatio();
  if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(height * ratio)) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function phase(): number {
  if (fixedPhase !== null) return fixedPhase;
  return ((performance.now() - startTime) % 2300) / 2300;
}

function render(): void {
  resize();
  const progress = phase();
  const runtime = object.userData.projectileRuntime ?? object.userData.impactRuntime;
  runtime.update(progress, contexts[kind]);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

rebuild(kind);
Object.assign(window, {
  waterwingProjectilesPreview: {
    ready: true,
    get object() { return object; },
    setKind: rebuild,
    setPhase(value: number) { fixedPhase = THREE.MathUtils.clamp(value, 0, 1); },
    getState() {
      const runtime = object.userData.projectileRuntime ?? object.userData.impactRuntime;
      return {
        kind,
        phase: fixedPhase ?? phase(),
        pathType: runtime.pathType ?? runtime.kind,
        position: object.position.toArray(),
      };
    },
  },
});
render();

declare global {
  interface Window {
    waterwingProjectilesPreview: {
      ready: boolean;
      object: THREE.Group;
      setKind(kind: PreviewKind): void;
      setPhase(phase: number): void;
      getState(): Record<string, unknown>;
    };
  }
}

import * as THREE from 'three';

import {
  configureWaterwingHoverRenderer,
  createWaterwingHoverEnvironment,
  createWaterwingHoverLookDevLights,
  frameWaterwingHoverCamera,
} from '../img2threejs-hover/createFinishedWaterwingHoverModel';
import { createWaterwingDodgeModel } from './createWaterwingDodgeModel';
import { createWaterwingHitModel } from './createWaterwingHitModel';
import { createWaterwingLungeModel } from './createWaterwingLungeModel';

type ActionName = 'lunge' | 'dodge' | 'hit';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const actionControls = document.querySelector<HTMLElement>('#action-controls')!;
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

const factories = {
  lunge: () => createWaterwingLungeModel({ textureAnisotropy: 8 }),
  dodge: () => createWaterwingDodgeModel({ direction: 1, textureAnisotropy: 8 }),
  hit: () => createWaterwingHitModel({ hitSide: 1, textureAnisotropy: 8 }),
};

const query = new URLSearchParams(location.search);
let action: ActionName = (query.get('action') as ActionName) in factories ? query.get('action') as ActionName : 'lunge';
let fixedPhase = query.has('phase') ? THREE.MathUtils.clamp(Number(query.get('phase')) || 0, 0, 1) : null;
let model: THREE.Group;
let actionStart = performance.now();

function setAction(next: ActionName): void {
  if (model) scene.remove(model);
  action = next;
  model = factories[action]();
  scene.add(model);
  actionStart = performance.now();
  if (action === 'lunge') {
    // The lunge is intentionally deep along camera Z. Framing by its largest 3D
    // dimension makes it tiny, so fit its projected X/Y silhouette from the front.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fitDistance = (Math.max(size.x, size.y) * 1.34 * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    camera.position.set(center.x, center.y + 0.08, box.max.z + fitDistance);
    camera.near = 0.05;
    camera.far = camera.position.z - box.min.z + 20;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  } else {
    frameWaterwingHoverCamera(camera, model, { azimuthDeg: 14, elevationDeg: 5, margin: 1.5 });
  }
  actionControls.querySelectorAll('button').forEach((button) => button.classList.toggle('active', (button as HTMLElement).dataset.action === action));
  status.textContent = `${action.toUpperCase()} · 独立动作模型 · 无全局塌缩`;
}

actionControls.addEventListener('click', (event) => {
  const next = (event.target as HTMLElement).dataset.action as ActionName | undefined;
  if (!next || !factories[next]) return;
  fixedPhase = null;
  setAction(next);
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

function currentPhase(): number {
  if (fixedPhase !== null) return fixedPhase;
  const duration = model.userData.actionRuntime.durationSeconds * 1000;
  return ((performance.now() - actionStart) % (duration + 420)) / duration > 1
    ? 1
    : ((performance.now() - actionStart) % (duration + 420)) / duration;
}

function render(): void {
  resize();
  const phase = currentPhase();
  model.userData.actionRuntime.update(phase, { frame: Math.round(phase * 60) });
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

setAction(action);
Object.assign(window, {
  waterwingMeleePreview: {
    ready: true,
    get model() { return model; },
    setAction,
    setPhase(value: number) { fixedPhase = THREE.MathUtils.clamp(value, 0, 1); },
    getState() {
      return {
        action,
        phase: fixedPhase ?? currentPhase(),
        actionId: model.userData.actionRuntime.actionId,
        state: model.userData.actionState,
      };
    },
  },
});
render();

declare global {
  interface Window {
    waterwingMeleePreview: {
      ready: boolean;
      model: THREE.Group;
      setAction(action: ActionName): void;
      setPhase(phase: number): void;
      getState(): Record<string, unknown>;
    };
  }
}

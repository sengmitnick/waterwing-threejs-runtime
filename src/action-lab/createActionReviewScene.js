import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { createActionModel } from '../full-film/actionFactoryRegistry.js';
import { createEnemyDirectWaterball } from '../projectiles/createEnemyDirectWaterball.ts';
import { createEnemyLobWaterball } from '../projectiles/createEnemyLobWaterball.ts';
import { createPlayerWaterPulse } from '../projectiles/createPlayerWaterPulse.ts';
import { createLensWaterImpact, createMonsterWaterImpact } from '../projectiles/createWaterImpacts.ts';
import { getReviewItem } from './reviewCatalog.js';

const FPS = 30;
const DARK_BACKGROUND = new THREE.Color('#152b34');
const LIGHT_BACKGROUND = new THREE.Color('#e4eef0');
const VALID_VIEWS = new Set(['front', 'quarter', 'side', 'rear']);
const FULL_MOTION_FRAMING = new Set(['emerge', 'lunge', 'dodge', 'defeat']);
const REFERENCE_PHASES = Object.freeze({
  hover: 0.28,
  forward: 0.34,
  'charge-direct': 0.72,
  'cast-direct': 0.5,
  'charge-lob': 0.72,
  'cast-lob': 0.5,
  hit: 0.5,
});
const EFFECT_CONTEXTS = Object.freeze({
  'player-pulse': Object.freeze({ start: [-1.45, -0.85, 4.8], end: [-0.4, 0.38, -0.2] }),
  'enemy-direct': Object.freeze({ start: [1.2, 0.25, -0.6], end: [0, -0.2, 4.8] }),
  'enemy-lob': Object.freeze({ start: [1.7, 0.6, -1.4], end: [0, -0.2, 4.8], arcHeight: 2.8 }),
  'monster-impact': Object.freeze({ normal: [0.2, 0.1, 1] }),
  'lens-impact': Object.freeze({ normal: [0.15, 0.05, 1] }),
});

const EFFECT_FACTORIES = Object.freeze({
  'player-pulse': (options) => createPlayerWaterPulse(options),
  'enemy-direct': (options) => createEnemyDirectWaterball(options),
  'enemy-lob': (options) => createEnemyLobWaterball(options),
  'monster-impact': () => createMonsterWaterImpact(),
  'lens-impact': () => createLensWaterImpact(),
});

function clamp01(value) {
  return THREE.MathUtils.clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1);
}

function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose?.();
    }
    const objectMaterials = object.material
      ? (Array.isArray(object.material) ? object.material : [object.material])
      : [];
    for (const material of objectMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !textures.has(value)) {
          textures.add(value);
          value.dispose?.();
        }
      }
      material.dispose?.();
    }
  });
}

function runtimeFor(object) {
  return object.userData.actionRuntime
    ?? object.userData.projectileRuntime
    ?? object.userData.impactRuntime;
}

function updateReviewObject(object, item, progress) {
  const runtime = runtimeFor(object);
  if (!runtime?.update) throw new Error(`Review runtime missing for ${item.id}`);
  if (item.kind === 'actor') {
    runtime.update(progress, {
      frame: Math.round(progress * item.durationSeconds * FPS),
      fps: FPS,
      intensity: 1,
      direction: 1,
      hitSide: 1,
      recoveryStrafe: 0.16,
      aimOffsetX: 0,
    });
  } else {
    runtime.update(progress, EFFECT_CONTEXTS[item.id]);
  }
}

function createReviewObject(item) {
  const options = {
    qualityPriority: 'reference-fidelity',
    textureSize: 256,
    textureAnisotropy: 8,
    castShadow: true,
    receiveShadow: true,
    direction: 1,
    hitSide: 1,
  };
  if (item.kind === 'actor') return createActionModel(item.id, options);
  const factory = EFFECT_FACTORIES[item.id];
  if (!factory) throw new Error(`Unknown review effect: ${item.id}`);
  return factory(options);
}

function captureMotionBounds(object, item) {
  const bounds = new THREE.Box3();
  const sample = new THREE.Box3();
  const phases = item.kind === 'actor'
    ? [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.999]
    : [0, 0.2, 0.4, 0.6, 0.8, 0.999];
  for (const phase of phases) {
    updateReviewObject(object, item, phase);
    object.updateMatrixWorld(true);
    sample.setFromObject(object);
    if (!sample.isEmpty()) bounds.union(sample);
  }
  updateReviewObject(object, item, 0);
  object.updateMatrixWorld(true);
  return bounds;
}

function captureReferenceBounds(object, item) {
  const phase = REFERENCE_PHASES[item.id] ?? 0.5;
  updateReviewObject(object, item, phase);
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  updateReviewObject(object, item, 0);
  object.updateMatrixWorld(true);
  return bounds;
}

export function createActionReviewScene(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createActionReviewScene requires a canvas element');
  }

  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.background = DARK_BACKGROUND.clone();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = environment;

  const hemisphere = new THREE.HemisphereLight('#d9eef3', '#10232b', 0.38);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight('#dceff5', 2.05);
  key.position.set(-4.8, 6.8, 5.6);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#789fac', 0.42);
  fill.position.set(4.2, 2.4, 4.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#acf5ff', 1.45);
  rim.position.set(4.8, 2.2, -5.8);
  scene.add(rim);
  const oppositeRim = new THREE.DirectionalLight('#e0fbff', 0.68);
  oppositeRim.position.set(-5.4, 1.5, -4.5);
  scene.add(oppositeRim);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 0.35;
  controls.maxDistance = 40;

  let selectedItem = getReviewItem(options.initialId);
  let activeObject = null;
  let motionBounds = new THREE.Box3();
  let cameraBounds = new THREE.Box3();
  let progress = 0;
  let playing = options.playing ?? true;
  let speed = 1;
  let view = 'quarter';
  let lightBackground = false;
  let disposed = false;
  let lastTimestamp = performance.now();
  let endHold = 0;
  let animationFrame = 0;

  function projectedFraming() {
    if (!activeObject || cameraBounds.isEmpty()) return { maxAbsX: 0, maxAbsY: 0 };
    camera.updateMatrixWorld(true);
    const min = cameraBounds.min;
    const max = cameraBounds.max;
    const point = new THREE.Vector3();
    let maxAbsX = 0;
    let maxAbsY = 0;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          point.set(x, y, z).project(camera);
          maxAbsX = Math.max(maxAbsX, Math.abs(point.x));
          maxAbsY = Math.max(maxAbsY, Math.abs(point.y));
        }
      }
    }
    return { maxAbsX, maxAbsY };
  }

  function state() {
    return {
      selectedId: selectedItem.id,
      kind: selectedItem.kind,
      durationSeconds: selectedItem.durationSeconds,
      progress,
      playing,
      speed,
      view,
      lightBackground,
      activeObjectCount: activeObject?.parent === scene ? 1 : 0,
      framing: projectedFraming(),
    };
  }

  function emit() {
    onStateChange(state());
  }

  function resize() {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const ratio = renderer.getPixelRatio();
    if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(height * ratio)) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function framing() {
    const box = cameraBounds.isEmpty() ? new THREE.Box3().setFromObject(activeObject) : cameraBounds;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { box, center, size };
  }

  function fitDistanceForDirection(box, center, direction, margin = 0.975) {
    const forward = direction.clone().multiplyScalar(-1);
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(forward).normalize();
    const verticalHalfTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const horizontalHalfTangent = verticalHalfTangent * Math.max(camera.aspect, 0.1);
    const relative = new THREE.Vector3();
    let distance = 0.8;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          relative.set(x, y, z).sub(center);
          const localX = relative.dot(right);
          const localY = relative.dot(up);
          const localZ = relative.dot(direction);
          distance = Math.max(
            distance,
            localZ + Math.abs(localX) / (margin * horizontalHalfTangent),
            localZ + Math.abs(localY) / (margin * verticalHalfTangent),
          );
        }
      }
    }
    return distance * 1.015;
  }

  function setView(nextView, notify = true) {
    view = VALID_VIEWS.has(nextView) ? nextView : 'quarter';
    if (!activeObject) return view;
    resize();
    const { box, center, size } = framing();
    const directions = {
      front: new THREE.Vector3(0, 0.025, 1),
      quarter: new THREE.Vector3(0.62, 0.16, 0.78),
      side: new THREE.Vector3(1, 0.025, 0),
      rear: new THREE.Vector3(0, 0.025, -1),
    };
    const direction = directions[view].normalize();
    const distance = fitDistanceForDirection(box, center, direction);
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.target.copy(center);
    camera.near = Math.max(0.01, distance * 0.002);
    camera.far = Math.max(80, distance * 8 + size.length());
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    controls.update();
    if (notify) emit();
    return view;
  }

  function select(id, selectOptions = {}) {
    const nextItem = getReviewItem(id);
    if (activeObject) {
      scene.remove(activeObject);
      disposeObject(activeObject);
    }
    selectedItem = nextItem;
    activeObject = createReviewObject(selectedItem);
    activeObject.name = `action-review-${selectedItem.id}`;
    scene.add(activeObject);
    progress = clamp01(selectOptions.progress ?? 0);
    endHold = 0;
    motionBounds = captureMotionBounds(activeObject, selectedItem);
    cameraBounds = selectedItem.kind === 'effect' || FULL_MOTION_FRAMING.has(selectedItem.id)
      ? motionBounds.clone()
      : captureReferenceBounds(activeObject, selectedItem);
    updateReviewObject(activeObject, selectedItem, progress);
    setView(selectOptions.view ?? view, false);
    emit();
    return selectedItem;
  }

  function setProgress(value) {
    progress = clamp01(value);
    playing = false;
    endHold = 0;
    updateReviewObject(activeObject, selectedItem, progress);
    emit();
    return progress;
  }

  function setPlaying(value) {
    playing = Boolean(value);
    endHold = 0;
    lastTimestamp = performance.now();
    emit();
    return playing;
  }

  function setSpeed(value) {
    const requested = Number(value);
    speed = [0.25, 0.5, 1].includes(requested) ? requested : 1;
    emit();
    return speed;
  }

  function stepFrames(frameDelta) {
    const frames = Number.isFinite(Number(frameDelta)) ? Number(frameDelta) : 0;
    return setProgress(progress + frames / (selectedItem.durationSeconds * FPS));
  }

  function setBackground(light) {
    lightBackground = Boolean(light);
    scene.background.copy(lightBackground ? LIGHT_BACKGROUND : DARK_BACKGROUND);
    emit();
    return lightBackground;
  }

  function tick(timestamp) {
    if (disposed) return;
    resize();
    const deltaSeconds = Math.min(0.1, Math.max(0, (timestamp - lastTimestamp) / 1000));
    lastTimestamp = timestamp;
    if (playing && activeObject) {
      if (progress >= 1) {
        endHold += deltaSeconds;
        if (endHold >= 0.38 / speed) {
          progress = 0;
          endHold = 0;
        }
      } else {
        progress = Math.min(1, progress + deltaSeconds * speed / selectedItem.durationSeconds);
      }
      updateReviewObject(activeObject, selectedItem, progress);
      emit();
    }
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(tick);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    controls.dispose();
    if (activeObject) disposeObject(activeObject);
    environment.dispose();
    renderer.dispose();
  }

  resize();
  select(selectedItem.id, { view });
  lastTimestamp = performance.now();
  animationFrame = requestAnimationFrame(tick);

  return {
    canvas,
    renderer,
    scene,
    camera,
    controls,
    select,
    setProgress,
    setPlaying,
    setSpeed,
    stepFrames,
    setView,
    setBackground,
    getState: state,
    dispose,
  };
}

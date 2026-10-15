import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import {
  ACTION_FACTORY_IDS,
} from './actionFactoryRegistry.js';
import {
  FULL_FILM_ACTOR_ASSET_FAMILY,
  loadFullFilmActionLibrary,
} from './loadFullFilmActionLibrary.js';
import { createPlayerWaterPulse } from '../projectiles/createPlayerWaterPulse.ts';
import { createEnemyDirectWaterball } from '../projectiles/createEnemyDirectWaterball.ts';
import { createEnemyLobWaterball } from '../projectiles/createEnemyLobWaterball.ts';
import {
  createLensWaterImpact,
  createMonsterWaterImpact,
} from '../projectiles/createWaterImpacts.ts';
import {
  FULL_FILM_CANVAS,
  FULL_WIDTH_OPTICAL_FIELD,
} from '../game/opticalField.js';

export { FULL_FILM_CANVAS };
export const FULL_FILM_OPTICAL_FIELD = FULL_WIDTH_OPTICAL_FIELD;

const ACTOR_IDS = Object.freeze(['A', 'B', 'C']);
const FPS = 30;
const MODEL_OPTIONS = Object.freeze({
  textureSize: 128,
  textureAnisotropy: 4,
  qualityPriority: 'balanced',
  castShadow: false,
  receiveShadow: false,
});

const vectorFrom = (value, fallback = [0, 0, 0]) => {
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3(...value);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return new THREE.Vector3(...fallback);
};

const tupleFrom = (value) => {
  if (Array.isArray(value)) return value;
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return [value.x, value.y, value.z];
  }
  return null;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function projectileKind(projectile) {
  if (projectile.kind === 'enemy-lob') return 'enemy-lob';
  if (projectile.kind === 'enemy-direct') return 'enemy-direct';
  return 'player-pulse';
}

function createProjectileForKind(kind) {
  const options = { textureSize: 128, textureAnisotropy: 4 };
  if (kind === 'enemy-lob') return createEnemyLobWaterball(options);
  if (kind === 'enemy-direct') return createEnemyDirectWaterball(options);
  return createPlayerWaterPulse(options);
}

function hideReleasedWater(model) {
  model.traverse((object) => {
    if (object.name === 'released-water') object.visible = false;
  });
}

function clampAuthoredRootMotion(model) {
  // The action sculpts own their local anticipation/recoil, while the encounter
  // simulator owns traversal through the world. Keeping only a small local offset
  // prevents lunge/dodge clips from applying their translation a second time.
  const limit = model.userData.actionRuntime?.actionId === 'lunge'
    || model.userData.actionRuntime?.actionId === 'dodge'
    ? 0.18
    : 0.22;
  model.position.set(
    THREE.MathUtils.clamp(model.position.x, -limit, limit),
    THREE.MathUtils.clamp(model.position.y, -limit, limit),
    THREE.MathUtils.clamp(model.position.z, -limit, limit),
  );
}

function disposeObject(root, seenGeometry, seenMaterial, seenTexture) {
  root.traverse((object) => {
    const geometry = object.geometry;
    if (geometry && !seenGeometry.has(geometry)) {
      seenGeometry.add(geometry);
      geometry.dispose?.();
    }
    const materials = object.material
      ? (Array.isArray(object.material) ? object.material : [object.material])
      : [];
    for (const material of materials) {
      if (!material || seenMaterial.has(material)) continue;
      seenMaterial.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !seenTexture.has(value)) {
          seenTexture.add(value);
          value.dispose?.();
        }
      }
      material.dispose?.();
    }
  });
}

/**
 * Creates the transparent, action-specific Three.js battle layer used by the
 * 68-second film. The caller owns timeline simulation; this controller only
 * maps a simulated frame state to renderable actors, shots and impacts.
 */
export async function createFullBattleScene(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createFullBattleScene requires a canvas element');
  }

  const width = options.width ?? FULL_FILM_CANVAS.width;
  const height = options.height ?? FULL_FILM_CANVAS.height;
  const opticalField = {
    left: options.opticalField?.left ?? FULL_FILM_OPTICAL_FIELD.left,
    top: options.opticalField?.top ?? FULL_FILM_OPTICAL_FIELD.top,
    width: options.opticalField?.width ?? FULL_FILM_OPTICAL_FIELD.width,
    height: options.opticalField?.height ?? FULL_FILM_OPTICAL_FIELD.height,
  };
  opticalField.right = opticalField.left + opticalField.width;
  opticalField.bottom = opticalField.top + opticalField.height;
  const viewportBottom = height - opticalField.bottom;

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environmentTarget.texture;
  scene.background = null;
  const refractionBackground = options.backgroundTexture ?? null;
  const actionLibrary = options.actionLibrary ?? await loadFullFilmActionLibrary();
  const camera = new THREE.PerspectiveCamera(42, opticalField.width / opticalField.height, 0.08, 100);
  camera.position.set(0, 0.28, 6.8);
  camera.lookAt(0, 0.2, -1.2);
  scene.add(camera);

  const hemisphere = new THREE.HemisphereLight(0xe6fbff, 0x10292f, 1.42);
  hemisphere.name = 'waterfall ambient light';
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xf0fbff, 2.18);
  key.name = 'waterfall daylight key';
  key.position.set(-3.8, 5.8, 5.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6cb7c6, 0.86);
  fill.name = 'waterfall cool fill';
  fill.position.set(4.4, 1.8, 3.2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xaef7ff, 1.36);
  rim.name = 'waterfall wet rim';
  rim.position.set(1.2, 3.4, -5.4);
  scene.add(rim);

  const refractionTarget = new THREE.WebGLRenderTarget(opticalField.width, opticalField.height, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  refractionTarget.texture.name = 'WaterwingRefractionComposite';
  const silhouetteTarget = new THREE.WebGLRenderTarget(opticalField.width, opticalField.height, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  silhouetteTarget.texture.name = 'WaterwingSilhouetteMask';
  const silhouetteMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
  const compositeScene = new THREE.Scene();
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const compositeGeometry = new THREE.PlaneGeometry(2, 2);
  const compositeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      colorPlate: { value: refractionTarget.texture },
      silhouette: { value: silhouetteTarget.texture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D colorPlate;
      uniform sampler2D silhouette;
      varying vec2 vUv;
      void main() {
        vec4 colorSample = texture2D(colorPlate, vUv);
        float mask = texture2D(silhouette, vUv).r;
        vec3 waterfallCyan = vec3(0.38, 0.82, 0.88);
        vec3 liftedWater = mix(colorSample.rgb, waterfallCyan, 0.28);
        liftedWater = pow(liftedWater, vec3(0.85)) * 1.07;
        gl_FragColor = vec4(liftedWater, mask);
      }
    `,
  });
  compositeScene.add(new THREE.Mesh(compositeGeometry, compositeMaterial));

  const actors = new Map();
  for (const id of ACTOR_IDS) {
    const holder = new THREE.Group();
    holder.name = `waterwing-actor-${id}`;
    holder.userData.actorId = id;
    scene.add(holder);
    actors.set(id, {
      id,
      holder,
      currentActionId: null,
      currentModel: null,
      modelCache: new Map(),
    });
  }

  const projectilePools = new Map([
    ['player-pulse', []],
    ['enemy-direct', []],
    ['enemy-lob', []],
  ]);
  const activeProjectiles = new Map();
  const impactPools = new Map([
    ['monster-impact', []],
    ['lens-impact', []],
  ]);
  const activeImpacts = new Map();
  const allProjectileModels = new Set();
  const allImpactModels = new Set();
  const scratchPosition = new THREE.Vector3();
  let currentState = null;

  function acquireProjectile(kind) {
    const pool = projectilePools.get(kind);
    const root = pool.pop() ?? createProjectileForKind(kind);
    if (!root.parent) scene.add(root);
    allProjectileModels.add(root);
    root.visible = true;
    return root;
  }

  function releaseInactiveProjectiles(activeIds) {
    for (const [id, entry] of activeProjectiles) {
      if (activeIds.has(id)) continue;
      entry.root.visible = false;
      activeProjectiles.delete(id);
      projectilePools.get(entry.kind).push(entry.root);
    }
  }

  function updateProjectiles(state) {
    const activeIds = new Set();
    for (const projectile of state.projectiles ?? []) {
      const id = String(projectile.id);
      const kind = projectileKind(projectile);
      activeIds.add(id);
      let entry = activeProjectiles.get(id);
      if (entry && entry.kind !== kind) {
        entry.root.visible = false;
        projectilePools.get(entry.kind).push(entry.root);
        activeProjectiles.delete(id);
        entry = null;
      }
      if (!entry) {
        entry = { kind, root: acquireProjectile(kind) };
        activeProjectiles.set(id, entry);
      }

      const { root } = entry;
      const runtime = root.userData.projectileRuntime;
      const start = tupleFrom(projectile.start);
      const end = tupleFrom(projectile.end);
      const context = {};
      if (start) context.start = start;
      if (end) context.end = end;
      if (Number.isFinite(projectile.arcHeight)) context.arcHeight = projectile.arcHeight;
      if (Number.isFinite(projectile.bend)) context.bend = projectile.bend;
      runtime.update(clamp01(projectile.progress), context);

      // Older simulator states expose only the already-evaluated position. Keep
      // those states compatible while newer states let the projectile model own
      // the complete direct/high-arc trajectory.
      if (!start || !end) root.position.copy(vectorFrom(projectile.position));
      const authoredScale = Number.isFinite(projectile.scale) ? projectile.scale : 0.2;
      const scale = 0.58 + authoredScale * 1.72;
      root.scale.setScalar(scale);
      root.visible = projectile.progress < 1;
    }
    releaseInactiveProjectiles(activeIds);
  }

  function acquireImpact(kind) {
    const pool = impactPools.get(kind);
    const root = pool.pop() ?? (kind === 'monster-impact' ? createMonsterWaterImpact() : createLensWaterImpact());
    if (!root.parent) scene.add(root);
    allImpactModels.add(root);
    root.visible = true;
    return root;
  }

  function releaseInactiveImpacts(activeIds) {
    for (const [id, entry] of activeImpacts) {
      if (activeIds.has(id)) continue;
      entry.root.visible = false;
      activeImpacts.delete(id);
      impactPools.get(entry.kind).push(entry.root);
    }
  }

  function updateImpacts(state) {
    const activeIds = new Set();
    for (const impact of state.impacts ?? []) {
      const kind = impact.kind === 'monster-hit' ? 'monster-impact' : 'lens-impact';
      const id = `${kind}:${impact.id}`;
      activeIds.add(id);
      let entry = activeImpacts.get(id);
      if (!entry) {
        entry = { kind, root: acquireImpact(kind) };
        activeImpacts.set(id, entry);
      }
      const { root } = entry;
      const lifetimeFrames = kind === 'monster-impact' ? 14 : 18;
      root.userData.impactRuntime.update(clamp01(impact.age / Math.max(1, lifetimeFrames - 1)));

      if (kind === 'monster-impact') {
        const actor = state.actors?.find((candidate) => candidate.id === impact.target);
        if (!actor) {
          root.visible = false;
          continue;
        }
        root.position.fromArray(actor.transform.position);
        root.position.y += 0.08 * actor.transform.scale;
        root.position.z += 0.38 * actor.transform.scale;
        root.rotation.fromArray(actor.transform.rotation);
        root.scale.setScalar(0.82 * actor.transform.scale);
      } else {
        const miss = impact.kind === 'near-miss';
        const side = impact.source === 'A' ? -1 : impact.source === 'B' ? 1 : Math.sin(String(impact.id).length) >= 0 ? 1 : -1;
        scratchPosition.set(side * (miss ? 0.48 : 0.18), miss ? 0.08 : -0.03, -0.86);
        camera.localToWorld(scratchPosition);
        root.position.copy(scratchPosition);
        root.quaternion.copy(camera.quaternion);
        root.scale.setScalar(miss ? 0.38 : 0.64);
      }
      root.visible = true;
    }
    releaseInactiveImpacts(activeIds);
  }

  function modelForActor(record, actionId) {
    let model = record.modelCache.get(actionId);
    if (model) return model;
    model = actionLibrary.create(actionId, {
      direction: record.id === 'A' ? -1 : 1,
      hitSide: record.id === 'B' ? -1 : 1,
      actorId: record.id,
    });
    model.root.name = `waterwing-${record.id}-${actionId}`;
    model.root.scale.setScalar(0.42);
    model.root.visible = false;
    record.holder.add(model.root);
    record.modelCache.set(actionId, model);
    return model;
  }

  function updateActors(state) {
    const stateById = new Map((state.actors ?? []).map((actor) => [actor.id, actor]));
    for (const [id, record] of actors) {
      const actor = stateById.get(id);
      if (!actor) {
        record.holder.visible = false;
        continue;
      }
      const actionId = actor.action?.id ?? 'hover';
      const model = modelForActor(record, actionId);
      if (record.currentModel !== model) {
        if (record.currentModel) record.currentModel.root.visible = false;
        record.currentModel = model;
        record.currentActionId = actionId;
      }

      record.holder.position.fromArray(actor.transform.position);
      record.holder.rotation.fromArray(actor.transform.rotation);
      record.holder.scale.setScalar(actor.transform.scale);
      record.holder.visible = Boolean(actor.visible);
      model.root.visible = Boolean(actor.visible);
      model.update(clamp01(actor.action?.progress), {
        frame: state.frame,
        fps: FPS,
        actorId: id,
        direction: id === 'A' ? -1 : 1,
        hitSide: id === 'B' ? -1 : 1,
        intensity: 1,
        recoveryStrafe: id === 'C' ? (Math.sin(state.frame * 0.07) >= 0 ? 0.18 : -0.18) : 0,
        aimOffsetX: state.camera?.position?.[0] ?? 0,
      });
      model.root.scale.setScalar(0.42);
    }
  }

  function updateCamera(state) {
    camera.position.copy(vectorFrom(state.camera?.position, [0, 0.28, 6.8]));
    camera.up.set(0, 1, 0);
    camera.lookAt(vectorFrom(state.camera?.lookAt, [0, 0.2, -1.2]));
    camera.rotateZ(state.camera?.roll ?? 0);
    camera.updateMatrixWorld(true);
  }

  function update(state) {
    if (!state) throw new TypeError('battle scene update requires a simulated frame state');
    currentState = state;
    updateCamera(state);
    updateActors(state);
    updateProjectiles(state);
    updateImpacts(state);
    return state;
  }

  function render() {
    // Render the waterfall-backed water shading offscreen, then apply an object
    // silhouette as alpha. This keeps the refraction plate inside the water
    // models without painting a rectangular duplicate over the real footage.
    renderer.setScissorTest(false);
    renderer.setRenderTarget(refractionTarget);
    renderer.setViewport(0, 0, opticalField.width, opticalField.height);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    scene.background = refractionBackground;
    scene.overrideMaterial = null;
    renderer.render(scene, camera);

    renderer.setRenderTarget(silhouetteTarget);
    renderer.setViewport(0, 0, opticalField.width, opticalField.height);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    scene.background = null;
    scene.overrideMaterial = silhouetteMaterial;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;

    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.setViewport(opticalField.left, viewportBottom, opticalField.width, opticalField.height);
    renderer.setScissor(opticalField.left, viewportBottom, opticalField.width, opticalField.height);
    renderer.setScissorTest(true);
    renderer.render(compositeScene, compositeCamera);
    renderer.setScissorTest(false);
  }

  function dispose() {
    const seenGeometry = new Set();
    const seenMaterial = new Set();
    const seenTexture = new Set();
    for (const record of actors.values()) {
      for (const model of record.modelCache.values()) {
        disposeObject(model.root, seenGeometry, seenMaterial, seenTexture);
      }
    }
    for (const model of allProjectileModels) disposeObject(model, seenGeometry, seenMaterial, seenTexture);
    for (const model of allImpactModels) disposeObject(model, seenGeometry, seenMaterial, seenTexture);
    refractionTarget.dispose();
    silhouetteTarget.dispose();
    silhouetteMaterial.dispose();
    compositeGeometry.dispose();
    compositeMaterial.dispose();
    renderer.dispose();
    environmentTarget.dispose();
    pmrem.dispose();
  }

  return {
    canvas,
    renderer,
    scene,
    camera,
    actorRoots: new Map([...actors].map(([id, record]) => [id, record.holder])),
    actionFactoryIds: [...ACTION_FACTORY_IDS],
    actorAssetFamily: FULL_FILM_ACTOR_ASSET_FAMILY,
    refractionBackground: options.backgroundTexture?.isVideoTexture ? 'video-texture' : 'environment-only',
    opticalField: { ...opticalField },
    update,
    applyState: update,
    render,
    dispose,
    getState: () => currentState,
  };
}

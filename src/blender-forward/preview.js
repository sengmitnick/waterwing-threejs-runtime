import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { loadWaterwingBlenderAsset } from './loadWaterwingBlenderAsset.js';
import { loadFullFilmActionLibrary } from '../full-film/loadFullFilmActionLibrary.js';
import { prepareCombatAttackSequenceFactory } from '../combat-effects/createCombatAttackSequence.ts';
import { prepareWaterwingDefeatTransitionFactory } from '../water-events/createWaterwingDefeatTransition.ts';
import { prepareWaterwingEmergenceFxFactory } from '../water-events/createWaterwingEmergenceFx.ts';

const actionReviewProfiles = Object.freeze({
  hover: Object.freeze({ label: '悬浮', title: '悬浮巡航', source: 'hover', duration: 6, loop: true }),
  forward: Object.freeze({ label: '推进', title: '前向推进', source: 'forward', duration: 4, loop: true }),
  emerge: Object.freeze({ label: '凝聚登场', title: '水下凝聚登场', source: 'emerge', duration: 6, loop: false }),
  'charge-direct': Object.freeze({ label: '直射蓄力', title: '直射水弹蓄力', source: 'directCast', duration: 2.4, loop: false }),
  'cast-direct': Object.freeze({ label: '直射释放', title: '直射水弹释放', source: 'directCast', duration: 1.15, loop: false }),
  'charge-lob': Object.freeze({ label: '高抛蓄力', title: '高抛水弹蓄力', source: 'directCast', duration: 2.4, loop: false }),
  'cast-lob': Object.freeze({ label: '高抛释放', title: '高抛水弹释放', source: 'directCast', duration: 1.15, loop: false }),
  lunge: Object.freeze({ label: '近战扑击', title: '近战扑击', source: 'forward', duration: 2.6, loop: false }),
  dodge: Object.freeze({ label: '侧向闪避', title: '侧向闪避', source: 'dodge', duration: 3, loop: false }),
  hit: Object.freeze({ label: '受击', title: '受击回弹', source: 'hover', duration: 1.2, loop: false }),
  defeat: Object.freeze({ label: '溃散', title: '失稳溃散', source: 'emerge', duration: 3.2, loop: false }),
});

const effectReviewProfiles = Object.freeze({
  'player-miss': Object.freeze({
    label: '玩家攻击·未中', title: '玩家水球 · 擦身未中', duration: 1.8,
    prepareFactory: () => prepareCombatAttackSequenceFactory('player-miss'),
    context: Object.freeze({}),
    reviewScale: 0.9,
  }),
  'player-hit': Object.freeze({
    label: '玩家攻击·命中', title: '玩家水球 · 斩中水怪', duration: 2.05,
    prepareFactory: () => prepareCombatAttackSequenceFactory('player-hit'),
    context: Object.freeze({}),
    reviewScale: 0.9,
  }),
  'enemy-direct-hit': Object.freeze({
    label: '怪物直射·命中', title: '怪物直射 · 水球抵达与镜头泼水', duration: 2.2,
    prepareFactory: () => prepareCombatAttackSequenceFactory('enemy-direct-hit'),
    context: Object.freeze({}),
    reviewScale: 0.88,
  }),
  'enemy-lob-hit': Object.freeze({
    label: '怪物高抛·命中', title: '怪物高抛 · 弧线抵达与镜头泼水', duration: 2.8,
    prepareFactory: () => prepareCombatAttackSequenceFactory('enemy-lob-hit'),
    context: Object.freeze({}),
    reviewScale: 0.88,
  }),
  'waterwing-emergence-fx': Object.freeze({
    label: '水面凝聚登场', title: '水面凝聚 · 真实水面起势到原版水怪成形', duration: 6,
    prepareFactory: options => prepareWaterwingEmergenceFxFactory(options),
    context: Object.freeze({ anchor: [0, -1.05, 0], surfaceNormal: [0, 1, 0], hoverHeight: 1.05 }),
    reviewScale: 1.18,
  }),
  'waterwing-defeat-fx': Object.freeze({
    label: '溃散', title: '原模型连续失稳并化为下落水渍', duration: 3.8,
    prepareFactory: options => prepareWaterwingDefeatTransitionFactory(options),
    context: Object.freeze({ anchor: [0, -1.05, 0], surfaceNormal: [0, 1, 0], hoverHeight: 1.05, impactDirection: [-0.6, -0.1, 0.4] }),
    reviewScale: 1,
  }),
});

const effectReviewIds = Object.freeze([
  'player-miss',
  'player-hit',
  'enemy-direct-hit',
  'enemy-lob-hit',
]);

const legacyReviewAction = 'directCast';

const stage = document.querySelector('#stage');
const phaseInput = document.querySelector('#phase');
const phaseLabel = document.querySelector('#phase-label');
const playButton = document.querySelector('#play-toggle');
const status = document.querySelector('#status');
const actionTitle = document.querySelector('#action-title');
const assetEyebrow = document.querySelector('#asset-eyebrow');
const reviewSubtitle = document.querySelector('#review-subtitle');
const libraryTitle = document.querySelector('#library-title');
const debugSection = document.querySelector('#debug-section');
const instancesSection = document.querySelector('#instances-section');
const modeChip = document.querySelector('#mode-chip');
const waterProfileChip = document.querySelector('#water-profile-chip');
const waterfallVideo = document.querySelector('#waterfall-background');
const backgroundVideoInput = document.querySelector('#background-video-input');
const waterfallTexture = new THREE.VideoTexture(waterfallVideo);
waterfallTexture.colorSpace = THREE.SRGBColorSpace;
waterfallTexture.minFilter = THREE.LinearFilter;
waterfallTexture.magFilter = THREE.LinearFilter;
waterfallTexture.generateMipmaps = false;
waterfallTexture.wrapS = THREE.ClampToEdgeWrapping;
waterfallTexture.wrapT = THREE.ClampToEdgeWrapping;

const proceduralBackdropCanvas = document.createElement('canvas');
proceduralBackdropCanvas.width = 1280;
proceduralBackdropCanvas.height = 720;
const proceduralBackdropContext = proceduralBackdropCanvas.getContext('2d');
const proceduralBackdropTexture = new THREE.CanvasTexture(proceduralBackdropCanvas);
proceduralBackdropTexture.colorSpace = THREE.SRGBColorSpace;
proceduralBackdropTexture.minFilter = THREE.LinearFilter;
proceduralBackdropTexture.magFilter = THREE.LinearFilter;
proceduralBackdropTexture.generateMipmaps = false;

let activeWaterBackdropTexture = proceduralBackdropTexture;
let backgroundVideoObjectUrl = null;

function updateProceduralWaterBackdrop(timeSeconds = 0) {
  const { width, height } = proceduralBackdropCanvas;
  const context = proceduralBackdropContext;
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, '#326776');
  base.addColorStop(0.42, '#173b4a');
  base.addColorStop(1, '#06151f');
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  const light = context.createRadialGradient(width * 0.54, height * 0.18, 10, width * 0.54, height * 0.18, width * 0.52);
  light.addColorStop(0, 'rgba(189, 244, 247, .5)');
  light.addColorStop(0.38, 'rgba(77, 167, 184, .2)');
  light.addColorStop(1, 'rgba(2, 13, 21, 0)');
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalCompositeOperation = 'screen';
  for (let index = 0; index < 18; index += 1) {
    const x = width * (0.18 + index * 0.038) + Math.sin(timeSeconds * 0.42 + index) * 14;
    const streamWidth = 18 + (index % 4) * 9;
    const stream = context.createLinearGradient(x, 0, x + streamWidth, 0);
    stream.addColorStop(0, 'rgba(164, 229, 236, 0)');
    stream.addColorStop(0.5, `rgba(177, 234, 240, ${0.08 + (index % 3) * 0.025})`);
    stream.addColorStop(1, 'rgba(164, 229, 236, 0)');
    context.fillStyle = stream;
    context.fillRect(x, -40, streamWidth, height * 0.86);
  }
  context.restore();

  const mist = context.createLinearGradient(0, height * 0.54, 0, height);
  mist.addColorStop(0, 'rgba(159, 222, 229, 0)');
  mist.addColorStop(0.58, 'rgba(159, 222, 229, .2)');
  mist.addColorStop(1, 'rgba(14, 49, 61, .44)');
  context.fillStyle = mist;
  context.fillRect(0, height * 0.48, width, height * 0.52);

  proceduralBackdropTexture.needsUpdate = true;
}

updateProceduralWaterBackdrop(0);

const lightingProfile = Object.freeze({
  exposure: 0.94,
  hemisphere: 0.28,
  key: 1.52,
  fill: 0.2,
  rim: 1.2,
  oppositeRim: 0.58,
});

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = lightingProfile.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.append(renderer.domElement);

const scene = new THREE.Scene();
const studioBackground = new THREE.Color(0x06121b);
const studioFog = new THREE.FogExp2(0x06121b, 0.018);
scene.background = null;
scene.fog = null;

const camera = new THREE.PerspectiveCamera(40, stage.clientWidth / stage.clientHeight, 0.05, 120);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 3.5;
controls.maxDistance = 40;
controls.target.set(0, 0.2, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

scene.add(new THREE.HemisphereLight(0xd8edf2, 0x10222c, lightingProfile.hemisphere));
const keyLight = new THREE.DirectionalLight(0xd6edf4, lightingProfile.key);
keyLight.position.set(-4, 6, 5.5);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x6d9fb0, lightingProfile.fill);
fillLight.position.set(4, 3, 3.5);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xa9f3ff, lightingProfile.rim);
rimLight.position.set(0.5, 4.5, -6);
scene.add(rimLight);
const oppositeRimLight = new THREE.DirectionalLight(0xd2f8ff, lightingProfile.oppositeRim);
oppositeRimLight.position.set(-5.2, 1.6, -4.8);
scene.add(oppositeRimLight);

const stageFloor = new THREE.Mesh(
  new THREE.CircleGeometry(11, 96),
  new THREE.MeshStandardMaterial({ color: 0x020c12, roughness: 0.74, metalness: 0.03, transparent: true, opacity: 0.52 }),
);
stageFloor.rotation.x = -Math.PI / 2;
stageFloor.position.y = -2.25;
stageFloor.receiveShadow = true;
scene.add(stageFloor);

const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x1bd6e8, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
const studioDecorations = [stageFloor];
for (const radius of [3.6, 6.2, 8.8]) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.018, radius + 0.018, 128), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -2.20;
  scene.add(ring);
  studioDecorations.push(ring);
}

const reviewRoot = new THREE.Group();
reviewRoot.name = 'ReviewInstances';
scene.add(reviewRoot);

const debugRoot = new THREE.Group();
debugRoot.name = 'FxReviewDebug';
scene.add(debugRoot);

const viewPresets = {
  propulsion: new THREE.Vector3(9.8, 6.7, 12.8),
  front: new THREE.Vector3(0, 2.1, 16.5),
  left: new THREE.Vector3(-16.5, 2.1, 0),
  right: new THREE.Vector3(16.5, 2.1, 0),
  rear: new THREE.Vector3(0, 2.1, -16.5),
  top: new THREE.Vector3(0, 18.5, 0.01),
};

let asset;
let instances = [];
let currentAction = 'forward';
let reviewMode = new URLSearchParams(location.search).get('mode') === 'effects' ? 'effects' : 'actors';
let cloneCount = 1;
let currentPhase = 0;
let materialMode = 'water';
let skeletonVisible = false;
let anchorsVisible = false;
let currentView = 'propulsion';
let backgroundMode = 'waterfall';
let playing = true;
let playbackSpeed = 1;
let fullFilmActionLibrary;
const debugLayers = new Set();
const initialAssetId = new URLSearchParams(location.search).get('asset');

function availableActionIds() {
  return fullFilmActionLibrary?.actionIds ?? Object.keys(actionReviewProfiles);
}

function availableReviewIds() {
  return reviewMode === 'effects' ? effectReviewIds : availableActionIds();
}

function renderActionButtons() {
  const actionGrid = document.querySelector('#action-grid');
  actionGrid.replaceChildren();
  for (const actionId of availableReviewIds()) {
    const profile = reviewMode === 'effects' ? effectReviewProfiles[actionId] : actionReviewProfiles[actionId];
    const button = document.createElement('button');
    button.type = 'button';
    if (reviewMode === 'effects') button.dataset.effect = actionId;
    else button.dataset.action = actionId;
    button.textContent = profile.label;
    button.classList.toggle('active', actionId === currentAction);
    button.addEventListener('click', () => {
      setAction(actionId).catch(error => {
        console.error(error);
        status.textContent = `载入失败：${error.message}`;
        status.classList.add('error');
      });
    });
    actionGrid.append(button);
  }
}

function runtimeForEffect(root) {
  return root.userData.projectileRuntime
    ?? root.userData.impactRuntime
    ?? root.userData.eventRuntime;
}

function effectPoseFingerprint(root, phase) {
  const values = [phase];
  root.traverse(object => {
    if (!object.isMesh) return;
    values.push(
      object.visible ? 1 : 0,
      ...object.position.toArray(),
      ...object.scale.toArray(),
      object.material?.opacity ?? 1,
    );
  });
  return values.map(value => Number(value).toFixed(4)).join('|');
}

function setEffectMaterialMode(root, mode) {
  root.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material?.color) continue;
      material.userData.reviewWaterColor ??= material.color.clone();
      material.userData.reviewTransmission ??= Number(material.transmission ?? 0);
      material.userData.reviewRoughness ??= Number(material.roughness ?? 0.3);
      if (mode === 'clay') {
        material.color.set('#80949b');
        if ('transmission' in material) material.transmission = 0;
        if ('roughness' in material) material.roughness = 0.72;
      } else {
        material.color.copy(material.userData.reviewWaterColor);
        if ('transmission' in material) material.transmission = material.userData.reviewTransmission;
        if ('roughness' in material) material.roughness = material.userData.reviewRoughness;
      }
      material.needsUpdate = true;
    }
  });
}

function createHitReviewContextSubject() {
  if (!fullFilmActionLibrary) throw new Error('Waterwing action library is not ready');
  const adapter = fullFilmActionLibrary.create('hit', { actorId: 'preview-only-hit-context' });
  const root = adapter.root;
  root.name = 'PreviewOnly_WaterwingHitReference';
  root.userData.previewOnly = true;
  root.userData.reviewContextSubjectId = 'waterwing-hit-reference';
  root.position.set(0, 0.55, -0.34);
  root.scale.setScalar(0.21);
  root.traverse(object => {
    if (!object.isMesh && !object.isSprite) return;
    object.userData.previewOnly = true;
    object.renderOrder = 0;
  });

  return {
    root,
    update(progress) {
      adapter.update(progress, { hitSide: 1 });
      root.updateMatrixWorld(true);
    },
    setMaterialMode(mode) {
      adapter.instance.setMaterialMode(mode);
    },
    getReviewState() {
      let visibleMeshCount = 0;
      root.traverse(object => {
        if (object.isMesh && object.visible) visibleMeshCount += 1;
      });
      return {
        id: root.userData.reviewContextSubjectId,
        previewOnly: root.userData.previewOnly,
        visibleMeshCount,
        localPosition: root.position.toArray(),
      };
    },
  };
}

async function createEffectReviewAsset(effectId, { actorMode = false } = {}) {
  const profile = effectReviewProfiles[effectId];
  if (!profile) throw new Error(`Unknown reusable effect ${effectId}`);

  const prepared = profile.prepareFactory
    ? await profile.prepareFactory(actorMode
      ? { anchor: [0, -1.05, 0], hoverHeight: 1.05, actorScale: 1 }
      : { anchor: profile.context.anchor, hoverHeight: profile.context.hoverHeight })
    : null;
  const duration = prepared?.durationSeconds ?? profile.duration;
  const clip = Object.freeze({
    name: actorMode
      ? (effectId === 'waterwing-defeat-fx' ? 'WW_defeat_transition_v1' : 'WW_emerge_hybrid_v3')
      : `WW_FX_${effectId.replaceAll('-', '_')}_v2`,
    duration,
  });
  const manifest = Object.freeze({
    assetVersion: actorMode
      ? prepared.sourceAssetVersion
      : `waterwing-fx-${effectId}-${prepared ? 'v2' : 'v1'}`,
    rootMotion: false,
    loop: false,
    anchors: ['source', 'impact', 'water-surface'],
  });
  const runtimeContext = actorMode
    ? Object.freeze({ anchor: [0, -1.05, 0], surfaceNormal: [0, 1, 0], hoverHeight: 1.05 })
    : profile.context;

  function createInstance() {
    const effectRoot = prepared ? prepared.createInstance() : profile.factory();
    const runtime = runtimeForEffect(effectRoot);
    if (!runtime?.update) throw new Error(`Reusable effect runtime missing for ${effectId}`);
    const root = new THREE.Group();
    root.name = `${effectId}-review-container`;
    const previewContextSubject = effectId === 'waterwing-hit-fx'
      ? createHitReviewContextSubject()
      : null;
    root.userData.effectObject = effectRoot;
    root.userData.projectileRuntime = effectRoot.userData.projectileRuntime;
    root.userData.impactRuntime = effectRoot.userData.impactRuntime;
    root.userData.eventRuntime = effectRoot.userData.eventRuntime;
    if (previewContextSubject) root.add(previewContextSubject.root);
    effectRoot.traverse(object => {
      if (object.isMesh || object.isSprite) object.renderOrder = Math.max(2, object.renderOrder ?? 0);
    });
    root.add(effectRoot);
    const reviewActor = effectRoot.userData.reviewActorInstance
      ?? effectRoot.userData.emergenceActorInstance
      ?? effectRoot.userData.defeatActorInstance
      ?? null;
    const skeletonHelper = reviewActor?.skeletonHelper ?? new THREE.Group();
    if (!reviewActor) skeletonHelper.name = `${effectId}-empty-skeleton-helper`;
    let phase = 0;
    let localMaterialMode = 'water';
    function setProgress(progress) {
      phase = THREE.MathUtils.clamp(Number(progress), 0, 1);
      previewContextSubject?.update(phase);
      runtime.update(phase, runtimeContext);
      setEffectMaterialMode(effectRoot, localMaterialMode);
      runtime.setMaterialMode?.(localMaterialMode);
      root.updateMatrixWorld(true);
    }
    setProgress(0);
    return {
      root,
      clip,
      manifest,
      skeletonHelper,
      skeletonUuid: skeletonHelper.uuid,
      setProgress,
      setMaterialMode(mode) {
        localMaterialMode = mode;
        previewContextSubject?.setMaterialMode(mode);
        setEffectMaterialMode(effectRoot, mode);
        runtime.setMaterialMode?.(mode);
      },
      setSkeletonVisible(visible) {
        reviewActor?.setSkeletonVisible?.(visible);
      },
      setAnchorsVisible(visible) {
        reviewActor?.setAnchorsVisible?.(visible);
      },
      getAnchor: name => reviewActor?.getAnchor?.(name) ?? null,
      getWaterMaterialProfile: () => runtime.getWaterMaterialProfile?.() ?? ({
        aqueousLookVersion: 'waterwing-reusable-fx-clear-water-v10',
        transmission: 0.9,
        ior: 1.333,
      }),
      getWaterRegionProfiles: () => runtime.getWaterRegionProfiles?.() ?? [],
      getCoreMaterialProfile: () => runtime.getCoreMaterialProfile?.() ?? null,
      getPhase: () => phase,
      getMaterialMode: () => localMaterialMode,
      getBounds: () => new THREE.Box3().setFromObject(effectRoot, true),
      getPoseFingerprint: () => runtime.getPoseFingerprint?.() ?? effectPoseFingerprint(effectRoot, phase),
      getEmergenceState: () => {
        const state = effectRoot.userData.emergenceState;
        if (!state) return null;
        const hiddenAuxiliaryVisibleCount = state.hiddenAuxiliaryNames
          .filter(name => effectRoot.getObjectByName(name)?.visible).length;
        return {
          ...state,
          surfaceChannels: { ...state.surfaceChannels },
          hiddenAuxiliaryNames: [...state.hiddenAuxiliaryNames],
          hiddenAuxiliaryVisibleCount,
        };
      },
      getDefeatState: () => effectRoot.userData.defeatState
        ? JSON.parse(JSON.stringify(effectRoot.userData.defeatState))
        : null,
      getAttackSequenceState: () => effectRoot.userData.attackSequenceState
        ? JSON.parse(JSON.stringify(effectRoot.userData.attackSequenceState))
        : null,
      getPreviewContextSubject: () => previewContextSubject?.getReviewState() ?? null,
      isProjectileVisible: () => Boolean(effectRoot.visible),
      getProjectileWorldPosition: () => effectRoot.getWorldPosition(new THREE.Vector3()),
    };
  }

  return {
    actionName: effectId,
    sourceAction: prepared?.sourceAction ?? effectId,
    actorAssetFamily: prepared?.actorAssetFamily
      ?? (actorMode ? 'blender-clear-water-v10' : 'waterwing-reusable-water-fx-v1'),
    sourceAssetVersion: prepared?.sourceAssetVersion ?? manifest.assetVersion,
    manifest,
    clip,
    reviewScale: actorMode ? 1 : profile.reviewScale,
    createInstance,
  };
}

async function createFullFilmReviewAsset(actionId) {
  const profile = actionReviewProfiles[actionId];
  if (!profile) throw new Error(`Unknown final-film action ${actionId}`);
  fullFilmActionLibrary ??= await loadFullFilmActionLibrary();
  const sourceAsset = await loadWaterwingBlenderAsset(profile.source);
  const isAuthoredSourceAction = actionId === profile.source;
  const clip = isAuthoredSourceAction
    ? sourceAsset.clip
    : Object.freeze({
        name: `WW_${actionId.replaceAll('-', '_')}_final_v10`,
        duration: profile.duration,
      });
  const manifest = Object.freeze({
    ...sourceAsset.manifest,
    loop: profile.loop,
  });

  function createInstance() {
    const adapter = fullFilmActionLibrary.create(actionId, { actorId: `review-${actionId}` });
    const sourceInstance = adapter.instance;
    let phase = 0;
    function setProgress(progress) {
      phase = THREE.MathUtils.clamp(Number(progress), 0, 1);
      adapter.update(phase, { direction: 1, hitSide: 1 });
      adapter.root.updateMatrixWorld(true);
    }
    setProgress(0);
    return {
      root: adapter.root,
      mixer: sourceInstance.mixer,
      clip,
      manifest,
      skeletonHelper: sourceInstance.skeletonHelper,
      skeletonUuid: sourceInstance.skeletonUuid,
      setProgress,
      setMaterialMode: sourceInstance.setMaterialMode,
      setSkeletonVisible: sourceInstance.setSkeletonVisible,
      setAnchorsVisible: sourceInstance.setAnchorsVisible,
      getAnchor: sourceInstance.getAnchor,
      getWaterMaterialProfile: sourceInstance.getWaterMaterialProfile,
      getWaterRegionProfiles: sourceInstance.getWaterRegionProfiles,
      getCoreMaterialProfile: sourceInstance.getCoreMaterialProfile,
      getPhase: () => phase,
      getMaterialMode: sourceInstance.getMaterialMode,
      getBounds: sourceInstance.getBounds,
      getPoseFingerprint: sourceInstance.getPoseFingerprint,
      isProjectileVisible: () => false,
      getProjectileWorldPosition: () => null,
    };
  }

  return {
    actionName: actionId,
    sourceAction: profile.source,
    actorAssetFamily: fullFilmActionLibrary.assetFamily,
    sourceAssetVersion: sourceAsset.manifest.assetVersion,
    manifest,
    clip,
    createInstance,
  };
}

async function loadReviewAsset(actionId) {
  if (actionId === 'emerge') {
    return createEffectReviewAsset('waterwing-emergence-fx', { actorMode: true });
  }
  if (actionId === 'defeat') {
    return createEffectReviewAsset('waterwing-defeat-fx', { actorMode: true });
  }
  if (effectReviewProfiles[actionId]) return createEffectReviewAsset(actionId);
  if (actionId !== legacyReviewAction) return createFullFilmReviewAsset(actionId);
  const sourceAsset = await loadWaterwingBlenderAsset(legacyReviewAction);
  return {
    ...sourceAsset,
    sourceAction: legacyReviewAction,
    actorAssetFamily: fullFilmActionLibrary?.assetFamily ?? 'blender-clear-water-v10',
    sourceAssetVersion: sourceAsset.manifest.assetVersion,
  };
}

function updateWaterfallTextureCover() {
  const mediaWidth = waterfallVideo.videoWidth || 1920;
  const mediaHeight = waterfallVideo.videoHeight || 1080;
  const mediaAspect = mediaWidth / Math.max(1, mediaHeight);
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

waterfallVideo.addEventListener('loadedmetadata', updateWaterfallTextureCover);

async function setLocalBackgroundVideo(file) {
  if (!(file instanceof File) || !file.type.startsWith('video/')) {
    throw new Error('请选择本机视频文件');
  }
  if (backgroundVideoObjectUrl) URL.revokeObjectURL(backgroundVideoObjectUrl);
  backgroundVideoObjectUrl = URL.createObjectURL(file);
  waterfallVideo.src = backgroundVideoObjectUrl;
  waterfallVideo.load();
  await new Promise((resolve, reject) => {
    waterfallVideo.addEventListener('loadedmetadata', resolve, { once: true });
    waterfallVideo.addEventListener('error', () => reject(new Error('本地背景视频无法读取')), { once: true });
  });
  activeWaterBackdropTexture = waterfallTexture;
  updateWaterfallTextureCover();
  setBackgroundMode('waterfall');
  await waterfallVideo.play().catch(() => {});
  return getState();
}

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function clearDebugObjects() {
  while (debugRoot.children.length) {
    const object = debugRoot.children.pop();
    object.traverse(child => {
      child.geometry?.dispose?.();
      const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
      materials.forEach(material => material.dispose?.());
    });
  }
}

function createDebugMarker(position, color, name) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 14, 10),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  marker.name = name;
  marker.position.fromArray(position);
  marker.renderOrder = 50;
  return marker;
}

function updateDebugObjects() {
  clearDebugObjects();
  if (reviewMode !== 'effects' || !effectReviewProfiles[currentAction]) return;
  const profile = effectReviewProfiles[currentAction];
  const context = profile.context;
  if (debugLayers.has('trajectory') && context.start && context.end) {
    const root = instances[0]?.root;
    const runtime = root?.userData.projectileRuntime;
    if (runtime?.pointAt) {
      const points = Array.from({ length: 49 }, (_, index) => runtime.pointAt(index / 48, context));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: '#74f1ff', transparent: true, opacity: 0.82, depthTest: false }),
      );
      line.name = 'debug-trajectory';
      line.renderOrder = 49;
      debugRoot.add(line);
    }
  }
  if (debugLayers.has('anchors')) {
    if (context.start) debugRoot.add(createDebugMarker(context.start, '#5effb8', 'debug-source-anchor'));
    if (context.end) debugRoot.add(createDebugMarker(context.end, '#ffcf5e', 'debug-impact-anchor'));
    if (context.impactPoint) debugRoot.add(createDebugMarker(context.impactPoint, '#ffcf5e', 'debug-impact-anchor'));
    if (context.contactPoint) debugRoot.add(createDebugMarker(context.contactPoint, '#ffcf5e', 'debug-contact-anchor'));
  }
  if (debugLayers.has('waterline') && context.anchor) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.7, 1.73, 96),
      new THREE.MeshBasicMaterial({ color: '#71e9f4', transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthTest: false }),
    );
    ring.name = 'debug-waterline';
    ring.position.fromArray(context.anchor);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 49;
    debugRoot.add(ring);
  }
}

function setDebugLayer(name, enabled = !debugLayers.has(name)) {
  if (!['trajectory', 'anchors', 'waterline'].includes(name)) throw new Error(`Unknown debug layer ${name}`);
  if (enabled) debugLayers.add(name);
  else debugLayers.delete(name);
  document.querySelectorAll('[data-debug]').forEach(button => {
    button.classList.toggle('active', debugLayers.has(button.dataset.debug));
  });
  updateDebugObjects();
  return [...debugLayers];
}

function placeInstances() {
  const layouts = cloneCount === 1
    ? [{ x: 0, z: 0, scale: 0.92 }]
    : cloneCount === 2
      ? [
          { x: -2.35, z: 0.55, scale: 0.64 },
          { x: 3.55, z: -1.25, scale: 0.44 },
        ]
      : [
        { x: -4.5, z: -0.9, scale: 0.47 },
        { x: 0, z: 0.5, scale: 0.55 },
        { x: 4.5, z: -0.9, scale: 0.47 },
      ];
  instances.forEach((instance, index) => {
    const layout = layouts[index];
    instance.root.position.set(layout.x, 0, layout.z);
    instance.root.scale.setScalar(layout.scale * (asset?.reviewScale ?? 1));
    instance.root.userData.reviewBasePosition = instance.root.position.clone();
    applyReviewWorldMotion(instance, index);
    instance.root.updateMatrixWorld(true);
  });
}

function applyReviewWorldMotion(instance, index) {
  const base = instance.root.userData.reviewBasePosition;
  if (!base) return;
  instance.root.position.copy(base);
  instance.root.rotation.set(0, 0, 0);
  if (reviewMode === 'effects') {
    instance.root.updateMatrixWorld(true);
    return;
  }
  if (currentAction === 'hover') {
    const angle = currentPhase * Math.PI * 2 + index * 0.24;
    instance.root.position.y += Math.sin(angle) * 0.42;
    instance.root.rotation.z = Math.sin(angle + 0.7) * 0.032;
    instance.root.rotation.x = Math.cos(angle) * 0.018;
  } else if (currentAction === 'dodge') {
    let travelX = 0;
    let travelY = 0;
    let travelZ = 0;
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    if (currentPhase < 0.15) {
      const preload = smoothstep01(currentPhase / 0.15);
      travelX = THREE.MathUtils.lerp(0, -0.24, preload);
      travelY = THREE.MathUtils.lerp(0, -0.04, preload);
      travelZ = THREE.MathUtils.lerp(0, -0.05, preload);
      pitch = THREE.MathUtils.lerp(0, 0.018, preload);
      yaw = THREE.MathUtils.lerp(0, -0.03, preload);
      roll = THREE.MathUtils.lerp(0, 0.07, preload);
    } else if (currentPhase < 0.48) {
      const cut = smoothstep01((currentPhase - 0.15) / 0.33);
      travelX = THREE.MathUtils.lerp(-0.24, 3.08, cut);
      travelY = THREE.MathUtils.lerp(-0.04, 0.38, cut);
      travelZ = THREE.MathUtils.lerp(-0.05, 0.72, cut);
      pitch = THREE.MathUtils.lerp(0.018, -0.04, cut);
      yaw = THREE.MathUtils.lerp(-0.03, 0.12, cut);
      roll = THREE.MathUtils.lerp(0.07, -0.27, cut);
    } else if (currentPhase < 0.7) {
      const brake = smoothstep01((currentPhase - 0.48) / 0.22);
      travelX = THREE.MathUtils.lerp(3.08, 3.42, brake);
      travelY = THREE.MathUtils.lerp(0.38, 0.2, brake);
      travelZ = THREE.MathUtils.lerp(0.72, 0.86, brake);
      pitch = THREE.MathUtils.lerp(-0.04, 0.025, brake);
      yaw = THREE.MathUtils.lerp(0.12, 0.045, brake);
      roll = THREE.MathUtils.lerp(-0.27, -0.07, brake);
    } else {
      const settle = smoothstep01((currentPhase - 0.7) / 0.3);
      travelX = THREE.MathUtils.lerp(3.42, 3.1, settle);
      travelY = THREE.MathUtils.lerp(0.2, 0, settle);
      travelZ = THREE.MathUtils.lerp(0.86, 0.68, settle);
      pitch = THREE.MathUtils.lerp(0.025, 0, settle);
      yaw = THREE.MathUtils.lerp(0.045, 0, settle);
      roll = THREE.MathUtils.lerp(-0.07, 0, settle);
    }
    instance.root.position.x += travelX;
    instance.root.position.y += travelY;
    instance.root.position.z += travelZ;
    instance.root.rotation.set(pitch, yaw, roll);
  } else if (currentAction === 'lunge') {
    const attack = Math.sin(currentPhase * Math.PI);
    instance.root.position.y += attack * 0.16;
    instance.root.position.z += attack * 3.15;
    instance.root.rotation.x = -attack * 0.08;
  } else if (currentAction === 'defeat') {
    const collapse = smoothstep01(currentPhase);
    instance.root.position.y -= collapse * 0.62;
    instance.root.position.z -= collapse * 0.28;
  }
  instance.root.updateMatrixWorld(true);
}

function clearInstances() {
  for (const instance of instances) {
    reviewRoot.remove(instance.root);
    scene.remove(instance.skeletonHelper);
  }
  instances = [];
}

function rebuildInstances(count) {
  cloneCount = THREE.MathUtils.clamp(Math.round(Number(count) || 1), 1, 3);
  clearInstances();
  for (let index = 0; index < cloneCount; index += 1) {
    const instance = asset.createInstance();
    instance.setProgress(currentPhase);
    instance.setMaterialMode(materialMode);
    instance.setSkeletonVisible(skeletonVisible);
    instance.setAnchorsVisible(anchorsVisible);
    reviewRoot.add(instance.root);
    scene.add(instance.skeletonHelper);
    instances.push(instance);
  }
  placeInstances();
}

function setPhase(value, pause = true) {
  currentPhase = THREE.MathUtils.clamp(Number(value), 0, 1);
  if (pause) playing = false;
  instances.forEach((instance, index) => {
    instance.setProgress(currentPhase);
    applyReviewWorldMotion(instance, index);
  });
  phaseInput.value = String(currentPhase);
  const duration = asset?.clip.duration ?? 0;
  phaseLabel.textContent = `${Math.round(currentPhase * 100)}% · ${(currentPhase * duration).toFixed(2)}s`;
  playButton.textContent = playing ? '暂停' : '播放';
}

function setSpeed(value) {
  const requested = Number(value);
  playbackSpeed = [0.25, 0.5, 1].includes(requested) ? requested : 1;
  document.querySelectorAll('[data-speed]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.speed) === playbackSpeed);
  });
  return playbackSpeed;
}

function stepFrames(frameDelta) {
  const frames = Number.isFinite(Number(frameDelta)) ? Number(frameDelta) : 0;
  const duration = Math.max(1 / 30, asset?.clip.duration ?? 1);
  return setPhase(currentPhase + frames / (duration * 30));
}

function setView(name) {
  if (!viewPresets[name]) throw new Error(`Unknown view ${name}`);
  currentView = name;
  camera.up.set(0, 1, 0);
  if (name === 'top') camera.up.set(0, 0, 1);
  const preset = viewPresets[name].clone();
  if (reviewMode === 'effects') {
    const nearField = currentAction === 'lens-impact' || currentAction === 'waterwing-hit-fx';
    preset.multiplyScalar(nearField ? 0.5 : 0.74);
  }
  camera.position.copy(preset);
  const targetY = reviewMode === 'effects' && currentAction === 'waterwing-hit-fx'
    ? 1
    : (reviewMode === 'effects' && currentAction.includes('waterwing-') ? -0.1 : 0.18);
  controls.target.set(0, targetY, 0);
  controls.update();
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
}

function setMaterialMode(mode) {
  materialMode = mode;
  for (const instance of instances) instance.setMaterialMode(mode);
  document.querySelectorAll('[data-material]').forEach(button => button.classList.toggle('active', button.dataset.material === mode));
}

function setSkeletonVisible(visible) {
  skeletonVisible = Boolean(visible);
  for (const instance of instances) instance.setSkeletonVisible(skeletonVisible);
  document.querySelector('#skeleton-toggle').classList.toggle('active', skeletonVisible);
}

function setAnchorsVisible(visible) {
  anchorsVisible = Boolean(visible);
  for (const instance of instances) instance.setAnchorsVisible(anchorsVisible);
  document.querySelector('#anchors-toggle').classList.toggle('active', anchorsVisible);
}

function setCloneCount(count) {
  if (reviewMode === 'effects') count = 1;
  rebuildInstances(count);
  document.querySelectorAll('[data-clones]').forEach(button => button.classList.toggle('active', Number(button.dataset.clones) === cloneCount));
}

function setBackgroundMode(mode) {
  if (!['waterfall', 'studio'].includes(mode)) throw new Error(`Unknown background mode ${mode}`);
  backgroundMode = mode;
  const isWaterfall = mode === 'waterfall';
  scene.background = isWaterfall ? activeWaterBackdropTexture : studioBackground;
  scene.fog = isWaterfall ? null : studioFog;
  for (const decoration of studioDecorations) decoration.visible = !isWaterfall;
  // The moving backdrop is rendered inside WebGL so physical transmission can
  // sample it. The public demo uses a generated water field until the viewer
  // chooses a local video; that local file never leaves the browser.
  waterfallVideo.classList.add('hidden');
  if (isWaterfall && activeWaterBackdropTexture === waterfallTexture) {
    updateWaterfallTextureCover();
    waterfallVideo.play().catch(() => {});
  }
  else waterfallVideo.pause();
  document.querySelectorAll('[data-background]').forEach(button => {
    button.classList.toggle('active', button.dataset.background === mode);
  });
}

function setTransparentCaptureMode(enabled) {
  const transparent = Boolean(enabled);
  if (transparent) {
    scene.background = null;
    scene.fog = null;
    for (const decoration of studioDecorations) decoration.visible = false;
    waterfallVideo.pause();
    waterfallVideo.classList.add('hidden');
    renderer.setClearColor(0x000000, 0);
  } else {
    renderer.setClearColor(0x000000, 1);
    setBackgroundMode(backgroundMode);
  }
  return transparent;
}

function setCaptureCameraScale(scale = 1) {
  const factor = THREE.MathUtils.clamp(Number(scale) || 1, 0.5, 8);
  camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);
  camera.updateProjectionMatrix();
  controls.update();
  return factor;
}

async function setAction(name) {
  const isEffect = Boolean(effectReviewProfiles[name]);
  if (![...availableActionIds(), legacyReviewAction, ...effectReviewIds].includes(name)) throw new Error(`Unknown action ${name}`);
  if (isEffect && reviewMode !== 'effects') {
    reviewMode = 'effects';
    cloneCount = 1;
    renderActionButtons();
    updateModeUi();
  } else if (!isEffect && reviewMode !== 'actors') {
    reviewMode = 'actors';
    renderActionButtons();
    updateModeUi();
  }
  playing = false;
  status.textContent = `LOADING ${name.toUpperCase()} ASSET…`;
  status.classList.remove('ready', 'error');
  const nextAsset = await loadReviewAsset(name);
  asset = nextAsset;
  currentAction = name;
  currentPhase = name === 'hover' ? 0.18 : 0;
  rebuildInstances(cloneCount);
  setPhase(currentPhase, false);
  setMaterialMode(materialMode);
  setView(currentView);
  const profile = effectReviewProfiles[name] ?? actionReviewProfiles[name];
  actionTitle.textContent = profile?.title ?? '直射水弹完整母动作';
  if (reviewMode === 'effects') {
    reviewSubtitle.textContent = '按完整攻击结果验收：水球飞行、命中或擦身、角色反馈与溅散收尾使用同一运行时。';
  } else {
    reviewSubtitle.textContent = '5 个 Blender 专用母动作派生 11 个成片战斗状态；统一使用当前确认的浅青晶透水体与弱水核。';
  }
  const version = asset.manifest.assetVersion.match(/-(v\d+)$/)?.[1]?.toUpperCase() ?? 'V1';
  assetEyebrow.textContent = `WATERWING / ${name.toUpperCase()} · ${version} → CLEAR V10`;
  document.querySelectorAll('[data-action], [data-effect]').forEach(button => {
    button.classList.toggle('active', (button.dataset.action ?? button.dataset.effect) === name);
  });
  status.textContent = `${asset.sourceAssetVersion.toUpperCase()} · ${asset.clip.duration.toFixed(2)}S · READY`;
  status.classList.add('ready');
  playing = true;
  playButton.textContent = '暂停';
  const url = new URL(location.href);
  url.searchParams.set('mode', reviewMode);
  url.searchParams.set('asset', name);
  history.replaceState(null, '', url);
  updateDebugObjects();
  return getState();
}

function updateModeUi() {
  document.querySelectorAll('[data-review-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.reviewMode === reviewMode);
  });
  const effects = reviewMode === 'effects';
  debugSection.hidden = !effects;
  instancesSection.hidden = effects;
  libraryTitle.textContent = effects ? 'FX ASSETS / 可复用特效' : 'ACTION / 专用动作';
  reviewSubtitle.textContent = effects
    ? '按完整攻击结果验收：水球飞行、命中或擦身、角色反馈与溅散收尾使用同一运行时。'
    : '5 个 Blender 专用母动作派生 11 个成片战斗状态；统一使用当前确认的浅青晶透水体与弱水核。';
  modeChip.textContent = effects ? '4 COMPLETE ATTACK RESULTS · PRODUCTION SOURCE' : '5 AUTHORED CLIPS · 11 COMBAT STATES';
  waterProfileChip.textContent = effects ? 'CLEAR WATER V10 · DETERMINISTIC SEEK' : 'CLEAR WATER V10 · WEAK CORE';
}

async function setReviewMode(mode) {
  if (!['actors', 'effects'].includes(mode)) throw new Error(`Unknown review mode ${mode}`);
  reviewMode = mode;
  if (mode === 'effects') cloneCount = 1;
  clearDebugObjects();
  renderActionButtons();
  updateModeUi();
  const nextId = mode === 'effects' ? 'player-miss' : 'forward';
  const url = new URL(location.href);
  url.searchParams.set('mode', mode);
  history.replaceState(null, '', url);
  return setAction(nextId);
}

function getState() {
  reviewRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(reviewRoot, true);
  const boundsSize = box.getSize(new THREE.Vector3()).toArray();
  const boundValues = [...box.min.toArray(), ...box.max.toArray()];
  const skeletonUuids = instances.map(instance => instance.skeletonUuid);
  const instanceWorldX = instances.map(instance => instance.root.getWorldPosition(new THREE.Vector3()).x);
  const instanceWorldY = instances.map(instance => instance.root.getWorldPosition(new THREE.Vector3()).y);
  const instanceWorldZ = instances.map(instance => instance.root.getWorldPosition(new THREE.Vector3()).z);
  const instanceWorldRotationZ = instances.map(instance => {
    const worldQuaternion = instance.root.getWorldQuaternion(new THREE.Quaternion());
    return new THREE.Euler().setFromQuaternion(worldQuaternion, 'XYZ').z;
  });
  const projectileVisible = instances[0]?.isProjectileVisible?.() ?? false;
  const projectileWorldPosition = instances[0]?.getProjectileWorldPosition?.()?.toArray() ?? null;
  const materialProfile = instances[0]?.getWaterMaterialProfile?.() ?? null;
  return {
    availableActions: availableActionIds(),
    availableFx: effectReviewIds,
    reviewMode,
    action: currentAction,
    sourceAction: asset.sourceAction,
    sourceAssetVersion: asset.sourceAssetVersion,
    actorAssetFamily: asset.actorAssetFamily,
    assetVersion: asset.manifest.assetVersion,
    clip: asset.clip.name,
    durationSeconds: asset.clip.duration,
    cloneCount,
    skeletonsIndependent: new Set(skeletonUuids).size === skeletonUuids.length,
    skeletonUuids,
    instanceWorldX,
    instanceWorldY,
    instanceWorldZ,
    instanceWorldRotationZ,
    rootMotion: asset.manifest.rootMotion,
    loop: asset.manifest.loop !== false,
    projectileAsset: asset.manifest.projectileAsset ?? null,
    projectileVisible,
    projectileWorldPosition,
    playing,
    playbackSpeed,
    phase: currentPhase,
    view: currentView,
    materialMode,
    materialProfile,
    materialRegions: instances[0]?.getWaterRegionProfiles?.() ?? [],
    coreProfile: instances[0]?.getCoreMaterialProfile?.() ?? null,
    lightingProfile: { ...lightingProfile },
    backgroundMode,
    debugLayers: [...debugLayers],
    backgroundSource: backgroundVideoObjectUrl ? 'local-video' : 'procedural-water',
    cameraTarget: controls.target.toArray(),
    backgroundRendering: backgroundMode === 'waterfall'
      ? (backgroundVideoObjectUrl ? 'webgl-video-texture' : 'webgl-canvas-texture')
      : 'webgl-solid-color',
    domBackdropVisible: !waterfallVideo.classList.contains('hidden'),
    anchorCount: asset.manifest.anchors.length,
    boundsSize,
    finiteBounds: boundValues.every(Number.isFinite),
    poseFingerprint: instances[0]?.getPoseFingerprint() ?? '',
    emergenceState: instances[0]?.getEmergenceState?.() ?? null,
    defeatState: instances[0]?.getDefeatState?.() ?? null,
    attackSequenceState: instances[0]?.getAttackSequenceState?.() ?? null,
    previewContextSubject: instances[0]?.getPreviewContextSubject?.() ?? null,
    canvasCount: document.querySelectorAll('canvas').length,
  };
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-material]').forEach(button => button.addEventListener('click', () => setMaterialMode(button.dataset.material)));
document.querySelectorAll('[data-background]').forEach(button => button.addEventListener('click', () => setBackgroundMode(button.dataset.background)));
document.querySelectorAll('[data-clones]').forEach(button => button.addEventListener('click', () => setCloneCount(Number(button.dataset.clones))));
document.querySelectorAll('[data-review-mode]').forEach(button => button.addEventListener('click', () => {
  setReviewMode(button.dataset.reviewMode).catch(error => {
    console.error(error);
    status.textContent = `载入失败：${error.message}`;
    status.classList.add('error');
  });
}));
document.querySelectorAll('[data-debug]').forEach(button => button.addEventListener('click', () => setDebugLayer(button.dataset.debug)));
document.querySelectorAll('[data-frame-step]').forEach(button => button.addEventListener('click', () => stepFrames(button.dataset.frameStep)));
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => setSpeed(button.dataset.speed)));
document.querySelector('#skeleton-toggle').addEventListener('click', () => setSkeletonVisible(!skeletonVisible));
document.querySelector('#anchors-toggle').addEventListener('click', () => setAnchorsVisible(!anchorsVisible));
backgroundVideoInput.addEventListener('change', () => {
  const [file] = backgroundVideoInput.files;
  if (!file) return;
  setLocalBackgroundVideo(file).catch(error => {
    console.error(error);
    status.textContent = `背景载入失败：${error.message}`;
    status.classList.add('error');
  });
});
phaseInput.addEventListener('input', () => setPhase(phaseInput.value));
playButton.addEventListener('click', () => {
  if (!playing && asset?.manifest.loop === false && currentPhase >= 1) setPhase(0, false);
  playing = !playing;
  playButton.textContent = playing ? '暂停' : '播放';
});

window.addEventListener('resize', () => {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  updateWaterfallTextureCover();
});

const clock = new THREE.Clock();
function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (activeWaterBackdropTexture === proceduralBackdropTexture) {
    updateProceduralWaterBackdrop(clock.elapsedTime);
  }
  if (playing && instances.length) {
    const nextPhase = currentPhase + delta * playbackSpeed / asset.clip.duration;
    if (asset.manifest.loop === false) {
      currentPhase = Math.min(nextPhase, 1);
      if (currentPhase >= 1) playing = false;
    } else {
      currentPhase = nextPhase % 1;
    }
    setPhase(currentPhase, false);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.waterwingBlenderPreview = { ready: false };

try {
  fullFilmActionLibrary = await loadFullFilmActionLibrary();
  renderActionButtons();
  window.waterwingBlenderPreview = {
    ready: false,
    setAction,
    setPhase,
    setView,
    setMaterialMode,
    setSkeletonVisible,
    setAnchorsVisible,
    setCloneCount,
    setBackgroundMode,
    setLocalBackgroundVideo,
    setTransparentCaptureMode,
    setCaptureCameraScale,
    setReviewMode,
    setDebugLayer,
    setSpeed,
    stepFrames,
    getState,
  };
  updateModeUi();
  renderActionButtons();
  const initialId = reviewMode === 'effects'
    ? (effectReviewIds.includes(initialAssetId) ? initialAssetId : 'player-miss')
    : ([...availableActionIds(), legacyReviewAction].includes(initialAssetId) ? initialAssetId : 'forward');
  await setAction(initialId);
  setBackgroundMode('waterfall');
  window.waterwingBlenderPreview.ready = true;
  render();
} catch (error) {
  console.error(error);
  status.textContent = `载入失败：${error.message}`;
  status.classList.add('error');
  window.waterwingBlenderPreview = { ready: false, error: error.message };
}

window.addEventListener('beforeunload', () => {
  if (backgroundVideoObjectUrl) URL.revokeObjectURL(backgroundVideoObjectUrl);
});

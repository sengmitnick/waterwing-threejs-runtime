import '@google/model-viewer';

const MODEL_ROOT = '/model/waterwing-v2';

const CATALOG = Object.freeze({
  waterwing: Object.freeze({
    label: '瀑翼水灵',
    defaultAction: 'idle',
    actions: Object.freeze({
      emerge: Object.freeze({ label: '破水登场', file: 'waterwing-emerge.glb', clip: 'emerge-from-water' }),
      idle: Object.freeze({ label: '悬浮', file: 'waterwing-idle.glb', clip: 'idle-hover' }),
      charge: Object.freeze({ label: '蓄力', file: 'waterwing-charge.glb', clip: 'charge-waterball' }),
      cast: Object.freeze({ label: '发射', file: 'waterwing-cast.glb', clip: 'cast-waterball' }),
      lunge: Object.freeze({ label: '扑击', file: 'waterwing-lunge.glb', clip: 'lunge-attack' }),
      dodge: Object.freeze({ label: '闪避', file: 'waterwing-dodge.glb', clip: 'dodge-bank' }),
      hit: Object.freeze({ label: '受击', file: 'waterwing-hit.glb', clip: 'hit-recoil' }),
      forward: Object.freeze({ label: '向前游动', file: 'waterwing-forward.glb', clip: 'forward-swim-loop' })
    })
  }),
  'waterball-player': Object.freeze({
    label: '玩家水球',
    file: 'waterball-player.glb',
    defaultAction: 'flight-loop',
    actions: Object.freeze({
      'charge-pulse': Object.freeze({ label: '蓄能', clip: 'charge-pulse' }),
      'flight-loop': Object.freeze({ label: '飞行', clip: 'flight-loop' }),
      'impact-burst': Object.freeze({ label: '命中', clip: 'impact-burst' })
    })
  }),
  'waterball-enemy': Object.freeze({
    label: '水怪水球',
    file: 'waterball-enemy.glb',
    defaultAction: 'direct-flight-loop',
    actions: Object.freeze({
      'charge-pulse': Object.freeze({ label: '水团脉动', clip: 'charge-pulse' }),
      'direct-charge': Object.freeze({ label: 'A/B短蓄力', clip: 'direct-charge' }),
      'direct-flight-loop': Object.freeze({ label: '前排直射', clip: 'direct-flight-loop' }),
      'lob-charge': Object.freeze({ label: 'C重蓄力', clip: 'lob-charge' }),
      'lob-flight-loop': Object.freeze({ label: '后排高抛', clip: 'lob-flight-loop' }),
      'impact-burst': Object.freeze({ label: '命中', clip: 'impact-burst' })
    })
  })
});

const ORBITS = Object.freeze({
  front: '0deg 78deg 108%',
  advance: '58deg 74deg 118%',
  side: '90deg 78deg 108%',
  rear: '180deg 78deg 108%',
  top: '0deg 12deg 118%'
});

const NEUTRAL_ORIENTATION = '0deg 0deg 0deg';
const FORWARD_ORIENTATION = '35deg 92deg 48deg';

const viewer = document.querySelector('#waterwing-v2-model');
const status = document.querySelector('#status');
const assetControls = document.querySelector('#asset-controls');
const actionControls = document.querySelector('#action-controls');
const viewControls = document.querySelector('#view-controls');
const backgroundToggle = document.querySelector('#background-toggle');

let selectedAsset = 'waterwing';
let selectedAction = CATALOG.waterwing.defaultAction;
let selectedSrc = '';
let selectedClip = '';
let loadGeneration = 0;

function normalizeSelection(asset, action) {
  const assetEntry = CATALOG[asset] ?? CATALOG.waterwing;
  const normalizedAsset = CATALOG[asset] ? asset : 'waterwing';
  const normalizedAction = assetEntry.actions[action] ? action : assetEntry.defaultAction;
  const actionEntry = assetEntry.actions[normalizedAction];
  return {
    asset: normalizedAsset,
    action: normalizedAction,
    assetEntry,
    actionEntry,
    src: `${MODEL_ROOT}/${actionEntry.file ?? assetEntry.file}`,
    clip: actionEntry.clip
  };
}

function renderControls() {
  assetControls.replaceChildren();
  Object.entries(CATALOG).forEach(([key, entry]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.label;
    button.classList.toggle('active', key === selectedAsset);
    button.addEventListener('click', () => setSelection(key, entry.defaultAction));
    assetControls.appendChild(button);
  });

  actionControls.replaceChildren();
  Object.entries(CATALOG[selectedAsset].actions).forEach(([key, entry]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.label;
    button.classList.toggle('active', key === selectedAction);
    button.addEventListener('click', () => setSelection(selectedAsset, key));
    actionControls.appendChild(button);
  });
}

function applyClip() {
  viewer.animationName = selectedClip;
  viewer.currentTime = 0;
  viewer.play?.();
  status.textContent = `${CATALOG[selectedAsset].label} · ${CATALOG[selectedAsset].actions[selectedAction].label}`;
}

function applyPreviewPose() {
  viewer.orientation =
    selectedAsset === 'waterwing' && selectedAction === 'forward'
      ? FORWARD_ORIENTATION
      : NEUTRAL_ORIENTATION;
}

function waitForModelLoad(generation) {
  return new Promise((resolve, reject) => {
    const handleLoad = () => {
      cleanup();
      if (generation === loadGeneration) applyClip();
      resolve();
    };
    const handleError = event => {
      cleanup();
      reject(new Error(`Model load failed: ${event.detail?.type ?? 'unknown'}`));
    };
    const cleanup = () => {
      viewer.removeEventListener('load', handleLoad);
      viewer.removeEventListener('error', handleError);
    };
    viewer.addEventListener('load', handleLoad, { once: true });
    viewer.addEventListener('error', handleError, { once: true });
  });
}

async function setSelection(asset, action) {
  const selection = normalizeSelection(asset, action);
  selectedAsset = selection.asset;
  selectedAction = selection.action;
  selectedClip = selection.clip;
  applyPreviewPose();
  renderControls();
  status.textContent = '模型载入中…';

  if (selectedSrc !== selection.src || !viewer.loaded) {
    selectedSrc = selection.src;
    loadGeneration += 1;
    const pending = waitForModelLoad(loadGeneration);
    viewer.setAttribute('src', selectedSrc);
    await pending;
  } else {
    applyClip();
  }

  if (selectedAsset === 'waterwing' && selectedAction === 'forward') setOrbit('advance');

  api.ready = true;
  return getState();
}

function setOrbit(name) {
  const orbit = ORBITS[name] ?? ORBITS.front;
  viewer.cameraOrbit = orbit;
  viewer.jumpCameraToGoal?.();
}

function getState() {
  return {
    asset: selectedAsset,
    action: selectedAction,
    src: selectedSrc,
    animationName: viewer.animationName,
    cameraOrbit: viewer.cameraOrbit,
    orientation: viewer.orientation,
    availableAnimations: [...(viewer.availableAnimations ?? [])],
    loaded: viewer.loaded === true
  };
}

const api = {
  ready: false,
  getState,
  setSelection,
  setOrbit
};
window.waterwingV2Viewer = api;

viewControls.addEventListener('click', event => {
  const name = event.target?.dataset?.orbit;
  if (name) setOrbit(name);
});

backgroundToggle.addEventListener('click', () => {
  const light = document.body.classList.toggle('light');
  backgroundToggle.textContent = light ? '深色背景' : '浅色背景';
});

const query = new URLSearchParams(window.location.search);
setSelection(query.get('asset') ?? 'waterwing', query.get('action') ?? 'idle').catch(error => {
  api.ready = false;
  status.textContent = '模型载入失败';
  queueMicrotask(() => { throw error; });
});

import { createActionReviewScene } from './createActionReviewScene.js';
import { REVIEW_ITEMS, REVIEW_ITEM_IDS, getReviewItem } from './reviewCatalog.js';

const GROUP_ORDER = Object.freeze(['基础移动', '远程攻击', '近战反应', '退场', '水弹命中']);
const canvas = document.querySelector('#review-viewport');
const actionList = document.querySelector('#action-list');
const progressControl = document.querySelector('#progress-control');
const progressLabel = document.querySelector('#progress-label');
const frameLabel = document.querySelector('#frame-label');
const playToggle = document.querySelector('#play-toggle');
const backgroundToggle = document.querySelector('#background-toggle');
const loadError = document.querySelector('#load-error');
const selectedLabel = document.querySelector('#selected-action-label');
const selectedCode = document.querySelector('#selected-action-code');
const selectedDescription = document.querySelector('#selected-action-description');
const selectedDuration = document.querySelector('#selected-action-duration');
const selectedOrigin = document.querySelector('#selected-action-origin');
const selectedGroup = document.querySelector('#selected-action-group');
const playbackState = document.querySelector('#playback-state');

function actionFromLocation() {
  const url = new URL(location.href);
  const queryId = url.searchParams.get('action');
  if (REVIEW_ITEM_IDS.includes(queryId)) return queryId;
  const hashId = decodeURIComponent(url.hash.slice(1));
  return REVIEW_ITEM_IDS.includes(hashId) ? hashId : 'forward';
}

function writeLocation(id, mode = 'push') {
  const url = new URL(location.href);
  url.searchParams.set('action', id);
  url.hash = '';
  history[mode === 'replace' ? 'replaceState' : 'pushState']({ action: id }, '', url);
}

function buildActionList() {
  const fragment = document.createDocumentFragment();
  for (const group of GROUP_ORDER) {
    const section = document.createElement('section');
    section.className = 'action-group';
    const heading = document.createElement('h2');
    heading.dataset.groupHeading = '';
    heading.textContent = group;
    section.append(heading);
    const items = document.createElement('div');
    items.className = 'action-group-items';
    for (const item of REVIEW_ITEMS.filter((candidate) => candidate.group === group)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-item';
      button.dataset.reviewId = item.id;
      button.innerHTML = `<span>${item.label}</span><small>${item.code}</small>`;
      items.append(button);
    }
    section.append(items);
    fragment.append(section);
  }
  actionList.replaceChildren(fragment);
}

function showError(error, itemId) {
  loadError.hidden = false;
  loadError.textContent = `${getReviewItem(itemId).label}加载失败：${error instanceof Error ? error.message : String(error)}`;
}

function hideError() {
  loadError.hidden = true;
  loadError.textContent = '';
}

function updateSelection(item) {
  selectedLabel.textContent = item.label;
  selectedCode.textContent = item.code;
  selectedDescription.textContent = item.description;
  selectedDuration.textContent = `${item.durationSeconds.toFixed(2)} 秒`;
  selectedOrigin.textContent = item.modelOrigin;
  selectedGroup.textContent = item.group;
  document.title = `瀑翼水灵 · ${item.label} · 统一动作审片台`;
  for (const button of document.querySelectorAll('[data-review-id]')) {
    const selected = button.dataset.reviewId === item.id;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-current', String(selected));
  }
}

function updateControls(state) {
  const item = getReviewItem(state.selectedId);
  updateSelection(item);
  const value = Math.max(0, Math.min(1, state.progress));
  progressControl.value = String(value);
  progressLabel.textContent = `${(value * 100).toFixed(1)}%`;
  const totalFrames = Math.max(1, Math.round(state.durationSeconds * 30));
  frameLabel.textContent = `${Math.round(value * totalFrames)} / ${totalFrames} 帧`;
  playToggle.textContent = state.playing ? '暂停' : '播放';
  playToggle.classList.toggle('active', state.playing);
  playToggle.setAttribute('aria-pressed', String(state.playing));
  playbackState.textContent = `原始动作 · ${state.speed}×${state.playing ? '' : ' · 已暂停'}`;
  for (const button of document.querySelectorAll('[data-speed]')) {
    button.classList.toggle('active', Number(button.dataset.speed) === state.speed);
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === state.view);
  }
  document.body.classList.toggle('light', state.lightBackground);
  backgroundToggle.textContent = state.lightBackground ? '切换深色' : '切换浅色';
}

buildActionList();

let reviewScene;
try {
  reviewScene = createActionReviewScene(canvas, {
    initialId: actionFromLocation(),
    onStateChange: updateControls,
  });
  hideError();
} catch (error) {
  showError(error, actionFromLocation());
  throw error;
}

function selectReview(id, { historyMode = null } = {}) {
  hideError();
  try {
    const item = reviewScene.select(id, { view: reviewScene.getState().view });
    if (historyMode) writeLocation(item.id, historyMode);
    return item;
  } catch (error) {
    showError(error, id);
    return null;
  }
}

actionList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-review-id]');
  if (!button) return;
  selectReview(button.dataset.reviewId, { historyMode: 'push' });
});

progressControl.addEventListener('input', () => reviewScene.setProgress(Number(progressControl.value)));
playToggle.addEventListener('click', () => reviewScene.setPlaying(!reviewScene.getState().playing));

document.querySelectorAll('[data-frame-step]').forEach((button) => {
  button.addEventListener('click', () => reviewScene.stepFrames(Number(button.dataset.frameStep)));
});

document.querySelectorAll('[data-speed]').forEach((button) => {
  button.addEventListener('click', () => reviewScene.setSpeed(Number(button.dataset.speed)));
});

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => reviewScene.setView(button.dataset.view));
});

backgroundToggle.addEventListener('click', () => reviewScene.setBackground(!reviewScene.getState().lightBackground));

window.addEventListener('popstate', () => selectReview(actionFromLocation()));
window.addEventListener('beforeunload', () => reviewScene.dispose(), { once: true });

writeLocation(reviewScene.getState().selectedId, 'replace');
updateControls(reviewScene.getState());

window.waterwingActionReview = {
  ready: true,
  items: REVIEW_ITEMS,
  select: (id) => selectReview(id),
  setProgress: reviewScene.setProgress,
  setPlaying: reviewScene.setPlaying,
  setSpeed: reviewScene.setSpeed,
  stepFrames: reviewScene.stepFrames,
  setView: reviewScene.setView,
  setBackground: reviewScene.setBackground,
  getState: reviewScene.getState,
  dispose: reviewScene.dispose,
};

import '@google/model-viewer';

const viewer = document.querySelector('#waterwing-model');
const status = document.querySelector('#model-status');

viewer.addEventListener('load', () => {
  const idle = viewer.availableAnimations?.find(name => name === 'idle-hover');
  if (idle) viewer.animationName = idle;
  viewer.play?.();
  status.textContent = '模型已载入 · 拖动检查正面、侧面与背面';
});

viewer.addEventListener('error', event => {
  const reason = event.detail?.type ?? 'unknown';
  status.textContent = `模型载入失败：${reason}`;
});

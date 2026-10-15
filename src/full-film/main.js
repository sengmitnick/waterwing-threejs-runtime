import { createFullFilmRuntime } from './runtime.js';

const parameters = new URLSearchParams(window.location.search);
const fixed = parameters.get('fixed') === '1';
const initialFrame = Number(parameters.get('frame') ?? 0);
const previewBackground = parameters.get('previewBackground') === '1';
const container = document.querySelector('#app');

const VIDEO_CANVAS = Object.freeze({ width: 1920, height: 1080 });

function fitPreviewCanvas() {
  if (fixed) {
    Object.assign(container.style, {
      position: 'relative',
      left: '0px',
      top: '0px',
      transform: 'none',
    });
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return;
  }

  const scale = Math.min(
    window.innerWidth / VIDEO_CANVAS.width,
    window.innerHeight / VIDEO_CANVAS.height,
  );
  const fittedWidth = VIDEO_CANVAS.width * scale;
  const fittedHeight = VIDEO_CANVAS.height * scale;
  Object.assign(container.style, {
    position: 'absolute',
    left: `${(window.innerWidth - fittedWidth) / 2}px`,
    top: `${(window.innerHeight - fittedHeight) / 2}px`,
    transform: `scale(${scale})`,
  });
}

fitPreviewCanvas();
window.addEventListener('resize', fitPreviewCanvas);
window.visualViewport?.addEventListener('resize', fitPreviewCanvas);

window.waterwingFullFilmRuntime = createFullFilmRuntime(container, {
  fixed,
  initialFrame,
  previewBackground,
});

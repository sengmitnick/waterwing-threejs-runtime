import * as THREE from 'three';

import { createFullEncounterScenario } from '../game/fullEncounterScenario.js';
import { simulateFullEncounterFrame, validateFullEncounterScenario } from '../game/fullEncounterSimulator.js';
import { createFullBattleScene } from './createFullBattleScene.js';
import { createFullHud } from './createFullHud.js';
import { FULL_FILM_CANVAS } from '../game/opticalField.js';

const WIDTH = FULL_FILM_CANVAS.width;
const HEIGHT = FULL_FILM_CANVAS.height;

function clampFrame(value, durationFrames) {
  return Math.max(0, Math.min(durationFrames - 1, Math.round(Number(value) || 0)));
}

function createBackgroundVideo(container, visible) {
  const video = document.createElement('video');
  video.id = 'full-film-preview-background';
  video.src = '/render/full-film/background-68s.mp4';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = true;
  Object.assign(video.style, {
    position: 'absolute',
    inset: '0',
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    objectFit: 'cover',
    zIndex: '0',
    opacity: visible ? '1' : '0',
    pointerEvents: 'none',
  });
  container.appendChild(video);
  video.load();
  return video;
}

function waitForVideoMetadata(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('error', onError);
    };
    const onMetadata = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed to load waterfall background'));
    };
    video.addEventListener('loadedmetadata', onMetadata, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function seekVideo(video, seconds) {
  const duration = Number.isFinite(video.duration) ? video.duration : 68;
  const target = Math.max(0, Math.min(duration - 1 / 120, seconds));
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - target) < 1 / 240) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed to seek waterfall background'));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = target;
  });
}

export function createFullFilmRuntime(container, options = {}) {
  const scenario = validateFullEncounterScenario(createFullEncounterScenario());
  const canvas = document.createElement('canvas');
  canvas.id = 'waterwing-battle-canvas';
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    zIndex: '1',
    pointerEvents: 'none',
  });

  const previewVideo = createBackgroundVideo(container, Boolean(options.previewBackground));
  const backgroundTexture = new THREE.VideoTexture(previewVideo);
  backgroundTexture.name = 'WaterfallRefractionPlate';
  backgroundTexture.colorSpace = THREE.SRGBColorSpace;
  backgroundTexture.minFilter = THREE.LinearFilter;
  backgroundTexture.magFilter = THREE.LinearFilter;
  backgroundTexture.generateMipmaps = false;
  backgroundTexture.wrapS = THREE.ClampToEdgeWrapping;
  backgroundTexture.wrapT = THREE.ClampToEdgeWrapping;
  backgroundTexture.matrixAutoUpdate = false;
  const field = scenario.opticalField;
  backgroundTexture.matrix.setUvTransform(
    field.left / WIDTH,
    field.top / HEIGHT,
    field.width / WIDTH,
    field.height / HEIGHT,
    0,
    0,
    0,
  );
  container.appendChild(canvas);
  const hud = createFullHud(container);
  hud.element.style.zIndex = '2';

  let battle = null;
  let currentState = null;
  let animationHandle = 0;
  let playbackStart = 0;
  let queuedFrame = clampFrame(options.initialFrame ?? 0, scenario.durationFrames);
  let disposed = false;

  function setFrame(requestedFrame) {
    const frame = clampFrame(requestedFrame, scenario.durationFrames);
    queuedFrame = frame;
    if (!battle) return currentState;
    currentState = simulateFullEncounterFrame(scenario, frame);
    battle.update(currentState);
    battle.render();
    hud.update(currentState, battle.camera);
    return currentState;
  }

  async function setFrameAsync(requestedFrame) {
    const frame = clampFrame(requestedFrame, scenario.durationFrames);
    queuedFrame = frame;
    await waitForVideoMetadata(previewVideo);
    await seekVideo(previewVideo, frame / scenario.fps);
    backgroundTexture.needsUpdate = true;
    return setFrame(frame);
  }

  function animate(now) {
    const elapsedFrames = Math.floor(((now - playbackStart) / 1000) * scenario.fps);
    setFrame(elapsedFrames % scenario.durationFrames);
    animationHandle = requestAnimationFrame(animate);
  }

  const api = {
    ready: false,
    error: null,
    canvas,
    setFrame,
    setFrameAsync,
    getState: () => currentState,
    getDebugInfo: () => ({
      actorCount: currentState?.actors.length ?? scenario.actors.length,
      opticalField: { ...scenario.opticalField },
      actionFactoryIds: [...(battle?.actionFactoryIds ?? [])],
      actorAssetFamily: battle?.actorAssetFamily ?? null,
      backgroundSourceCount: 1,
      containsSelfieEpilogue: false,
      refractionBackground: battle?.refractionBackground ?? 'video-texture',
      durationFrames: scenario.durationFrames,
      fps: scenario.fps,
    }),
    play() {
      cancelAnimationFrame(animationHandle);
      playbackStart = performance.now() - ((currentState?.frame ?? 0) / scenario.fps) * 1000;
      animationHandle = requestAnimationFrame(animate);
      previewVideo?.play().catch(() => {});
    },
    pause() {
      cancelAnimationFrame(animationHandle);
      animationHandle = 0;
      previewVideo?.pause();
    },
    dispose() {
      api.pause();
      hud.dispose();
      battle?.dispose();
      previewVideo?.remove();
      backgroundTexture.dispose();
      canvas.remove();
      disposed = true;
      api.ready = false;
    },
  };

  api.whenReady = Promise.all([
    createFullBattleScene(canvas, { backgroundTexture, opticalField: scenario.opticalField }),
    waitForVideoMetadata(previewVideo),
  ])
    .then(async ([createdBattle]) => {
      if (disposed) {
        createdBattle.dispose();
        return api;
      }
      battle = createdBattle;
      await setFrameAsync(queuedFrame);
      api.ready = true;
      if (!options.fixed) api.play();
      return api;
    })
    .catch((error) => {
      api.error = error instanceof Error ? error.message : String(error);
      throw error;
    });
  return api;
}

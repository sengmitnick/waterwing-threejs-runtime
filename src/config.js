export const OUTPUT = Object.freeze({ width: 1080, height: 1920, fps: 30, frames: 240 });

export const CAMERA = Object.freeze({
  fov: 60,
  near: 0.1,
  far: 100,
  position: Object.freeze([0, 1.58, 7.8]),
  lookAt: Object.freeze([0, 1.45, 0])
});

export const PLAYFIELD = Object.freeze({ left: 54, top: 387, width: 972, height: 1146 });

export const WATERWING = Object.freeze({ healthAnchorY: 1.22 });

export const PALETTE = Object.freeze({
  waterDeep: 0x258c9e,
  waterEdge: 0xa3fff4,
  waterHighlight: 0xc7fff6,
  darkStroke: '#063d35',
  player: '#ffd166',
  teammate: '#52e5ff',
  enemy: '#ff6b87',
  system: '#39ff88'
});

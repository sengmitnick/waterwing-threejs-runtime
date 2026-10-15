import { interpolateAngle } from './angularMotion.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

// Approximate the source waterfall pan after the 0-45 second shot is retimed to
// 54 seconds, followed by the clean 26-40 second section. Keeping this authored
// curve deterministic makes frame seeking and offline rendering identical.
export const BACKGROUND_HEAD_YAW_KEYS = Object.freeze([
  [0, -18], [180, -15], [360, -11], [540, -7], [720, -2],
  [900, 4], [1080, 10], [1260, 16], [1440, 23], [1590, 30],
  [1620, 8], [1770, 15], [1920, 23], [2039, 28],
]);

export function sampleBackgroundYaw(frame) {
  const clamped = Math.max(BACKGROUND_HEAD_YAW_KEYS[0][0], Math.min(BACKGROUND_HEAD_YAW_KEYS.at(-1)[0], frame));
  const endIndex = BACKGROUND_HEAD_YAW_KEYS.findIndex(([keyFrame]) => keyFrame >= clamped);
  if (endIndex <= 0) return BACKGROUND_HEAD_YAW_KEYS[0][1];
  const [endFrame, endYaw] = BACKGROUND_HEAD_YAW_KEYS[endIndex];
  const [startFrame, startYaw] = BACKGROUND_HEAD_YAW_KEYS[endIndex - 1];
  const progress = smooth((clamped - startFrame) / (endFrame - startFrame));
  return interpolateAngle(startYaw, endYaw, progress);
}

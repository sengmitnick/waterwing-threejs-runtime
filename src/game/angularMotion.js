export function normalizeDegrees(value) {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function shortestAngularDelta(target, source) {
  return normalizeDegrees(target - source);
}

export function interpolateAngle(source, target, progress) {
  return normalizeDegrees(source + shortestAngularDelta(target, source) * progress);
}

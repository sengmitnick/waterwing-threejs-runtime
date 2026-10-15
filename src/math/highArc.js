const clamp01 = value => Math.max(0, Math.min(1, value));

export function highArcPoint(start, end, progress, apexHeight = 3.45) {
  const t = clamp01(progress);
  if (t === 0) return { ...start };
  if (t === 1) return { ...end };

  const x = start.x + (end.x - start.x) * t;
  const z = start.z + (end.z - start.z) * t;
  const linearY = start.y + (end.y - start.y) * t;
  const averageEndpointHeight = (start.y + end.y) / 2;
  const y = linearY + 4 * (apexHeight - averageEndpointHeight) * t * (1 - t);
  return { x, y, z };
}

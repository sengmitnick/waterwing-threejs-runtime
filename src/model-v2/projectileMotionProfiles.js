import * as THREE from 'three';

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    noSpin: true,
    spinRadiansPerSecond: 0
  });
}

export const PROJECTILE_MOTION_PROFILES = Object.freeze({
  'player-direct': freezeProfile({
    id: 'player-direct',
    owner: 'player',
    role: 'player-shot',
    pathKind: 'direct',
    sizeClass: 'compact',
    weightClass: 'light',
    visualScale: 0.74,
    chargeSeconds: 0.52,
    flightSeconds: 0.72,
    animationClipName: 'flight-loop',
    arcLiftMeters: 0.12
  }),
  'enemy-front-direct': freezeProfile({
    id: 'enemy-front-direct',
    owner: 'enemy',
    role: 'frontliner-shot',
    pathKind: 'direct',
    sizeClass: 'compact',
    weightClass: 'light',
    visualScale: 0.86,
    chargeSeconds: 0.38,
    flightSeconds: 0.64,
    animationClipName: 'direct-flight-loop',
    arcLiftMeters: 0.18
  }),
  'enemy-rear-lob': freezeProfile({
    id: 'enemy-rear-lob',
    owner: 'enemy',
    role: 'rear-caster-shot',
    pathKind: 'lob',
    sizeClass: 'large',
    weightClass: 'heavy',
    visualScale: 1.18,
    chargeSeconds: 0.84,
    flightSeconds: 1.08,
    animationClipName: 'lob-flight-loop',
    arcLiftMeters: 2.05
  })
});

export function getProjectileMotionProfile(profileName) {
  const profile = PROJECTILE_MOTION_PROFILES[profileName];
  if (!profile) {
    throw new RangeError(`Unknown projectile motion profile: ${profileName}`);
  }
  return profile;
}

function resolveProfile(profile) {
  if (typeof profile === 'string') return getProjectileMotionProfile(profile);
  if (
    profile &&
    typeof profile === 'object' &&
    Number.isFinite(profile.arcLiftMeters) &&
    (profile.pathKind === 'direct' || profile.pathKind === 'lob')
  ) {
    return profile;
  }
  throw new TypeError('Projectile motion profile must be a known profile name or profile object');
}

function vectorFromPoint(point, label) {
  const vector = point?.isVector3
    ? point.clone()
    : new THREE.Vector3(point?.x, point?.y, point?.z);
  if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
    throw new TypeError(`${label} must contain finite x, y and z coordinates`);
  }
  return vector;
}

/**
 * Samples a world-space projectile trajectory without mutating either endpoint.
 * Runtime orientation should face velocity while preserving roll: every built-in
 * profile intentionally forbids continuous projectile spin.
 */
export function sampleProjectilePath(start, end, progress, profile) {
  const resolvedProfile = resolveProfile(profile);
  const startPoint = vectorFromPoint(start, 'start');
  const endPoint = vectorFromPoint(end, 'end');
  const t = THREE.MathUtils.clamp(Number.isFinite(progress) ? progress : 0, 0, 1);

  if (t === 0) return startPoint;
  if (t === 1) return endPoint;

  const travelDirection = endPoint.clone().sub(startPoint);
  const point = startPoint.clone().lerp(endPoint, t);
  if (travelDirection.lengthSq() === 0) return point;

  travelDirection.normalize();
  const liftDirection = new THREE.Vector3(0, 1, 0)
    .addScaledVector(travelDirection, -travelDirection.y);
  if (liftDirection.lengthSq() < 1e-10) {
    liftDirection.set(1, 0, 0);
  } else {
    liftDirection.normalize();
  }
  point.addScaledVector(
    liftDirection,
    4 * resolvedProfile.arcLiftMeters * t * (1 - t)
  );
  return point;
}

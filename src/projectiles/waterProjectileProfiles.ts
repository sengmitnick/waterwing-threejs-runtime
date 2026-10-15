import type * as THREE from 'three';

import type { ProjectileKind, ProjectilePathType } from './createWaterProjectileCore';

export type WaterProjectileArchetype =
  | 'compact-forward-bolt'
  | 'heavy-flattened-slug'
  | 'charged-high-arc-orb';

export type WaterProjectileProfile = {
  kind: ProjectileKind;
  pathType: ProjectilePathType;
  archetype: WaterProjectileArchetype;
  wakeStyle: 'short-clean-fold' | 'broad-broken-wake' | 'long-tapered-mist';
  defaultStart: readonly [number, number, number];
  defaultEnd: readonly [number, number, number];
  defaultArcHeight?: number;
  defaultBend: number;
  durationSeconds: number;
  baseRadius: number;
  shape: readonly [number, number, number];
  launchScale: readonly [number, number, number];
  cruiseScale: readonly [number, number, number];
  arrivalScale: readonly [number, number, number];
  tint: THREE.ColorRepresentation;
  attenuation: THREE.ColorRepresentation;
  emissive: THREE.ColorRepresentation;
  trail: {
    count: number;
    length: number;
    spread: number;
    radius: number;
    fall: number;
  };
};

export const WATER_PROJECTILE_PROFILES: Readonly<Record<ProjectileKind, WaterProjectileProfile>> = Object.freeze({
  'player-pulse': Object.freeze({
    kind: 'player-pulse', pathType: 'direct', archetype: 'compact-forward-bolt', wakeStyle: 'short-clean-fold',
    defaultStart: [-1.2, -1.05, 4.8], defaultEnd: [-0.2, 0.15, 0], defaultBend: 0.1,
    durationSeconds: 0.72, baseRadius: 0.34, shape: [0.74, 0.7, 1.34],
    launchScale: [1.05, 0.92, 0.78], cruiseScale: [0.82, 0.75, 1.38], arrivalScale: [0.78, 0.46, 0.34],
    tint: '#d4fbff', attenuation: '#47afc0', emissive: '#75f3ff',
    trail: Object.freeze({ count: 3, length: 0.68, spread: 0.1, radius: 0.07, fall: 0.04 }),
  }),
  'enemy-direct': Object.freeze({
    kind: 'enemy-direct', pathType: 'direct', archetype: 'heavy-flattened-slug', wakeStyle: 'broad-broken-wake',
    defaultStart: [0.85, 0.35, 0], defaultEnd: [0, -0.22, 4.8], defaultBend: 0.08,
    durationSeconds: 0.92, baseRadius: 0.45, shape: [1.08, 0.88, 1.13],
    launchScale: [1.02, 0.8, 0.64], cruiseScale: [0.8, 0.62, 1.52], arrivalScale: [1.28, 0.82, 0.22],
    tint: '#bceff7', attenuation: '#2a91a5', emissive: '#3ab9cf',
    trail: Object.freeze({ count: 5, length: 1.12, spread: 0.2, radius: 0.082, fall: 0.075 }),
  }),
  'enemy-lob': Object.freeze({
    kind: 'enemy-lob', pathType: 'high-arc', archetype: 'charged-high-arc-orb', wakeStyle: 'long-tapered-mist',
    defaultStart: [1.5, 0.75, -1.2], defaultEnd: [0, -0.2, 4.8], defaultArcHeight: 2.8, defaultBend: 0,
    durationSeconds: 1.65, baseRadius: 0.52, shape: [1.04, 0.9, 1.16],
    launchScale: [1, 0.95, 0.93], cruiseScale: [0.76, 0.7, 1.48], arrivalScale: [1.34, 0.82, 0.2],
    tint: '#c5edf3', attenuation: '#377f91', emissive: '#3598aa',
    trail: Object.freeze({ count: 7, length: 1.75, spread: 0.17, radius: 0.08, fall: 0.095 }),
  }),
});

export function getWaterProjectileProfile(kind: ProjectileKind): WaterProjectileProfile {
  return WATER_PROJECTILE_PROFILES[kind];
}

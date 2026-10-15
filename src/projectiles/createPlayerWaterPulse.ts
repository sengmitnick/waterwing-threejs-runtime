import * as THREE from 'three';

import { createWaterProjectile, type WaterProjectileOptions } from './createWaterProjectileCore';
import { getWaterProjectileProfile } from './waterProjectileProfiles';

export function createPlayerWaterPulse(options: WaterProjectileOptions = {}): THREE.Group {
  return createWaterProjectile(getWaterProjectileProfile('player-pulse'), options);
}

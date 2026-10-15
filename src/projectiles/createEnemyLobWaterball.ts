import * as THREE from 'three';

import { createWaterProjectile, type WaterProjectileOptions } from './createWaterProjectileCore';
import { getWaterProjectileProfile } from './waterProjectileProfiles';

export function createEnemyLobWaterball(options: WaterProjectileOptions = {}): THREE.Group {
  return createWaterProjectile(getWaterProjectileProfile('enemy-lob'), options);
}

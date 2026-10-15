import { createWaterwingHoverModel } from '../img2threejs-hover/createFinishedWaterwingHoverModel.ts';
import { createWaterwingForwardPropulsionModel } from '../img2threejs-forward/createFinishedWaterwingForwardModel.ts';
import { createWaterwingEmergeModel } from '../img2threejs-emerge/createWaterwingEmergenceModel.ts';
import { createWaterwingDirectChargeModel } from '../img2threejs-direct/createWaterwingDirectChargeModel.ts';
import { createWaterwingDirectCastModel } from '../img2threejs-direct/createWaterwingDirectCastModel.ts';
import { createWaterwingLobChargeModel } from '../img2threejs-lob/createWaterwingLobChargeModel.ts';
import { createWaterwingLobCastModel } from '../img2threejs-lob/createWaterwingLobCastModel.ts';
import { createWaterwingLungeModel } from '../img2threejs-melee/createWaterwingLungeModel.ts';
import { createWaterwingDodgeModel } from '../img2threejs-melee/createWaterwingDodgeModel.ts';
import { createWaterwingHitModel } from '../img2threejs-melee/createWaterwingHitModel.ts';
import { createWaterwingDefeatModel } from '../img2threejs-defeat/createWaterwingDefeatModel.ts';

/**
 * Stable scenario-facing order. Keep this independent of object key ordering: it
 * is used both by the renderer and by deterministic render diagnostics.
 */
export const ACTION_FACTORY_IDS = Object.freeze([
  'hover',
  'forward',
  'emerge',
  'charge-direct',
  'cast-direct',
  'charge-lob',
  'cast-lob',
  'lunge',
  'dodge',
  'hit',
  'defeat',
]);

// The deterministic encounter keeps the same eleven scenario-facing action
// ids, while the finished film now sources its motion from five authored
// Blender clips.  The old procedural factories remain available to the action
// review lab; the full-film renderer consumes this stable mapping through the
// asynchronous Blender adapter.
export const FULL_FILM_ACTION_SOURCE_MAP = Object.freeze({
  hover: Object.freeze({ source: 'hover', range: Object.freeze([0, 1]) }),
  forward: Object.freeze({ source: 'forward', range: Object.freeze([0, 1]) }),
  emerge: Object.freeze({ source: 'emerge', range: Object.freeze([0, 1]) }),
  dodge: Object.freeze({ source: 'dodge', range: Object.freeze([0, 1]) }),
  'charge-direct': Object.freeze({ source: 'directCast', range: Object.freeze([0, 0.545]), attackLift: 0.62 }),
  'cast-direct': Object.freeze({ source: 'directCast', range: Object.freeze([0.545, 0.8]), attackLift: 0.72 }),
  'charge-lob': Object.freeze({ source: 'directCast', range: Object.freeze([0, 0.545]), attackLift: 0.78 }),
  'cast-lob': Object.freeze({ source: 'directCast', range: Object.freeze([0.545, 0.8]), attackLift: 0.88 }),
  lunge: Object.freeze({ source: 'forward', range: Object.freeze([0.15, 0.75]) }),
  hit: Object.freeze({ source: 'hover', range: Object.freeze([0.12, 0.42]) }),
  defeat: Object.freeze({ source: 'emerge', range: Object.freeze([1, 0]) }),
});

const FACTORIES = new Map([
  ['hover', createWaterwingHoverModel],
  ['forward', createWaterwingForwardPropulsionModel],
  ['emerge', createWaterwingEmergeModel],
  ['charge-direct', createWaterwingDirectChargeModel],
  ['cast-direct', createWaterwingDirectCastModel],
  ['charge-lob', createWaterwingLobChargeModel],
  ['cast-lob', createWaterwingLobCastModel],
  ['lunge', createWaterwingLungeModel],
  ['dodge', createWaterwingDodgeModel],
  ['hit', createWaterwingHitModel],
  ['defeat', createWaterwingDefeatModel],
]);

export const ACTION_FACTORY_REGISTRY = Object.freeze(
  ACTION_FACTORY_IDS.map((id) => Object.freeze({ id, create: FACTORIES.get(id) })),
);

export function getActionFactory(actionId) {
  const factory = FACTORIES.get(actionId);
  if (!factory) throw new Error(`Unknown Waterwing action: ${actionId}`);
  return factory;
}

export function createActionModel(actionId, options = {}) {
  const model = getActionFactory(actionId)(options);
  if (model?.userData?.actionRuntime?.actionId !== actionId) {
    throw new Error(`Waterwing action factory contract mismatch: expected ${actionId}`);
  }
  return model;
}

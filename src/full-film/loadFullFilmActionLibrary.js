import * as THREE from 'three';

import { loadWaterwingBlenderAsset } from '../blender-forward/loadWaterwingBlenderAsset.js';
import {
  ACTION_FACTORY_IDS,
  FULL_FILM_ACTION_SOURCE_MAP,
} from './actionFactoryRegistry.js';

export const FULL_FILM_ACTOR_ASSET_FAMILY = 'blender-clear-water-v10';

const clamp01 = value => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
const smooth01 = value => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function attackLiftFor(actionId, progress, maximum) {
  if (!maximum) return 0;
  const t = clamp01(progress);
  if (actionId.startsWith('charge-')) return maximum * smooth01(t);
  // The release begins upright, recoils with the shot and returns only partway
  // toward horizontal so an attack never reads as the forward-flight pose.
  return maximum * THREE.MathUtils.lerp(1, 0.42, smooth01(t));
}

export function fullFilmPoseFor(actionId, progress) {
  const config = FULL_FILM_ACTION_SOURCE_MAP[actionId];
  if (!config) throw new Error(`Unknown full-film Waterwing action: ${actionId}`);
  const t = clamp01(progress);
  const mappedProgress = THREE.MathUtils.lerp(config.range[0], config.range[1], t);
  const pose = {
    mappedProgress,
    attackLiftRadians: attackLiftFor(actionId, t, config.attackLift ?? 0),
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };

  if (actionId === 'lunge') {
    const compression = Math.sin(Math.PI * t);
    pose.scale = [1 + compression * 0.075, 1 - compression * 0.07, 1 - compression * 0.035];
    pose.position = [0, -compression * 0.035, compression * 0.08];
  } else if (actionId === 'hit') {
    const recoil = Math.sin(Math.PI * t);
    pose.rotation = [recoil * 0.055, 0, recoil * 0.13];
    pose.position = [recoil * 0.1, recoil * 0.025, -recoil * 0.16];
    pose.scale = [1.02, 0.98, 0.97];
  } else if (actionId === 'defeat') {
    const collapse = smooth01(t);
    pose.rotation = [-collapse * 0.08, collapse * 0.06, collapse * 0.17];
    pose.position = [collapse * 0.08, -collapse * 0.24, -collapse * 0.16];
    const retainedVolume = 1 - collapse * 0.055;
    pose.scale = [retainedVolume, retainedVolume, retainedVolume];
  } else if (pose.attackLiftRadians > 0) {
    pose.rotation[0] = -pose.attackLiftRadians;
    pose.position[1] = Math.sin(pose.attackLiftRadians) * 0.34;
    pose.position[2] = -(1 - Math.cos(pose.attackLiftRadians)) * 0.28;
  }

  return pose;
}

function hideEmbeddedProjectiles(root) {
  root.traverse(object => {
    const name = object.name.toLowerCase();
    if (name.includes('waterball') || name.includes('projectile')) object.visible = false;
    if (object.name === 'released-water') object.visible = false;
  });
}

function createAdapter(actionId, sourceAsset, options = {}) {
  const config = FULL_FILM_ACTION_SOURCE_MAP[actionId];
  const instance = sourceAsset.createInstance();
  const root = new THREE.Group();
  root.name = `WaterwingAction_${options.actorId ?? 'actor'}_${actionId}`;
  root.userData.clearWaterwingVersion = 'waterwing-clear-water-v10';
  root.userData.actorAssetFamily = FULL_FILM_ACTOR_ASSET_FAMILY;
  root.userData.actionId = actionId;
  root.add(instance.root);
  instance.root.name = `${sourceAsset.actionName}_authored_motion`;
  hideEmbeddedProjectiles(instance.root);

  const anchorAliases = Object.freeze({
    muzzle: 'muzzle-anchor',
    tailtip: 'tailtip-anchor',
    health: 'health-anchor',
    impact: 'impact-anchor',
    waterline: 'waterline-anchor',
  });

  function update(progress, context = {}) {
    const t = clamp01(progress);
    const pose = fullFilmPoseFor(actionId, t);
    instance.mixer.setTime(pose.mappedProgress * instance.clip.duration);
    instance.root.position.fromArray(pose.position);
    instance.root.rotation.fromArray(pose.rotation);
    instance.root.scale.fromArray(pose.scale);

    if (actionId === 'hit' && context.hitSide === -1) {
      instance.root.position.x *= -1;
      instance.root.rotation.z *= -1;
    }
    if (actionId === 'dodge' && context.direction === -1) {
      instance.root.rotation.y *= -1;
      instance.root.rotation.z *= -1;
    }
    instance.root.updateMatrixWorld(true);
    hideEmbeddedProjectiles(instance.root);
    root.userData.actionProgress = t;
    root.userData.sourceProgress = pose.mappedProgress;
    return pose;
  }

  function getWorldAnchor(name) {
    const anchorName = anchorAliases[name] ?? name;
    const anchor = instance.getAnchor(anchorName);
    if (!anchor) return null;
    root.updateMatrixWorld(true);
    return anchor.getWorldPosition(new THREE.Vector3());
  }

  update(0, options);
  return {
    root,
    sourceAction: config.source,
    actionId,
    instance,
    update,
    getWorldAnchor,
  };
}

let libraryPromise;

export function loadFullFilmActionLibrary() {
  if (libraryPromise) return libraryPromise;
  const sourceActions = [...new Set(Object.values(FULL_FILM_ACTION_SOURCE_MAP).map(({ source }) => source))];
  libraryPromise = Promise.all(sourceActions.map(async source => [source, await loadWaterwingBlenderAsset(source)]))
    .then(entries => {
      const sources = new Map(entries);
      return Object.freeze({
        assetFamily: FULL_FILM_ACTOR_ASSET_FAMILY,
        actionIds: Object.freeze([...ACTION_FACTORY_IDS]),
        poseFor: fullFilmPoseFor,
        create(actionId, options = {}) {
          const config = FULL_FILM_ACTION_SOURCE_MAP[actionId];
          if (!config) throw new Error(`Unknown full-film Waterwing action: ${actionId}`);
          return createAdapter(actionId, sources.get(config.source), options);
        },
      });
    });
  return libraryPromise;
}

import * as THREE from 'three';

export const ACTION_ANCHOR_NAMES = Object.freeze([
  'health-anchor',
  'muzzle-anchor',
  'impact-anchor',
  'waterline-anchor',
]);

const DEFAULT_ANCHORS = Object.freeze({
  'health-anchor': [0, 1.35, 0],
  'muzzle-anchor': [0, 0.2, 0.82],
  'impact-anchor': [0, 0.12, 0.12],
  'waterline-anchor': [0, -1.0, 0],
});

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function attachActionContract(root, options) {
  if (!(root instanceof THREE.Object3D)) throw new TypeError('action root must be a Three.js Object3D');
  if (!options?.actionId) throw new TypeError('actionId is required');
  if (typeof options.update !== 'function') throw new TypeError('action update function is required');

  const anchors = {};
  for (const name of ACTION_ANCHOR_NAMES) {
    let anchor = root.getObjectByName(name);
    if (!anchor) {
      anchor = new THREE.Object3D();
      anchor.name = name;
      root.add(anchor);
    }
    const position = options.anchors?.[name] ?? DEFAULT_ANCHORS[name];
    anchor.position.fromArray(position);
    anchor.userData.actionAnchor = name;
    anchors[name] = anchor;
  }

  const runtime = {
    root,
    actionId: options.actionId,
    durationSeconds: options.durationSeconds ?? 1,
    anchors,
    update(progress, context = {}) {
      options.update(clamp01(progress), context, runtime);
      return runtime;
    },
  };
  root.userData.actionRuntime = runtime;
  return runtime;
}

export function assertActionContract(root) {
  const runtime = root?.userData?.actionRuntime;
  if (!runtime || typeof runtime.update !== 'function') throw new Error('action update hook missing');
  for (const name of ACTION_ANCHOR_NAMES) {
    if (!root.getObjectByName(name)) throw new Error(`${name} missing`);
  }
  return true;
}

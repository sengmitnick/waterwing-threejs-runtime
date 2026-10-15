import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';

import {
  createWaterwingForwardPropulsionModel as createGeneratedModel,
  createWaterwingForwardPropulsionLookDevLights as createGeneratedLookDevLights,
  type ProceduralModelOptions,
} from './createWaterwingForwardPropulsionModel';
import { applyWaterwingAqueousLook } from './applyWaterwingAqueousLook';
import { attachActionContract } from '../actions/actionContract.js';

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function roundWaterWing(mesh: THREE.Mesh): void {
  const component = mesh.userData.sculptComponent as {
    geometryDescriptor?: { profile2D?: { points?: [number, number][] } };
  } | undefined;
  const outline = component?.geometryDescriptor?.profile2D?.points;
  if (!outline || outline.length < 3) return;

  const tessellated = new TessellateModifier(0.16, 5).modify(mesh.geometry.clone().toNonIndexed());
  const position = tessellated.getAttribute('position') as THREE.BufferAttribute;
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  const edgeDistances: number[] = [];

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
    let distance = Infinity;
    for (let edge = 0; edge < outline.length; edge += 1) {
      const a = outline[edge];
      const b = outline[(edge + 1) % outline.length];
      distance = Math.min(distance, distanceToSegment(x, y, a[0], a[1], b[0], b[1]));
    }
    edgeDistances.push(distance);
  }

  const middle = (zMin + zMax) * 0.5;
  const originalHalf = Math.max(1e-5, (zMax - zMin) * 0.5);
  const maxDistance = Math.max(1e-5, ...edgeDistances);
  const lengthSpan = Math.max(1e-5, xMax - xMin);
  // Keep the propulsion paddles visibly massive from oblique and side views.
  // The edge stays rounded while the middle swells into a loaded water volume.
  const edgeHalf = 0.078;
  const crown = 0.165;
  for (let index = 0; index < position.count; index += 1) {
    const original = (position.getZ(index) - middle) / originalHalf;
    const distanceFactor = THREE.MathUtils.smoothstep(edgeDistances[index] / maxDistance, 0, 0.92);
    const tipProgress = THREE.MathUtils.clamp((xMax - position.getX(index)) / lengthSpan, 0, 1);
    const thicknessScale = THREE.MathUtils.lerp(1.25, 0.4, THREE.MathUtils.smoothstep(tipProgress, 0.32, 1));
    const faceBias = Math.sign(original) * crown * thicknessScale * distanceFactor * Math.min(1, Math.abs(original) * 2.5);
    position.setZ(index, middle + original * edgeHalf * thicknessScale + faceBias);
  }
  position.needsUpdate = true;
  for (const attributeName of Object.keys(tessellated.attributes)) {
    if (attributeName !== 'position') tessellated.deleteAttribute(attributeName);
  }
  const welded = mergeVertices(tessellated, 1e-4);
  const weldedPosition = welded.getAttribute('position') as THREE.BufferAttribute;
  welded.computeBoundingBox();
  const bounds = welded.boundingBox!;
  const spanX = Math.max(1e-5, bounds.max.x - bounds.min.x);
  const spanY = Math.max(1e-5, bounds.max.y - bounds.min.y);
  const uv: number[] = [];
  for (let index = 0; index < weldedPosition.count; index += 1) {
    uv.push((weldedPosition.getX(index) - bounds.min.x) / spanX, (weldedPosition.getY(index) - bounds.min.y) / spanY);
  }
  welded.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  welded.computeVertexNormals();
  welded.computeBoundingSphere();

  // A propulsion wing is not a rigid paddle. Bake one reusable relative morph
  // that lengthens the trailing half, cups the membrane and swells its loaded
  // centre. The runtime drives the same influence on both wings, preserving the
  // deliberately synchronous stroke required by this action-specific model.
  welded.computeBoundingBox();
  const morphBounds = welded.boundingBox!;
  const morphLength = Math.max(1e-5, morphBounds.max.x - morphBounds.min.x);
  const morphMiddleZ = (morphBounds.min.z + morphBounds.max.z) * 0.5;
  const morphValues = new Float32Array(weldedPosition.count * 3);
  for (let index = 0; index < weldedPosition.count; index += 1) {
    const x = weldedPosition.getX(index);
    const y = weldedPosition.getY(index);
    const z = weldedPosition.getZ(index);
    const trailing = THREE.MathUtils.clamp((morphBounds.max.x - x) / morphLength, 0, 1);
    const loaded = Math.sin(Math.PI * trailing);
    const face = Math.sign(z - morphMiddleZ) || 1;
    morphValues[index * 3] = -0.105 * trailing * trailing;
    morphValues[index * 3 + 1] = y * 0.045 * loaded;
    morphValues[index * 3 + 2] = 0.035 * trailing * trailing + face * 0.048 * loaded;
  }
  const powerStroke = new THREE.Float32BufferAttribute(morphValues, 3);
  powerStroke.name = 'powerStroke';
  welded.morphAttributes.position = [powerStroke];
  welded.morphTargetsRelative = true;
  mesh.geometry.dispose();
  mesh.geometry = welded;
  mesh.updateMorphTargets();
  mesh.userData.actionMorph = 'powerStroke';
}

export function createWaterwingForwardPropulsionModel(options: ProceduralModelOptions = {}): THREE.Group {
  const model = createGeneratedModel(options);
  const runtime = model.userData.sculptRuntime as {
    nodes: Record<string, THREE.Object3D>;
    meshes: Record<string, THREE.Mesh>;
  };
  roundWaterWing(runtime.meshes['wing-left']);
  roundWaterWing(runtime.meshes['wing-right']);
  applyWaterwingAqueousLook(model, {
    textureSize: options.qualityPriority === 'reference-fidelity' ? 512 : 256,
    textureAnisotropy: options.textureAnisotropy,
  });
  const body = runtime.nodes.body;
  const leftWing = runtime.nodes['wing-left'];
  const rightWing = runtime.nodes['wing-right'];
  const tail = runtime.nodes['tail-leaf'];
  const leftWingMesh = runtime.meshes['wing-left'];
  const rightWingMesh = runtime.meshes['wing-right'];
  const base = {
    bodyPosition: body.position.clone(),
    bodyRotation: body.rotation.clone(),
    leftRotation: leftWing.rotation.clone(),
    rightRotation: rightWing.rotation.clone(),
    tailRotation: tail.rotation.clone(),
  };
  attachActionContract(model, {
    actionId: 'forward',
    durationSeconds: 2,
    anchors: {
      'health-anchor': [0, 0.96, 0],
      'muzzle-anchor': [0, 0.2, 1.12],
      'impact-anchor': [0, 0.08, 0.3],
      'waterline-anchor': [0, -0.85, -0.45],
    },
    update(progress: number) {
      const angle = progress * Math.PI * 2;
      const drive = Math.sin(angle);
      const secondary = Math.sin(angle - 0.55);
      const compression = 0.5 + 0.5 * Math.cos(angle);
      const powerStroke = 0.5 + 0.5 * Math.sin(angle);
      leftWing.rotation.set(base.leftRotation.x + 0.06 * secondary, base.leftRotation.y - 0.055 * drive, base.leftRotation.z + 0.13 * drive);
      rightWing.rotation.set(base.rightRotation.x + 0.06 * secondary, base.rightRotation.y + 0.055 * drive, base.rightRotation.z - 0.13 * drive);
      body.position.set(base.bodyPosition.x, base.bodyPosition.y - 0.035 * compression, base.bodyPosition.z + 0.045 * drive);
      body.rotation.set(base.bodyRotation.x + 0.025 * secondary, base.bodyRotation.y, base.bodyRotation.z);
      tail.rotation.set(base.tailRotation.x + 0.035 * Math.sin(angle - 0.8), base.tailRotation.y + 0.085 * Math.sin(angle - 0.9), base.tailRotation.z);
      if (leftWingMesh.morphTargetInfluences) leftWingMesh.morphTargetInfluences[0] = powerStroke;
      if (rightWingMesh.morphTargetInfluences) rightWingMesh.morphTargetInfluences[0] = powerStroke;
    },
  });
  return model;
}

export function createWaterwingForwardPropulsionLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = createGeneratedLookDevLights(mode);
  const hemi = lights.children.find((child): child is THREE.HemisphereLight => child instanceof THREE.HemisphereLight);
  const directional = lights.children.filter((child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight);
  if (hemi) {
    hemi.color.set(mode === 'reference' ? '#d7eef4' : '#d8edf2');
    hemi.groundColor.set('#10222c');
    hemi.intensity = mode === 'grazing' ? 0.2 : mode === 'reference' ? 0.34 : 0.28;
  }
  const [key, fill, rim] = directional;
  if (key) {
    key.color.set('#d6edf4');
    key.intensity = mode === 'grazing' ? 2.4 : mode === 'reference' ? 1.68 : 1.52;
  }
  if (fill) {
    fill.color.set('#6d9fb0');
    fill.intensity = mode === 'grazing' ? 0.1 : 0.2;
  }
  if (rim) {
    rim.color.set('#a9f3ff');
    rim.intensity = mode === 'grazing' ? 0.72 : 1.2;
  }
  if (mode !== 'grazing') {
    const oppositeRim = new THREE.DirectionalLight('#d2f8ff', mode === 'reference' ? 0.72 : 0.58);
    oppositeRim.name = 'Waterwing opposite wet rim';
    oppositeRim.position.set(-5.2, 1.6, -4.8);
    lights.add(oppositeRim);
  }
  lights.userData.aqueousLightingVersion = 'waterwing-reference-water-v2';
  return lights;
}

export {
  configureWaterwingForwardPropulsionRenderer,
  createWaterwingForwardPropulsionEnvironment,
  createWaterwingForwardPropulsionInspectControls,
  frameWaterwingForwardPropulsionCamera,
} from './createWaterwingForwardPropulsionModel';

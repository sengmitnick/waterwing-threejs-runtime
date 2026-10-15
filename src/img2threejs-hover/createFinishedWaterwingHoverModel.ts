import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  createWaterwingHoverActionModelModel as createGeneratedModel,
  type ProceduralModelOptions,
} from './createWaterwingHoverModel';
import { applyWaterwingAqueousLook } from '../img2threejs-forward/applyWaterwingAqueousLook';
import { attachActionContract } from '../actions/actionContract.js';

const TAU = Math.PI * 2;

function applyVerticalWaterUv(mesh: THREE.Mesh): void {
  const source = mesh.geometry;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;

  const height = Math.max(1e-6, bounds.max.y - bounds.min.y);
  const uv = new Float32Array(position.count * 2);
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const horizontal = [0, 1, 2].map((offset) => {
      const index = triangle + offset;
      // Put the cylindrical wrap seam on the hidden rear (-Z), never across
      // the front-facing eye and water body.
      return Math.atan2(position.getX(index), position.getZ(index)) / TAU + 0.5;
    });
    const minimum = Math.min(...horizontal);
    const maximum = Math.max(...horizontal);
    if (maximum - minimum > 0.5) {
      for (let offset = 0; offset < horizontal.length; offset += 1) {
        if (horizontal[offset] < 0.5) horizontal[offset] += 1;
      }
    }
    for (let offset = 0; offset < 3; offset += 1) {
      const index = triangle + offset;
      uv[index * 2] = horizontal[offset];
      uv[index * 2 + 1] = (position.getY(index) - bounds.min.y) / height;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  source.dispose();
  mesh.geometry = geometry;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function convexifyFanWing(mesh: THREE.Mesh, side: -1 | 1): void {
  const component = mesh.userData.sculptComponent as {
    geometryDescriptor?: { profile2D?: { points?: [number, number][] } };
  } | undefined;
  const outline = component?.geometryDescriptor?.profile2D?.points;
  if (!outline || outline.length < 3) return;

  const tessellated = new TessellateModifier(0.14, 5).modify(mesh.geometry.clone().toNonIndexed());
  const position = tessellated.getAttribute('position') as THREE.BufferAttribute;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  const edgeDistances: number[] = [];

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
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

  const middleZ = (zMin + zMax) * 0.5;
  const sourceHalf = Math.max(1e-5, (zMax - zMin) * 0.5);
  const spanX = Math.max(1e-5, xMax - xMin);
  const maxEdgeDistance = Math.max(1e-5, ...edgeDistances);

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const original = (position.getZ(index) - middleZ) / sourceHalf;
    const rootToTip = side < 0 ? (xMax - x) / spanX : (x - xMin) / spanX;
    const taper = THREE.MathUtils.smoothstep(rootToTip, 0.08, 0.96);
    const halfThickness = THREE.MathUtils.lerp(0.205, 0.058, taper);
    const boundaryDepth = THREE.MathUtils.smoothstep(edgeDistances[index] / maxEdgeDistance, 0, 0.86);
    const crown = THREE.MathUtils.lerp(0.095, 0.022, taper) * boundaryDepth;
    const face = Math.sign(original || 1) * crown * Math.min(1, Math.abs(original) * 2.25);
    position.setZ(index, original * halfThickness + face);
  }

  position.needsUpdate = true;
  for (const name of Object.keys(tessellated.attributes)) {
    if (name !== 'position') tessellated.deleteAttribute(name);
  }
  const welded = mergeVertices(tessellated, 1e-4);
  const weldedPosition = welded.getAttribute('position') as THREE.BufferAttribute;
  const uv: number[] = [];
  const spanY = Math.max(1e-5, yMax - yMin);
  for (let index = 0; index < weldedPosition.count; index += 1) {
    uv.push((weldedPosition.getX(index) - xMin) / spanX, (weldedPosition.getY(index) - yMin) / spanY);
  }
  welded.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = welded;
}

function makeInnerFlow(): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(0.045, 0.58, 10, 18);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x245f70,
    roughness: 0.24,
    metalness: 0,
    transmission: 0.08,
    thickness: 0.06,
    clearcoat: 0.45,
    clearcoatRoughness: 0.12,
    emissive: 0x1e7788,
    emissiveIntensity: 0.12,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Weak internal teal flow';
  mesh.position.set(0, -0.04, 0.3);
  mesh.scale.set(0.78, 1, 0.64);
  mesh.renderOrder = 2;
  mesh.userData.sculptComponent = { id: 'inner-water-vein', material: 'inner-water', role: 'internal-accent' };
  return mesh;
}

function makeEye(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.078, 28, 18);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x48dce7,
    roughness: 0.16,
    metalness: 0,
    transmission: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    emissive: 0x1a9caa,
    emissiveIntensity: 0.72,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Small cyan eye bead';
  mesh.position.set(0, 0.28, 0.59);
  mesh.userData.sculptComponent = { id: 'eye-center', material: 'eye-cyan', role: 'eye' };
  return mesh;
}

export function createWaterwingHoverModel(options: ProceduralModelOptions = {}): THREE.Group {
  const model = createGeneratedModel(options);
  const runtime = model.userData.sculptRuntime as {
    nodes: Record<string, THREE.Object3D>;
    meshes: Record<string, THREE.Mesh>;
  };

  convexifyFanWing(runtime.meshes['wing-left'], -1);
  convexifyFanWing(runtime.meshes['wing-right'], 1);

  const body = runtime.nodes.body;
  if (!runtime.nodes['inner-water-vein']) {
    const flow = makeInnerFlow();
    body.add(flow);
    runtime.nodes['inner-water-vein'] = flow;
    runtime.meshes['inner-water-vein'] = flow;
  }
  if (!runtime.nodes['eye-center']) {
    const eye = makeEye();
    body.add(eye);
    runtime.nodes['eye-center'] = eye;
    runtime.meshes['eye-center'] = eye;
  }

  applyVerticalWaterUv(runtime.meshes.body);
  applyVerticalWaterUv(runtime.meshes['tail-leaf']);

  // Share the approved water language with the propulsion build while keeping
  // this action's mesh, pivots, proportions, and animation completely separate.
  applyWaterwingAqueousLook(model, {
    textureSize: options.textureSize ?? 512,
    textureAnisotropy: options.textureAnisotropy ?? 8,
  });

  const innerFlowMaterial = runtime.meshes['inner-water-vein'].material;
  if (innerFlowMaterial instanceof THREE.MeshPhysicalMaterial) {
    innerFlowMaterial.emissive.set('#0d5362');
    innerFlowMaterial.emissiveIntensity = 0.035;
    innerFlowMaterial.transmission = 0.24;
    innerFlowMaterial.thickness = 0.18;
    innerFlowMaterial.opacity = 0.38;
    innerFlowMaterial.transparent = true;
    innerFlowMaterial.depthWrite = false;
    innerFlowMaterial.needsUpdate = true;
  }

  const eyeMaterial = runtime.meshes['eye-center'].material;
  if (eyeMaterial instanceof THREE.MeshPhysicalMaterial) {
    eyeMaterial.color.set('#6aeaf2');
    eyeMaterial.emissive.set('#27aebb');
    eyeMaterial.emissiveIntensity = 0.58;
    eyeMaterial.roughness = 0.12;
    eyeMaterial.clearcoat = 0.92;
    eyeMaterial.clearcoatRoughness = 0.035;
    eyeMaterial.transmission = 0.08;
    eyeMaterial.thickness = 0.08;
    eyeMaterial.needsUpdate = true;
  }

  model.userData.hoverContract = {
    clip: 'hover_loop',
    durationSeconds: 3.8,
    wingPhase: 'synchronized',
    tailLagCycles: 0.17,
    bodyBobMax: 0.055,
    scaleAnimation: false,
    aqueousLookVersion: 'waterwing-reference-water-v2',
  };
  const leftWing = runtime.nodes['wing-left'];
  const rightWing = runtime.nodes['wing-right'];
  const tail = runtime.nodes['tail-leaf'];
  const base = {
    bodyPosition: body.position.clone(),
    bodyRotation: body.rotation.clone(),
    leftRotation: leftWing.rotation.clone(),
    rightRotation: rightWing.rotation.clone(),
    tailRotation: tail.rotation.clone(),
  };
  attachActionContract(model, {
    actionId: 'hover',
    durationSeconds: 3.8,
    anchors: {
      'health-anchor': [0, 1.22, 0],
      'muzzle-anchor': [0, 0.26, 0.78],
      'impact-anchor': [0, 0.06, 0.18],
      'waterline-anchor': [0, -1.42, 0],
    },
    update(progress: number) {
      const angle = progress * Math.PI * 2;
      const wingPress = Math.sin(angle);
      const buoyancy = Math.sin(angle - 0.38);
      const tailAngle = angle - Math.PI * 2 * 0.17;
      leftWing.rotation.set(base.leftRotation.x + 0.025 * wingPress, base.leftRotation.y, base.leftRotation.z + 0.1 * wingPress);
      rightWing.rotation.set(base.rightRotation.x + 0.025 * wingPress, base.rightRotation.y, base.rightRotation.z - 0.1 * wingPress);
      body.position.set(base.bodyPosition.x, base.bodyPosition.y + 0.048 * buoyancy, base.bodyPosition.z + 0.012 * Math.sin(angle - 0.62));
      body.rotation.set(base.bodyRotation.x + 0.018 * Math.sin(angle - 0.55), base.bodyRotation.y, base.bodyRotation.z + 0.01 * Math.sin(angle + 0.25));
      tail.rotation.set(base.tailRotation.x + 0.025 * Math.sin(tailAngle - 0.18), base.tailRotation.y + 0.045 * Math.sin(tailAngle), base.tailRotation.z + 0.09 * Math.sin(tailAngle));
    },
  });
  return model;
}

export {
  configureWaterwingHoverActionModelRenderer as configureWaterwingHoverRenderer,
  createWaterwingHoverActionModelEnvironment as createWaterwingHoverEnvironment,
  createWaterwingHoverActionModelInspectControls as createWaterwingHoverInspectControls,
  createWaterwingHoverActionModelLookDevLights as createWaterwingHoverLookDevLights,
  frameWaterwingHoverActionModelCamera as frameWaterwingHoverCamera,
} from './createWaterwingHoverModel';

export type { ProceduralModelOptions } from './createWaterwingHoverModel';

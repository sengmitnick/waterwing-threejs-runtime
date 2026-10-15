import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createWaterwingForwardPropulsionModel } from './createFinishedWaterwingForwardModel';
import {
  createForwardPropulsionAnimation,
  FORWARD_PROPEL_CLIP_NAME,
  FORWARD_PROPEL_DURATION_SECONDS,
  FORWARD_PROPEL_SAMPLE_COUNT,
} from './createForwardPropulsionAnimation';

type ForwardRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
};

type ExportBundle = {
  model: THREE.Group;
  clip: THREE.AnimationClip;
};

const COMPONENT_NAMES = Object.freeze({
  body: 'body',
  'wing-left': 'wing-left',
  'wing-right': 'wing-right',
  'tail-leaf': 'tail',
});

function runtimeOf(model: THREE.Group): ForwardRuntime {
  const runtime = model.userData.sculptRuntime as ForwardRuntime | undefined;
  if (!runtime?.nodes || !runtime?.meshes) throw new Error('Forward model is missing its sculpt runtime');
  return runtime;
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function prepareExportBundle(): ExportBundle {
  const model = createWaterwingForwardPropulsionModel({
    qualityPriority: 'reference-fidelity',
    castShadow: true,
    receiveShadow: true,
    textureAnisotropy: 8,
  });
  const runtime = runtimeOf(model);

  model.name = 'WaterwingForwardPropulsion';
  for (const [componentId, exportName] of Object.entries(COMPONENT_NAMES)) {
    const node = runtime.nodes[componentId];
    const mesh = runtime.meshes[componentId];
    if (!node || !mesh) throw new Error(`Forward model is missing export component: ${componentId}`);
    node.name = exportName;
    mesh.name = `${exportName}-mesh`;
    const sculptComponent = mesh.userData.sculptComponent as { material?: string } | undefined;
    const materialId = sculptComponent?.material ?? `${componentId}-water`;
    for (const material of materialList(mesh.material)) {
      if (!material.name) material.name = `${materialId}-material`;
      // Generated material evidence contains workstation-local provenance.
      // It is valuable in the sculpt spec, but must not leak into a reusable GLB.
      material.userData = {
        materialId,
        aqueousLookVersion: material.userData.aqueousLookVersion ?? 'waterwing-reference-water-v2',
      };
    }
  }

  const clip = createForwardPropulsionAnimation(runtime);
  // Make the standalone/static pose equal to the first loop sample. Consumers
  // that enable autoplay a frame after load therefore do not show a pose pop.
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  mixer.update(0);

  // The generated runtime holds live Object3D references and therefore cannot be
  // serialized as glTF extras. Preserve only stable, consumer-facing metadata.
  model.traverse((object) => {
    const component = object.userData.sculptComponent as { id?: string; role?: string } | undefined;
    const action = object.userData.actionProfile as { animationRole?: string } | undefined;
    object.userData = {
      ...(component?.id ? { componentId: component.id } : {}),
      ...(component?.role ? { componentRole: component.role } : {}),
      ...(action?.animationRole ? { animationRole: action.animationRole } : {}),
    };
  });
  model.userData = {
    assetId: 'waterwing-forward-propulsion',
    actionClip: FORWARD_PROPEL_CLIP_NAME,
    actionDurationSeconds: FORWARD_PROPEL_DURATION_SECONDS,
    actionSamples: FORWARD_PROPEL_SAMPLE_COUNT,
    rootMotion: false,
    axisConvention: { forward: '+Z', up: '+Y', lateral: 'X' },
    motionContract: {
      wings: 'same-phase mirrored propulsion stroke',
      tail: 'phase-lagged follow-through',
      root: 'stationary',
    },
  };
  model.updateMatrixWorld(true);
  return { model, clip };
}

async function waitForTextures(model: THREE.Object3D): Promise<void> {
  const textures = new Set<THREE.Texture>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of materialList(object.material)) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  const deadline = performance.now() + 20000;
  while (true) {
    const pending = [...textures].filter((texture) => {
      const image = texture.image as {
        width?: number;
        height?: number;
        naturalWidth?: number;
        naturalHeight?: number;
        videoWidth?: number;
        videoHeight?: number;
      } | null;
      if (!image) return true;
      const width = image.naturalWidth ?? image.videoWidth ?? image.width ?? 0;
      const height = image.naturalHeight ?? image.videoHeight ?? image.height ?? 0;
      return width <= 0 || height <= 0;
    });
    if (pending.length === 0) return;
    if (performance.now() >= deadline) {
      throw new Error(`${pending.length} export textures did not become image-ready`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(''));
}

async function exportBase64(): Promise<string> {
  const { model, clip } = prepareExportBundle();
  await waitForTextures(model);
  const output = await new GLTFExporter().parseAsync(model, {
    binary: true,
    trs: true,
    onlyVisible: true,
    animations: [clip],
    includeCustomExtensions: true,
  });
  if (!(output instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return a binary GLB');
  return arrayBufferToBase64(output);
}

function animationClosure(animations: THREE.AnimationClip[]): number {
  let maximum = 0;
  for (const clip of animations) {
    for (const track of clip.tracks) {
      const itemSize = track.getValueSize();
      const values = track.values;
      const lastOffset = values.length - itemSize;
      for (let component = 0; component < itemSize; component += 1) {
        maximum = Math.max(maximum, Math.abs(values[component] - values[lastOffset + component]));
      }
    }
  }
  return maximum;
}

async function inspectUrl(url: string): Promise<Record<string, unknown>> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const nodeNames: string[] = [];
  const emptyMeshes: string[] = [];
  let meshCount = 0;
  let vertexCount = 0;
  gltf.scene.traverse((object) => {
    if (object.name) nodeNames.push(object.name);
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    const count = object.geometry.getAttribute('position')?.count ?? 0;
    vertexCount += count;
    if (count === 0) emptyMeshes.push(object.name);
  });
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const root = gltf.scene.getObjectByName('WaterwingForwardPropulsion');
  const tracks = gltf.animations.flatMap(clip => clip.tracks.map(track => track.name));
  return {
    nodeNames,
    meshCount,
    vertexCount,
    emptyMeshes,
    animations: gltf.animations.map(clip => clip.name),
    tracks,
    maximumLoopClosureDelta: animationClosure(gltf.animations),
    rootPosition: root?.position.toArray() ?? null,
    finiteBounds: box.min.toArray().concat(box.max.toArray()).every(Number.isFinite),
  };
}

const api = {
  ready: true,
  exportBase64,
  inspectUrl,
};

declare global {
  interface Window {
    waterwingForwardGlbExporter?: typeof api;
  }
}

window.waterwingForwardGlbExporter = api;

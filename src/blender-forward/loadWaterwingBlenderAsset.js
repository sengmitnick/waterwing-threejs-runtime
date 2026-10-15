import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  WATERWING_CLEAR_WATER_PROFILE,
  WATERWING_REGION_PROFILES,
  applySharedWaterwingCrystalMaterial,
  createSharedWaterFxMaterial,
  createWeakWaterCoreCarrierMaterial,
  createWeakWaterCoreGlow,
  installWaterwingRegionalShader,
} from './sharedWaterMaterial.js';

import forwardGlbUrl from '../../assets/blender/waterwing-forward-v1/waterwing-forward-v1.glb?url';
import forwardManifestUrl from '../../assets/blender/waterwing-forward-v1/waterwing-forward-v1.manifest.json?url';
import hoverGlbUrl from '../../assets/blender/waterwing-hover-v1/waterwing-hover-v1.glb?url';
import hoverManifestUrl from '../../assets/blender/waterwing-hover-v1/waterwing-hover-v1.manifest.json?url';
import emergeGlbUrl from '../../assets/blender/waterwing-emerge-v2/waterwing-emerge-v2.glb?url';
import emergeManifestUrl from '../../assets/blender/waterwing-emerge-v2/waterwing-emerge-v2.manifest.json?url';
import dodgeGlbUrl from '../../assets/blender/waterwing-dodge-v2/waterwing-dodge-v2.glb?url';
import dodgeManifestUrl from '../../assets/blender/waterwing-dodge-v2/waterwing-dodge-v2.manifest.json?url';
import directCastGlbUrl from '../../assets/blender/waterwing-direct-cast-v2/waterwing-direct-cast-v2.glb?url';
import directCastManifestUrl from '../../assets/blender/waterwing-direct-cast-v2/waterwing-direct-cast-v2.manifest.json?url';
import directWaterballGlbUrl from '../../assets/blender/waterwing-direct-cast-v2/enemy-direct-waterball-v2.glb?url';
import directWaterballManifestUrl from '../../assets/blender/waterwing-direct-cast-v2/enemy-direct-waterball-v2.manifest.json?url';

const loader = new GLTFLoader();

const catalog = {
  forward: {
    label: '推进',
    glbUrl: forwardGlbUrl,
    manifestUrl: forwardManifestUrl,
  },
  hover: {
    label: '悬浮',
    glbUrl: hoverGlbUrl,
    manifestUrl: hoverManifestUrl,
  },
  emerge: {
    label: '水下凝聚',
    glbUrl: emergeGlbUrl,
    manifestUrl: emergeManifestUrl,
  },
  dodge: {
    label: '侧向闪避',
    glbUrl: dodgeGlbUrl,
    manifestUrl: dodgeManifestUrl,
  },
  directCast: {
    label: '直射水弹',
    glbUrl: directCastGlbUrl,
    manifestUrl: directCastManifestUrl,
    projectileGlbUrl: directWaterballGlbUrl,
    projectileManifestUrl: directWaterballManifestUrl,
  },
};

const sourcePromises = new Map();

function prepareSourceBodyWaterLook(gltf) {
  const body = gltf.scene.getObjectByName('WaterwingBody');
  if (!body?.isMesh) throw new Error('Waterwing source has no WaterwingBody mesh');

  // Some action GLBs share MAT_WaterShell between the hero body and auxiliary
  // droplets/pools. Isolate the body before applying its four-channel flow bake
  // so VFX geometry and projectiles keep their own material treatment.
  body.material = Array.isArray(body.material)
    ? body.material.map(material => material.clone())
    : body.material.clone();
  applySharedWaterwingCrystalMaterial(body);
}

function loadSources(actionName) {
  const entry = catalog[actionName];
  if (!entry) throw new Error(`Unknown Waterwing action ${actionName}`);
  if (!sourcePromises.has(actionName)) {
    sourcePromises.set(actionName, Promise.all([
      loader.loadAsync(entry.glbUrl),
      fetch(entry.manifestUrl).then(response => {
        if (!response.ok) throw new Error(`Waterwing manifest ${response.status}`);
        return response.json();
      }),
      entry.projectileGlbUrl ? loader.loadAsync(entry.projectileGlbUrl) : Promise.resolve(null),
      entry.projectileManifestUrl
        ? fetch(entry.projectileManifestUrl).then(response => {
            if (!response.ok) throw new Error(`Waterball manifest ${response.status}`);
            return response.json();
          })
        : Promise.resolve(null),
    ]).then(([gltf, manifest, projectileGltf, projectileManifest]) => {
      const clip = THREE.AnimationClip.findByName(gltf.animations, manifest.clip);
      if (!clip) throw new Error(`Missing animation clip ${manifest.clip}`);
      prepareSourceBodyWaterLook(gltf);
      return { gltf, manifest, clip, projectileGltf, projectileManifest };
    }));
  }
  return sourcePromises.get(actionName);
}

function makeClayMaterial() {
  return new THREE.MeshStandardMaterial({
    name: 'REVIEW_Clay',
    color: new THREE.Color(0x4c97aa),
    roughness: 0.57,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

function finiteBounds(root) {
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (object.isSkinnedMesh) {
      object.computeBoundingBox();
      object.computeBoundingSphere();
    }
  });
  const box = new THREE.Box3().setFromObject(root, true);
  return {
    box,
    finite: [...box.min, ...box.max].every(Number.isFinite),
  };
}

function poseFingerprint(root) {
  const values = [];
  const stable = value => (Math.abs(value) < 0.00005 ? '0.0000' : value.toFixed(4));
  root.traverse(object => {
    if (object.isBone && /wing_|tail_|body_/.test(object.name)) {
      object.updateMatrixWorld(true);
      values.push(object.name, ...object.matrixWorld.elements.map(stable));
    }
    if (object.isMesh && object.morphTargetInfluences) {
      values.push(object.name, ...object.morphTargetInfluences.map(stable));
    }
  });
  return values.join('|');
}

function installAnchorMarkers(root, names) {
  const markers = [];
  const geometry = new THREE.SphereGeometry(0.065, 12, 8);
  for (const name of names) {
    const anchor = root.getObjectByName(name);
    if (!anchor) throw new Error(`Missing cloned anchor ${name}`);
    const marker = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0x5dffcf, depthTest: false }),
    );
    marker.name = `${name}-marker`;
    marker.renderOrder = 20;
    marker.visible = false;
    anchor.add(marker);
    markers.push(marker);
  }
  return markers;
}

export function listWaterwingBlenderActions() {
  return Object.keys(catalog);
}

export async function loadWaterwingBlenderAsset(actionName = 'forward') {
  const { gltf, manifest, clip, projectileGltf, projectileManifest } = await loadSources(actionName);
  const clayMaterial = makeClayMaterial();

  function createInstance() {
    const root = cloneSkeleton(gltf.scene);
    root.name = 'WaterwingInstance';
    const projectileRoot = projectileGltf?.scene.clone(true) ?? null;
    if (projectileRoot) {
      projectileRoot.name = projectileManifest?.assetVersion ?? 'WaterballProjectile';
      projectileRoot.visible = false;
      root.add(projectileRoot);
    }
    const waterMaterials = new Map();
    let bodyMaterial;
    let bodyMaterials = [];
    let bodyMesh;
    let coreMaterial;
    let coreGlow;
    let firstSkeleton;
    root.traverse(object => {
      if (!object.isMesh) return;
      object.frustumCulled = false;
      object.castShadow = true;
      object.receiveShadow = true;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const sourceMaterial = sourceMaterials[0];
      let material;
      if (object.name === 'WeakWaterCore' || sourceMaterial?.name === 'MAT_CoreWeak') {
        material = createWeakWaterCoreCarrierMaterial();
        coreMaterial = material;
        coreGlow = createWeakWaterCoreGlow();
        object.add(coreGlow);
      } else if (object.name === 'WaterwingBody' && sourceMaterial?.isMeshPhysicalMaterial) {
        bodyMaterials = sourceMaterials.map(source => {
          const clone = source.clone();
          clone.userData = { ...source.userData, semantic: 'water-shell' };
          installWaterwingRegionalShader(clone, WATERWING_REGION_PROFILES);
          return clone;
        });
        material = bodyMaterials.length === 1 ? bodyMaterials[0] : bodyMaterials;
        bodyMaterial = bodyMaterials.find(candidate => candidate.userData.forwardRegionId === 'body') ?? bodyMaterials[0];
        bodyMesh = object;
      } else {
        const key = sourceMaterial?.uuid ?? 'water';
        if (!waterMaterials.has(key)) {
          waterMaterials.set(key, createSharedWaterFxMaterial(sourceMaterial ?? {}));
        }
        material = waterMaterials.get(key);
      }
      object.material = material;
      object.userData.waterMaterial = material;
      if (object.isSkinnedMesh && !firstSkeleton) firstSkeleton = object.skeleton;
    });
    if (!firstSkeleton) throw new Error('Waterwing clone has no skinned mesh');

    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
    action.play();
    const skeletonHelper = new THREE.SkeletonHelper(root);
    skeletonHelper.name = 'WaterwingSkeletonHelper';
    skeletonHelper.material.depthTest = false;
    skeletonHelper.material.transparent = true;
    skeletonHelper.material.opacity = 0.82;
    skeletonHelper.visible = false;
    const anchorMarkers = installAnchorMarkers(root, manifest.anchors.map(anchor => anchor.name));
    const muzzleAnchor = root.getObjectByName('muzzle-anchor');
    const releaseEvent = manifest.events?.find(event => event.name === 'projectile-release');
    const projectilePosition = new THREE.Vector3();
    const muzzleWorld = new THREE.Vector3();

    let phase = 0;
    let materialMode = 'water';
    function updateProjectile() {
      if (!projectileRoot || !muzzleAnchor || !releaseEvent) return;
      const elapsedSeconds = phase * clip.duration - releaseEvent.seconds;
      const flightDuration = 1.15;
      const shotProgress = THREE.MathUtils.clamp(elapsedSeconds / flightDuration, 0, 1);
      projectileRoot.visible = elapsedSeconds >= -1e-4 && elapsedSeconds <= flightDuration;
      if (!projectileRoot.visible) return;
      root.updateMatrixWorld(true);
      muzzleAnchor.getWorldPosition(muzzleWorld);
      projectilePosition.copy(muzzleWorld);
      root.worldToLocal(projectilePosition);
      projectileRoot.position.copy(projectilePosition);
      projectileRoot.position.z += shotProgress * 10.5;
      projectileRoot.position.y += Math.sin(shotProgress * Math.PI) * 0.18;
      projectileRoot.position.x += Math.sin(shotProgress * Math.PI * 2) * 0.07;
      projectileRoot.rotation.set(0, 0, shotProgress * 1.15);
      projectileRoot.scale.setScalar(0.56 * (1 + Math.sin(shotProgress * Math.PI * 3) * 0.06));
    }
    function setProgress(progress) {
      phase = THREE.MathUtils.clamp(progress, 0, 1);
      mixer.setTime(phase * clip.duration);
      root.updateMatrixWorld(true);
      updateProjectile();
      finiteBounds(root);
    }
    function setMaterialMode(mode) {
      if (!['water', 'clay'].includes(mode)) throw new Error(`Unknown material mode ${mode}`);
      materialMode = mode;
      root.traverse(object => {
        if (object.isSprite && object.userData.coreGlow) {
          object.visible = mode === 'water';
          return;
        }
        if (!object.isMesh) return;
        object.material = mode === 'clay' ? clayMaterial : object.userData.waterMaterial;
      });
    }
    function setSkeletonVisible(visible) {
      skeletonHelper.visible = Boolean(visible);
    }
    function setAnchorsVisible(visible) {
      for (const marker of anchorMarkers) marker.visible = Boolean(visible);
    }
    function getAnchor(name) {
      return root.getObjectByName(name) ?? null;
    }
    function getWaterMaterialProfile() {
      if (!bodyMaterial || !bodyMesh) return null;
      const side = bodyMaterial.side === THREE.FrontSide
        ? 'front'
        : bodyMaterial.side === THREE.BackSide ? 'back' : 'double';
      return {
        opacity: bodyMaterial.opacity,
        transmission: bodyMaterial.transmission,
        thickness: bodyMaterial.thickness,
        attenuationColor: `#${bodyMaterial.attenuationColor.getHexString()}`,
        attenuationDistance: bodyMaterial.attenuationDistance,
        baseColor: `#${bodyMaterial.color.getHexString()}`,
        roughness: bodyMaterial.roughness,
        envMapIntensity: bodyMaterial.envMapIntensity,
        clearcoat: bodyMaterial.clearcoat,
        clearcoatRoughness: bodyMaterial.clearcoatRoughness,
        transparent: bodyMaterial.transparent,
        depthWrite: bodyMaterial.depthWrite,
        side,
        uv: Boolean(bodyMesh.geometry.getAttribute('uv')),
        albedoMap: Boolean(bodyMaterial.map),
        roughnessMap: Boolean(bodyMaterial.roughnessMap),
        normalMap: Boolean(bodyMaterial.normalMap),
        thicknessMap: Boolean(bodyMaterial.thicknessMap),
        normalScale: bodyMaterial.normalScale?.x ?? null,
        flowContrast: bodyMaterial.userData.flowContrast ?? null,
        regionalBlend: bodyMaterial.userData.regionalBlend ?? null,
        normalPattern: bodyMaterial.userData.normalPattern ?? null,
        edgeTint: bodyMaterial.userData.edgeTint ?? null,
        edgeStrength: bodyMaterial.userData.edgeStrength ?? null,
        edgePower: bodyMaterial.userData.edgePower ?? null,
        regionalShaderInstalled: bodyMaterial.customProgramCacheKey() === WATERWING_CLEAR_WATER_PROFILE.name,
        regionWeightItemSize: bodyMesh.geometry.getAttribute('wwRegionWeight')?.itemSize ?? null,
        aqueousLookVersion: bodyMaterial.userData.aqueousLookVersion ?? null,
      };
    }
    function getWaterRegionProfiles() {
      return bodyMaterial?.userData.forwardRegionProfiles?.map(profile => ({ ...profile })) ?? [];
    }
    function getCoreMaterialProfile() {
      if (!coreMaterial) return null;
      return {
        meshOpacity: coreMaterial.opacity,
        glow: Boolean(coreGlow),
        glowScale: coreGlow?.scale.x ?? null,
        glowOpacity: coreGlow?.material.opacity ?? null,
        glowBlending: coreGlow?.material.blending === THREE.AdditiveBlending ? 'additive' : 'normal',
        glowDepthTest: coreGlow?.material.depthTest ?? null,
        glowToneMapped: coreGlow?.material.toneMapped ?? null,
      };
    }

    setProgress(0);
    return {
      root,
      mixer,
      clip,
      action,
      manifest,
      skeletonHelper,
      skeletonUuid: firstSkeleton.uuid,
      setProgress,
      setMaterialMode,
      setSkeletonVisible,
      setAnchorsVisible,
      getAnchor,
      getWaterMaterialProfile,
      getWaterRegionProfiles,
      getCoreMaterialProfile,
      getPhase: () => phase,
      getMaterialMode: () => materialMode,
      getBounds: () => finiteBounds(root),
      getPoseFingerprint: () => poseFingerprint(root),
      isProjectileVisible: () => Boolean(projectileRoot?.visible),
      getProjectileWorldPosition: () => projectileRoot?.getWorldPosition(new THREE.Vector3()) ?? null,
    };
  }

  return { actionName, manifest, clip, createInstance };
}

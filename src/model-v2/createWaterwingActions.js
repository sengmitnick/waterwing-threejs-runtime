import * as THREE from 'three';

function vectorTrack(node, property, times, values) {
  return new THREE.VectorKeyframeTrack(`${node}.${property}`, times, values);
}

function numberTrack(node, property, times, values) {
  return new THREE.NumberKeyframeTrack(`${node}.${property}`, times, values);
}

function morphTrack(node, morph, times, values) {
  return numberTrack(node, `morphTargetInfluences[${morph}]`, times, values);
}

function quaternionValues(poses) {
  return poses.flatMap(([x, y, z]) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')).toArray()
  );
}

function quaternionTrack(node, times, poses) {
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, quaternionValues(poses));
}

function emergeClip() {
  const times = [0, 0.24, 0.58, 1.02, 1.42, 1.8];
  return new THREE.AnimationClip('emerge-from-water', 1.8, [
    vectorTrack('pose-root', 'position', times, [
      0, -1.18, -0.08,
      -0.02, -0.94, -0.04,
      0.025, -0.48, 0.015,
      -0.018, 0.1, 0.035,
      0.008, -0.035, 0.01,
      0, 0, 0
    ]),
    quaternionTrack('pose-root', times, [
      [0.12, -0.035, -0.04],
      [0.085, 0.025, 0.045],
      [0.035, -0.025, -0.035],
      [-0.025, 0.015, 0.025],
      [0.01, -0.008, -0.01],
      [0, 0, 0]
    ]),
    morphTrack('body', 'pulse', times, [0.32, 0.24, 0.13, 0.055, 0.018, 0]),
    morphTrack('body', 'streamline', times, [0.54, 0.48, 0.32, 0.14, 0.045, 0]),
    morphTrack('wing-left', 'fold', times, [0.88, 0.82, 0.62, 0.3, 0.08, 0]),
    morphTrack('wing-right', 'fold', times, [0.88, 0.8, 0.58, 0.26, 0.065, 0]),
    morphTrack('wing-left', 'stroke', times, [0.12, 0.34, 0.7, 0.42, 0.14, 0]),
    morphTrack('wing-right', 'stroke', times, [0.18, 0.48, 0.78, 0.34, 0.1, 0]),
    quaternionTrack('wing-left-pivot', times, [
      [0.18, 0.28, -0.12],
      [0.12, 0.2, -0.09],
      [-0.08, 0.08, 0.035],
      [0.045, -0.025, -0.018],
      [-0.018, 0.01, 0.008],
      [0, 0, 0]
    ]),
    quaternionTrack('wing-right-pivot', times, [
      [-0.18, -0.28, 0.12],
      [-0.1, -0.18, 0.08],
      [0.1, -0.065, -0.04],
      [-0.035, 0.03, 0.015],
      [0.015, -0.01, -0.006],
      [0, 0, 0]
    ]),
    morphTrack('tail', 'swim', times, [0.12, 0.72, 0.28, 0.82, 0.24, 0.5]),
    morphTrack('wing-left', 'ripple', times, [0.08, 0.28, 0.48, 0.22, 0.08, 0.04]),
    morphTrack('wing-right', 'ripple', times, [0.16, 0.4, 0.24, 0.46, 0.1, 0.04])
  ]);
}

function idleClip() {
  const times = [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4];
  return new THREE.AnimationClip('idle-hover', 2.4, [
    vectorTrack('pose-root', 'position', times, [
      0, 0, 0,
      -0.012, 0.032, 0.008,
      0.008, 0.056, 0.014,
      0.018, 0.015, 0.004,
      0.006, -0.038, -0.009,
      -0.014, -0.024, -0.006,
      0, 0, 0
    ]),
    quaternionTrack('pose-root', times, [
      [0, 0, -0.025],
      [0.012, -0.018, -0.012],
      [0.018, -0.01, 0.018],
      [0, 0.015, 0.032],
      [-0.016, 0.012, 0.012],
      [-0.01, -0.01, -0.018],
      [0, 0, -0.025]
    ]),
    morphTrack('body', 'pulse', times, [0.08, 0.14, 0.2, 0.13, 0.065, 0.035, 0.08]),
    morphTrack('body', 'streamline', times, [0.08, 0.12, 0.1, 0.06, 0.11, 0.13, 0.08]),
    morphTrack('wing-left', 'ripple', times, [0.12, 0.42, 0.2, 0.08, 0.28, 0.48, 0.12]),
    morphTrack('wing-right', 'ripple', times, [0.38, 0.16, 0.1, 0.34, 0.5, 0.22, 0.38]),
    morphTrack('wing-left', 'stroke', times, [0.24, 0.42, 0.28, 0.12, 0.2, 0.34, 0.24]),
    morphTrack('wing-right', 'stroke', times, [0.3, 0.16, 0.22, 0.4, 0.32, 0.18, 0.3]),
    morphTrack('tail', 'swim', times, [0.48, 0.7, 0.88, 0.56, 0.18, 0.28, 0.48]),
    quaternionTrack('wing-left-pivot', times, [
      [0, 0, -0.018],
      [-0.035, 0.012, 0.01],
      [-0.012, 0.02, 0.024],
      [0.025, 0.006, 0.008],
      [0.035, -0.012, -0.018],
      [0.012, -0.018, -0.028],
      [0, 0, -0.018]
    ]),
    quaternionTrack('wing-right-pivot', times, [
      [0.025, 0, 0.014],
      [0.035, -0.012, -0.008],
      [0.01, -0.02, -0.025],
      [-0.03, -0.006, -0.012],
      [-0.038, 0.012, 0.016],
      [-0.006, 0.018, 0.028],
      [0.025, 0, 0.014]
    ])
  ]);
}

function chargeClip() {
  const times = [0, 0.28, 0.62, 0.98, 1.3, 1.6];
  return new THREE.AnimationClip('charge-waterball', 1.6, [
    vectorTrack('pose-root', 'position', times, [
      0, 0, 0,
      0, -0.025, -0.035,
      0, -0.05, -0.065,
      0, -0.035, -0.08,
      0, -0.012, -0.03,
      0, 0, 0
    ]),
    morphTrack('body', 'pulse', times, [0.04, 0.2, 0.42, 0.68, 0.28, 0.04]),
    morphTrack('body', 'streamline', times, [0.06, 0.16, 0.31, 0.52, 0.2, 0.06]),
    morphTrack('wing-left', 'fold', times, [0.04, 0.2, 0.46, 0.72, 0.28, 0.04]),
    morphTrack('wing-right', 'fold', times, [0.04, 0.18, 0.43, 0.7, 0.26, 0.04]),
    morphTrack('wing-left', 'sweep', times, [0.06, 0.18, 0.38, 0.62, 0.24, 0.06]),
    morphTrack('wing-right', 'sweep', times, [0.06, 0.2, 0.4, 0.64, 0.25, 0.06]),
    quaternionTrack('wing-left-pivot', times, [
      [0, 0, 0],
      [0.035, 0.055, -0.028],
      [0.075, 0.11, -0.052],
      [0.11, 0.17, -0.075],
      [0.03, 0.045, -0.02],
      [0, 0, 0]
    ]),
    quaternionTrack('wing-right-pivot', times, [
      [0, 0, 0],
      [-0.03, -0.05, 0.024],
      [-0.07, -0.105, 0.048],
      [-0.105, -0.165, 0.07],
      [-0.028, -0.04, 0.018],
      [0, 0, 0]
    ]),
    vectorTrack('weak-core', 'scale', times, [
      1, 1, 1,
      1.03, 1.03, 1.03,
      1.075, 1.075, 1.075,
      1.13, 1.13, 1.13,
      1.045, 1.045, 1.045,
      1, 1, 1
    ]),
    morphTrack('tail', 'swim', times, [0.5, 0.62, 0.38, 0.7, 0.44, 0.5])
  ]);
}

function castClip() {
  const times = [0, 0.12, 0.26, 0.46, 0.7, 0.9];
  return new THREE.AnimationClip('cast-waterball', 0.9, [
    vectorTrack('pose-root', 'position', times, [
      0, 0, 0,
      0, 0.025, 0.055,
      0, 0.05, 0.12,
      0, -0.018, -0.085,
      0, 0.008, 0.025,
      0, 0, 0
    ]),
    quaternionTrack('pose-root', times, [
      [0, 0, 0],
      [-0.025, 0.012, -0.015],
      [-0.055, 0.02, -0.025],
      [0.035, -0.015, 0.018],
      [-0.01, 0.005, -0.006],
      [0, 0, 0]
    ]),
    morphTrack('body', 'pulse', times, [0.28, 0.5, 0.18, 0.1, 0.035, 0]),
    morphTrack('body', 'streamline', times, [0.22, 0.48, 0.72, 0.26, 0.08, 0]),
    morphTrack('wing-left', 'stroke', times, [0.18, 0.44, 0.84, 0.38, 0.12, 0]),
    morphTrack('wing-right', 'stroke', times, [0.2, 0.48, 0.88, 0.42, 0.14, 0]),
    morphTrack('wing-left', 'sweep', times, [0.14, 0.32, 0.66, 0.3, 0.1, 0]),
    morphTrack('wing-right', 'sweep', times, [0.15, 0.35, 0.7, 0.32, 0.1, 0]),
    quaternionTrack('wing-left-pivot', times, [
      [0, 0, 0],
      [-0.035, -0.04, 0.02],
      [-0.09, -0.1, 0.045],
      [0.045, 0.04, -0.018],
      [-0.012, -0.01, 0.005],
      [0, 0, 0]
    ]),
    quaternionTrack('wing-right-pivot', times, [
      [0, 0, 0],
      [0.035, 0.04, -0.02],
      [0.09, 0.1, -0.045],
      [-0.045, -0.04, 0.018],
      [0.012, 0.01, -0.005],
      [0, 0, 0]
    ]),
    vectorTrack('weak-core', 'scale', times, [
      1.08, 1.08, 1.08,
      1.14, 1.14, 1.14,
      0.96, 0.96, 0.96,
      1.015, 1.015, 1.015,
      1, 1, 1,
      1, 1, 1
    ])
  ]);
}

function lungeClip() {
  const times = [0, 0.18, 0.4, 0.64, 0.92, 1.2];
  return new THREE.AnimationClip('lunge-attack', 1.2, [
    vectorTrack('pose-root', 'position', times, [
      0, 0, 0,
      -0.02, -0.045, -0.06,
      0.025, 0.06, 0.18,
      -0.012, 0.025, 0.08,
      0.008, -0.01, -0.025,
      0, 0, 0
    ]),
    quaternionTrack('pose-root', times, [
      [0, 0, 0],
      [0.045, -0.035, 0.04],
      [-0.105, 0.08, -0.135],
      [-0.035, 0.02, 0.07],
      [0.015, -0.008, -0.018],
      [0, 0, 0]
    ]),
    morphTrack('body', 'pulse', times, [0.04, 0.18, 0.34, 0.18, 0.07, 0.04]),
    morphTrack('body', 'streamline', times, [0.08, 0.36, 0.88, 0.52, 0.2, 0.08]),
    morphTrack('wing-left', 'stroke', times, [0.18, 0.5, 0.94, 0.58, 0.26, 0.18]),
    morphTrack('wing-right', 'stroke', times, [0.24, 0.58, 0.98, 0.62, 0.3, 0.24]),
    morphTrack('wing-left', 'sweep', times, [0.12, 0.42, 0.9, 0.64, 0.25, 0.12]),
    morphTrack('wing-right', 'sweep', times, [0.14, 0.48, 0.92, 0.68, 0.28, 0.14]),
    morphTrack('wing-left', 'fold', times, [0.04, 0.18, 0.46, 0.24, 0.08, 0.04]),
    morphTrack('wing-right', 'fold', times, [0.05, 0.2, 0.5, 0.26, 0.09, 0.05]),
    quaternionTrack('wing-left-pivot', times, [
      [0, 0, 0],
      [0.04, 0.08, -0.04],
      [0.12, 0.2, -0.08],
      [0.035, 0.04, -0.015],
      [-0.012, -0.015, 0.006],
      [0, 0, 0]
    ]),
    quaternionTrack('wing-right-pivot', times, [
      [0, 0, 0],
      [-0.04, -0.08, 0.04],
      [-0.12, -0.2, 0.08],
      [-0.035, -0.04, 0.015],
      [0.012, 0.015, -0.006],
      [0, 0, 0]
    ]),
    morphTrack('tail', 'swim', times, [0.5, 0.72, 0.92, 0.34, 0.16, 0.5])
  ]);
}

function dodgeClip() {
  const times = [0, 0.14, 0.32, 0.52, 0.72, 0.94];
  return new THREE.AnimationClip('dodge-bank', 0.94, [
    vectorTrack('pose-root', 'position', times, [
      0, 0, 0,
      0.07, 0.018, -0.015,
      0.2, 0.05, 0.02,
      0.11, 0.02, 0.012,
      0.025, -0.008, -0.006,
      0, 0, 0
    ]),
    quaternionTrack('pose-root', times, [
      [0, 0, 0],
      [0.015, -0.025, 0.07],
      [0.035, -0.09, 0.16],
      [-0.02, 0.035, -0.075],
      [0.008, -0.01, 0.02],
      [0, 0, 0]
    ]),
    morphTrack('body', 'streamline', times, [0.08, 0.34, 0.74, 0.42, 0.15, 0.08]),
    morphTrack('wing-left', 'fold', times, [0.06, 0.28, 0.64, 0.34, 0.12, 0.06]),
    morphTrack('wing-right', 'fold', times, [0.06, 0.12, 0.3, 0.18, 0.08, 0.06]),
    morphTrack('wing-left', 'sweep', times, [0.1, 0.46, 0.84, 0.5, 0.18, 0.1]),
    morphTrack('wing-right', 'sweep', times, [0.1, 0.22, 0.48, 0.3, 0.14, 0.1]),
    morphTrack('wing-left', 'stroke', times, [0.2, 0.58, 0.86, 0.48, 0.24, 0.2]),
    morphTrack('wing-right', 'stroke', times, [0.3, 0.16, 0.08, 0.36, 0.42, 0.3]),
    morphTrack('tail', 'swim', times, [0.5, 0.78, 0.96, 0.18, 0.28, 0.5]),
    quaternionTrack('wing-left-pivot', times, [
      [0, 0, 0],
      [0.055, 0.08, -0.04],
      [0.12, 0.15, -0.065],
      [-0.04, -0.03, 0.018],
      [-0.01, -0.012, 0.006],
      [0, 0, 0]
    ]),
    quaternionTrack('wing-right-pivot', times, [
      [0, 0, 0],
      [-0.02, -0.025, 0.012],
      [-0.05, -0.06, 0.025],
      [0.075, 0.09, -0.04],
      [0.018, 0.018, -0.008],
      [0, 0, 0]
    ])
  ]);
}

function hitClip() {
  const times = [0, 0.1, 0.23, 0.39, 0.56, 0.74];
  return new THREE.AnimationClip('hit-recoil', 0.74, [
    vectorTrack('pose-root', 'position', times, [
      0, 0, 0,
      0.035, -0.035, -0.17,
      -0.025, 0.012, -0.09,
      0.014, -0.004, -0.035,
      -0.006, 0.003, -0.01,
      0, 0, 0
    ]),
    quaternionTrack('pose-root', times, [
      [0, 0, 0],
      [0.11, -0.075, 0.12],
      [-0.05, 0.04, -0.08],
      [0.022, -0.018, 0.035],
      [-0.008, 0.006, -0.012],
      [0, 0, 0]
    ]),
    morphTrack('body', 'pulse', times, [0.04, 0.5, 0.22, 0.11, 0.065, 0.04]),
    morphTrack('body', 'streamline', times, [0.08, 0.36, 0.18, 0.1, 0.07, 0.08]),
    morphTrack('wing-left', 'ripple', times, [0.08, 0.96, 0.42, 0.24, 0.14, 0.08]),
    morphTrack('wing-right', 'ripple', times, [0.08, 0.78, 0.58, 0.3, 0.15, 0.08]),
    morphTrack('wing-left', 'fold', times, [0.04, 0.48, 0.26, 0.12, 0.06, 0.04]),
    morphTrack('wing-right', 'fold', times, [0.04, 0.4, 0.32, 0.15, 0.07, 0.04]),
    morphTrack('tail', 'swim', times, [0.5, 0.92, 0.14, 0.72, 0.36, 0.5]),
    quaternionTrack('wing-left-pivot', times, [
      [0, 0, 0],
      [0.11, 0.09, -0.07],
      [-0.055, -0.04, 0.035],
      [0.025, 0.02, -0.014],
      [-0.008, -0.006, 0.004],
      [0, 0, 0]
    ]),
    quaternionTrack('wing-right-pivot', times, [
      [0, 0, 0],
      [-0.085, -0.07, 0.055],
      [0.07, 0.05, -0.04],
      [-0.03, -0.022, 0.016],
      [0.01, 0.007, -0.004],
      [0, 0, 0]
    ])
  ]);
}

function forwardSwimClip() {
  const times = [0, 0.22, 0.48, 0.74, 1, 1.26, 1.52, 1.78, 2];
  return new THREE.AnimationClip('forward-swim-loop', 2, [
    vectorTrack('pose-root', 'position', times, [
      0, 0, 0,
      -0.012, 0.028, 0.012,
      0.006, 0.048, 0.026,
      0.018, 0.022, 0.01,
      0.004, -0.018, -0.012,
      -0.016, -0.04, -0.024,
      -0.02, -0.012, -0.008,
      -0.008, 0.014, 0.004,
      0, 0, 0
    ]),
    quaternionTrack('pose-root', times, [
      [0.015, 0, -0.025],
      [0.035, -0.015, -0.05],
      [0.052, -0.022, -0.018],
      [0.02, -0.01, 0.035],
      [-0.025, 0.012, 0.052],
      [-0.05, 0.022, 0.022],
      [-0.028, 0.012, -0.035],
      [0, 0.004, -0.045],
      [0.015, 0, -0.025]
    ]),
    morphTrack('body', 'pulse', times, [0.1, 0.2, 0.34, 0.22, 0.08, 0.06, 0.2, 0.3, 0.1]),
    morphTrack('body', 'streamline', times, [0.14, 0.34, 0.62, 0.48, 0.18, 0.32, 0.66, 0.4, 0.14]),
    // Both wings share one propulsion phase. Alternating the left and right
    // membrane reads as an arm stroke; a water manta presses a whole sheet of
    // water at once, so every wing channel below is authored once and applied
    // identically to both sides. The loop never drops below the forward
    // posture, which keeps the down-back heavy silhouette continuous.
    morphTrack('wing-left', 'stroke', times, [0.58, 0.72, 0.86, 0.76, 0.52, 0.44, 0.58, 0.78, 0.58]),
    morphTrack('wing-right', 'stroke', times, [0.58, 0.72, 0.86, 0.76, 0.52, 0.44, 0.58, 0.78, 0.58]),
    morphTrack('wing-left', 'sweep', times, [0.66, 0.8, 0.92, 0.8, 0.6, 0.54, 0.64, 0.84, 0.66]),
    morphTrack('wing-right', 'sweep', times, [0.66, 0.8, 0.92, 0.8, 0.6, 0.54, 0.64, 0.84, 0.66]),
    morphTrack('wing-left', 'cup', times, [0.64, 0.78, 0.9, 0.78, 0.58, 0.53, 0.62, 0.82, 0.64]),
    morphTrack('wing-right', 'cup', times, [0.64, 0.78, 0.9, 0.78, 0.58, 0.53, 0.62, 0.82, 0.64]),
    morphTrack('wing-left', 'fold', times, [0.09, 0.15, 0.21, 0.16, 0.08, 0.06, 0.11, 0.18, 0.09]),
    morphTrack('wing-right', 'fold', times, [0.09, 0.15, 0.21, 0.16, 0.08, 0.06, 0.11, 0.18, 0.09]),
    morphTrack('wing-left', 'ripple', times, [0.16, 0.3, 0.44, 0.32, 0.14, 0.1, 0.22, 0.36, 0.16]),
    morphTrack('wing-right', 'ripple', times, [0.16, 0.3, 0.44, 0.32, 0.14, 0.1, 0.22, 0.36, 0.16]),
    morphTrack('tail', 'swim', times, [0.5, 0.9, 0.66, 0.22, 0.06, 0.34, 0.78, 0.96, 0.5]),
    quaternionTrack('wing-left-pivot', times, [
      [0.015, 0.01, -0.02],
      [-0.075, 0.045, -0.05],
      [-0.13, 0.085, -0.06],
      [-0.05, 0.04, -0.02],
      [0.06, -0.028, 0.028],
      [0.1, -0.06, 0.045],
      [0.03, -0.018, 0.01],
      [-0.04, 0.022, -0.014],
      [0.015, 0.01, -0.02]
    ]),
    // The right pivot mirrors the left in pitch sign and negates the yaw/roll
    // terms, so the pair beats as one surface instead of alternating.
    quaternionTrack('wing-right-pivot', times, [
      [0.015, -0.01, 0.02],
      [-0.075, -0.045, 0.05],
      [-0.13, -0.085, 0.06],
      [-0.05, -0.04, 0.02],
      [0.06, 0.028, -0.028],
      [0.1, 0.06, -0.045],
      [0.03, 0.018, -0.01],
      [-0.04, -0.022, 0.014],
      [0.015, -0.01, 0.02]
    ]),
    quaternionTrack('tail-pivot', times, [
      [0, 0, 0.025],
      [0.015, 0.02, 0.085],
      [0.02, 0.03, 0.04],
      [0.005, 0.005, -0.07],
      [-0.012, -0.02, -0.1],
      [-0.02, -0.03, -0.035],
      [-0.006, -0.01, 0.075],
      [0.008, 0.012, 0.09],
      [0, 0, 0.025]
    ])
  ]);
}

export function createWaterwingActions() {
  return [
    emergeClip(),
    idleClip(),
    chargeClip(),
    castClip(),
    lungeClip(),
    dodgeClip(),
    hitClip(),
    forwardSwimClip()
  ];
}

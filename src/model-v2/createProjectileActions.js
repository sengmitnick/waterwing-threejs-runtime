import * as THREE from 'three';

function vectorTrack(node, property, times, values) {
  return new THREE.VectorKeyframeTrack(`${node}.${property}`, times, values);
}

function numberTrack(node, property, times, values) {
  return new THREE.NumberKeyframeTrack(`${node}.${property}`, times, values);
}

function morphTrack(morph, times, values) {
  return numberTrack('water-mass', `morphTargetInfluences[${morph}]`, times, values);
}

function quaternionValues(poses) {
  return poses.flatMap(([x, y, z]) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')).toArray()
  );
}

function quaternionTrack(node, times, poses) {
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, quaternionValues(poses));
}

function chargeClip(owner) {
  const duration = owner === 'player' ? 0.72 : 0.84;
  const times = [0, duration * 0.25, duration * 0.58, duration];
  const peakScale = owner === 'player' ? 1.075 : 1.08;
  const tracks = [
    vectorTrack('water-mass', 'scale', times, [
      1, 1, 1,
      1.035, 1.035, 1.045,
      peakScale, peakScale, peakScale,
      1, 1, 1
    ]),
    morphTrack('pulse', times, [0, 0.38, owner === 'player' ? 0.68 : 0.78, 0]),
    vectorTrack('droplet-group', 'scale', times, [
      1, 1, 1,
      0.98, 0.98, 0.98,
      1.055, 1.055, 1.055,
      1, 1, 1
    ]),
    quaternionTrack('droplet-group', times, [
      [0, 0, -0.04],
      [0.03, 0.08, 0.025],
      [-0.025, -0.07, 0.055],
      [0, 0, -0.04]
    ]),
    vectorTrack('direct-trail', 'scale', times, [
      0.72, 0.72, 0.72,
      0.82, 0.82, 0.82,
      1, 1, 1,
      0.72, 0.72, 0.72
    ]),
    vectorTrack('lob-satellites', 'scale', times, [
      0.08, 0.08, 0.08,
      0.28, 0.28, 0.28,
      owner === 'enemy' ? 0.72 : 0.08,
      owner === 'enemy' ? 0.72 : 0.08,
      owner === 'enemy' ? 0.72 : 0.08,
      0.08, 0.08, 0.08
    ])
  ];
  return new THREE.AnimationClip('charge-pulse', duration, tracks);
}

function directChargeClip() {
  const times = [0, 0.08, 0.2, 0.34];
  return new THREE.AnimationClip('direct-charge', 0.34, [
    vectorTrack('water-mass', 'scale', times, [
      0.08, 0.08, 0.1,
      0.28, 0.26, 0.32,
      0.58, 0.55, 0.66,
      0.63, 0.6, 0.72
    ]),
    morphTrack('pulse', times, [0, 0.18, 0.35, 0.12]),
    vectorTrack('direct-trail', 'scale', times, [
      0.02, 0.02, 0.02,
      0.18, 0.18, 0.18,
      0.7, 0.7, 0.7,
      1, 1, 1
    ]),
    vectorTrack('lob-satellites', 'scale', times, [
      0.02, 0.02, 0.02,
      0.02, 0.02, 0.02,
      0.02, 0.02, 0.02,
      0.02, 0.02, 0.02
    ])
  ]);
}

function lobChargeClip() {
  const times = [0, 0.2, 0.46, 0.7, 0.88];
  return new THREE.AnimationClip('lob-charge', 0.88, [
    vectorTrack('water-mass', 'scale', times, [
      0.14, 0.14, 0.14,
      0.34, 0.33, 0.35,
      0.66, 0.64, 0.65,
      0.94, 0.93, 0.9,
      1.08, 1.08, 1.02
    ]),
    morphTrack('lob', times, [0, 0.12, 0.34, 0.62, 0.4]),
    vectorTrack('direct-trail', 'scale', times, [
      0.02, 0.02, 0.02,
      0.04, 0.04, 0.04,
      0.06, 0.06, 0.06,
      0.08, 0.08, 0.08,
      0.1, 0.1, 0.1
    ]),
    vectorTrack('lob-satellites', 'scale', times, [
      0.02, 0.02, 0.02,
      0.2, 0.2, 0.2,
      0.56, 0.56, 0.56,
      0.9, 0.9, 0.9,
      1.06, 1.06, 1.06
    ]),
    quaternionTrack('lob-satellites', times, [
      [0, 0, -0.06],
      [0.03, 0.08, 0.02],
      [-0.035, -0.07, 0.055],
      [0.02, 0.09, -0.04],
      [0, 0, -0.06]
    ])
  ]);
}

function playerFlightClip() {
  const times = [0, 0.18, 0.36, 0.54, 0.72];
  return new THREE.AnimationClip('flight-loop', 0.72, [
    vectorTrack('water-mass', 'scale', times, [
      0.94, 0.96, 1.1,
      0.97, 0.93, 1.14,
      0.93, 0.98, 1.11,
      0.96, 0.94, 1.15,
      0.94, 0.96, 1.1
    ]),
    morphTrack('pulse', times, [0.12, 0.27, 0.1, 0.24, 0.12]),
    quaternionTrack('water-mass', times, [
      [0.025, 0.075, -0.035],
      [-0.035, -0.065, 0.055],
      [0.02, 0.08, 0.025],
      [-0.025, -0.055, -0.05],
      [0.025, 0.075, -0.035]
    ]),
    vectorTrack('droplet-group', 'position', times, [
      0, 0, 0.08,
      0.025, -0.02, 0.15,
      -0.02, 0.015, 0.11,
      0.015, 0.02, 0.16,
      0, 0, 0.08
    ])
  ]);
}

function directFlightClip() {
  const times = [0, 0.16, 0.32, 0.48, 0.64];
  return new THREE.AnimationClip('direct-flight-loop', 0.64, [
    vectorTrack('water-mass', 'scale', times, [
      0.62, 0.64, 0.72,
      0.66, 0.61, 0.75,
      0.61, 0.66, 0.73,
      0.65, 0.62, 0.76,
      0.62, 0.64, 0.72
    ]),
    morphTrack('pulse', times, [0.08, 0.22, 0.09, 0.2, 0.08]),
    quaternionTrack('water-mass', times, [
      [0.02, 0.065, -0.04],
      [-0.03, -0.075, 0.045],
      [0.025, 0.06, 0.035],
      [-0.02, -0.055, -0.045],
      [0.02, 0.065, -0.04]
    ]),
    vectorTrack('droplet-group', 'position', times, [
      0, 0, 0.14,
      0.035, -0.025, 0.23,
      -0.025, 0.02, 0.17,
      0.02, 0.018, 0.24,
      0, 0, 0.14
    ]),
    vectorTrack('direct-trail', 'scale', times, [
      1, 1, 1,
      1.05, 1.03, 1.08,
      0.98, 1.04, 1.06,
      1.04, 0.99, 1.1,
      1, 1, 1
    ]),
    vectorTrack('lob-satellites', 'scale', times, [
      0.02, 0.02, 0.02,
      0.02, 0.02, 0.02,
      0.02, 0.02, 0.02,
      0.02, 0.02, 0.02,
      0.02, 0.02, 0.02
    ])
  ]);
}

function lobFlightClip() {
  const times = [0, 0.27, 0.54, 0.81, 1.08];
  return new THREE.AnimationClip('lob-flight-loop', 1.08, [
    vectorTrack('water-mass', 'scale', times, [
      1.08, 1.1, 1.02,
      1.13, 1.08, 1,
      1.07, 1.14, 1.04,
      1.12, 1.09, 1.01,
      1.08, 1.1, 1.02
    ]),
    morphTrack('lob', times, [0.62, 0.84, 0.68, 0.9, 0.62]),
    quaternionTrack('water-mass', times, [
      [0.055, 0.08, -0.045],
      [-0.075, 0.15, 0.08],
      [0.06, -0.11, 0.11],
      [-0.045, -0.14, -0.075],
      [0.055, 0.08, -0.045]
    ]),
    vectorTrack('droplet-group', 'position', times, [
      0, -0.025, 0.32,
      0.055, -0.08, 0.45,
      -0.045, 0.035, 0.38,
      0.035, -0.06, 0.47,
      0, -0.025, 0.32
    ]),
    vectorTrack('droplet-group', 'scale', times, [
      1.08, 1.08, 1.12,
      1.14, 1.1, 1.18,
      1.09, 1.15, 1.14,
      1.13, 1.09, 1.19,
      1.08, 1.08, 1.12
    ]),
    vectorTrack('direct-trail', 'scale', times, [
      0.12, 0.12, 0.12,
      0.16, 0.16, 0.16,
      0.1, 0.1, 0.1,
      0.15, 0.15, 0.15,
      0.12, 0.12, 0.12
    ]),
    vectorTrack('lob-satellites', 'scale', times, [
      1.03, 1.03, 1.03,
      1.1, 1.06, 1.08,
      1.04, 1.11, 1.07,
      1.09, 1.05, 1.12,
      1.03, 1.03, 1.03
    ])
  ]);
}

function impactClip(owner) {
  const duration = owner === 'player' ? 0.48 : 0.56;
  const times = [0, duration * 0.29, duration * 0.62, duration];
  const spread = owner === 'player' ? 2.2 : 2.55;
  return new THREE.AnimationClip('impact-burst', duration, [
    morphTrack('impact', times, [0, 0.32, 0.78, 1]),
    vectorTrack('water-mass', 'scale', times, [
      1, 1, 1,
      1.02, 1, 0.68,
      0.96, 0.9, 0.38,
      0.9, 0.82, 0.18
    ]),
    vectorTrack('droplet-group', 'scale', times, [
      1, 1, 1,
      1.28, 1.22, 1.14,
      spread * 0.76, spread * 0.66, spread * 0.58,
      spread, spread * 0.88, spread * 0.34
    ]),
    vectorTrack('droplet-group', 'position', times, [
      0, 0, 0,
      0.025, 0.02, -0.04,
      -0.045, 0.055, -0.12,
      0.065, 0.08, -0.2
    ]),
    quaternionTrack('droplet-group', times, [
      [0, 0, 0],
      [0.08, -0.1, 0.12],
      [-0.12, 0.16, -0.18],
      [0.18, -0.2, 0.24]
    ])
  ]);
}

export function createProjectileActions(owner = 'enemy') {
  if (owner !== 'player' && owner !== 'enemy') {
    throw new RangeError(`Unsupported projectile owner: ${owner}`);
  }

  if (owner === 'player') {
    return [chargeClip(owner), playerFlightClip(), impactClip(owner)];
  }
  return [
    chargeClip(owner),
    directChargeClip(),
    directFlightClip(),
    lobChargeClip(),
    lobFlightClip(),
    impactClip(owner)
  ];
}

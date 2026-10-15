import * as THREE from 'three';

const SPAN_SEGMENTS = 44;
const CHORD_SEGMENTS = 24;

// Cup tuning. `cupInflation` is the per-shell half-thickening that the two
// membrane surfaces receive in opposite directions, so the section reads as
// loaded water rather than a translated plate.
const CUP_INFLATION = 0.16;
const CUP_BOW = 0.04;

function sideSign(side) {
  return side === 'left' || side === -1 ? -1 : 1;
}

function deterministicWave(u, v, seed) {
  const phase = seed * 0.61803398875;
  return (
    Math.sin((u * 5.15 + v * 2.7 + phase) * Math.PI) * 0.62 +
    Math.sin((u * 11.3 - v * 4.1 + phase * 1.71) * Math.PI) * 0.27 +
    Math.sin((u * 19.7 + v * 7.3 + phase * 0.43) * Math.PI) * 0.11
  );
}

function createMembranePoint(u, v, sign, seed) {
  // The membrane grows from a broad shoulder chord and converges to a high
  // spear point. In top/profile views the whole outer third sweeps behind the
  // torso; it is intentionally not a flat billboard.
  const leadingY =
    0.55 - 0.35 * Math.sin(Math.PI * u) + 1 * u * u;
  const trailingY =
    -0.78 - 0.3 * Math.sin(Math.PI * u) + 2.33 * Math.pow(u, 5);
  const edgeDistance = Math.abs(v * 2 - 1);
  const edgeWeight = Math.pow(edgeDistance, 6);
  const outerWeight = THREE.MathUtils.smootherstep(u, 0.62, 1);
  const tipClosure = 1 - THREE.MathUtils.smootherstep(u, 0.84, 1);
  const edgeWave = deterministicWave(u, v, seed);

  // The root starts slightly beneath the torso. The lower edge drifts back as
  // the wing opens, while the tip remains a clean, narrow point.
  const trailingPull =
    0.075 * Math.pow(u, 1.7) * Math.pow(1 - v, 1.35) * tipClosure;
  const leadingPush = 0.018 * Math.pow(u, 1.45) * v * v * tipClosure;
  const edgeBreak =
    (0.004 + 0.014 * u) * edgeWave * Math.max(edgeWeight, outerWeight * 0.82) * tipClosure;
  // Curve the attachment around the body's side rather than ending the wing
  // in a vertical cut visible through the transparent torso.
  const rootSpan = 0.42 + 0.17 * Math.sin(Math.PI * v);
  const span =
    THREE.MathUtils.lerp(rootSpan, 1.57, u) -
    trailingPull +
    leadingPush +
    edgeBreak;

  const raggedY =
    (0.003 + 0.018 * u) * edgeWave * Math.max(edgeWeight * 0.82, outerWeight * 0.72) * tipClosure;
  const y = THREE.MathUtils.lerp(trailingY, leadingY, v) + raggedY;
  const z =
    -0.025 +
    0.14 * Math.sin(v * Math.PI) * (1 - 0.28 * u) +
    0.105 * Math.sin(u * Math.PI) -
    0.5 * Math.pow(u, 1.25) -
    0.075 * (1 - v) * Math.sin(Math.PI * u) +
    0.01 * edgeWave * outerWeight * edgeWeight;
  const tipThickness = 1 - 0.8 * THREE.MathUtils.smootherstep(u, 0.78, 1);
  const halfThickness =
    (0.018 + 0.043 * Math.sin(v * Math.PI) * (1 - 0.32 * u)) * tipThickness;

  return {
    x: sign * span,
    y,
    z,
    halfThickness,
    edgeWeight,
    outerWeight,
    edgeWave
  };
}

function createMorphDeltas(point, u, v, sign, seed, surfaceSign) {
  const anchoredU = THREE.MathUtils.smootherstep(u, 0.025, 0.28);
  const foldAmount = anchoredU * Math.pow(u, 0.72);
  const localMidline = 0.5 - v;
  const fold = new THREE.Vector3(
    -sign * 0.205 * Math.pow(u, 1.38),
    localMidline * 0.13 * foldAmount + 0.035 * u * u,
    0.37 * Math.pow(u, 1.5) + 0.025 * Math.sin(v * Math.PI) * foldAmount
  );

  const ripplePhase = seed * 0.37 + (sign < 0 ? 0.63 : 0.17);
  const membraneRipple =
    Math.sin(u * Math.PI * 3.25 + v * Math.PI * 1.4 + ripplePhase) *
    Math.sin(v * Math.PI) *
    (0.018 + 0.03 * u);
  const edgeFlutter =
    Math.sin(u * Math.PI * 7.2 + ripplePhase * 1.7) *
    (point.edgeWeight * 0.022 + point.outerWeight * 0.018);
  const ripple = new THREE.Vector3(
    sign * edgeFlutter * 0.18 * anchoredU,
    edgeFlutter * 0.24 * anchoredU,
    (membraneRipple + edgeFlutter) * anchoredU
  );

  // A broad down/up stroke changes both depth and silhouette. Keeping the
  // shoulder fixed lets the action clip layer this deformation with a small
  // pivot rotation without tearing the membrane away from the torso.
  const strokeWeight = anchoredU * Math.pow(u, 0.58);
  const stroke = new THREE.Vector3(
    -sign * 0.055 * Math.pow(u, 1.35),
    -0.13 * strokeWeight * (0.72 + 0.28 * Math.sin(Math.PI * v)),
    0.52 * strokeWeight * (0.82 + 0.18 * Math.sin(Math.PI * v))
  );

  // Sweep folds the outer wing rearward for a forward-swimming pose. It is a
  // separate channel from `fold`, so the action library can blend propulsion,
  // banking and recovery instead of rotating the entire creature rigidly.
  const sweepWeight = anchoredU * Math.pow(u, 1.08);
  const sweep = new THREE.Vector3(
    -sign * 0.27 * sweepWeight,
    -0.64 * sweepWeight * (0.84 + 0.16 * (1 - v)),
    -0.36 * sweepWeight * (0.78 + 0.22 * Math.sin(Math.PI * v))
  );

  // Cup loads the outer-mid membrane the way a wing scoops water: the dorsal
  // shell lifts while the ventral shell drops, so the section thickens into a
  // shallow dish. The mask is fully anchored at the shoulder, which keeps the
  // wing root planted on the torso while the blade inflates. The common `bow`
  // term moves both shells together, so it shapes the silhouette without
  // disturbing the measured section thickness.
  const cupAnchor = THREE.MathUtils.smootherstep(u, 0.12, 0.58);
  const cupChord = Math.pow(Math.sin(Math.PI * v), 0.6);
  const cupMask = cupAnchor * cupChord * (0.55 + 0.45 * point.outerWeight);
  const cupInflation = CUP_INFLATION * cupMask;
  const cupBow = -CUP_BOW * cupMask * (0.5 + 0.5 * Math.cos(Math.PI * v));
  const cup = new THREE.Vector3(
    -sign * 0.02 * cupMask,
    -0.03 * cupMask * (0.6 + 0.4 * (1 - v)),
    surfaceSign * cupInflation + cupBow
  );

  return { fold, ripple, stroke, sweep, cup };
}

function appendQuad(indices, a, b, c, d) {
  indices.push(a, b, d, b, c, d);
}

/**
 * Builds one original, closed water-wing membrane.
 *
 * The geometry uses relative morph targets named `fold`, `ripple`, `stroke`,
 * `sweep` and `cup`, making it safe to animate before or after glTF export.
 * The left wing is generated directly rather than mirrored with a negative
 * scale.
 */
export function createWingGeometry({ side = 'right', seed = 0 } = {}) {
  const sign = sideSign(side);
  const numericSeed = Number.isFinite(seed) ? seed : 0;
  const saltedSeed = numericSeed + (sign < 0 ? 1.271 : 0.413);
  const rowSize = CHORD_SEGMENTS + 1;
  const surfaceVertexCount = (SPAN_SEGMENTS + 1) * rowSize;
  const points = [];

  for (let spanIndex = 0; spanIndex <= SPAN_SEGMENTS; spanIndex += 1) {
    const u = spanIndex / SPAN_SEGMENTS;
    for (let chordIndex = 0; chordIndex <= CHORD_SEGMENTS; chordIndex += 1) {
      const v = chordIndex / CHORD_SEGMENTS;
      points.push(createMembranePoint(u, v, sign, saltedSeed));
    }
  }

  const positions = [];
  const colors = [];
  const uvs = [];
  const foldDeltas = [];
  const rippleDeltas = [];
  const strokeDeltas = [];
  const sweepDeltas = [];
  const cupDeltas = [];
  const innerColor = new THREE.Color(0x69aab4);
  const edgeColor = new THREE.Color(0xddffff);
  const color = new THREE.Color();

  for (const surfaceSign of [1, -1]) {
    for (let spanIndex = 0; spanIndex <= SPAN_SEGMENTS; spanIndex += 1) {
      const u = spanIndex / SPAN_SEGMENTS;
      for (let chordIndex = 0; chordIndex <= CHORD_SEGMENTS; chordIndex += 1) {
        const v = chordIndex / CHORD_SEGMENTS;
        const point = points[spanIndex * rowSize + chordIndex];
        positions.push(point.x, point.y, point.z + surfaceSign * point.halfThickness);
        uvs.push(sign > 0 ? u : 1 - u, v);

        const brightness = THREE.MathUtils.clamp(
          0.18 + point.edgeWeight * 0.48 + point.outerWeight * 0.2,
          0,
          0.82
        );
        color.lerpColors(innerColor, edgeColor, brightness);
        colors.push(color.r, color.g, color.b);

        const morph = createMorphDeltas(point, u, v, sign, saltedSeed, surfaceSign);
        foldDeltas.push(morph.fold.x, morph.fold.y, morph.fold.z);
        rippleDeltas.push(morph.ripple.x, morph.ripple.y, morph.ripple.z);
        strokeDeltas.push(morph.stroke.x, morph.stroke.y, morph.stroke.z);
        sweepDeltas.push(morph.sweep.x, morph.sweep.y, morph.sweep.z);
        cupDeltas.push(morph.cup.x, morph.cup.y, morph.cup.z);
      }
    }
  }

  const indices = [];
  const topIndex = (spanIndex, chordIndex) => spanIndex * rowSize + chordIndex;
  const bottomIndex = (spanIndex, chordIndex) =>
    surfaceVertexCount + spanIndex * rowSize + chordIndex;

  for (let spanIndex = 0; spanIndex < SPAN_SEGMENTS; spanIndex += 1) {
    for (let chordIndex = 0; chordIndex < CHORD_SEGMENTS; chordIndex += 1) {
      const a = topIndex(spanIndex, chordIndex);
      const b = topIndex(spanIndex + 1, chordIndex);
      const c = topIndex(spanIndex + 1, chordIndex + 1);
      const d = topIndex(spanIndex, chordIndex + 1);
      appendQuad(indices, a, b, c, d);

      const ba = bottomIndex(spanIndex, chordIndex);
      const bb = bottomIndex(spanIndex + 1, chordIndex);
      const bc = bottomIndex(spanIndex + 1, chordIndex + 1);
      const bd = bottomIndex(spanIndex, chordIndex + 1);
      indices.push(ba, bd, bb, bb, bd, bc);
    }
  }

  // Counter-clockwise top perimeter. Each edge is bridged to the bottom
  // surface so the membrane has real side thickness in profile views.
  const perimeter = [];
  for (let spanIndex = 0; spanIndex <= SPAN_SEGMENTS; spanIndex += 1) {
    perimeter.push([spanIndex, 0]);
  }
  for (let chordIndex = 1; chordIndex <= CHORD_SEGMENTS; chordIndex += 1) {
    perimeter.push([SPAN_SEGMENTS, chordIndex]);
  }
  for (let spanIndex = SPAN_SEGMENTS - 1; spanIndex >= 0; spanIndex -= 1) {
    perimeter.push([spanIndex, CHORD_SEGMENTS]);
  }
  for (let chordIndex = CHORD_SEGMENTS - 1; chordIndex > 0; chordIndex -= 1) {
    perimeter.push([0, chordIndex]);
  }

  for (let index = 0; index < perimeter.length; index += 1) {
    const [aSpan, aChord] = perimeter[index];
    const [bSpan, bChord] = perimeter[(index + 1) % perimeter.length];
    const topA = topIndex(aSpan, aChord);
    const topB = topIndex(bSpan, bChord);
    const bottomA = bottomIndex(aSpan, aChord);
    const bottomB = bottomIndex(bSpan, bChord);
    indices.push(topA, bottomA, bottomB, topA, bottomB, topB);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = `waterwing-wing-${sign < 0 ? 'left' : 'right'}-geometry`;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.morphTargetsRelative = true;

  const foldAttribute = new THREE.Float32BufferAttribute(foldDeltas, 3);
  foldAttribute.name = 'fold';
  const rippleAttribute = new THREE.Float32BufferAttribute(rippleDeltas, 3);
  rippleAttribute.name = 'ripple';
  const strokeAttribute = new THREE.Float32BufferAttribute(strokeDeltas, 3);
  strokeAttribute.name = 'stroke';
  const sweepAttribute = new THREE.Float32BufferAttribute(sweepDeltas, 3);
  sweepAttribute.name = 'sweep';
  const cupAttribute = new THREE.Float32BufferAttribute(cupDeltas, 3);
  cupAttribute.name = 'cup';
  geometry.morphAttributes.position = [
    foldAttribute,
    rippleAttribute,
    strokeAttribute,
    sweepAttribute,
    cupAttribute
  ];

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.side = sign < 0 ? 'left' : 'right';
  geometry.userData.seed = numericSeed;
  geometry.userData.grid = [SPAN_SEGMENTS, CHORD_SEGMENTS];
  return geometry;
}

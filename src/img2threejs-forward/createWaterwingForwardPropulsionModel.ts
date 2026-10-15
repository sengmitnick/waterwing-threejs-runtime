import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

type SdfVector = readonly [number, number, number];
type SdfTransform = { position?: SdfVector; translation?: SdfVector; rotation?: SdfVector; scale?: SdfVector };
type SdfPrimitive = {
  readonly id: string;
  readonly type: 'sphere' | 'capsule' | 'box' | 'cone' | 'ellipsoid';
  readonly center?: SdfVector;
  readonly radius?: number | SdfVector;
  readonly height?: number;
  readonly size?: SdfVector;
  readonly dimensions?: SdfVector;
  readonly radii?: SdfVector;
  readonly transform?: SdfTransform;
};
type SdfOperation = {
  readonly id?: string;
  readonly output?: string;
  readonly type: 'smooth-union' | 'subtract' | 'intersect';
  readonly left: string;
  readonly right: string;
  readonly radius?: number;
};
type SdfDescriptor = {
  readonly primitives: readonly SdfPrimitive[];
  readonly operations?: readonly SdfOperation[];
  readonly resolution: number;
  readonly bounds?: { readonly min: SdfVector; readonly max: SdfVector };
};
type SdfFunction = (point: THREE.Vector3) => number;

function sdfSphere(point: THREE.Vector3, radius: number): number {
  return point.length() - radius;
}

function sdfCapsule(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const y = Math.max(-halfHeight, Math.min(halfHeight, point.y));
  return point.distanceTo(new THREE.Vector3(0, y, 0)) - radius;
}

function sdfBox(point: THREE.Vector3, size: SdfVector): number {
  const q = new THREE.Vector3(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
    .sub(new THREE.Vector3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5));
  return q.clone().max(new THREE.Vector3()).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function sdfCone(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (point.y + halfHeight) / height);
  return Math.max(Math.hypot(point.x, point.z) - Math.max(0, taper), Math.abs(point.y) - halfHeight);
}

function sdfEllipsoid(point: THREE.Vector3, radii: SdfVector): number {
  const scaled = new THREE.Vector3(point.x / radii[0], point.y / radii[1], point.z / radii[2]);
  return (scaled.length() - 1) * Math.min(radii[0], radii[1], radii[2]);
}

function sdfRadii(primitive: SdfPrimitive): SdfVector {
  const radius = primitive.radius;
  if (primitive.radii) return primitive.radii;
  if (typeof radius === 'number') return [radius, radius, radius];
  return radius ?? [0.5, 0.5, 0.5];
}

function smin(left: number, right: number, radius: number): number {
  const blend = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - blend * blend * radius * 0.25;
}

function sdfLocalPoint(point: THREE.Vector3, primitive: SdfPrimitive): { point: THREE.Vector3; scale: number } {
  const transform = primitive.transform;
  const translation = transform?.position ?? transform?.translation ?? primitive.center ?? [0, 0, 0];
  const rotation = transform?.rotation ?? [0, 0, 0];
  const scale = transform?.scale ?? [1, 1, 1];
  const local = point.clone().sub(new THREE.Vector3(translation[0], translation[1], translation[2]));
  const inverseRotation = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .invert();
  local.applyQuaternion(inverseRotation);
  local.set(local.x / scale[0], local.y / scale[1], local.z / scale[2]);
  return { point: local, scale: Math.min(scale[0], scale[1], scale[2]) };
}

function sdfPrimitive(point: THREE.Vector3, primitive: SdfPrimitive): number {
  const local = sdfLocalPoint(point, primitive);
  let distance: number;
  switch (primitive.type) {
    case 'sphere':
      distance = sdfSphere(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5);
      break;
    case 'capsule':
      distance = sdfCapsule(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.25, primitive.height ?? 1);
      break;
    case 'box':
      distance = sdfBox(local.point, primitive.size ?? primitive.dimensions ?? [1, 1, 1]);
      break;
    case 'cone':
      distance = sdfCone(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5, primitive.height ?? 1);
      break;
    case 'ellipsoid':
      distance = sdfEllipsoid(local.point, sdfRadii(primitive));
      break;
  }
  return distance * local.scale;
}

function sdfSample(descriptor: SdfDescriptor): SdfFunction {
  const nodes = new Map<string, SdfFunction>();
  for (const primitive of descriptor.primitives) nodes.set(primitive.id, (point) => sdfPrimitive(point, primitive));
  let result = descriptor.primitives.length > 0 ? nodes.get(descriptor.primitives[0].id) : undefined;
  for (let index = 0; index < (descriptor.operations?.length ?? 0); index += 1) {
    const operation = descriptor.operations?.[index];
    if (!operation) continue;
    const left = nodes.get(operation.left);
    const right = nodes.get(operation.right);
    if (!left || !right) continue;
    let combined: SdfFunction;
    switch (operation.type) {
      case 'smooth-union':
        combined = (point) => smin(left(point), right(point), operation.radius ?? 0.1);
        break;
      case 'subtract':
        combined = (point) => Math.max(left(point), -right(point));
        break;
      case 'intersect':
        combined = (point) => Math.max(left(point), right(point));
        break;
    }
    nodes.set(operation.id ?? operation.output ?? `operation-${index}`, combined);
    result = combined;
  }
  return result ?? (() => Infinity);
}

function polygonizeSdf(descriptor: SdfDescriptor): THREE.BufferGeometry {
  // SURFACE NETS, not a voxel shell.
  //
  // This used to emit one axis-aligned quad per exposed voxel face, which is a Minecraft surface:
  // every face is axis-aligned, every edge is a 90-degree step, and the result is stair-stepped at
  // exactly the scale of the sampling grid. For a subject whose whole identity is smooth blended
  // organic form -- which is the only kind of subject anyone reaches for an implicit surface to
  // build -- that is worse than the assembled primitives it was meant to replace.
  //
  // Naive surface nets places ONE vertex per sign-changing cell, at the average of the linearly
  // interpolated crossings on that cell's edges, and joins the four cells around each crossing
  // edge into a quad. It is compact, manifold, and smooth, and it is a natural fit for a field
  // that can be sampled anywhere rather than only at corners.
  //
  // Normals come from the field GRADIENT, not from face averaging: the gradient is the exact
  // surface normal of the implicit surface, so shading no longer carries the grid's imprint.
  const resolution = Math.max(4, Math.min(64, Math.floor(descriptor.resolution)));
  const defaultBounds: { readonly min: SdfVector; readonly max: SdfVector } = { min: [-2, -2, -2], max: [2, 2, 2] };
  const bounds = descriptor.bounds ?? defaultBounds;
  const min = new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]);
  const step = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / resolution,
    (bounds.max[1] - bounds.min[1]) / resolution,
    (bounds.max[2] - bounds.min[2]) / resolution,
  );
  const sample = sdfSample(descriptor);
  const scratch = new THREE.Vector3();

  // Corner grid: one more corner than cells on each axis.
  const side = resolution + 1;
  const field = new Float32Array(side * side * side);
  const cornerAt = (x: number, y: number, z: number): number => (z * side + y) * side + x;
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        scratch.set(min.x + x * step.x, min.y + y * step.y, min.z + z * step.z);
        field[cornerAt(x, y, z)] = sample(scratch);
      }
    }
  }

  // The 12 cell edges as corner-offset pairs.
  const CUBE_EDGES: readonly (readonly [number, number, number, number, number, number])[] = [
    [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
    [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 1, 1], [0, 1, 0, 0, 1, 1],
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cellVertex = new Int32Array(resolution * resolution * resolution).fill(-1);
  const cellAt = (x: number, y: number, z: number): number => (z * resolution + y) * resolution + x;

  // Central-difference gradient, stepped at a fraction of a cell so it follows the field rather
  // than the grid.
  const epsilon = Math.min(step.x, step.y, step.z) * 0.25;
  const gradient = (point: THREE.Vector3): THREE.Vector3 => {
    const gx = sample(scratch.set(point.x + epsilon, point.y, point.z))
      - sample(scratch.set(point.x - epsilon, point.y, point.z));
    const gy = sample(scratch.set(point.x, point.y + epsilon, point.z))
      - sample(scratch.set(point.x, point.y - epsilon, point.z));
    const gz = sample(scratch.set(point.x, point.y, point.z + epsilon))
      - sample(scratch.set(point.x, point.y, point.z - epsilon));
    const normal = new THREE.Vector3(gx, gy, gz);
    // A point where the field is flat has no defined normal; +Y is arbitrary but finite, and
    // leaving a zero vector would poison every lighting calculation downstream.
    return normal.lengthSq() < 1e-20 ? new THREE.Vector3(0, 1, 0) : normal.normalize();
  };

  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        let crossings = 0;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (const [ax, ay, az, bx, by, bz] of CUBE_EDGES) {
          const a = field[cornerAt(x + ax, y + ay, z + az)];
          const b = field[cornerAt(x + bx, y + by, z + bz)];
          if ((a <= 0) === (b <= 0)) continue;
          const t = a / (a - b);
          sumX += (ax + (bx - ax) * t);
          sumY += (ay + (by - ay) * t);
          sumZ += (az + (bz - az) * t);
          crossings += 1;
        }
        if (crossings === 0) continue;
        const px = min.x + (x + sumX / crossings) * step.x;
        const py = min.y + (y + sumY / crossings) * step.y;
        const pz = min.z + (z + sumZ / crossings) * step.z;
        cellVertex[cellAt(x, y, z)] = positions.length / 3;
        positions.push(px, py, pz);
        const normal = gradient(new THREE.Vector3(px, py, pz));
        normals.push(normal.x, normal.y, normal.z);
      }
    }
  }

  // One quad per sign-changing grid edge, joining the four cells that share it.
  //
  // Winding, worked out rather than guessed. For the +x edge from corner (x,y,z), the four cells
  // around it are (x, y-1, z-1), (x, y, z-1), (x, y, z), (x, y-1, z); in the (y,z) plane that
  // traversal is +y, +z, -y, whose cross product is +x. So when the corner is INSIDE and its
  // neighbour is outside, the unflipped order already faces out, and the flip belongs on the
  // opposite case. Getting this backwards is invisible in the normals -- those come from the
  // gradient and stay correct -- and shows only as back-face culling removing the front surface,
  // i.e. the model rendering as a hollow shell with its interior visible.
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  // Each quad joins the FOUR cells sharing one grid edge, so every one of those cells must exist.
  // Bounding only the edge axis and the lower end of the other two let y/z reach `resolution`, which
  // is a corner index, not a cell index: `cellAt` then strides into an unrelated slot (with
  // resolution 8, `cellAt(3, 8, 1)` is 131 -- the slot for cell (3, 0, 2)) or past the end of the
  // array, where a typed-array read yields `undefined`. `undefined < 0` is false, so the guard in
  // `quad` passed it through to `setIndex`, which coerces it to 0. Measured on a sphere reaching its
  // own bounds at resolution 8: 60 out-of-range reads and 108 aliased reads. A surface that touches
  // the sampling box is therefore left OPEN at that face rather than closed with wrong triangles --
  // pad `bounds` past the surface to get a closed mesh.
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const here = field[cornerAt(x, y, z)] <= 0;
        if (x + 1 < side && y > 0 && z > 0 && y < side - 1 && z < side - 1
          && here !== (field[cornerAt(x + 1, y, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x, y - 1, z - 1)], cellVertex[cellAt(x, y, z - 1)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y - 1, z)], !here,
          );
        }
        if (y + 1 < side && x > 0 && z > 0 && x < side - 1 && z < side - 1
          && here !== (field[cornerAt(x, y + 1, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y, z - 1)], cellVertex[cellAt(x - 1, y, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y, z - 1)], !here,
          );
        }
        if (z + 1 < side && x > 0 && y > 0 && x < side - 1 && y < side - 1
          && here !== (field[cornerAt(x, y, z + 1)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y - 1, z)], cellVertex[cellAt(x, y - 1, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x - 1, y, z)], !here,
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[]; bevelEnabled?: boolean; bevelThickness?: number; bevelSize?: number; bevelSegments?: number; curveSegments?: number; steps?: number }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: profile.bevelEnabled ?? false,
    bevelThickness: profile.bevelThickness ?? 0.04,
    bevelSize: profile.bevelSize ?? 0.03,
    bevelSegments: profile.bevelSegments ?? 3,
    curveSegments: profile.curveSegments ?? 12,
    steps: profile.steps ?? 1,
  });
}

type TaperedStation = { position: [number, number, number]; rx: number; rz: number; twist?: number };

// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep: { stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean },
): THREE.BufferGeometry {
  const stations = sweep.stations;
  if (stations.length < 2) throw new Error('tapered-sweep needs at least two stations');
  const radial = Math.max(3, sweep.radialSegments ?? 10);
  const centres = stations.map((s) => new THREE.Vector3(...s.position));

  const tangents = centres.map((_, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    // Coincident neighbours would normalise to NaN and poison every downstream vertex.
    return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
  });

  // Seed a reference axis that is not parallel to the first tangent, or the first cross
  // product is degenerate and the whole sweep collapses to a line.
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(1, 0, 0);

  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
  for (let i = 0; i < tangents.length; i += 1) {
    const t = tangents[i];
    // Project the carried frame back onto the plane perpendicular to this tangent.
    const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
    if (n.lengthSq() < 1e-12) {
      const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
    }
    n.normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
    carried = n;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const isPoint: boolean[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const st = stations[i];
    const v = i / (stations.length - 1);
    ringStart.push(positions.length / 3);
    // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
    // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
    // triangles, so the lock ends in a blunt cap the width of the floating-point noise
    // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
    if (st.rx <= 1e-6 && st.rz <= 1e-6) {
      isPoint.push(true);
      positions.push(centres[i].x, centres[i].y, centres[i].z);
      uvs.push(0.5, v);
      continue;
    }
    isPoint.push(false);
    const twist = ((st.twist ?? 0) * Math.PI) / 180;
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * Math.PI * 2 + twist;
      const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
        .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
      const p = centres[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, v);
    }
  }

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a0 = ringStart[i];
    const b0 = ringStart[i + 1];
    if (isPoint[i] && isPoint[i + 1]) continue;   // two collapsed stations bound nothing
    for (let j = 0; j < radial; j += 1) {
      // Wound so the face normal points radially OUTWARD.
      //
      // Ring vertices advance from `normal` toward `binormal`, and binormal is
      // tangent x normal, so increasing theta runs counter-clockwise seen from the
      // far end of the segment. Taking the ring-to-ring edge first therefore puts
      // the cross product on the inside. Measured as signed volume on the built
      // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
      // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
      // generator has ever emitted rendered its back faces, with normals pointing
      // into the solid and every lighting judgement made on the wrong surface.
      if (isPoint[i]) indices.push(a0, b0 + j + 1, b0 + j);
      else if (isPoint[i + 1]) indices.push(a0 + j, a0 + j + 1, b0);
      else indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
    }
  }

  if (sweep.capEnds ?? true) {
    for (const end of [0, stations.length - 1]) {
      if (isPoint[end]) continue;   // a point end is already closed
      const centreIndex = positions.length / 3;
      positions.push(centres[end].x, centres[end].y, centres[end].z);
      uvs.push(0.5, end === 0 ? 0 : 1);
      const base = ringStart[end];
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centreIndex, base + j + 1, base + j);
        else indices.push(centreIndex, base + j, base + j + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Waterwing Forward Propulsion
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createWaterwingForwardPropulsionModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Waterwing Forward Propulsion";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 34, "aspect": 0.8307692307692308, "orientation": {"yaw": -38, "pitch": -18, "roll": -4}, "positionHint": [-3.4, 2.5, 4.8], "note": "Locked comparison camera chosen from the bottom-right forward-propulsion turnaround view; projection is intentionally skipped."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "img2threejs/docs/materials/material-reference.json", "analysisArtifact": "./workflows/waterwing-forward/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "body", "regionId": "closed-water-shell", "specMaterialId": "water-shell", "profileId": "glass.clear", "status": "proceed"}, {"componentId": "wing-left", "regionId": "thick-wing-water", "specMaterialId": "wing-membrane", "profileId": "glass.frosted", "status": "proceed"}, {"componentId": "head-crown", "regionId": "near-white-wet-rim", "specMaterialId": "water-rim", "profileId": "glass.clear", "status": "proceed"}, {"componentId": "inner-water-vein", "regionId": "weak-inner-teal", "specMaterialId": "inner-water", "profileId": "glass.clear", "status": "proceed"}, {"componentId": "eye-left", "regionId": "cyan-eye-bead", "specMaterialId": "eye-cyan", "profileId": "gemstone.quartz", "status": "proceed"}], "controlledViewsRequired": ["backlight-transmission", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"], "agentCorrections": [{"scope": "all aqueous layers", "reason": "Canonical clear-glass priors are physically valid but erase the stylized creature on bright waterfall footage. Keep opacity at 1 and use bounded lower transmission plus image-derived blue-grey albedo for the approved game-art look.", "evidence": ["forward-ref", "front-ref", "light-background review requirement"]}, {"scope": "wing-membrane", "reason": "The reference wing remains visibly massive and glossy rather than uniformly frosted; reduce roughness from the generic frosted-glass prior while preserving independent roughness/normal maps.", "evidence": ["forward-ref", "three-quarter-ref", "rear-ref"]}]};
  root.userData.materialReferenceRegistry = "img2threejs/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["water-shell"] = createSculptMaterial(
    "water-shell",
    {"id": "water-shell", "name": "Blue-grey closed water shell", "type": "physical", "shaderModel": "MeshPhysicalMaterial / layered aqueous dielectric", "baseColor": "#6E96A8", "color": "#6E96A8", "albedo": {"dominant": "#6E96A8", "secondary": ["#315F73", "#D8F5FF"], "samplingNotes": "Sampled qualitatively from the isolated RGB reference; reference PBR extraction is wired in the next stage."}, "colorVariation": {"palette": ["#6E96A8", "#315F73", "#D8F5FF"], "pattern": "directional-flow-mottle", "amplitude": 0.11, "heightCorrelation": 0.18}, "textureResolution": 2048, "textureProjection": {"mode": "triplanar-object-space", "repeat": [1.5, 1.5], "anisotropy": 8, "texelDensityIntent": "Stable object-space frequency through the wing stroke."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.8, "amplitude": 0.24, "role": "broad depth tint and refraction gradient across each closed mass"}, {"id": "meso", "frequency": 11, "amplitude": 0.12, "role": "directional flowing water striations aligned with propulsion"}, {"id": "micro", "frequency": 58, "amplitude": 0.035, "role": "small wet highlight breakup without opaque noise"}], "roughness": {"base": 0.18, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "lower on wet rims, slightly higher in deep blue-grey body zones"}, "metalness": {"base": 0, "variation": 0}, "clearcoat": {"base": 0.74}, "clearcoatRoughness": {"base": 0.10450000000000001}, "transmission": {"base": 0.42, "variation": 0}, "ior": {"base": 1.5, "variation": 0}, "thickness": {"base": 0.46}, "attenuationDistance": {"base": 2.4}, "attenuationColor": "#315F73", "specularF0": {"base": 0.82}, "envMapIntensity": 1.15, "emissive": "#000000", "emissiveIntensity": {"base": 0}, "opacity": {"base": 1}, "normal": {"pattern": "independent directional aqueous height field", "strength": 0.22, "scale": 30, "space": "tangent"}, "bump": {"pattern": "micro ripple field", "amplitude": 0.018, "scale": 46}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.14, "contactShadowBias": 0.2, "notes": "Only liquid root overlaps darken; water edges remain bright."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1D3944"}, "localOverrides": [{"id": "tail-wet-rim", "region": "tail outer edge", "roughness": 0.06, "clearcoat": 1, "evidenceRefs": ["forward-ref"]}, {"id": "dorsal-wet-rim", "region": "upper body crest", "roughness": 0.07, "clearcoat": 0.95, "evidenceRefs": ["forward-ref"]}, {"id": "right-wing-wet-rim", "region": "right wing trailing/tip edge", "roughness": 0.06, "clearcoat": 1, "evidenceRefs": ["forward-ref"]}, {"id": "head-wet-rim", "region": "brow and snout perimeter", "roughness": 0.05, "clearcoat": 1, "evidenceRefs": ["forward-ref"]}], "shaderNotes": ["Closed geometry is mandatory so transmission has thickness and the side view never collapses into a card.", "Use environment reflection plus a restrained near-white Fresnel rim; do not lower opacity to fake water.", "Keep albedo, roughness, height, normal, and AO independent; no channel re-use."], "notes": "Stylized real-time water, designed to remain legible over both dark rock and bright waterfall footage.", "referenceMaterialId": "glass.clear", "materialFamily": "glass", "materialSubtype": "clear", "materialFinish": "polished", "materialReference": {"registry": "img2threejs/docs/materials/material-reference.json", "profileId": "glass.clear", "method": "explicit-material-id", "confidence": 1, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.transmission", "khronos.volume", "google.filament-pbr"], "requiredMaps": ["roughnessMap", "thicknessMap"], "optionalMaps": ["map", "normalMap", "transmissionMap"], "validationViews": ["neutral-studio", "environment-reflection", "backlight-transmission", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "./workflows/waterwing-forward/material-evidence/00-closed-water-shell.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_albedo.png", "url": "/waterwing-forward-materials/water-shell_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_roughness.png", "url": "/waterwing-forward-materials/water-shell_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_height.png", "url": "/waterwing-forward-materials/water-shell_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_normal.png", "url": "/waterwing-forward-materials/water-shell_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_ao.png", "url": "/waterwing-forward-materials/water-shell_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 315, "sourceHeight": 375, "mapSize": 512, "cropBBoxPixels": {"x": 5, "y": 0, "width": 310, "height": 375}, "mask": {"backgroundColor": "#000000", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.6672}, "mapStats": {"valueRange": 0.5075, "heightP90Gradient": 0.1425, "roughnessBase": 0.72, "roughnessVariation": 0.205, "normalStrength": 0.323, "blurRadius": 10}, "palette": ["#446776", "#5A7B8B", "#355665", "#7D9CA9", "#C1D6DE"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0, "procedural": "gradient-smoke"}, "palette": ["#010202", "#47636E", "#45616C", "#3B4F59", "#2C3A41"], "paletteHueRisk": [{"stop": "#47636E", "hueRisk": "blue-collapse", "suggestedRgb": [110, 99, 71]}, {"stop": "#45616C", "hueRisk": "blue-collapse", "suggestedRgb": [108, 97, 69]}, {"stop": "#3B4F59", "hueRisk": "blue-collapse", "suggestedRgb": [89, 79, 59]}, {"stop": "#2C3A41", "hueRisk": "blue-collapse", "suggestedRgb": [65, 58, 44]}], "gradientAxis": "horizontal", "stats": {"meanLum": 78.4, "meanSaturation": 0.249, "gradientStrength": 0.374, "mottle": 0.073, "streakRatio": 1.1, "hueSpread": 0.001, "specularFraction": 0.009}}, "materialEvidence": {"componentId": "body", "regionId": "closed-water-shell", "crop": {"path": "./workflows/waterwing-forward/material-evidence/00-closed-water-shell.png", "bbox": {"x": 45, "y": 260, "width": 315, "height": 375}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.3365}, "observations": ["chromatic base-colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "body", "regionId": "closed-water-shell", "materialId": "glass.clear", "family": "glass", "subtype": "clear", "finish": "polished", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["wing-membrane"] = createSculptMaterial(
    "wing-membrane",
    {"id": "wing-membrane", "name": "Thick propulsion-wing water", "type": "physical", "shaderModel": "MeshPhysicalMaterial / layered aqueous dielectric", "baseColor": "#789EAD", "color": "#789EAD", "albedo": {"dominant": "#789EAD", "secondary": ["#3E7183", "#D8F5FF"], "samplingNotes": "Sampled qualitatively from the isolated RGB reference; reference PBR extraction is wired in the next stage."}, "colorVariation": {"palette": ["#789EAD", "#3E7183", "#D8F5FF"], "pattern": "directional-flow-mottle", "amplitude": 0.11, "heightCorrelation": 0.18}, "textureResolution": 2048, "textureProjection": {"mode": "triplanar-object-space", "repeat": [1.5, 1.5], "anisotropy": 8, "texelDensityIntent": "Stable object-space frequency through the wing stroke."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.8, "amplitude": 0.24, "role": "broad depth tint and refraction gradient across each closed mass"}, {"id": "meso", "frequency": 11, "amplitude": 0.12, "role": "directional flowing water striations aligned with propulsion"}, {"id": "micro", "frequency": 58, "amplitude": 0.035, "role": "small wet highlight breakup without opaque noise"}], "roughness": {"base": 0.24, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "lower on wet rims, slightly higher in deep blue-grey body zones"}, "metalness": {"base": 0, "variation": 0}, "clearcoat": {"base": 0.62}, "clearcoatRoughness": {"base": 0.12650000000000003}, "transmission": {"base": 0.34, "variation": 0}, "ior": {"base": 1.5, "variation": 0}, "thickness": {"base": 0.32}, "attenuationDistance": {"base": 2.4}, "attenuationColor": "#3E7183", "specularF0": {"base": 0.82}, "envMapIntensity": 1.15, "emissive": "#000000", "emissiveIntensity": {"base": 0}, "opacity": {"base": 1}, "normal": {"pattern": "independent directional aqueous height field", "strength": 0.22, "scale": 30, "space": "tangent"}, "bump": {"pattern": "micro ripple field", "amplitude": 0.018, "scale": 46}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.14, "contactShadowBias": 0.2, "notes": "Only liquid root overlaps darken; water edges remain bright."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1D3944"}, "localOverrides": [{"id": "flow-striation-left", "region": "left wing root-to-tip flow paths", "roughness": 0.12, "normalStrength": 0.3, "direction": "root-to-tip", "evidenceRefs": ["forward-ref"]}, {"id": "flow-striation-right", "region": "right wing root-to-tip flow paths", "roughness": 0.13, "normalStrength": 0.28, "direction": "root-to-tip", "evidenceRefs": ["forward-ref"]}], "shaderNotes": ["Closed geometry is mandatory so transmission has thickness and the side view never collapses into a card.", "Use environment reflection plus a restrained near-white Fresnel rim; do not lower opacity to fake water.", "Keep albedo, roughness, height, normal, and AO independent; no channel re-use."], "notes": "Stylized real-time water, designed to remain legible over both dark rock and bright waterfall footage.", "referenceMaterialId": "glass.frosted", "materialFamily": "glass", "materialSubtype": "frosted", "materialFinish": "rough-transmissive", "materialReference": {"registry": "img2threejs/docs/materials/material-reference.json", "profileId": "glass.frosted", "method": "explicit-material-id", "confidence": 1, "sourceRefs": ["three.mesh-physical", "three.pmrem", "khronos.transmission", "khronos.volume", "google.filament-pbr"], "requiredMaps": ["roughnessMap", "normalMap", "thicknessMap"], "optionalMaps": ["transmissionMap", "map"], "validationViews": ["neutral-studio", "grazing", "backlight-transmission", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "./workflows/waterwing-forward/material-evidence/01-thick-wing-water.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "./workflows/waterwing-forward/material-evidence/pbr-01-thick-wing-water/wing-membrane_albedo.png", "url": "/waterwing-forward-materials/wing-membrane_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "./workflows/waterwing-forward/material-evidence/pbr-01-thick-wing-water/wing-membrane_roughness.png", "url": "/waterwing-forward-materials/wing-membrane_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "./workflows/waterwing-forward/material-evidence/pbr-01-thick-wing-water/wing-membrane_height.png", "url": "/waterwing-forward-materials/wing-membrane_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "./workflows/waterwing-forward/material-evidence/pbr-01-thick-wing-water/wing-membrane_normal.png", "url": "/waterwing-forward-materials/wing-membrane_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "./workflows/waterwing-forward/material-evidence/pbr-01-thick-wing-water/wing-membrane_ao.png", "url": "/waterwing-forward-materials/wing-membrane_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 400, "sourceHeight": 365, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 390, "height": 365}, "mask": {"backgroundColor": "#000000", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.5698}, "mapStats": {"valueRange": 0.5031, "heightP90Gradient": 0.1418, "roughnessBase": 0.715, "roughnessVariation": 0.208, "normalStrength": 0.322, "blurRadius": 10}, "palette": ["#436473", "#5A7A89", "#334F5E", "#7E9AA8", "#BED3DC"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0, "procedural": "gradient-smoke"}, "palette": ["#0C1113", "#313E45", "#546D7A", "#354A54", "#1D2A30"], "paletteHueRisk": [{"stop": "#0C1113", "hueRisk": "blue-collapse", "suggestedRgb": [19, 17, 12]}, {"stop": "#313E45", "hueRisk": "blue-collapse", "suggestedRgb": [69, 62, 49]}, {"stop": "#546D7A", "hueRisk": "blue-collapse", "suggestedRgb": [122, 109, 84]}, {"stop": "#354A54", "hueRisk": "blue-collapse", "suggestedRgb": [84, 74, 53]}, {"stop": "#1D2A30", "hueRisk": "blue-collapse", "suggestedRgb": [48, 42, 29]}], "gradientAxis": "vertical", "stats": {"meanLum": 67.4, "meanSaturation": 0.211, "gradientStrength": 0.418, "mottle": 0.077, "streakRatio": 1.08, "hueSpread": 0.001, "specularFraction": 0.005}}, "materialEvidence": {"componentId": "wing-left", "regionId": "thick-wing-water", "crop": {"path": "./workflows/waterwing-forward/material-evidence/01-thick-wing-water.png", "bbox": {"x": 105, "y": 165, "width": 400, "height": 365}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.416}, "observations": ["chromatic base-colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "wing-left", "regionId": "thick-wing-water", "materialId": "glass.frosted", "family": "glass", "subtype": "frosted", "finish": "wet-satin", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["water-rim"] = createSculptMaterial(
    "water-rim",
    {"id": "water-rim", "name": "Near-white wet edge volume", "type": "physical", "shaderModel": "MeshPhysicalMaterial / layered aqueous dielectric", "baseColor": "#D4F4FF", "color": "#D4F4FF", "albedo": {"dominant": "#D4F4FF", "secondary": ["#8BD8EC", "#D8F5FF"], "samplingNotes": "Sampled qualitatively from the isolated RGB reference; reference PBR extraction is wired in the next stage."}, "colorVariation": {"palette": ["#D4F4FF", "#8BD8EC", "#D8F5FF"], "pattern": "directional-flow-mottle", "amplitude": 0.11, "heightCorrelation": 0.18}, "textureResolution": 2048, "textureProjection": {"mode": "triplanar-object-space", "repeat": [1.5, 1.5], "anisotropy": 8, "texelDensityIntent": "Stable object-space frequency through the wing stroke."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.8, "amplitude": 0.24, "role": "broad depth tint and refraction gradient across each closed mass"}, {"id": "meso", "frequency": 11, "amplitude": 0.12, "role": "directional flowing water striations aligned with propulsion"}, {"id": "micro", "frequency": 58, "amplitude": 0.035, "role": "small wet highlight breakup without opaque noise"}], "roughness": {"base": 0.07, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "lower on wet rims, slightly higher in deep blue-grey body zones"}, "metalness": {"base": 0, "variation": 0}, "clearcoat": {"base": 0.95}, "clearcoatRoughness": {"base": 0.04}, "transmission": {"base": 0.18, "variation": 0}, "ior": {"base": 1.5, "variation": 0}, "thickness": {"base": 0.08}, "attenuationDistance": {"base": 2.4}, "attenuationColor": "#8BD8EC", "specularF0": {"base": 0.82}, "envMapIntensity": 1.15, "emissive": "#2A7E91", "emissiveIntensity": {"base": 0.08}, "opacity": {"base": 1}, "normal": {"pattern": "independent directional aqueous height field", "strength": 0.22, "scale": 30, "space": "tangent"}, "bump": {"pattern": "micro ripple field", "amplitude": 0.018, "scale": 46}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.14, "contactShadowBias": 0.2, "notes": "Only liquid root overlaps darken; water edges remain bright."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1D3944"}, "localOverrides": [], "shaderNotes": ["Closed geometry is mandatory so transmission has thickness and the side view never collapses into a card.", "Use environment reflection plus a restrained near-white Fresnel rim; do not lower opacity to fake water.", "Keep albedo, roughness, height, normal, and AO independent; no channel re-use."], "notes": "Stylized real-time water, designed to remain legible over both dark rock and bright waterfall footage.", "referenceMaterialId": "glass.clear", "materialFamily": "glass", "materialSubtype": "clear", "materialFinish": "polished", "materialReference": {"registry": "img2threejs/docs/materials/material-reference.json", "profileId": "glass.clear", "method": "explicit-material-id", "confidence": 1, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.transmission", "khronos.volume", "google.filament-pbr"], "requiredMaps": ["roughnessMap", "thicknessMap"], "optionalMaps": ["map", "normalMap", "transmissionMap"], "validationViews": ["neutral-studio", "environment-reflection", "backlight-transmission", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "./workflows/waterwing-forward/material-evidence/02-near-white-wet-rim.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "./workflows/waterwing-forward/material-evidence/pbr-02-near-white-wet-rim/water-rim_albedo.png", "url": "/waterwing-forward-materials/water-rim_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "./workflows/waterwing-forward/material-evidence/pbr-02-near-white-wet-rim/water-rim_roughness.png", "url": "/waterwing-forward-materials/water-rim_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "./workflows/waterwing-forward/material-evidence/pbr-02-near-white-wet-rim/water-rim_height.png", "url": "/waterwing-forward-materials/water-rim_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "./workflows/waterwing-forward/material-evidence/pbr-02-near-white-wet-rim/water-rim_normal.png", "url": "/waterwing-forward-materials/water-rim_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "./workflows/waterwing-forward/material-evidence/pbr-02-near-white-wet-rim/water-rim_ao.png", "url": "/waterwing-forward-materials/water-rim_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 455, "sourceHeight": 420, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 441, "height": 420}, "mask": {"backgroundColor": "#000000", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.5083}, "mapStats": {"valueRange": 0.5167, "heightP90Gradient": 0.1344, "roughnessBase": 0.705, "roughnessVariation": 0.204, "normalStrength": 0.314, "blurRadius": 10}, "palette": ["#5A7A8A", "#436574", "#335260", "#7F9CAA", "#C2D6DE"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0, "procedural": "gradient-smoke"}, "palette": ["#06090B", "#496470", "#364850", "#2B363D", "#030405"], "paletteHueRisk": [{"stop": "#06090B", "hueRisk": "blue-collapse", "suggestedRgb": [11, 9, 6]}, {"stop": "#496470", "hueRisk": "blue-collapse", "suggestedRgb": [112, 100, 73]}, {"stop": "#364850", "hueRisk": "blue-collapse", "suggestedRgb": [80, 72, 54]}, {"stop": "#2B363D", "hueRisk": "blue-collapse", "suggestedRgb": [61, 54, 43]}, {"stop": "#030405", "hueRisk": "blue-collapse", "suggestedRgb": [5, 4, 3]}], "gradientAxis": "horizontal", "stats": {"meanLum": 61.2, "meanSaturation": 0.187, "gradientStrength": 0.389, "mottle": 0.076, "streakRatio": 1.17, "hueSpread": 0.001, "specularFraction": 0.006}}, "materialEvidence": {"componentId": "head-crown", "regionId": "near-white-wet-rim", "crop": {"path": "./workflows/waterwing-forward/material-evidence/02-near-white-wet-rim.png", "bbox": {"x": 55, "y": 205, "width": 455, "height": 420}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.5444}, "observations": ["chromatic base-colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "head-crown", "regionId": "near-white-wet-rim", "materialId": "glass.clear", "family": "glass", "subtype": "clear", "finish": "polished", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["inner-water"] = createSculptMaterial(
    "inner-water",
    {"id": "inner-water", "name": "Weak teal internal flow", "type": "physical", "shaderModel": "MeshPhysicalMaterial / layered aqueous dielectric", "baseColor": "#246F82", "color": "#246F82", "albedo": {"dominant": "#246F82", "secondary": ["#164957", "#D8F5FF"], "samplingNotes": "Sampled qualitatively from the isolated RGB reference; reference PBR extraction is wired in the next stage."}, "colorVariation": {"palette": ["#246F82", "#164957", "#D8F5FF"], "pattern": "directional-flow-mottle", "amplitude": 0.11, "heightCorrelation": 0.18}, "textureResolution": 2048, "textureProjection": {"mode": "triplanar-object-space", "repeat": [1.5, 1.5], "anisotropy": 8, "texelDensityIntent": "Stable object-space frequency through the wing stroke."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.8, "amplitude": 0.24, "role": "broad depth tint and refraction gradient across each closed mass"}, {"id": "meso", "frequency": 11, "amplitude": 0.12, "role": "directional flowing water striations aligned with propulsion"}, {"id": "micro", "frequency": 58, "amplitude": 0.035, "role": "small wet highlight breakup without opaque noise"}], "roughness": {"base": 0.24, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "lower on wet rims, slightly higher in deep blue-grey body zones"}, "metalness": {"base": 0, "variation": 0}, "clearcoat": {"base": 0.25}, "clearcoatRoughness": {"base": 0.14300000000000002}, "transmission": {"base": 0.26, "variation": 0}, "ior": {"base": 1.5, "variation": 0}, "thickness": {"base": 0.12}, "attenuationDistance": {"base": 2.4}, "attenuationColor": "#164957", "specularF0": {"base": 0.82}, "envMapIntensity": 1.15, "emissive": "#1A8195", "emissiveIntensity": {"base": 0.12}, "opacity": {"base": 1}, "normal": {"pattern": "independent directional aqueous height field", "strength": 0.22, "scale": 30, "space": "tangent"}, "bump": {"pattern": "micro ripple field", "amplitude": 0.018, "scale": 46}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.14, "contactShadowBias": 0.2, "notes": "Only liquid root overlaps darken; water edges remain bright."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1D3944"}, "localOverrides": [{"id": "weak-teal-vein", "region": "deep centerline inside body", "emissive": "#24A5B7", "emissiveIntensity": 0.12, "evidenceRefs": ["forward-ref"]}], "shaderNotes": ["Closed geometry is mandatory so transmission has thickness and the side view never collapses into a card.", "Use environment reflection plus a restrained near-white Fresnel rim; do not lower opacity to fake water.", "Keep albedo, roughness, height, normal, and AO independent; no channel re-use."], "notes": "Stylized real-time water, designed to remain legible over both dark rock and bright waterfall footage.", "referenceMaterialId": "glass.clear", "materialFamily": "glass", "materialSubtype": "clear", "materialFinish": "polished", "materialReference": {"registry": "img2threejs/docs/materials/material-reference.json", "profileId": "glass.clear", "method": "explicit-material-id", "confidence": 1, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.transmission", "khronos.volume", "google.filament-pbr"], "requiredMaps": ["roughnessMap", "thicknessMap"], "optionalMaps": ["map", "normalMap", "transmissionMap"], "validationViews": ["neutral-studio", "environment-reflection", "backlight-transmission", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "./workflows/waterwing-forward/material-evidence/03-weak-inner-teal.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "./workflows/waterwing-forward/material-evidence/pbr-03-weak-inner-teal/inner-water_albedo.png", "url": "/waterwing-forward-materials/inner-water_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "./workflows/waterwing-forward/material-evidence/pbr-03-weak-inner-teal/inner-water_roughness.png", "url": "/waterwing-forward-materials/inner-water_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "./workflows/waterwing-forward/material-evidence/pbr-03-weak-inner-teal/inner-water_height.png", "url": "/waterwing-forward-materials/inner-water_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "./workflows/waterwing-forward/material-evidence/pbr-03-weak-inner-teal/inner-water_normal.png", "url": "/waterwing-forward-materials/inner-water_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "./workflows/waterwing-forward/material-evidence/pbr-03-weak-inner-teal/inner-water_ao.png", "url": "/waterwing-forward-materials/inner-water_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 235, "sourceHeight": 245, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 235, "height": 245}, "mask": {"backgroundColor": "#668191", "backgroundNoise": 97.211, "transparentPixelFraction": 0, "foregroundCoverage": 0.7536}, "mapStats": {"valueRange": 0.3235, "heightP90Gradient": 0.14151, "roughnessBase": 0.74, "roughnessVariation": 0.209, "normalStrength": 0.322, "blurRadius": 10}, "palette": ["#527383", "#426474", "#698998", "#355563", "#93B1BD"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0, "procedural": "gradient-smoke"}, "palette": ["#658492", "#577988", "#466371", "#374D56", "#0F1315"], "paletteHueRisk": [{"stop": "#658492", "hueRisk": "blue-collapse", "suggestedRgb": [146, 132, 101]}, {"stop": "#577988", "hueRisk": "blue-collapse", "suggestedRgb": [136, 121, 87]}, {"stop": "#466371", "hueRisk": "blue-collapse", "suggestedRgb": [113, 99, 70]}, {"stop": "#374D56", "hueRisk": "blue-collapse", "suggestedRgb": [86, 77, 55]}, {"stop": "#0F1315", "hueRisk": "blue-collapse", "suggestedRgb": [21, 19, 15]}], "gradientAxis": "vertical", "stats": {"meanLum": 88.6, "meanSaturation": 0.295, "gradientStrength": 0.46, "mottle": 0.057, "streakRatio": 0.96, "hueSpread": 0.001, "specularFraction": 0.008}}, "materialEvidence": {"componentId": "inner-water-vein", "regionId": "weak-inner-teal", "crop": {"path": "./workflows/waterwing-forward/material-evidence/03-weak-inner-teal.png", "bbox": {"x": 150, "y": 315, "width": 235, "height": 245}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.164}, "observations": ["chromatic base-colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "inner-water-vein", "regionId": "weak-inner-teal", "materialId": "glass.clear", "family": "glass", "subtype": "clear", "finish": "tinted-transmissive", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["eye-cyan"] = createSculptMaterial(
    "eye-cyan",
    {"id": "eye-cyan", "name": "Restrained cyan eye bead", "type": "physical", "shaderModel": "MeshPhysicalMaterial / layered aqueous dielectric", "baseColor": "#68E9F2", "color": "#68E9F2", "albedo": {"dominant": "#68E9F2", "secondary": ["#167C8D", "#D8F5FF"], "samplingNotes": "Sampled qualitatively from the isolated RGB reference; reference PBR extraction is wired in the next stage."}, "colorVariation": {"palette": ["#68E9F2", "#167C8D", "#D8F5FF"], "pattern": "directional-flow-mottle", "amplitude": 0.11, "heightCorrelation": 0.18}, "textureResolution": 2048, "textureProjection": {"mode": "triplanar-object-space", "repeat": [1.5, 1.5], "anisotropy": 8, "texelDensityIntent": "Stable object-space frequency through the wing stroke."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.8, "amplitude": 0.24, "role": "broad depth tint and refraction gradient across each closed mass"}, {"id": "meso", "frequency": 11, "amplitude": 0.12, "role": "directional flowing water striations aligned with propulsion"}, {"id": "micro", "frequency": 58, "amplitude": 0.035, "role": "small wet highlight breakup without opaque noise"}], "roughness": {"base": 0.08, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "lower on wet rims, slightly higher in deep blue-grey body zones"}, "metalness": {"base": 0, "variation": 0}, "clearcoat": {"base": 1}, "clearcoatRoughness": {"base": 0.044000000000000004}, "transmission": {"base": 0.32, "variation": 0}, "ior": {"base": 1.54, "variation": 0}, "thickness": {"base": 0.04}, "attenuationDistance": {"base": 2.4}, "attenuationColor": "#167C8D", "specularF0": {"base": 0.82}, "envMapIntensity": 1.15, "emissive": "#37CAD7", "emissiveIntensity": {"base": 0.65}, "opacity": {"base": 1}, "normal": {"pattern": "independent directional aqueous height field", "strength": 0.22, "scale": 30, "space": "tangent"}, "bump": {"pattern": "micro ripple field", "amplitude": 0.018, "scale": 46}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.14, "contactShadowBias": 0.2, "notes": "Only liquid root overlaps darken; water edges remain bright."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1D3944"}, "localOverrides": [{"id": "eye-glow", "region": "small eye orb only", "emissive": "#62F1F4", "emissiveIntensity": 0.75, "evidenceRefs": ["forward-ref", "front-ref"]}], "shaderNotes": ["Closed geometry is mandatory so transmission has thickness and the side view never collapses into a card.", "Use environment reflection plus a restrained near-white Fresnel rim; do not lower opacity to fake water.", "Keep albedo, roughness, height, normal, and AO independent; no channel re-use."], "notes": "Stylized real-time water, designed to remain legible over both dark rock and bright waterfall footage.", "referenceMaterialId": "gemstone.quartz", "materialFamily": "gemstone", "materialSubtype": "quartz-like", "materialFinish": "polished", "materialReference": {"registry": "img2threejs/docs/materials/material-reference.json", "profileId": "gemstone.quartz", "method": "explicit-material-id", "confidence": 1, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.transmission", "khronos.volume", "google.filament-pbr"], "requiredMaps": ["roughnessMap", "thicknessMap"], "optionalMaps": ["map", "normalMap", "transmissionMap"], "validationViews": ["neutral-studio", "environment-reflection", "backlight-transmission", "reference-beauty"]}, "dispersion": {"base": 0, "variation": 0}, "referencePbr": {"version": "1.0", "sourceImage": "./workflows/waterwing-forward/material-evidence/04-cyan-eye-bead.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.795, "estimatedFidelity": 0.795, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "./workflows/waterwing-forward/material-evidence/pbr-04-cyan-eye-bead/eye-cyan_albedo.png", "url": "/waterwing-forward-materials/eye-cyan_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "./workflows/waterwing-forward/material-evidence/pbr-04-cyan-eye-bead/eye-cyan_roughness.png", "url": "/waterwing-forward-materials/eye-cyan_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "./workflows/waterwing-forward/material-evidence/pbr-04-cyan-eye-bead/eye-cyan_height.png", "url": "/waterwing-forward-materials/eye-cyan_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "./workflows/waterwing-forward/material-evidence/pbr-04-cyan-eye-bead/eye-cyan_normal.png", "url": "/waterwing-forward-materials/eye-cyan_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "./workflows/waterwing-forward/material-evidence/pbr-04-cyan-eye-bead/eye-cyan_ao.png", "url": "/waterwing-forward-materials/eye-cyan_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 125, "sourceHeight": 120, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 125, "height": 120}, "mask": {"backgroundColor": "#446D7E", "backgroundNoise": 179.947, "transparentPixelFraction": 0, "foregroundCoverage": 0.9216}, "mapStats": {"valueRange": 0.3426, "heightP90Gradient": 0.09096, "roughnessBase": 0.701, "roughnessVariation": 0.148, "normalStrength": 0.263, "blurRadius": 10}, "palette": ["#365C6B", "#315361", "#416978", "#5D8593", "#8CAFBA"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0, "roughness": 0.5, "clearcoat": 1, "clearcoatRoughness": 0.05, "transmission": 0, "ior": 1.5, "envMapIntensity": 1, "anisotropy": 0, "procedural": "flat-clearcoat"}, "palette": ["#7497A5", "#3A5F6E", "#3D6371", "#3E5E6B", "#405E68"], "paletteHueRisk": [{"stop": "#7497A5", "hueRisk": "blue-collapse", "suggestedRgb": [165, 151, 116]}, {"stop": "#3A5F6E", "hueRisk": "blue-collapse", "suggestedRgb": [110, 95, 58]}, {"stop": "#3D6371", "hueRisk": "blue-collapse", "suggestedRgb": [113, 99, 61]}, {"stop": "#3E5E6B", "hueRisk": "blue-collapse", "suggestedRgb": [107, 94, 62]}, {"stop": "#405E68", "hueRisk": "blue-collapse", "suggestedRgb": [104, 94, 64]}], "gradientAxis": "horizontal", "stats": {"meanLum": 93.5, "meanSaturation": 0.416, "gradientStrength": 0.254, "mottle": 0.035, "streakRatio": 1.1, "hueSpread": 0.001, "specularFraction": 0.002}}, "materialEvidence": {"componentId": "eye-left", "regionId": "cyan-eye-bead", "crop": {"path": "./workflows/waterwing-forward/material-evidence/04-cyan-eye-bead.png", "bbox": {"x": 65, "y": 465, "width": 125, "height": 120}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.0427}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "eye-left", "regionId": "cyan-eye-bead", "materialId": "gemstone.quartz", "family": "gemstone", "subtype": "quartz-like", "finish": "polished", "aliases": [], "confidence": 0.795, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_body_0 = makeAttachmentEndpoint(null);
  const node_body_0 = new THREE.Group();
  node_body_0.name = "Waterwing body mass__pivot";
  node_body_0.scale.set(1, 1, 1);
  if (endpoint_body_0) {
    node_body_0.position.copy(endpoint_body_0.start);
    node_body_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_body_0.position.set(0.0, 0.0, 0.0);
    node_body_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_body_0.userData.sculptComponent = {"id": "body", "name": "Waterwing body mass", "level": "macro", "role": "body", "importance": 1, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "The pointed head, chest and tapering rear are one closed smoothly varying water volume with no seams, implemented as a smooth-union SDF.", "geometryDescriptor": {"topologyIntent": "The pointed head, chest and tapering rear are one closed smoothly varying water volume with no seams, implemented as a smooth-union SDF.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "sdf": {"primitives": [{"id": "snout", "type": "ellipsoid", "center": [0, -0.125, 1.66], "radii": [0.085, 0.09, 0.38]}, {"id": "brow", "type": "ellipsoid", "center": [0, -0.035, 1.18], "radii": [0.32, 0.31, 0.56]}, {"id": "chest", "type": "ellipsoid", "center": [0, 0.02, 0.4], "radii": [0.45, 0.44, 0.8]}, {"id": "waist", "type": "ellipsoid", "center": [0, 0.045, -0.34], "radii": [0.35, 0.365, 0.68]}, {"id": "tail-base", "type": "ellipsoid", "center": [0, 0.04, -0.9], "radii": [0.2, 0.21, 0.48]}, {"id": "shoulder-left", "type": "ellipsoid", "center": [-0.255, -0.025, 0.76], "radii": [0.29, 0.31, 0.46]}, {"id": "shoulder-right", "type": "ellipsoid", "center": [0.245, 0.025, 0.47], "radii": [0.29, 0.31, 0.46]}], "operations": [{"id": "brow-snout", "type": "smooth-union", "left": "brow", "right": "snout", "radius": 0.14}, {"id": "front-mass", "type": "smooth-union", "left": "brow-snout", "right": "chest", "radius": 0.24}, {"id": "body-mass", "type": "smooth-union", "left": "front-mass", "right": "waist", "radius": 0.25}, {"id": "body-final", "type": "smooth-union", "left": "body-mass", "right": "tail-base", "radius": 0.16}, {"id": "body-with-left-shoulder", "type": "smooth-union", "left": "body-final", "right": "shoulder-left", "radius": 0.2}, {"id": "body-with-shoulders", "type": "smooth-union", "left": "body-with-left-shoulder", "right": "shoulder-right", "radius": 0.2}], "resolution": 56, "bounds": {"min": [-0.76, -0.6, -1.5], "max": [0.76, 0.62, 2.12]}}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "water-shell", "materialLayers": ["water-shell", "inner-water"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.86}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wing-left-socket", "localPosition": [-0.36, -0.09, 0.48], "localRotation": [0, 0, 0]}, {"id": "wing-right-socket", "localPosition": [0.36, -0.09, 0.48], "localRotation": [0, 0, 0]}, {"id": "tail-socket", "localPosition": [0, 0.04, -1], "localRotation": [0, 0, 0]}, {"id": "projectile-emitter", "localPosition": [0, -0.1, 1.98], "localRotation": [0, 0, 0]}], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.52, 0.42, 1.5], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "spear-snout", "description": "Low continuous taper to a pointed snout with a tiny rounded wet tip.", "level": "macro", "confidence": 0.93, "evidence": ["forward-ref"]}, {"id": "ventral-splash-edge", "description": "Sparse irregular lower-edge droplet breakup; never a continuous fringe.", "level": "micro", "confidence": 0.79, "evidence": ["forward-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "details": [], "fidelityTier": "blockout", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "water-shell"}, "materialRegions": [{"regionId": "closed-water-shell", "materialId": "water-shell", "profileId": "glass.clear", "crop": {"path": "./workflows/waterwing-forward/material-evidence/00-closed-water-shell.png", "bbox": {"x": 45, "y": 260, "width": 315, "height": 375}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.3365}}]};
  node_body_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.86}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wing-left-socket", "localPosition": [-0.36, -0.09, 0.48], "localRotation": [0, 0, 0]}, {"id": "wing-right-socket", "localPosition": [0.36, -0.09, 0.48], "localRotation": [0, 0, 0]}, {"id": "tail-socket", "localPosition": [0, 0.04, -1], "localRotation": [0, 0, 0]}, {"id": "projectile-emitter", "localPosition": [0, -0.1, 1.98], "localRotation": [0, 0, 0]}], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.52, 0.42, 1.5], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}};
  (nodes["root"] ?? root).add(node_body_0);
  nodes["body"] = node_body_0;
  const mesh_body_0Geometry = polygonizeSdf({"primitives": [{"id": "snout", "type": "ellipsoid", "center": [0, -0.125, 1.66], "radii": [0.085, 0.09, 0.38]}, {"id": "brow", "type": "ellipsoid", "center": [0, -0.035, 1.18], "radii": [0.32, 0.31, 0.56]}, {"id": "chest", "type": "ellipsoid", "center": [0, 0.02, 0.4], "radii": [0.45, 0.44, 0.8]}, {"id": "waist", "type": "ellipsoid", "center": [0, 0.045, -0.34], "radii": [0.35, 0.365, 0.68]}, {"id": "tail-base", "type": "ellipsoid", "center": [0, 0.04, -0.9], "radii": [0.2, 0.21, 0.48]}, {"id": "shoulder-left", "type": "ellipsoid", "center": [-0.255, -0.025, 0.76], "radii": [0.29, 0.31, 0.46]}, {"id": "shoulder-right", "type": "ellipsoid", "center": [0.245, 0.025, 0.47], "radii": [0.29, 0.31, 0.46]}], "operations": [{"id": "brow-snout", "type": "smooth-union", "left": "brow", "right": "snout", "radius": 0.14}, {"id": "front-mass", "type": "smooth-union", "left": "brow-snout", "right": "chest", "radius": 0.24}, {"id": "body-mass", "type": "smooth-union", "left": "front-mass", "right": "waist", "radius": 0.25}, {"id": "body-final", "type": "smooth-union", "left": "body-mass", "right": "tail-base", "radius": 0.16}, {"id": "body-with-left-shoulder", "type": "smooth-union", "left": "body-final", "right": "shoulder-left", "radius": 0.2}, {"id": "body-with-shoulders", "type": "smooth-union", "left": "body-with-left-shoulder", "right": "shoulder-right", "radius": 0.2}], "resolution": 56, "bounds": {"min": [-0.76, -0.6, -1.5], "max": [0.76, 0.62, 2.12]}});
  if (!endpoint_body_0) {
    mesh_body_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_body_0 = new THREE.Mesh(
    mesh_body_0Geometry,
    createSculptMaterial("water-shell", {"id": "water-shell", "name": "Blue-grey closed water shell", "type": "physical", "shaderModel": "MeshPhysicalMaterial / layered aqueous dielectric", "baseColor": "#6E96A8", "color": "#6E96A8", "albedo": {"dominant": "#6E96A8", "secondary": ["#315F73", "#D8F5FF"], "samplingNotes": "Sampled qualitatively from the isolated RGB reference; reference PBR extraction is wired in the next stage."}, "colorVariation": {"palette": ["#6E96A8", "#315F73", "#D8F5FF"], "pattern": "directional-flow-mottle", "amplitude": 0.11, "heightCorrelation": 0.18}, "textureResolution": 2048, "textureProjection": {"mode": "triplanar-object-space", "repeat": [1.5, 1.5], "anisotropy": 8, "texelDensityIntent": "Stable object-space frequency through the wing stroke."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1.8, "amplitude": 0.24, "role": "broad depth tint and refraction gradient across each closed mass"}, {"id": "meso", "frequency": 11, "amplitude": 0.12, "role": "directional flowing water striations aligned with propulsion"}, {"id": "micro", "frequency": 58, "amplitude": 0.035, "role": "small wet highlight breakup without opaque noise"}], "roughness": {"base": 0.18, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "lower on wet rims, slightly higher in deep blue-grey body zones"}, "metalness": {"base": 0, "variation": 0}, "clearcoat": {"base": 0.74}, "clearcoatRoughness": {"base": 0.10450000000000001}, "transmission": {"base": 0.42, "variation": 0}, "ior": {"base": 1.5, "variation": 0}, "thickness": {"base": 0.46}, "attenuationDistance": {"base": 2.4}, "attenuationColor": "#315F73", "specularF0": {"base": 0.82}, "envMapIntensity": 1.15, "emissive": "#000000", "emissiveIntensity": {"base": 0}, "opacity": {"base": 1}, "normal": {"pattern": "independent directional aqueous height field", "strength": 0.22, "scale": 30, "space": "tangent"}, "bump": {"pattern": "micro ripple field", "amplitude": 0.018, "scale": 46}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.14, "contactShadowBias": 0.2, "notes": "Only liquid root overlaps darken; water edges remain bright."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1D3944"}, "localOverrides": [{"id": "tail-wet-rim", "region": "tail outer edge", "roughness": 0.06, "clearcoat": 1, "evidenceRefs": ["forward-ref"]}, {"id": "dorsal-wet-rim", "region": "upper body crest", "roughness": 0.07, "clearcoat": 0.95, "evidenceRefs": ["forward-ref"]}, {"id": "right-wing-wet-rim", "region": "right wing trailing/tip edge", "roughness": 0.06, "clearcoat": 1, "evidenceRefs": ["forward-ref"]}, {"id": "head-wet-rim", "region": "brow and snout perimeter", "roughness": 0.05, "clearcoat": 1, "evidenceRefs": ["forward-ref"]}], "shaderNotes": ["Closed geometry is mandatory so transmission has thickness and the side view never collapses into a card.", "Use environment reflection plus a restrained near-white Fresnel rim; do not lower opacity to fake water.", "Keep albedo, roughness, height, normal, and AO independent; no channel re-use."], "notes": "Stylized real-time water, designed to remain legible over both dark rock and bright waterfall footage.", "referenceMaterialId": "glass.clear", "materialFamily": "glass", "materialSubtype": "clear", "materialFinish": "polished", "materialReference": {"registry": "img2threejs/docs/materials/material-reference.json", "profileId": "glass.clear", "method": "explicit-material-id", "confidence": 1, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.transmission", "khronos.volume", "google.filament-pbr"], "requiredMaps": ["roughnessMap", "thicknessMap"], "optionalMaps": ["map", "normalMap", "transmissionMap"], "validationViews": ["neutral-studio", "environment-reflection", "backlight-transmission", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "./workflows/waterwing-forward/material-evidence/00-closed-water-shell.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_albedo.png", "url": "/waterwing-forward-materials/water-shell_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_roughness.png", "url": "/waterwing-forward-materials/water-shell_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_height.png", "url": "/waterwing-forward-materials/water-shell_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_normal.png", "url": "/waterwing-forward-materials/water-shell_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "./workflows/waterwing-forward/material-evidence/pbr-00-closed-water-shell/water-shell_ao.png", "url": "/waterwing-forward-materials/water-shell_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 315, "sourceHeight": 375, "mapSize": 512, "cropBBoxPixels": {"x": 5, "y": 0, "width": 310, "height": 375}, "mask": {"backgroundColor": "#000000", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.6672}, "mapStats": {"valueRange": 0.5075, "heightP90Gradient": 0.1425, "roughnessBase": 0.72, "roughnessVariation": 0.205, "normalStrength": 0.323, "blurRadius": 10}, "palette": ["#446776", "#5A7B8B", "#355665", "#7D9CA9", "#C1D6DE"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "textureAnalysis": {"finishClass": "candy-coat", "recipe": {"metalness": 0.35, "roughness": 0.18, "clearcoat": 0.6, "clearcoatRoughness": 0.15, "transmission": 0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0, "procedural": "gradient-smoke"}, "palette": ["#010202", "#47636E", "#45616C", "#3B4F59", "#2C3A41"], "paletteHueRisk": [{"stop": "#47636E", "hueRisk": "blue-collapse", "suggestedRgb": [110, 99, 71]}, {"stop": "#45616C", "hueRisk": "blue-collapse", "suggestedRgb": [108, 97, 69]}, {"stop": "#3B4F59", "hueRisk": "blue-collapse", "suggestedRgb": [89, 79, 59]}, {"stop": "#2C3A41", "hueRisk": "blue-collapse", "suggestedRgb": [65, 58, 44]}], "gradientAxis": "horizontal", "stats": {"meanLum": 78.4, "meanSaturation": 0.249, "gradientStrength": 0.374, "mottle": 0.073, "streakRatio": 1.1, "hueSpread": 0.001, "specularFraction": 0.009}}, "materialEvidence": {"componentId": "body", "regionId": "closed-water-shell", "crop": {"path": "./workflows/waterwing-forward/material-evidence/00-closed-water-shell.png", "bbox": {"x": 45, "y": 260, "width": 315, "height": 375}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.3365}, "observations": ["chromatic base-colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "body", "regionId": "closed-water-shell", "materialId": "glass.clear", "family": "glass", "subtype": "clear", "finish": "polished", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "needsEnvironment": true}, options, true)
  );
  mesh_body_0.name = "Waterwing body mass";
  if (endpoint_body_0) {
    mesh_body_0.position.copy(endpoint_body_0.midpoint);
    mesh_body_0.quaternion.copy(endpoint_body_0.quaternion);
  }
  mesh_body_0.castShadow = options.castShadow ?? true;
  mesh_body_0.receiveShadow = options.receiveShadow ?? true;
  mesh_body_0.userData.sculptComponent = {"id": "body", "name": "Waterwing body mass", "level": "macro", "role": "body", "importance": 1, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "The pointed head, chest and tapering rear are one closed smoothly varying water volume with no seams, implemented as a smooth-union SDF.", "geometryDescriptor": {"topologyIntent": "The pointed head, chest and tapering rear are one closed smoothly varying water volume with no seams, implemented as a smooth-union SDF.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "sdf": {"primitives": [{"id": "snout", "type": "ellipsoid", "center": [0, -0.125, 1.66], "radii": [0.085, 0.09, 0.38]}, {"id": "brow", "type": "ellipsoid", "center": [0, -0.035, 1.18], "radii": [0.32, 0.31, 0.56]}, {"id": "chest", "type": "ellipsoid", "center": [0, 0.02, 0.4], "radii": [0.45, 0.44, 0.8]}, {"id": "waist", "type": "ellipsoid", "center": [0, 0.045, -0.34], "radii": [0.35, 0.365, 0.68]}, {"id": "tail-base", "type": "ellipsoid", "center": [0, 0.04, -0.9], "radii": [0.2, 0.21, 0.48]}, {"id": "shoulder-left", "type": "ellipsoid", "center": [-0.255, -0.025, 0.76], "radii": [0.29, 0.31, 0.46]}, {"id": "shoulder-right", "type": "ellipsoid", "center": [0.245, 0.025, 0.47], "radii": [0.29, 0.31, 0.46]}], "operations": [{"id": "brow-snout", "type": "smooth-union", "left": "brow", "right": "snout", "radius": 0.14}, {"id": "front-mass", "type": "smooth-union", "left": "brow-snout", "right": "chest", "radius": 0.24}, {"id": "body-mass", "type": "smooth-union", "left": "front-mass", "right": "waist", "radius": 0.25}, {"id": "body-final", "type": "smooth-union", "left": "body-mass", "right": "tail-base", "radius": 0.16}, {"id": "body-with-left-shoulder", "type": "smooth-union", "left": "body-final", "right": "shoulder-left", "radius": 0.2}, {"id": "body-with-shoulders", "type": "smooth-union", "left": "body-with-left-shoulder", "right": "shoulder-right", "radius": 0.2}], "resolution": 56, "bounds": {"min": [-0.76, -0.6, -1.5], "max": [0.76, 0.62, 2.12]}}}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "water-shell", "materialLayers": ["water-shell", "inner-water"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.9, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.86}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wing-left-socket", "localPosition": [-0.36, -0.09, 0.48], "localRotation": [0, 0, 0]}, {"id": "wing-right-socket", "localPosition": [0.36, -0.09, 0.48], "localRotation": [0, 0, 0]}, {"id": "tail-socket", "localPosition": [0, 0.04, -1], "localRotation": [0, 0, 0]}, {"id": "projectile-emitter", "localPosition": [0, -0.1, 1.98], "localRotation": [0, 0, 0]}], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.52, 0.42, 1.5], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "spear-snout", "description": "Low continuous taper to a pointed snout with a tiny rounded wet tip.", "level": "macro", "confidence": 0.93, "evidence": ["forward-ref"]}, {"id": "ventral-splash-edge", "description": "Sparse irregular lower-edge droplet breakup; never a continuous fringe.", "level": "micro", "confidence": 0.79, "evidence": ["forward-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "details": [], "fidelityTier": "blockout", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "water-shell"}, "materialRegions": [{"regionId": "closed-water-shell", "materialId": "water-shell", "profileId": "glass.clear", "crop": {"path": "./workflows/waterwing-forward/material-evidence/00-closed-water-shell.png", "bbox": {"x": 45, "y": 260, "width": 315, "height": 375}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.3365}}]};
  node_body_0.add(mesh_body_0);
  meshes["body"] = mesh_body_0;
  colliders["body"] = {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.52, 0.42, 1.5], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."};
  destructionGroups["waterwing-forward"] ??= [];
  destructionGroups["waterwing-forward"].push(node_body_0);
  const socket_body_wing_left_socket_0 = new THREE.Object3D();
  socket_body_wing_left_socket_0.name = "wing-left-socket";
  socket_body_wing_left_socket_0.position.set(-0.36, -0.09, 0.48);
  socket_body_wing_left_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_body_wing_left_socket_0.userData.socket = {"id": "wing-left-socket", "localPosition": [-0.36, -0.09, 0.48], "localRotation": [0, 0, 0]};
  node_body_0.add(socket_body_wing_left_socket_0);
  sockets["body:wing-left-socket"] = socket_body_wing_left_socket_0;
  const socket_body_wing_right_socket_1 = new THREE.Object3D();
  socket_body_wing_right_socket_1.name = "wing-right-socket";
  socket_body_wing_right_socket_1.position.set(0.36, -0.09, 0.48);
  socket_body_wing_right_socket_1.rotation.set(0.0, 0.0, 0.0);
  socket_body_wing_right_socket_1.userData.socket = {"id": "wing-right-socket", "localPosition": [0.36, -0.09, 0.48], "localRotation": [0, 0, 0]};
  node_body_0.add(socket_body_wing_right_socket_1);
  sockets["body:wing-right-socket"] = socket_body_wing_right_socket_1;
  const socket_body_tail_socket_2 = new THREE.Object3D();
  socket_body_tail_socket_2.name = "tail-socket";
  socket_body_tail_socket_2.position.set(0.0, 0.04, -1.0);
  socket_body_tail_socket_2.rotation.set(0.0, 0.0, 0.0);
  socket_body_tail_socket_2.userData.socket = {"id": "tail-socket", "localPosition": [0, 0.04, -1], "localRotation": [0, 0, 0]};
  node_body_0.add(socket_body_tail_socket_2);
  sockets["body:tail-socket"] = socket_body_tail_socket_2;
  const socket_body_projectile_emitter_3 = new THREE.Object3D();
  socket_body_projectile_emitter_3.name = "projectile-emitter";
  socket_body_projectile_emitter_3.position.set(0.0, -0.1, 1.98);
  socket_body_projectile_emitter_3.rotation.set(0.0, 0.0, 0.0);
  socket_body_projectile_emitter_3.userData.socket = {"id": "projectile-emitter", "localPosition": [0, -0.1, 1.98], "localRotation": [0, 0, 0]};
  node_body_0.add(socket_body_projectile_emitter_3);
  sockets["body:projectile-emitter"] = socket_body_projectile_emitter_3;

  const endpoint_wing_left_1 = makeAttachmentEndpoint(null);
  const node_wing_left_1 = new THREE.Group();
  node_wing_left_1.name = "Left thick propulsion wing__pivot";
  node_wing_left_1.scale.set(1, 1, 1);
  if (endpoint_wing_left_1) {
    node_wing_left_1.position.copy(endpoint_wing_left_1.start);
    node_wing_left_1.rotation.set(1.5707963267948966, 0.0, 1.6807963267948967);
  } else {
    node_wing_left_1.position.set(-0.24, -0.04, 0.86);
    node_wing_left_1.rotation.set(1.5707963267948966, 0.0, 1.6807963267948967);
  }
  node_wing_left_1.userData.sculptComponent = {"id": "wing-left", "name": "Left thick propulsion wing", "level": "macro", "role": "wing", "importance": 0.98, "confidence": 0.84, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "geometryDescriptor": {"topologyIntent": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "profile2D": {"points": [[0.5, -0.12600000000000003], [0.52, -0.018000000000000002], [0.49, 0.108], [0.28, 0.342], [-0.12, 0.558], [-0.62, 0.7020000000000001], [-1.03, 0.6930000000000001], [-1.42, 0.6030000000000001], [-1.68, 0.5040000000000001], [-1.48, 0.333], [-1.18, 0.198], [-0.83, 0.07200000000000001], [-0.52, -0.045000000000000005], [-0.22, -0.14400000000000002], [0.16, -0.162]], "depth": 0.38, "bevelEnabled": true, "bevelThickness": 0.065, "bevelSize": 0.065, "bevelSegments": 5, "curveSegments": 16, "steps": 2}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "wing-left-socket", "localStart": [-0.24, -0.04, 0.86], "localEnd": [-0.9, -0.3, -0.86], "contactType": "continuous-liquid-overlap", "overlap": 0.24, "gapTolerance": 0.01, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.84}, "transform": {"position": [-0.24, -0.04, 0.86], "rotation": [1.5707963267948966, 0, 1.6807963267948967], "scale": [1, 1, 1]}, "material": "wing-membrane", "materialLayers": ["wing-membrane", "water-rim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.84, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "wing", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wing-leading-volume", "description": "Broad rounded leading edge with about 12% chord thickness at peak drive.", "level": "macro", "confidence": 0.88, "evidence": ["forward-ref", "three-quarter-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"], "details": [], "fidelityTier": "blockout", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wing-membrane"}, "materialRegions": [{"regionId": "thick-wing-water", "materialId": "wing-membrane", "profileId": "glass.frosted", "crop": {"path": "./workflows/waterwing-forward/material-evidence/01-thick-wing-water.png", "bbox": {"x": 105, "y": 165, "width": 400, "height": 365}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.416}}]};
  node_wing_left_1.userData.actionProfile = {"animationRole": "wing", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}};
  (nodes["body"] ?? root).add(node_wing_left_1);
  nodes["wing-left"] = node_wing_left_1;
  const mesh_wing_left_1Geometry = endpoint_wing_left_1
    ? new THREE.CylinderGeometry(endpoint_wing_left_1.endRadius, endpoint_wing_left_1.baseRadius, endpoint_wing_left_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.5, -0.12600000000000003], [0.52, -0.018000000000000002], [0.49, 0.108], [0.28, 0.342], [-0.12, 0.558], [-0.62, 0.7020000000000001], [-1.03, 0.6930000000000001], [-1.42, 0.6030000000000001], [-1.68, 0.5040000000000001], [-1.48, 0.333], [-1.18, 0.198], [-0.83, 0.07200000000000001], [-0.52, -0.045000000000000005], [-0.22, -0.14400000000000002], [0.16, -0.162]], "depth": 0.38, "bevelEnabled": true, "bevelThickness": 0.065, "bevelSize": 0.065, "bevelSegments": 5, "curveSegments": 16, "steps": 2});
  if (!endpoint_wing_left_1) {
    mesh_wing_left_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wing_left_1 = new THREE.Mesh(
    mesh_wing_left_1Geometry,
    materialMap["wing-membrane"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_left_1.name = "Left thick propulsion wing";
  if (endpoint_wing_left_1) {
    mesh_wing_left_1.position.copy(endpoint_wing_left_1.midpoint);
    mesh_wing_left_1.quaternion.copy(endpoint_wing_left_1.quaternion);
  }
  mesh_wing_left_1.castShadow = options.castShadow ?? true;
  mesh_wing_left_1.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_left_1.userData.sculptComponent = {"id": "wing-left", "name": "Left thick propulsion wing", "level": "macro", "role": "wing", "importance": 0.98, "confidence": 0.84, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "geometryDescriptor": {"topologyIntent": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "profile2D": {"points": [[0.5, -0.12600000000000003], [0.52, -0.018000000000000002], [0.49, 0.108], [0.28, 0.342], [-0.12, 0.558], [-0.62, 0.7020000000000001], [-1.03, 0.6930000000000001], [-1.42, 0.6030000000000001], [-1.68, 0.5040000000000001], [-1.48, 0.333], [-1.18, 0.198], [-0.83, 0.07200000000000001], [-0.52, -0.045000000000000005], [-0.22, -0.14400000000000002], [0.16, -0.162]], "depth": 0.38, "bevelEnabled": true, "bevelThickness": 0.065, "bevelSize": 0.065, "bevelSegments": 5, "curveSegments": 16, "steps": 2}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "wing-left-socket", "localStart": [-0.24, -0.04, 0.86], "localEnd": [-0.9, -0.3, -0.86], "contactType": "continuous-liquid-overlap", "overlap": 0.24, "gapTolerance": 0.01, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.84}, "transform": {"position": [-0.24, -0.04, 0.86], "rotation": [1.5707963267948966, 0, 1.6807963267948967], "scale": [1, 1, 1]}, "material": "wing-membrane", "materialLayers": ["wing-membrane", "water-rim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.84, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "wing", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wing-leading-volume", "description": "Broad rounded leading edge with about 12% chord thickness at peak drive.", "level": "macro", "confidence": 0.88, "evidence": ["forward-ref", "three-quarter-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"], "details": [], "fidelityTier": "blockout", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wing-membrane"}, "materialRegions": [{"regionId": "thick-wing-water", "materialId": "wing-membrane", "profileId": "glass.frosted", "crop": {"path": "./workflows/waterwing-forward/material-evidence/01-thick-wing-water.png", "bbox": {"x": 105, "y": 165, "width": 400, "height": 365}, "sourceWidth": 540, "sourceHeight": 650, "loaderWarnings": [], "coverage": 0.416}}]};
  node_wing_left_1.add(mesh_wing_left_1);
  meshes["wing-left"] = mesh_wing_left_1;
  colliders["wing-left"] = {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."};
  destructionGroups["waterwing-forward"] ??= [];
  destructionGroups["waterwing-forward"].push(node_wing_left_1);

  const endpoint_wing_right_2 = makeAttachmentEndpoint(null);
  const node_wing_right_2 = new THREE.Group();
  node_wing_right_2.name = "Right thick propulsion wing__pivot";
  node_wing_right_2.scale.set(1, 1, 1);
  if (endpoint_wing_right_2) {
    node_wing_right_2.position.copy(endpoint_wing_right_2.start);
    node_wing_right_2.rotation.set(1.5707963267948966, 0.0, 1.4857963267948966);
  } else {
    node_wing_right_2.position.set(0.22, 0.04, 0.32);
    node_wing_right_2.rotation.set(1.5707963267948966, 0.0, 1.4857963267948966);
  }
  node_wing_right_2.userData.sculptComponent = {"id": "wing-right", "name": "Right thick propulsion wing", "level": "macro", "role": "wing", "importance": 0.98, "confidence": 0.84, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "geometryDescriptor": {"topologyIntent": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "profile2D": {"points": [[0.5, 0.14], [0.52, 0.02], [0.49, -0.12], [0.28, -0.38], [-0.1296, -0.62], [-0.6696000000000001, -0.78], [-1.1124, -0.77], [-1.5336, -0.67], [-1.8144, -0.56], [-1.5984, -0.37], [-1.2744, -0.22], [-0.8964, -0.08], [-0.5616000000000001, 0.05], [-0.2376, 0.16], [0.16, 0.18]], "depth": 0.38, "bevelEnabled": true, "bevelThickness": 0.065, "bevelSize": 0.065, "bevelSegments": 5, "curveSegments": 16, "steps": 2}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "wing-right-socket", "localStart": [0.22, 0.04, 0.32], "localEnd": [0.84, -0.22, -1.36], "contactType": "continuous-liquid-overlap", "overlap": 0.24, "gapTolerance": 0.01, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.84}, "transform": {"position": [0.22, 0.04, 0.32], "rotation": [1.5707963267948966, 0, 1.4857963267948966], "scale": [1, 1, 1]}, "material": "wing-membrane", "materialLayers": ["wing-membrane", "water-rim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.84, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "wing", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tapered-tip", "description": "Sharp swept-back water point with restrained splash breakup.", "level": "macro", "confidence": 0.9, "evidence": ["forward-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"], "details": [], "fidelityTier": "blockout"};
  node_wing_right_2.userData.actionProfile = {"animationRole": "wing", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}};
  (nodes["body"] ?? root).add(node_wing_right_2);
  nodes["wing-right"] = node_wing_right_2;
  const mesh_wing_right_2Geometry = endpoint_wing_right_2
    ? new THREE.CylinderGeometry(endpoint_wing_right_2.endRadius, endpoint_wing_right_2.baseRadius, endpoint_wing_right_2.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.5, 0.14], [0.52, 0.02], [0.49, -0.12], [0.28, -0.38], [-0.1296, -0.62], [-0.6696000000000001, -0.78], [-1.1124, -0.77], [-1.5336, -0.67], [-1.8144, -0.56], [-1.5984, -0.37], [-1.2744, -0.22], [-0.8964, -0.08], [-0.5616000000000001, 0.05], [-0.2376, 0.16], [0.16, 0.18]], "depth": 0.38, "bevelEnabled": true, "bevelThickness": 0.065, "bevelSize": 0.065, "bevelSegments": 5, "curveSegments": 16, "steps": 2});
  if (!endpoint_wing_right_2) {
    mesh_wing_right_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wing_right_2 = new THREE.Mesh(
    mesh_wing_right_2Geometry,
    materialMap["wing-membrane"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_right_2.name = "Right thick propulsion wing";
  if (endpoint_wing_right_2) {
    mesh_wing_right_2.position.copy(endpoint_wing_right_2.midpoint);
    mesh_wing_right_2.quaternion.copy(endpoint_wing_right_2.quaternion);
  }
  mesh_wing_right_2.castShadow = options.castShadow ?? true;
  mesh_wing_right_2.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_right_2.userData.sculptComponent = {"id": "wing-right", "name": "Right thick propulsion wing", "level": "macro", "role": "wing", "importance": 0.98, "confidence": 0.84, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "geometryDescriptor": {"topologyIntent": "A dedicated closed swept-back propulsion silhouette is extruded to real thickness; it reads as a single heavy water wing instead of a chain of oval lobes.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "profile2D": {"points": [[0.5, 0.14], [0.52, 0.02], [0.49, -0.12], [0.28, -0.38], [-0.1296, -0.62], [-0.6696000000000001, -0.78], [-1.1124, -0.77], [-1.5336, -0.67], [-1.8144, -0.56], [-1.5984, -0.37], [-1.2744, -0.22], [-0.8964, -0.08], [-0.5616000000000001, 0.05], [-0.2376, 0.16], [0.16, 0.18]], "depth": 0.38, "bevelEnabled": true, "bevelThickness": 0.065, "bevelSize": 0.065, "bevelSegments": 5, "curveSegments": 16, "steps": 2}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "wing-right-socket", "localStart": [0.22, 0.04, 0.32], "localEnd": [0.84, -0.22, -1.36], "contactType": "continuous-liquid-overlap", "overlap": 0.24, "gapTolerance": 0.01, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.84}, "transform": {"position": [0.22, 0.04, 0.32], "rotation": [1.5707963267948966, 0, 1.4857963267948966], "scale": [1, 1, 1]}, "material": "wing-membrane", "materialLayers": ["wing-membrane", "water-rim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.84, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "wing", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tapered-tip", "description": "Sharp swept-back water point with restrained splash breakup.", "level": "macro", "confidence": 0.9, "evidence": ["forward-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"], "details": [], "fidelityTier": "blockout"};
  node_wing_right_2.add(mesh_wing_right_2);
  meshes["wing-right"] = mesh_wing_right_2;
  colliders["wing-right"] = {"type": "ellipsoid", "offset": [0, 0, 0], "scale": [0.54, 0.22, 1.15], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."};
  destructionGroups["waterwing-forward"] ??= [];
  destructionGroups["waterwing-forward"].push(node_wing_right_2);

  const endpoint_tail_leaf_3 = makeAttachmentEndpoint(null);
  const node_tail_leaf_3 = new THREE.Group();
  node_tail_leaf_3.name = "Leaf-shaped tail__pivot";
  node_tail_leaf_3.scale.set(1, 1, 1);
  if (endpoint_tail_leaf_3) {
    node_tail_leaf_3.position.copy(endpoint_tail_leaf_3.start);
    node_tail_leaf_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tail_leaf_3.position.set(0.0, 0.04, -1.0);
    node_tail_leaf_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_tail_leaf_3.userData.sculptComponent = {"id": "tail-leaf", "name": "Leaf-shaped tail", "level": "macro", "role": "tail", "importance": 0.88, "confidence": 0.79, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The tail is a closed thick leaf following a curved spine and tapering to a true point, so a changing-section sweep is required.", "geometryDescriptor": {"topologyIntent": "The tail is a closed thick leaf following a curved spine and tapering to a true point, so a changing-section sweep is required.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "taperedSweep": {"stations": [{"position": [0, 0, 0], "rx": 0.19, "rz": 0.12}, {"position": [0.018, 0.035, -0.39], "rx": 0.12, "rz": 0.085}, {"position": [-0.022, 0.078, -0.8], "rx": 0.18, "rz": 0.095}, {"position": [0.026, 0.13, -1.17], "rx": 0.115, "rz": 0.06}, {"position": [0.065, 0.19, -1.62], "rx": 0, "rz": 0}], "radialSegments": 18}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "tail-socket", "localStart": [0, 0.04, -0.9], "localEnd": [0.06, 0.18, -2.5], "contactType": "continuous-liquid-overlap", "overlap": 0.08, "gapTolerance": 0.01, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.79}, "transform": {"position": [0, 0.04, -1], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "water-shell", "materialLayers": ["water-shell", "water-rim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.79, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "tail", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [0.2, 0.12, 0.84], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tail-midrib", "description": "Low axial ridge giving the leaf thickness under grazing light.", "level": "meso", "confidence": 0.78, "evidence": ["forward-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "rear-ref"], "details": [], "fidelityTier": "blockout"};
  node_tail_leaf_3.userData.actionProfile = {"animationRole": "tail", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [0.2, 0.12, 0.84], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}};
  (nodes["body"] ?? root).add(node_tail_leaf_3);
  nodes["tail-leaf"] = node_tail_leaf_3;
  const mesh_tail_leaf_3Geometry = endpoint_tail_leaf_3
    ? new THREE.CylinderGeometry(endpoint_tail_leaf_3.endRadius, endpoint_tail_leaf_3.baseRadius, endpoint_tail_leaf_3.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0, 0], "rx": 0.19, "rz": 0.12}, {"position": [0.018, 0.035, -0.39], "rx": 0.12, "rz": 0.085}, {"position": [-0.022, 0.078, -0.8], "rx": 0.18, "rz": 0.095}, {"position": [0.026, 0.13, -1.17], "rx": 0.115, "rz": 0.06}, {"position": [0.065, 0.19, -1.62], "rx": 0, "rz": 0}], "radialSegments": 18});
  if (!endpoint_tail_leaf_3) {
    mesh_tail_leaf_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tail_leaf_3 = new THREE.Mesh(
    mesh_tail_leaf_3Geometry,
    materialMap["water-shell"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_leaf_3.name = "Leaf-shaped tail";
  if (endpoint_tail_leaf_3) {
    mesh_tail_leaf_3.position.copy(endpoint_tail_leaf_3.midpoint);
    mesh_tail_leaf_3.quaternion.copy(endpoint_tail_leaf_3.quaternion);
  }
  mesh_tail_leaf_3.castShadow = options.castShadow ?? true;
  mesh_tail_leaf_3.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_leaf_3.userData.sculptComponent = {"id": "tail-leaf", "name": "Leaf-shaped tail", "level": "macro", "role": "tail", "importance": 0.88, "confidence": 0.79, "primitive": "tapered-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The tail is a closed thick leaf following a curved spine and tapering to a true point, so a changing-section sweep is required.", "geometryDescriptor": {"topologyIntent": "The tail is a closed thick leaf following a curved spine and tapering to a true point, so a changing-section sweep is required.", "edgeTreatment": {"type": "rounded-water-edge", "bevelRadius": 0.018, "segments": 3}, "deformationStack": [], "uvStrategy": "generated object-space procedural coordinates", "normalStrategy": "analytic/vertex normals from closed generated geometry", "taperedSweep": {"stations": [{"position": [0, 0, 0], "rx": 0.19, "rz": 0.12}, {"position": [0.018, 0.035, -0.39], "rx": 0.12, "rz": 0.085}, {"position": [-0.022, 0.078, -0.8], "rx": 0.18, "rz": 0.095}, {"position": [0.026, 0.13, -1.17], "rx": 0.115, "rz": 0.06}, {"position": [0.065, 0.19, -1.62], "rx": 0, "rz": 0}], "radialSegments": 18}}, "parent": "body", "attachment": {"parentId": "body", "parentSocket": "tail-socket", "localStart": [0, 0.04, -0.9], "localEnd": [0.06, 0.18, -2.5], "contactType": "continuous-liquid-overlap", "overlap": 0.08, "gapTolerance": 0.01, "evidenceRefs": ["forward-ref", "three-quarter-ref", "rear-ref"]}, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "relative", "confidence": 0.79}, "transform": {"position": [0, 0.04, -1], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "material": "water-shell", "materialLayers": ["water-shell", "water-rim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(111, 151, 168, 1.0)", "secondaryAlbedo": "rgba(50, 105, 126, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.79, "evidence": ["forward-ref", "front-ref", "three-quarter-ref", "rear-ref"], "samplingNotes": "Blue-grey water mass with cool teal depth, near-white wet edges, and no opaque pigment layer."}, "actionProfile": {"animationRole": "tail", "pivot": {"mode": "explicit", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.86}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": true, "twist": true, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [0.2, 0.12, 0.84], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."}, "constraints": [], "destruction": {"breakable": false, "breakImpulse": 0, "fractureGroup": "waterwing-forward", "debrisMaterial": "water-shell", "seamRefs": [], "detachableFragments": []}}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tail-midrib", "description": "Low axial ridge giving the leaf thickness under grazing light.", "level": "meso", "confidence": 0.78, "evidence": ["forward-ref"]}], "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.18, "bumpAmplitude": 0.025, "normalPattern": "directional aqueous streaks following local flow", "displacementPattern": "none; silhouette comes from closed geometry", "occlusionPattern": "soft darkening only at overlapping liquid roots", "edgeWearPattern": "wet-rim highlight, not abrasion", "notes": "Water relief is continuous and non-repeating; no hard manufactured seams."}, "evidenceRefs": ["forward-ref", "rear-ref"], "details": [], "fidelityTier": "blockout"};
  node_tail_leaf_3.add(mesh_tail_leaf_3);
  meshes["tail-leaf"] = mesh_tail_leaf_3;
  colliders["tail-leaf"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [0.2, 0.12, 0.84], "isTrigger": false, "notes": "Simplified runtime proxy; visual meshes remain non-collider geometry."};
  destructionGroups["waterwing-forward"] ??= [];
  destructionGroups["waterwing-forward"].push(node_tail_leaf_3);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createWaterwingForwardPropulsionLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Waterwing Forward Propulsion look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Reference-matched key: large cool-white area light from camera-left/front and above, intensity 2.4, soft shadow radius 5.", "Fill: blue-grey hemisphere/environment at about 30% of key to preserve transmission through the body.", "Rim: narrow cyan-white rear light at 40% of key to prove wing thickness and wet edges.", "Exposure 1.05 with ACES Filmic tone mapping; do not clip the near-white water rim.", "Review backgrounds: #14252E dark gradient and #E7F1F2 light waterfall surrogate.", "Soft contact shadow only in the turntable proof; combat overlay delivery remains shadowless in world space."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createWaterwingForwardPropulsionEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameWaterwingForwardPropulsionCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createWaterwingForwardPropulsionPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureWaterwingForwardPropulsionRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createWaterwingForwardPropulsionInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}

"""Build Waterwing emergence v2 as an underwater condensation sequence."""

from __future__ import annotations

import argparse
import json
import math
import sys
import traceback
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_waterwing_forward_v1 import (  # noqa: E402
    assign_skin_weights,
    bind_anchors_and_core,
    blender_to_three,
    build_geometry,
    configure_animation_curves,
    create_armature,
    export_glb,
    save_blend,
    sha256_file,
    shape_context,
    smoothstep,
    world_bounds,
)
from waterwing_forward_v1_config import ANCHOR_NAMES, Y_MIN  # noqa: E402
from waterwing_emerge_v2_config import (  # noqa: E402
    ASSET_VERSION,
    CLIP_NAME,
    DEFAULT_BLEND_PATH,
    DEFAULT_GLB_PATH,
    DEFAULT_MANIFEST_PATH,
    DROPLET_COUNT,
    DROPLET_PREFIX,
    FPS,
    FRAME_END,
    FRAME_START,
    KEY_FRAMES,
    MORPH_CLIP_NAME,
    MORPH_NAMES,
    PHASE_FRAMES,
    POOL_NAME,
    REVIEW_FRAMES,
    REVIEW_VIEWS,
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--output-glb", type=Path, default=DEFAULT_GLB_PATH)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    return parser.parse_args(argv)


def surface_midline(x: float, y: float, span: float, tail: float) -> float:
    """Approximate the basis surface midline so stage targets retain volume."""

    # The rounded nose lives in six short rings before the regular manta loft.
    # Its lateral span can be numerically large even though the ring itself is
    # tiny.  Fade the wing arch in over the same distance as the shared base,
    # otherwise subtracting a full wing midline folds the soft nose downward.
    front_blend = smoothstep((y - Y_MIN) / 0.56)
    wing_lift = front_blend * (
        0.54
        * span**2.35
        * (1.0 - tail)
        * (0.86 + 0.14 * math.cos((y + 0.35) * 1.25))
    )
    dorsal = 0.05 * math.exp(-((abs(x) / 0.92) ** 2.0))
    return wing_lift + dorsal


def create_emergence_shape_keys(body: bpy.types.Object) -> None:
    """Create eight absolute narrative poses, blended one stage at a time."""

    basis = body.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = "KEY_LINEAR"
    keys = {name: body.shape_key_add(name=name, from_mix=False) for name in MORPH_NAMES}

    for index, point in enumerate(basis.data):
        original = point.co.copy()
        x, y, z, span, wing, centre, tail = shape_context(original)
        midline = surface_midline(x, y, span, tail)
        shell_height = z - midline
        side = 1.0 if x >= 0.0 else -1.0
        left = 1.0 if side > 0.0 else 0.0
        right = 1.0 - left

        # 0-20%: the whole topology is folded into a compact, lopsided, fully
        # volumetric water mass.  Tanh keeps ordering while destroying the
        # recognisable manta outline in all three views.
        amorphous = original.copy()
        amorphous.x = 0.66 * math.tanh(x * 0.72)
        amorphous.x += 0.10 * math.sin(y * 1.63 + z * 2.4)
        amorphous.y = -0.20 + 0.67 * math.tanh((y + 0.12) * 0.48)
        amorphous.y += 0.085 * math.sin(x * 1.38 - z * 1.7)
        amorphous.z = -0.43 + shell_height * (0.40 + 0.08 * centre)
        amorphous.z += 0.085 * math.sin(x * 1.47 + y * 1.19)
        amorphous.z += 0.035 * math.cos(y * 2.11 - side * 0.55)
        keys["Emerge_Amorphous"].data[index].co = amorphous

        # 20-28%: the chest and thick wing roots form first.  Tips and tail
        # remain gathered in the water so this cannot read as a small finished
        # creature.
        roots = original.copy()
        # Keep enough span to read as a forming wing, but retain a thick,
        # cohesive shoulder instead of extruding two rigid horizontal spikes.
        roots.x = x * (0.30 + 0.20 * centre + 0.10 * (1.0 - span))
        roots.x += side * 0.08 * wing * (1.0 - span)
        roots.y = -0.18 + (y + 0.18) * (0.52 - 0.22 * tail)
        roots.z = -0.26 + shell_height * (
            0.72 + 0.12 * centre + 0.20 * wing * (0.28 + 0.72 * span)
        )
        roots.z += 0.36 * centre + 0.20 * wing * (1.0 - 0.82 * span)
        roots.z -= 0.055 * wing * span**1.55
        roots.z -= 0.08 * tail
        keys["Emerge_WingRoots"].data[index].co = roots

        # 28-38%: the left membrane is pulled out of the water first.  The
        # right side stays visibly gathered and thick.
        draw_left = original.copy()
        left_factor = 0.82 if left else 0.48
        draw_left.x = x * (left_factor if wing > 0.02 else 0.72)
        draw_left.y = -0.14 + (y + 0.14) * (0.68 - 0.26 * tail)
        draw_left.y += 0.18 * left * wing * span
        draw_left.z = -0.14 + shell_height * (
            0.84 + 0.10 * centre + 0.13 * wing * span
        )
        draw_left.z += 0.30 * centre
        draw_left.z += wing * (0.34 * left + 0.18 * right) * (0.30 + 0.70 * span)
        draw_left.z -= 0.10 * tail
        keys["Emerge_WingDraw_L"].data[index].co = draw_left

        # 38-45%: the right membrane follows.  The left has already opened,
        # preserving a natural phase offset instead of mirrored simultaneity.
        draw_right = original.copy()
        right_stage_factor = 0.94 if left else 0.82
        draw_right.x = x * (right_stage_factor if wing > 0.02 else 0.84)
        draw_right.y = -0.10 + (y + 0.10) * (0.79 - 0.24 * tail)
        draw_right.y += 0.12 * right * wing * span
        draw_right.z = -0.05 + shell_height * (
            0.91 + 0.06 * centre + 0.11 * wing * span
        )
        draw_right.z += 0.26 * centre
        draw_right.z += wing * (0.34 * left + 0.29 * right) * (0.28 + 0.72 * span)
        draw_right.z -= 0.12 * tail
        keys["Emerge_WingDraw_R"].data[index].co = draw_right

        # 45-68%: torso and wings lift as one heavy body.  The rear third stays
        # low, making the remaining water tether legible without moving root.
        lift = original.copy()
        lift.x *= 0.94 + 0.035 * wing
        lift.y = -0.06 + (y + 0.06) * (0.93 - 0.18 * tail)
        lift.z += 0.32 * (1.0 - 0.92 * tail)
        lift.z += 0.16 * wing * (0.22 + 0.78 * span)
        lift.z -= 0.23 * tail * smoothstep((y - 1.55) / 2.45)
        keys["Emerge_BodyLift"].data[index].co = lift

        # 68-75%: the tail peels out last.  It is still slightly lower than the
        # chest, but is no longer contracted into the water source.
        release = original.copy()
        release.x *= 0.985 + 0.025 * wing
        release.y += 0.03 * tail
        release.z += 0.22 * (1.0 - 0.48 * tail)
        release.z += 0.20 * wing * (0.24 + 0.76 * span)
        release.z -= 0.07 * tail * smoothstep((y - 2.0) / 1.75)
        release.x += side * 0.035 * tail * math.sin((y - 1.4) * 1.7)
        keys["Emerge_TailRelease"].data[index].co = release

        # 75-90%: broad wing opening while preserving thickness through the
        # membrane; this is a water creature, not a flat card.
        unfurl = original.copy()
        unfurl.x *= 1.015 + 0.035 * wing * (0.30 + 0.70 * span)
        unfurl.y -= 0.11 * wing * span
        unfurl.z += 0.12 * centre
        unfurl.z += 0.30 * wing * (0.26 + 0.74 * span)
        unfurl.z += side * 0.025 * wing * math.sin(y * 1.55)
        keys["Emerge_Unfurl"].data[index].co = unfurl

        # 90-100%: settle into a thick hover silhouette with a small residual
        # phase difference between wings and a slow tail bias.
        settle = original.copy()
        settle.x *= 1.0 + 0.012 * wing
        settle.y -= 0.032 * wing * span
        settle.z += 0.07 * centre
        settle.z += wing * (0.145 + 0.045 * left) * (0.28 + 0.72 * span)
        settle.x += side * 0.018 * wing * math.sin(y * 1.85)
        settle.x += 0.045 * tail * math.sin((y - 1.55) * 1.35)
        keys["Emerge_HoverSettle"].data[index].co = settle

    body.data.shape_keys.use_relative = True
    for key in keys.values():
        key.value = 0.0
        key.slider_min = 0.0
        key.slider_max = 1.0


def rig_emergence_body(body: bpy.types.Object, rig: bpy.types.Object) -> None:
    create_emergence_shape_keys(body)
    assign_skin_weights(body, rig)
    modifier = body.modifiers.new(name="WaterwingEmergeV2Armature", type="ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()


def create_irregular_pool(root: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    """Make a closed lopsided water mound, deliberately not a torus/ring."""

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=56,
        ring_count=16,
        location=(0.08, 0.18, -0.52),
    )
    pool = bpy.context.object
    pool.name = POOL_NAME
    pool.scale = (2.05, 1.42, 0.15)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for vertex in pool.data.vertices:
        x, y, z = vertex.co
        phase = math.atan2(y / 1.42, x / 2.05)
        radial_warp = 1.0 + 0.10 * math.sin(3.0 * phase + 0.35) + 0.055 * math.sin(7.0 * phase - 0.8)
        vertex.co.x = x * radial_warp + 0.06 * math.sin(y * 2.8)
        vertex.co.y = y * (1.0 + 0.075 * math.cos(5.0 * phase + 0.6))
        vertex.co.z = z + 0.035 * math.sin(x * 1.7 + y * 2.2)
    pool.data.update()
    for polygon in pool.data.polygons:
        polygon.use_smooth = True
    pool.data.materials.append(material)
    pool.parent = root
    pool["semantic"] = "irregular-underwater-condensation-source"
    return pool


DROPLET_SPECS = (
    # x, y, z, radius, height, start, peak, end, drift_x, drift_y, rise
    (-1.56, -0.42, -0.38, 0.10, 0.28, 10, 20, 38, -0.16, -0.08, 0.75),
    (0.82, -0.96, -0.34, 0.13, 0.34, 17, 30, 51, 0.13, -0.16, 0.92),
    (-0.62, 0.54, -0.31, 0.08, 0.24, 25, 39, 60, -0.05, 0.14, 1.08),
    (1.72, 0.12, -0.39, 0.095, 0.31, 32, 47, 70, 0.22, 0.06, 1.22),
    (-2.04, 0.28, -0.36, 0.075, 0.22, 41, 55, 79, -0.20, 0.12, 0.98),
    (0.24, 0.86, -0.33, 0.115, 0.39, 49, 65, 91, 0.04, 0.21, 1.42),
    (1.18, 0.66, -0.37, 0.07, 0.20, 59, 72, 96, 0.18, 0.13, 1.16),
    (-1.14, -0.82, -0.35, 0.09, 0.29, 68, 83, 107, -0.14, -0.12, 1.34),
    (0.48, -0.34, -0.30, 0.065, 0.18, 80, 94, 116, 0.08, -0.04, 1.06),
)


def create_asymmetric_droplets(root: bpy.types.Object, material: bpy.types.Material) -> list[bpy.types.Object]:
    assert len(DROPLET_SPECS) == DROPLET_COUNT
    droplets = []
    for index, (x, y, z, radius, height, *_timing) in enumerate(DROPLET_SPECS, start=1):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=(x, y, z))
        droplet = bpy.context.object
        droplet.name = f"{DROPLET_PREFIX}{index:02d}"
        droplet.scale = (0.82, 0.91, height / radius)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        droplet.data.materials.append(material)
        droplet.parent = root
        droplet["semantic"] = "staggered-condensation-droplet"
        droplets.append(droplet)
    return droplets


def key_rotations(bone: bpy.types.PoseBone, values: tuple[tuple[float, float, float], ...]) -> None:
    bone.rotation_mode = "XYZ"
    for frame, rotation in zip(KEY_FRAMES, values, strict=True):
        bone.rotation_euler = rotation
        bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone.name)


def create_armature_action(rig: bpy.types.Object) -> bpy.types.Action:
    action = bpy.data.actions.new(CLIP_NAME)
    rig.animation_data_create()
    rig.animation_data.action = action
    zero = (0.0, 0.0, 0.0)
    root = rig.pose.bones["root"]
    root.rotation_mode = "XYZ"
    for frame in KEY_FRAMES:
        root.location = zero
        root.rotation_euler = zero
        root.keyframe_insert(data_path="location", frame=frame, group="root")
        root.keyframe_insert(data_path="rotation_euler", frame=frame, group="root")

    left = (
        zero, zero, (0.006, -0.004, -0.006), (0.010, -0.006, -0.012),
        (0.012, -0.008, -0.016), (0.018, -0.010, -0.022),
        (0.012, -0.006, -0.014), (-0.020, 0.012, 0.025),
        (-0.028, 0.016, 0.034), (-0.010, 0.006, 0.012),
    )
    right = tuple((x, -y, -z * 0.90) for x, y, z in left)
    for side, values in (("L", left), ("R", right)):
        key_rotations(rig.pose.bones[f"wing_{side}_root"], values)
        key_rotations(
            rig.pose.bones[f"wing_{side}_mid"],
            tuple((x * 1.08, y * 1.08, z * 1.12) for x, y, z in values),
        )
        key_rotations(
            rig.pose.bones[f"wing_{side}_tip"],
            tuple((x * 1.12, y * 1.12, z * 1.18) for x, y, z in values),
        )
        key_rotations(
            rig.pose.bones[f"wing_{side}_web"],
            tuple((x * 0.72, y * 0.76, z * 0.80) for x, y, z in values),
        )

    body_front = (
        zero, zero, (-0.004, 0.0, 0.0), (-0.007, 0.0, 0.0),
        (-0.009, 0.0, 0.0), (-0.012, 0.0, 0.0), (-0.006, 0.0, 0.0),
        (0.010, 0.0, 0.0), (0.018, 0.0, 0.0), (0.006, 0.0, 0.0),
    )
    key_rotations(rig.pose.bones["body_front"], body_front)
    key_rotations(rig.pose.bones["body_mid"], tuple((-x * 0.30, 0.0, 0.0) for x, _, _ in body_front))
    key_rotations(rig.pose.bones["body_rear"], tuple((-x * 0.52, 0.0, 0.0) for x, _, _ in body_front))

    tail = (
        zero, zero, zero, (0.0, 0.004, -0.003), (0.0, 0.008, -0.006),
        (0.0, 0.012, -0.010), (0.0, -0.012, 0.010),
        (0.0, -0.022, 0.016), (0.0, 0.018, -0.012), (0.0, 0.010, -0.006),
    )
    key_rotations(rig.pose.bones["tail_01"], tail)
    key_rotations(rig.pose.bones["tail_02"], tuple((x, y * 1.12, z * 1.16) for x, y, z in tail))
    key_rotations(rig.pose.bones["tail_03"], tuple((x, y * 1.24, z * 1.28) for x, y, z in tail))
    action.use_fake_user = True
    return action


def create_morph_action(body: bpy.types.Object) -> bpy.types.Action:
    values = {
        "Emerge_Amorphous": (1.00, 0.90, 0.18, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        "Emerge_WingRoots": (0.00, 0.10, 0.82, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        "Emerge_WingDraw_L": (0.00, 0.00, 0.00, 1.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        "Emerge_WingDraw_R": (0.00, 0.00, 0.00, 0.00, 1.00, 0.00, 0.00, 0.00, 0.00, 0.00),
        "Emerge_BodyLift": (0.00, 0.00, 0.00, 0.00, 0.00, 1.00, 0.42, 0.00, 0.00, 0.00),
        "Emerge_TailRelease": (0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.58, 1.00, 0.00, 0.00),
        "Emerge_Unfurl": (0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 1.00, 0.00),
        "Emerge_HoverSettle": (0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 1.00),
    }
    assert tuple(values) == MORPH_NAMES
    action = bpy.data.actions.new(MORPH_CLIP_NAME)
    shape_keys = body.data.shape_keys
    shape_keys.animation_data_create()
    shape_keys.animation_data.action = action
    for name, samples in values.items():
        key = shape_keys.key_blocks[name]
        for frame, value in zip(KEY_FRAMES, samples, strict=True):
            key.value = value
            key.keyframe_insert(data_path="value", frame=frame, group=name)
    action.use_fake_user = True
    return action


def create_object_action(
    obj: bpy.types.Object,
    action_name: str,
    samples: tuple[tuple[int, tuple[float, float, float], tuple[float, float, float]], ...],
) -> bpy.types.Action:
    action = bpy.data.actions.new(action_name)
    obj.animation_data_create()
    obj.animation_data.action = action
    for frame, scale, location in samples:
        obj.scale = scale
        obj.location = location
        obj.keyframe_insert(data_path="scale", frame=frame, group=obj.name)
        obj.keyframe_insert(data_path="location", frame=frame, group=obj.name)
    action.use_fake_user = True
    return action


def push_nla(owner, action: bpy.types.Action) -> None:
    track = owner.animation_data.nla_tracks.new()
    track.name = CLIP_NAME
    strip = track.strips.new(CLIP_NAME, FRAME_START, action)
    strip.action_frame_start = FRAME_START
    strip.action_frame_end = FRAME_END
    strip.frame_start = FRAME_START
    strip.frame_end = FRAME_END
    strip.extrapolation = "NOTHING"
    owner.animation_data.action = None


def animate_droplet(obj: bpy.types.Object, spec, index: int) -> bpy.types.Action:
    x, y, z, _radius, _height, start, peak, end, drift_x, drift_y, rise = spec
    base = (x, y, z)
    samples = (
        (FRAME_START, (0.001, 0.001, 0.001), base),
        (max(FRAME_START + 1, start - 3), (0.001, 0.001, 0.001), base),
        (start, (0.20, 0.20, 0.28), base),
        (peak, (1.0, 1.0, 1.0), (x + drift_x * 0.34, y + drift_y * 0.34, z + rise * 0.42)),
        (end, (0.001, 0.001, 0.001), (x + drift_x, y + drift_y, z + rise)),
        (FRAME_END, (0.001, 0.001, 0.001), (x + drift_x, y + drift_y, z + rise)),
    )
    return create_object_action(obj, f"{CLIP_NAME}_Droplet_{index:02d}", samples)


def animate_emergence(
    body: bpy.types.Object,
    rig: bpy.types.Object,
    core: bpy.types.Object,
    pool: bpy.types.Object,
    droplets: list[bpy.types.Object],
) -> None:
    actions = [create_armature_action(rig), create_morph_action(body)]

    pool_base = tuple(pool.location)
    pool_action = create_object_action(
        pool,
        f"{CLIP_NAME}_Pool",
        (
            (1, (0.92, 0.84, 0.94), pool_base),
            (16, (1.08, 0.96, 1.05), (pool_base[0] - 0.04, pool_base[1] + 0.02, pool_base[2] + 0.015)),
            (31, (0.98, 1.06, 0.88), (pool_base[0] + 0.03, pool_base[1] - 0.02, pool_base[2] + 0.025)),
            (61, (0.78, 0.68, 0.72), (pool_base[0], pool_base[1], pool_base[2] + 0.04)),
            (82, (0.56, 0.44, 0.50), (pool_base[0], pool_base[1], pool_base[2] + 0.03)),
            (113, (0.22, 0.16, 0.18), pool_base),
            (132, (0.06, 0.04, 0.05), pool_base),
            (151, (0.001, 0.001, 0.001), pool_base),
        ),
    )
    actions.append(pool_action)

    core_base = tuple(core.location)
    core_action = create_object_action(
        core,
        f"{CLIP_NAME}_Core",
        tuple(
            (frame, (scale, scale, scale), core_base)
            for frame, scale in zip(KEY_FRAMES, (0.03, 0.08, 0.16, 0.25, 0.34, 0.52, 0.68, 0.78, 0.92, 1.0), strict=True)
        ),
    )
    actions.append(core_action)

    droplet_actions = [animate_droplet(obj, spec, index) for index, (obj, spec) in enumerate(zip(droplets, DROPLET_SPECS, strict=True), start=1)]
    actions.extend(droplet_actions)
    for action in actions:
        configure_animation_curves(action)

    push_nla(rig, actions[0])
    push_nla(body.data.shape_keys, actions[1])
    push_nla(pool, pool_action)
    push_nla(core, core_action)
    for droplet, action in zip(droplets, droplet_actions, strict=True):
        push_nla(droplet, action)
    bpy.context.scene.frame_set(FRAME_START)


def write_manifest(path: Path, glb_path: Path, body: bpy.types.Object, rig: bpy.types.Object, droplets) -> None:
    bpy.context.scene.frame_set(FRAME_END)
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(body)
    anchors = []
    for name in ANCHOR_NAMES:
        location = bpy.data.objects[name].matrix_world.translation
        anchors.append({
            "name": name,
            "blender": [round(value, 6) for value in location],
            "three": blender_to_three(location),
        })
    auxiliary = [POOL_NAME, *(obj.name for obj in droplets)]
    manifest = {
        "assetVersion": ASSET_VERSION,
        "action": "emerge",
        "clip": CLIP_NAME,
        "fps": FPS,
        "frameRange": [FRAME_START, FRAME_END],
        "durationSeconds": (FRAME_END - FRAME_START) / FPS,
        "loop": False,
        "rootMotion": False,
        "formationLogic": "underwater-condensation-asymmetric",
        "phaseFrames": PHASE_FRAMES,
        "coordinateConvention": {
            "blender": "right-handed Z-up, creature forward -Y",
            "three": "right-handed Y-up, creature forward +Z",
            "mapping": "(x, y, z) -> (x, z, -y)",
        },
        "boundsAtFinalPose": {
            "blender": {"min": minimum, "max": maximum},
            "three": {"min": blender_to_three(minimum), "max": blender_to_three(maximum)},
        },
        "mesh": {
            "vertices": len(body.data.vertices),
            "polygons": len(body.data.polygons),
            "topology": body["topology"],
            "frontPoleValence": body["frontPoleValence"],
            "noseRingSegments": json.loads(body["noseRingSegments"]),
        },
        "bones": [bone.name for bone in rig.data.bones],
        "morphs": list(MORPH_NAMES),
        "animations": [CLIP_NAME],
        "anchors": anchors,
        "auxiliaryMeshes": auxiliary,
        "review": {"frames": list(REVIEW_FRAMES), "views": list(REVIEW_VIEWS)},
        "sha256": sha256_file(glb_path),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    root, body, core = build_geometry()
    scene = bpy.context.scene
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    root["assetVersion"] = ASSET_VERSION
    root["action"] = "emerge"
    body["assetVersion"] = ASSET_VERSION
    core["assetVersion"] = ASSET_VERSION

    rig = create_armature(root)
    rig["assetVersion"] = ASSET_VERSION
    rig["rigContract"] = ASSET_VERSION
    rig_emergence_body(body, rig)
    bind_anchors_and_core(rig, core)

    material = bpy.data.materials["MAT_WaterShell"]
    pool = create_irregular_pool(root, material)
    droplets = create_asymmetric_droplets(root, material)
    animate_emergence(body, rig, core, pool, droplets)

    save_blend(args.output_blend)
    export_glb(args.output_glb)
    write_manifest(args.manifest, args.output_glb, body, rig, droplets)
    print("EMERGENCE_V2_EXPORT_OK", json.dumps({
        "vertices": len(body.data.vertices),
        "polygons": len(body.data.polygons),
        "blend": str(args.output_blend),
        "glb": str(args.output_glb),
        "droplets": len(droplets),
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

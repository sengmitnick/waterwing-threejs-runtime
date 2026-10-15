"""Render deterministic multi-view Waterwing review frames."""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from waterwing_forward_v1_config import BODY_NAME  # noqa: E402


DEFAULT_FRAMES = (1, 13, 27, 45, 58, 72, 94, 108, 121)
VIEW_POSITIONS = {
    "propulsion": (8.4, -11.8, 6.8),
    "axial-front": (0.0, -14.2, 1.0),
    "left-side": (-14.2, 0.45, 1.0),
    "right-side": (14.2, 0.45, 1.0),
    "rear": (0.0, 14.2, 1.0),
    "top": (0.0, 0.45, 14.2),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("clay", "water"), default="clay")
    parser.add_argument("--frames", default=",".join(str(frame) for frame in DEFAULT_FRAMES))
    parser.add_argument("--views", default=",".join(VIEW_POSITIONS))
    parser.add_argument("--size", type=int, default=640)
    return parser.parse_args(argv)


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def create_clay_material() -> bpy.types.Material:
    material = bpy.data.materials.get("REVIEW_Clay") or bpy.data.materials.new("REVIEW_Clay")
    material.use_nodes = True
    material.diffuse_color = (0.19, 0.39, 0.46, 1.0)
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.12, 0.31, 0.38, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.58
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def add_area_light(name: str, location, energy: float, size: float, color) -> bpy.types.Object:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, Vector((0.0, 0.2, 0.0)))
    return light


def setup_review_scene(size: int, mode: str) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False

    world = scene.world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.006, 0.020, 0.034, 1.0)
    background.inputs["Strength"].default_value = 0.32

    camera_data = bpy.data.cameras.new("REVIEW_Camera")
    camera_data.lens = 52
    camera_data.sensor_width = 36
    camera = bpy.data.objects.new("REVIEW_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    add_area_light("REVIEW_Key", (-6.5, -7.8, 10.0), 1450.0, 5.0, (0.64, 0.88, 1.0))
    add_area_light("REVIEW_Rim", (7.5, 2.5, 7.0), 1180.0, 4.0, (0.16, 0.72, 1.0))
    add_area_light("REVIEW_Fill", (0.0, 8.5, 4.0), 880.0, 5.0, (0.22, 0.48, 0.68))

    if mode == "clay":
        bpy.context.scene.view_layers[0].material_override = create_clay_material()
    else:
        bpy.context.scene.view_layers[0].material_override = None
    return camera


def main() -> None:
    args = parse_args()
    assert bpy.data.filepath, "open the authored .blend before running the review renderer"
    assert BODY_NAME in bpy.data.objects
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    frames = tuple(int(value) for value in args.frames.split(",") if value)
    views = tuple(value for value in args.views.split(",") if value)
    assert all(view in VIEW_POSITIONS for view in views)
    camera = setup_review_scene(args.size, args.mode)
    target = Vector((0.0, 0.35, 0.12))

    rendered = []
    for frame in frames:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for view in views:
            camera.location = VIEW_POSITIONS[view]
            if view == "top":
                camera.data.type = "ORTHO"
                camera.data.ortho_scale = 9.8
            else:
                camera.data.type = "PERSP"
                camera.data.lens = 52
            look_at(camera, target)
            file_path = output / f"{args.mode}_f{frame:03d}_{view}.png"
            bpy.context.scene.render.filepath = str(file_path)
            bpy.ops.render.render(write_still=True)
            rendered.append(file_path.name)
    print(f"REVIEW_RENDER_OK count={len(rendered)} output={output}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

"""Render five narrative stages from front, side, and top for emergence v2."""

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
from waterwing_emerge_v2_config import DEFAULT_REVIEW_DIR, REVIEW_FRAMES, REVIEW_VIEWS  # noqa: E402


VIEW_POSITIONS = {
    "axial-front": (0.0, -14.2, 1.0),
    "left-three-quarter": (-9.2, -10.6, 5.3),
    "left-side": (-14.2, 0.45, 1.0),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_REVIEW_DIR)
    parser.add_argument("--size", type=int, default=512)
    return parser.parse_args(argv)


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_clay_material() -> bpy.types.Material:
    material = bpy.data.materials.get("EMERGE_V2_REVIEW_Clay") or bpy.data.materials.new("EMERGE_V2_REVIEW_Clay")
    material.use_nodes = True
    material.diffuse_color = (0.11, 0.42, 0.53, 1.0)
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.065, 0.30, 0.40, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.48
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def add_area_light(name: str, location, energy: float, size: float, color) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, Vector((0.0, 0.15, -0.05)))


def setup_scene(size: int) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_layers[0].material_override = create_clay_material()
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.004, 0.014, 0.024, 1.0)
    background.inputs["Strength"].default_value = 0.30

    camera_data = bpy.data.cameras.new("EMERGE_V2_REVIEW_Camera")
    camera_data.lens = 52
    camera = bpy.data.objects.new("EMERGE_V2_REVIEW_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    add_area_light("EMERGE_V2_REVIEW_Key", (-6.8, -8.2, 10.5), 1650.0, 5.6, (0.62, 0.88, 1.0))
    add_area_light("EMERGE_V2_REVIEW_Rim", (7.8, 2.4, 7.2), 1260.0, 4.2, (0.16, 0.72, 1.0))
    add_area_light("EMERGE_V2_REVIEW_Fill", (0.0, 8.8, 4.0), 860.0, 5.0, (0.22, 0.48, 0.68))
    return camera


def main() -> None:
    args = parse_args()
    assert bpy.data.filepath, "open the emergence v2 .blend before rendering"
    assert BODY_NAME in bpy.data.objects
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    camera = setup_scene(args.size)
    target = Vector((0.0, 0.15, -0.02))
    rendered = []
    for frame in REVIEW_FRAMES:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for view in REVIEW_VIEWS:
            camera.location = VIEW_POSITIONS[view]
            camera.data.type = "PERSP"
            camera.data.lens = 52
            look_at(camera, target)
            file_path = output / f"clay_f{frame:03d}_{view}.png"
            bpy.context.scene.render.filepath = str(file_path)
            bpy.ops.render.render(write_still=True)
            rendered.append(file_path.name)
    assert len(rendered) == len(REVIEW_FRAMES) * len(REVIEW_VIEWS)
    print(f"EMERGENCE_V2_REVIEW_OK count={len(rendered)} output={output}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

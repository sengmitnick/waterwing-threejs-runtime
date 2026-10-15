"""Render clay multi-angle checks for direct-cast v2 and its projectile."""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from waterwing_direct_cast_v2_config import (  # noqa: E402
    DEFAULT_BLEND_PATH,
    DEFAULT_PROJECTILE_BLEND_PATH,
    PHASES,
    PROJECTILE_MESHES,
)
from waterwing_forward_v1_config import BODY_NAME  # noqa: E402


CHARACTER_VIEWS = {
    "front": (0.0, -14.4, 1.0),
    "three-quarter": (8.6, -11.2, 6.0),
    "side": (-14.4, 0.25, 1.0),
    "top": (0.0, 0.25, 14.4),
}
PROJECTILE_VIEWS = {
    "front": (0.0, -4.2, 0.15),
    "three-quarter": (2.8, -3.2, 2.0),
    "side": (-4.2, 0.15, 0.15),
    "rear": (0.0, 4.2, 0.15),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", type=Path, default=DEFAULT_BLEND_PATH)
    parser.add_argument("--projectile-blend", type=Path, default=DEFAULT_PROJECTILE_BLEND_PATH)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--size", type=int, default=480)
    return parser.parse_args(argv)


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_clay_material() -> bpy.types.Material:
    material = bpy.data.materials.get("REVIEW_DirectCastV2Clay") or bpy.data.materials.new("REVIEW_DirectCastV2Clay")
    material.use_nodes = True
    material.diffuse_color = (0.08, 0.41, 0.50, 1.0)
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.31, 0.39, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.46
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def add_area_light(name: str, location, energy: float, size: float, color, target: Vector) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, target)


def setup_scene(size: int, target: Vector) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = scene.world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.004, 0.014, 0.023, 1.0)
    background.inputs["Strength"].default_value = 0.30

    camera_data = bpy.data.cameras.new("REVIEW_DirectCastV2Camera")
    camera_data.lens = 54
    camera_data.sensor_width = 36
    camera = bpy.data.objects.new("REVIEW_DirectCastV2Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    add_area_light("REVIEW_V2_Key", (-6.5, -7.5, 10.0), 1550.0, 5.0, (0.63, 0.88, 1.0), target)
    add_area_light("REVIEW_V2_Rim", (7.2, 2.8, 7.2), 1280.0, 4.2, (0.12, 0.68, 1.0), target)
    add_area_light("REVIEW_V2_Fill", (0.0, 8.2, 3.8), 820.0, 5.2, (0.20, 0.43, 0.62), target)
    add_area_light("REVIEW_V2_Underfill", (0.0, -7.4, -4.8), 760.0, 4.8, (0.18, 0.62, 0.78), target)
    scene.view_layers[0].material_override = create_clay_material()
    return camera


def render_views(
    output: Path,
    prefix: str,
    views: dict[str, tuple[float, float, float]],
    camera: bpy.types.Object,
    target: Vector,
    ortho_scale: float,
) -> list[str]:
    files = []
    for name, position in views.items():
        camera.location = position
        if name == "top":
            camera.data.type = "ORTHO"
            camera.data.ortho_scale = ortho_scale
        else:
            camera.data.type = "PERSP"
            camera.data.lens = 54
        look_at(camera, target)
        relative = f"cast_{prefix}_{name}.png"
        bpy.context.scene.render.filepath = str(output / relative)
        bpy.ops.render.render(write_still=True)
        files.append(relative)
    return files


def render_character(blend: Path, output: Path, size: int) -> tuple[list[str], list[str]]:
    assert blend.exists(), blend
    bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()))
    assert BODY_NAME in bpy.data.objects
    target = Vector((0.0, 0.25, 0.10))
    camera = setup_scene(size, target)
    files = []
    phases = []
    for name, frame in PHASES[:-1]:
        phases.append(name)
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        files.extend(render_views(output, f"{name}_f{frame:03d}", CHARACTER_VIEWS, camera, target, 9.8))
    return phases, files


def render_projectile(blend: Path, output: Path, size: int) -> list[str]:
    assert blend.exists(), blend
    bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()))
    assert all(name in bpy.data.objects for name in PROJECTILE_MESHES)
    target = Vector((0.0, 0.12, 0.0))
    camera = setup_scene(size, target)
    return render_views(output, "projectile", PROJECTILE_VIEWS, camera, target, 2.3)


def main() -> None:
    args = parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    phases, character_files = render_character(args.blend, output, args.size)
    projectile_files = render_projectile(args.projectile_blend, output, args.size)
    review = {
        "character": {
            "views": list(CHARACTER_VIEWS),
            "phases": phases,
            "files": character_files,
        },
        "projectile": {
            "views": list(PROJECTILE_VIEWS),
            "files": projectile_files,
        },
    }
    (output / "review-index.json").write_text(
        json.dumps(review, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"DIRECT_CAST_V2_REVIEW_OK count={len(character_files) + len(projectile_files)} output={output}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

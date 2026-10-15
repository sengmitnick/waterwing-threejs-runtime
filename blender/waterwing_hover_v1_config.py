"""Public contract for the dedicated Waterwing hover asset."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 181
ASSET_VERSION = "waterwing-hover-v1"
CLIP_NAME = "WW_hover_loop_v1"
MORPH_CLIP_NAME = "WW_hover_loop_v1_Morphs"
MORPH_NAMES = (
    "Hover_Lift",
    "Hover_Sink",
    "Wing_Ripple_L",
    "Wing_Ripple_R",
    "Body_Breathe",
    "Tail_Sway_L",
    "Tail_Sway_R",
    "Surface_Wobble",
)
KEY_FRAMES = (1, 25, 49, 73, 97, 121, 145, 169, 181)

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"

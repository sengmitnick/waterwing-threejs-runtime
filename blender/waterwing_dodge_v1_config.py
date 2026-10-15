"""Public contract for the dedicated Waterwing lateral-dodge asset."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 76
ASSET_VERSION = "waterwing-dodge-v1"
CLIP_NAME = "WW_dodge_v1"
MORPH_CLIP_NAME = "WW_dodge_v1_Morphs"
MORPH_NAMES = (
    "Dodge_Anticipate",
    "Dodge_Bank",
    "Dodge_Streamline",
    "Dodge_Brake",
    "Dodge_Recovery",
    "Wing_Fold_L",
    "Wing_Fold_R",
    "Tail_CounterSweep",
)
KEY_FRAMES = (1, 10, 22, 30, 43, 58, 76)
REVIEW_FRAMES = (1, 10, 30, 43, 76)
REVIEW_VIEWS = ("axial-front", "right-side", "top")

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"
DEFAULT_REVIEW_DIR = RUNTIME_ROOT / "render" / ASSET_VERSION

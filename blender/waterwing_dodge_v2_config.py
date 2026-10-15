"""Public contract for the corrected Waterwing lateral-dodge v2 asset."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 91
ASSET_VERSION = "waterwing-dodge-v2"
CLIP_NAME = "WW_dodge_v2"
MORPH_CLIP_NAME = "WW_dodge_v2_Morphs"
MORPH_NAMES = (
    "Dodge_Anticipate",
    "Dodge_Bank",
    "Dodge_Streamline",
    "Dodge_Burst_Corrective",
    "Dodge_Burst_Buffer",
    "Dodge_Brake",
    "Dodge_Recovery",
    "Wing_Sweep_L",
    "Wing_Sweep_R",
    "Tail_CounterSweep",
)

# Hover -> compressed tell -> burst -> first unfold buffer -> braking spread ->
# reverse tail counter-sweep -> stable recovery.  The two intermediate stages
# deliberately remove the v1 burst-to-full-spread snap.
KEY_FRAMES = (1, 13, 31, 43, 55, 67, 91)
REVIEW_FRAMES = KEY_FRAMES
REVIEW_VIEWS = ("axial-front", "left-three-quarter", "right-side", "top")

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"
DEFAULT_REVIEW_DIR = RUNTIME_ROOT / "render" / ASSET_VERSION

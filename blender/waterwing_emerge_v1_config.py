"""Public contract for the dedicated Waterwing water-emergence asset."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 151
ASSET_VERSION = "waterwing-emerge-v1"
CLIP_NAME = "WW_emerge_once_v1"
MORPH_CLIP_NAME = "WW_emerge_once_v1_Morphs"
MORPH_NAMES = (
    "Emerge_Puddle",
    "Emerge_WingBud",
    "Emerge_Rise",
    "Emerge_Unfurl",
    "Emerge_Droplets",
    "Emerge_Stabilize",
)

# Narrative milestones: a low water mass, visible wing roots, a rising body,
# the decisive wing opening, and a complete hovering creature.
PHASE_FRAMES = {
    "puddle": 1,
    "wingBud": 31,
    "rise": 76,
    "unfurl": 113,
    "hover": 151,
}
KEY_FRAMES = (1, 16, 31, 39, 61, 76, 96, 113, 136, 151)
REVIEW_FRAMES = (1, 39, 76, 114, 151)
REVIEW_VIEWS = ("axial-front", "left-side", "top")

RIPPLE_NAME = "EmergenceRipple"
DROPLETS_NAME = "EmergenceDroplets"

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"

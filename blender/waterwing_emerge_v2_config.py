"""Public contract for the rebuilt underwater-condensation emergence asset."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 151
ASSET_VERSION = "waterwing-emerge-v2"
CLIP_NAME = "WW_emerge_once_v2"
MORPH_CLIP_NAME = "WW_emerge_once_v2_Morphs"
MORPH_NAMES = (
    "Emerge_Amorphous",
    "Emerge_WingRoots",
    "Emerge_WingDraw_L",
    "Emerge_WingDraw_R",
    "Emerge_BodyLift",
    "Emerge_TailRelease",
    "Emerge_Unfurl",
    "Emerge_HoverSettle",
)

# Dense keys make the side-to-side wing draw and late tail release legible
# without adding root motion.  The game layer remains responsible for world
# placement above the source waterfall or pool.
KEY_FRAMES = (1, 16, 31, 45, 61, 82, 104, 113, 132, 151)
PHASE_FRAMES = {
    "amorphous": 1,
    "wingRoots": 40,
    "bodyLift": 82,
    "tailRelease": 113,
    "hover": 151,
}
REVIEW_FRAMES = (1, 40, 82, 113, 151)
REVIEW_VIEWS = ("axial-front", "left-three-quarter", "left-side")

POOL_NAME = "EmergencePoolIrregular"
DROPLET_PREFIX = "EmergeDroplet_"
DROPLET_COUNT = 9

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"
DEFAULT_REVIEW_DIR = RUNTIME_ROOT / "render" / ASSET_VERSION

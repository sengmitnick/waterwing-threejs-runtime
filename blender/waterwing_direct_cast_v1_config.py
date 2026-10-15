"""Public contract for the dedicated Waterwing direct-cast action."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 115
ASSET_VERSION = "waterwing-direct-cast-v1"
PROJECTILE_VERSION = "enemy-direct-waterball-v1"
CLIP_NAME = "WW_direct_cast_v1"
MORPH_CLIP_NAME = "WW_direct_cast_v1_Morphs"

PHASES = (
    ("neutral", 1),
    ("gather", 19),
    ("compress", 37),
    ("aim", 55),
    ("release", 67),
    ("recoil", 77),
    ("recover", 97),
    ("settled", 115),
)
KEY_FRAMES = tuple(frame for _, frame in PHASES)
REVIEW_FRAMES = (1, 19, 37, 55, 67, 77, 97, 115)

MORPH_NAMES = (
    "Cast_Gather",
    "Cast_Compress",
    "Cast_Aim",
    "Cast_Recoil",
    "Cast_Recovery",
    "Wing_Channel_L",
    "Wing_Channel_R",
    "Surface_Tension",
)

PROJECTILE_ROOT = "EnemyDirectWaterball"
PROJECTILE_MESHES = ("WaterBulb", "ShortFluidTail")
PROJECTILE_ANCHORS = ("center-anchor", "impact-anchor")

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"
DEFAULT_PROJECTILE_BLEND_PATH = DEFAULT_ASSET_DIR / f"{PROJECTILE_VERSION}.blend"
DEFAULT_PROJECTILE_GLB_PATH = DEFAULT_ASSET_DIR / f"{PROJECTILE_VERSION}.glb"
DEFAULT_PROJECTILE_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{PROJECTILE_VERSION}.manifest.json"

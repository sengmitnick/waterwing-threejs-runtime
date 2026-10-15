"""Public contract for the volume-safe Waterwing direct-cast v2 action."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 133
ASSET_VERSION = "waterwing-direct-cast-v2"
PROJECTILE_VERSION = "enemy-direct-waterball-v2"
CLIP_NAME = "WW_direct_cast_v2"
MORPH_CLIP_NAME = "WW_direct_cast_v2_Morphs"

PHASES = (
    ("neutral", 1),
    ("gather", 21),
    ("charge", 43),
    ("aim", 61),
    ("release", 73),
    ("recoil", 83),
    ("tail-lag", 97),
    ("recover", 117),
    ("settled", 133),
)
KEY_FRAMES = tuple(frame for _, frame in PHASES)
REVIEW_FRAMES = tuple(frame for _, frame in PHASES[:-1])

MORPH_NAMES = (
    "Cast_Gather",
    "Cast_AimLift",
    "Cast_FullBodyRecoil",
    "Cast_WingWave_L",
    "Cast_WingWave_R",
    "Cast_TailLag",
    "Cast_ChestVolume_Corrective",
)

CHARGE_NODES = ("MuzzleCharge", "MuzzleDroplet_L", "MuzzleDroplet_R")
PROJECTILE_ROOT = "EnemyDirectWaterball"
PROJECTILE_MESHES = ("WaterBulb", "ShortFluidTail", "WakeDroplet")
PROJECTILE_ANCHORS = ("center-anchor", "impact-anchor")

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"
DEFAULT_PROJECTILE_BLEND_PATH = DEFAULT_ASSET_DIR / f"{PROJECTILE_VERSION}.blend"
DEFAULT_PROJECTILE_GLB_PATH = DEFAULT_ASSET_DIR / f"{PROJECTILE_VERSION}.glb"
DEFAULT_PROJECTILE_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{PROJECTILE_VERSION}.manifest.json"

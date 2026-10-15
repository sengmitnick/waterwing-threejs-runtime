"""Deterministic public contract for the Waterwing forward asset."""

from pathlib import Path


FPS = 30
FRAME_START = 1
FRAME_END = 121
ASSET_VERSION = "waterwing-forward-v1"
ROOT_NAME = "Waterwing"
RIG_NAME = "WaterwingRig"
BODY_NAME = "WaterwingBody"
CORE_NAME = "WeakWaterCore"
CLIP_NAME = "WW_forward_loop_v1"
MORPH_CLIP_NAME = "WW_forward_loop_v1_Morphs"

MORPH_NAMES = (
    "Propel_Preload",
    "Propel_Power",
    "Propel_Recovery",
    "Body_Compress",
    "Body_Stretch",
    "Wing_Cup_L",
    "Wing_Cup_R",
    "Tail_Drag",
)

ANCHOR_NAMES = (
    "health-anchor",
    "muzzle-anchor",
    "impact-anchor",
    "waterline-anchor",
    "wingtip-left",
    "wingtip-right",
    "tailtip-anchor",
)

BONE_NAMES = (
    "root",
    "body_front",
    "body_mid",
    "body_rear",
    "wing_L_root",
    "wing_L_mid",
    "wing_L_tip",
    "wing_L_web",
    "wing_R_root",
    "wing_R_mid",
    "wing_R_tip",
    "wing_R_web",
    "tail_01",
    "tail_02",
    "tail_03",
)

REVIEW_VIEWS = {
    "propulsion": (5.2, -7.0, 4.3),
    "axial-front": (0.0, -8.0, 0.35),
    "left-side": (-8.0, 0.0, 0.55),
    "right-side": (8.0, 0.0, 0.55),
    "rear": (0.0, 8.0, 0.55),
    "top": (0.0, 0.0, 9.0),
}
REVIEW_FRAMES = (1, 31, 61, 91, 121)
KEY_FRAMES = (1, 13, 27, 36, 45, 58, 72, 84, 94, 108, 121)

# The creature faces Blender -Y.  The regular ring topology is deliberately
# dense enough for close review while staying cheap enough for three enemies.
LONGITUDINAL_SEGMENTS = 81
RING_SEGMENTS = 160
Y_MIN = -2.72
Y_MAX = 4.18

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_DIR = RUNTIME_ROOT / "assets" / "blender" / ASSET_VERSION
DEFAULT_BLEND_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.blend"
DEFAULT_GLB_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.glb"
DEFAULT_MANIFEST_PATH = DEFAULT_ASSET_DIR / f"{ASSET_VERSION}.manifest.json"

# Low-frequency outline stations.  Width values include the integrated wings
# and tail so the final mesh has no pasted-on plates or nozzle-shaped rear.
OUTLINE_STATIONS = (
    (-2.72, 0.18),
    (-2.58, 0.34),
    (-2.34, 1.18),
    (-2.02, 2.45),
    (-1.54, 3.48),
    (-0.92, 3.94),
    (-0.28, 4.10),
    (0.34, 3.82),
    (0.94, 3.16),
    (1.46, 2.14),
    (1.84, 1.04),
    (2.08, 0.42),
    (2.44, 0.27),
    (2.82, 0.39),
    (3.18, 0.58),
    (3.52, 0.52),
    (3.82, 0.30),
    (4.18, 0.02),
)

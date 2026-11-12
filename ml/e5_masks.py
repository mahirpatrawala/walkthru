"""E5: masks for Brush (SPEC 15.5). White = keep, black = ignore.

Blown-out windows and glass: pixels over 250 luma in connected regions over 2% of the frame (dilated 6 px so the glare edge goes too).
DA3 Metric sky segmentation was not run (its weights were not approved), so luma is the only cue.

  python e5_masks.py make <fragment_dir_name> [first] [last]    writes runs/e5/<frag>/masks/<frame>.png
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import *

LUMA = 250
MIN_FRAC = 0.02


def glass_mask(bgr: np.ndarray, luma: int = LUMA, min_frac: float = MIN_FRAC, dilate_px: int = 6) -> np.ndarray:
    """uint8 mask, 255 = keep, 0 = blown-out region."""
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hot = (g > luma).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hot, connectivity=8)
    drop = np.zeros_like(hot)
    for k in range(1, n):
        if stats[k, cv2.CC_STAT_AREA] > min_frac * g.size:
            drop[lab == k] = 1
    if dilate_px and drop.any():
        drop = cv2.dilate(drop, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilate_px + 1, 2 * dilate_px + 1)))
    return np.where(drop > 0, 0, 255).astype(np.uint8)


def make(names: list[str], out_dir: Path, src_images: Path = BASELINE / "images") -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    masked = 0
    fracs = []
    for n in names:
        im = cv2.imread(str(src_images / n))
        m = glass_mask(im)
        cv2.imwrite(str(out_dir / (Path(n).stem + ".png")), m)
        f = float((m == 0).mean())
        fracs.append(f)
        masked += f > 0
    return {"frames": len(names), "framesWithMask": masked, "meanMaskedFraction": float(np.mean(fracs)), "maxMaskedFraction": float(np.max(fracs))}


if __name__ == "__main__":
    ims = read_images_txt(BASELINE / "txt/3/images.txt")
    names = sorted(i.name for i in ims.values())
    print(make(names, RUNS / "e5" / "masks"))

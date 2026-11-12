"""E4: a rough layout from points (SPEC 15.5). numpy core in layout_planes.py.

  python e4_layout.py synthetic                 the always-testable bar: 10 seeds of the truth bedroom cloud
  python e4_layout.py real <cloud.npy|moge>     real video: levelled metric cloud -> ml/layout-proposal.json
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "tests"))
from common import *
from layout_planes import level_cloud, polygon_area, propose_layout

NODE = str(HOME / ".local/node/bin")


def synthetic():
    from test_layout_planes import bedroom_cloud
    t0 = time.time()
    areas, wall_err = [], []
    for seed in range(10):
        pts = bedroom_cloud(seed=seed, rot_deg=(0.0 if seed < 5 else 17.0 * seed))
        prop = propose_layout(pts, wall_h=2.6)
        poly = np.array([[p["x"], p["z"]] for p in prop["rooms"][0]["polygon"]])
        areas.append(polygon_area(poly))
        # wall lines: the four sides' distance to the truth lines. Truth is a 4 x 5 rectangle; compare sorted side lengths
        # and the polygon's offset: every side's two end vertices must lie within tolerance of the truth rectangle edges.
        import math
        rot = math.radians(0.0 if seed < 5 else 17.0 * seed)
        R = np.array([[math.cos(rot), math.sin(rot)], [-math.sin(rot), math.cos(rot)]])   # x' = x cos + z sin (same as y-rotation in bedroom_cloud)
        truth = np.array([[0, 0], [4, 0], [4, 5], [0, 5]], float) @ R.T
        errs = []
        for i in range(4):
            a, b = truth[i], truth[(i + 1) % 4]
            d = (b - a) / np.linalg.norm(b - a)
            n = np.array([-d[1], d[0]])
            # distance of every polygon vertex that lies near this truth edge to the truth line
            for p in poly:
                off = abs((p - a) @ n)
                along = (p - a) @ d
                if off < 0.3 and -0.3 < along < np.linalg.norm(b - a) + 0.3:
                    errs.append(off)
        wall_err.append(max(errs) if errs else float("nan"))
    area_err = [100 * abs(a - 20.0) / 20.0 for a in areas]
    m = {"seeds": 10, "areaMedianM2": float(np.median(areas)), "areaErrMaxPct": max(area_err), "wallLineErrMaxCm": 100 * float(np.nanmax(wall_err)),
         "wallLineErrMedianCm": 100 * float(np.nanmedian(wall_err))}
    ok = m["areaErrMaxPct"] <= 5 and m["wallLineErrMaxCm"] <= 5
    write_report_entry(entry("E4", "synthetic", "RANSAC/histogram planes (own numpy code)", "ours", True, m, bool(ok), (time.time() - t0) / 60, peak_rss_gb(),
        "Truth flat's bedroom 4 x 5 m = 20 m2, 2 cm noise, 30% of wall points removed at random, 5% outliers; 10 seeds, 5 unrotated and 5 rotated about Y. "
        "Wall-line error = largest distance of any recovered corner to its truth wall line."))
    print(json.dumps(m, indent=1), "passed" if ok else "FAILED")


def real():
    """Real video: MoGe-2 S depth on the baseline COLMAP poses (largest fragment), COLMAP units -> metres with E2's scale."""
    import cv2
    wait_for_idle()
    from e2_scale import Moge2S, load_baseline, sparse_pairs, scale_from_depths
    t0 = time.time()
    e2 = json.loads((RUNS / "e2" / "moge2-s.json").read_text())
    s_vote = e2["scaleMedian"]
    cams, ims, pts3 = load_baseline()
    cam = next(iter(cams.values()))
    K = np.array([[cam.params[0], 0, cam.params[2]], [0, cam.params[1], cam.params[3]], [0, 0, 1.0]])
    M = Moge2S()
    names = sorted(i.name for i in ims.values())[::2]
    by = {i.name: i for i in ims.values()}
    cloud, down = [], []
    for k, n in enumerate(names):
        im = by[n]
        bgr = cv2.imread(str(BASELINE / "images" / n))
        D, P, mask = M.infer(bgr, K)
        md, cd = sparse_pairs(im, pts3, D)
        s_i = scale_from_depths(md, cd) or s_vote
        sub = (slice(None, None, 8), slice(None, None, 8))
        Pm = P[sub].reshape(-1, 3)
        ok = mask[sub].reshape(-1) & np.isfinite(Pm).all(1)
        # metric camera point -> metres in the metric frame of the COLMAP world: world_colmap = R^T (p / s_i - t); metres = s_vote * world_colmap
        pc = Pm[ok] / s_i
        pw = (pc - im.t) @ im.R
        cloud.append(pw * s_vote)
        down.append(im.R.T @ np.array([0.0, 1.0, 0.0]))
        if k % 10 == 0:
            print(k, len(names), flush=True)
    cloud = np.vstack(cloud)
    up = -np.mean(down, axis=0)
    lv, R, t, floor_frac = level_cloud(cloud, up)
    # ceiling from the levelled cloud: densest height peak above 2 m
    y = lv[:, 1]
    hist, edges = np.histogram(y[(y > 1.8) & (y < 4.0)], bins=110, range=(1.8, 4.0))
    ceil_h = float((edges[np.argmax(hist)] + edges[np.argmax(hist) + 1]) / 2)
    ceil_file = json.loads((ML_OUT / "ceiling.json").read_text()) if (ML_OUT / "ceiling.json").exists() else None
    prop = propose_layout(lv, wall_h=ceil_h)
    prop["notes"].append("Machine-made from MoGe-2 ViT-S depth on COLMAP poses of the first 13 s (largest fragment); metres from E2 scale; rooms are one rectilinear footprint per connected region, not separate rooms. Check every wall before use.")
    ML_OUT.mkdir(parents=True, exist_ok=True)
    (ML_OUT / "layout-proposal.json").write_text(json.dumps(prop, indent=2) + "\n")
    write_ply(RUNS / "e4_real_levelled.ply", lv[::3].astype(np.float32))
    v = subprocess.run([f"{NODE}/npx", "tsx", "ml/validate-proposal.ts", str(ML_OUT / "layout-proposal.json")], cwd=str(REPO),
                       capture_output=True, text=True, env={**os.environ, "PATH": f"{NODE}:{os.environ['PATH']}"})
    val = json.loads(v.stdout.strip().splitlines()[-1]) if v.returncode == 0 and v.stdout.strip() else {"errors": ["validator failed: " + v.stderr[-300:]], "warnings": []}
    areas = [abs(polygon_area(np.array([[p["x"], p["z"]] for p in r["polygon"]]))) for r in prop["rooms"]]
    e2c = ceil_file["heightM"] if ceil_file else float("nan")
    m = {"cloudPoints": int(len(cloud)), "floorInlierFraction": floor_frac, "rooms": len(prop["rooms"]), "largestRoomM2": max(areas), "openings": len(prop["openings"]),
         "validateLayoutErrors": len(val["errors"]), "validateLayoutWarnings": len(val["warnings"]), "ceilingFromCloudM": ceil_h, "ceilingE2M": e2c,
         "ceilingDisagreementPct": 100 * abs(ceil_h - e2c) / e2c, "confidence": prop["confidence"], "frames": len(names)}
    ok = m["validateLayoutErrors"] == 0 and m["largestRoomM2"] >= 6 and m["ceilingDisagreementPct"] <= 10 and prop["confidence"] <= 0.4
    write_report_entry(entry("E4", "real", "MoGe-2 ViT-S point maps on COLMAP poses + own numpy planes", "MIT (model), ours (planes)", True, m, bool(ok), (time.time() - t0) / 60, peak_rss_gb(),
        f"Cloud: MoGe-2 ViT-S depth on every 2nd frame of the baseline's largest fragment (67 frames, stride 8 px), per-frame scaled to COLMAP then to metres with E2's vote. Floor RANSAC on the lowest 40% of heights with the gravity guess from camera 'down' axes. "
        f"validateLayout errors: {val['errors']}; warnings: {val['warnings']}. The E3 chained cloud was not used because it breaks up after about 13 s."))
    print(json.dumps(m, indent=1), val)


if __name__ == "__main__":
    {"synthetic": synthetic, "real": real}[sys.argv[1]]()

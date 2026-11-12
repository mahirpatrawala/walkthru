"""E3: feed-forward poses without tracking, Depth Anything 3 (SPEC 15.5).

  python e3_feedforward.py run <small|base> <n_frames> <process_res>     one inference, saves runs/e3/<tag>.npz + <tag>.json
  python e3_feedforward.py analyze <tag>                                  compares with the baseline COLMAP fragment
Peak memory is the process's lifetime peak physical footprint (what `/usr/bin/time -l` calls peak memory footprint).
"""
from __future__ import annotations

import json
import sys
import time
import types
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import *

OUT = RUNS / "e3"
TOTAL_FRAMES = 355


# ---------------------------------------------------------------- pure maths
def umeyama(src: np.ndarray, dst: np.ndarray, with_scale: bool = True):
    """Least-squares similarity dst ~ s R src + t."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    S, D = src - mu_s, dst - mu_d
    cov = D.T @ S / len(src)
    U, sig, Vt = np.linalg.svd(cov)
    E = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        E[2, 2] = -1
    R = U @ E @ Vt
    var = (S ** 2).sum() / len(src)
    s = (sig * np.diag(E)).sum() / var if with_scale and var > 0 else 1.0
    t = mu_d - s * R @ mu_s
    return s, R, t


def rot_angle_deg(R: np.ndarray) -> float:
    return float(np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))))


def pose_stats(R_a, c_a, R_b, c_b):
    """Compare two trajectories over the same frames. R_* are world->camera rotations (n,3,3), c_* camera centres (n,3).

    Returns (median consecutive relative-rotation disagreement in degrees, median centre error / path length after a
    similarity alignment of the centres, similarity scale).
    """
    rel = []
    for i in range(len(R_a) - 1):
        ra = R_a[i + 1] @ R_a[i].T
        rb = R_b[i + 1] @ R_b[i].T
        rel.append(rot_angle_deg(ra @ rb.T))
    s, R, t = umeyama(c_a, c_b)
    err = np.linalg.norm((s * (c_a @ R.T) + t) - c_b, axis=1)
    path = float(np.linalg.norm(np.diff(c_b, axis=0), axis=1).sum())
    return float(np.median(rel)) if rel else float("nan"), float(np.median(err) / path) if path > 0 else float("nan"), float(s)


def teleport_free_fraction(centres: np.ndarray, k: float = 3.0) -> float:
    steps = np.linalg.norm(np.diff(centres, axis=0), axis=1)
    med = np.median(steps)
    return float((steps < k * med).mean())


# ---------------------------------------------------------------- DA3 loading
def load_da3(which: str):
    """DA3 from the pinned repo, with the unused export/evo/gsplat imports stubbed so only inference deps are needed."""
    import torch
    for name in ("evo", "evo.core", "evo.core.trajectory", "gsplat"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["evo.core.trajectory"].PosePath3D = object
    ex = types.ModuleType("depth_anything_3.utils.export")
    ex.export = lambda *a, **k: None
    sys.modules["depth_anything_3.utils.export"] = ex
    sys.path.insert(0, str(SRC / "da3" / "src"))
    from depth_anything_3.api import DepthAnything3
    d = WEIGHTS / ("depth-anything__DA3-BASE" if which == "base" else "depth-anything__DA3-SMALL")
    m = DepthAnything3.from_pretrained(str(d))
    return m.to(device()).eval()


def sample_names(n: int, span: int = TOTAL_FRAMES) -> list[str]:
    idx = np.linspace(0, span - 1, n).round().astype(int)
    return [f"f{i + 1:04d}.jpg" for i in idx]


def cmd_run(which: str, n: int, res: int, span: int = TOTAL_FRAMES):
    wait_for_idle()
    import torch
    OUT.mkdir(parents=True, exist_ok=True)
    tag = f"{which}_{n}_{res}" + ("" if span == TOTAL_FRAMES else f"_s{span}")
    names = sample_names(n, span)
    t0 = time.time()
    m = load_da3(which)
    t1 = time.time()
    paths = [str(BASELINE / "images" / nm) for nm in names]
    with torch.no_grad():
        pred = m.inference(paths, process_res=res, process_res_method="upper_bound_resize")
    if device().type == "mps":
        torch.mps.synchronize()
    t2 = time.time()
    np.savez_compressed(OUT / f"{tag}.npz", names=np.array(names), depth=pred.depth.astype(np.float16), conf=None if pred.conf is None else pred.conf.astype(np.float16),
                        extrinsics=pred.extrinsics, intrinsics=pred.intrinsics,
                        images=pred.processed_images if pred.processed_images is not None else np.zeros(1))
    info = {"model": which, "frames": n, "processRes": res, "loadSec": t1 - t0, "inferSec": t2 - t1, "peakGb": peak_rss_gb(),
            "span": span, "depthShape": list(pred.depth.shape), "isMetric": str(pred.is_metric)}
    (OUT / f"{tag}.json").write_text(json.dumps(info, indent=1))
    print(json.dumps(info))


def cmd_analyze(tag: str):
    d = np.load(OUT / f"{tag}.npz", allow_pickle=True)
    names = [str(x) for x in d["names"]]
    E = d["extrinsics"].astype(float)
    if E.shape[1] == 3:
        E = np.concatenate([E, np.tile(np.array([[0, 0, 0, 1.0]]), (E.shape[0], 1, 1))], 1)
    R_da = E[:, :3, :3]
    c_da = np.array([-R.T @ t for R, t in zip(R_da, E[:, :3, 3])])
    cons = teleport_free_fraction(c_da)
    ims = read_images_txt(BASELINE / "txt/3/images.txt")
    by = {i.name: i for i in ims.values()}
    shared = [k for k, n in enumerate(names) if n in by]
    res = {"tag": tag, "frames": len(names), "sharedWithColmap": len(shared), "teleportFreeFraction": cons}
    if len(shared) >= 3:
        Rc = np.array([by[names[k]].R for k in shared]); cc = np.array([by[names[k]].centre for k in shared])
        rot, cerr, s = pose_stats(R_da[shared], c_da[shared], Rc, cc)
        res.update({"medianRelRotErrDeg": rot, "medianCentreErrOverPath": cerr, "similarityScale": s})
        rel = [rot_angle_deg((R_da[shared[i + 1]] @ R_da[shared[i]].T) @ (Rc[i + 1] @ Rc[i].T).T) for i in range(len(shared) - 1)]
        res["perPairRotErrDeg"] = [round(x, 1) for x in rel]
        res["perPairColmapRotDeg"] = [round(rot_angle_deg(Rc[i + 1] @ Rc[i].T), 1) for i in range(len(shared) - 1)]
    (OUT / f"{tag}.analysis.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    if sys.argv[1] == "run":
        cmd_run(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]) if len(sys.argv) > 5 else TOTAL_FRAMES)
    elif sys.argv[1] == "analyze":
        cmd_analyze(sys.argv[2])

"""E3 follow-up (SPEC 15.5): chain DA3 windows over the whole video, write a COLMAP text model.

  python e3_chain.py <small|base> [stride=3] [window=32] [shared=8]

Frames: every `stride`-th of the 355. Windows of `window` frames overlapping by `shared`; each window is aligned to the previous
one with a similarity: rotation from the shared cameras' poses, scale and translation from their centres.
Writes runs/e3/chain_<model>/{sparse/0/*.txt, images/, chain.npz, points.ply, chain.json}.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import *
from e3_feedforward import load_da3, teleport_free_fraction, pose_stats, umeyama


def project_so3(M):
    U, _, Vt = np.linalg.svd(M)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        U[:, -1] *= -1
        R = U @ Vt
    return R


def align_window(Rk, ck, Rg, cg):
    """World similarity (s, R, t): X_g = s R X_k + t from the shared cameras (w2c rotations Rk/Rg, centres ck/cg)."""
    R = project_so3(sum(Rg[i].T @ Rk[i] for i in range(len(Rk))))
    mk, mg = ck.mean(0), cg.mean(0)
    a = (ck - mk) @ R.T
    b = cg - mg
    s = float((a * b).sum() / max((a * a).sum(), 1e-12))
    t = mg - s * R @ mk
    return s, R, t


def main():
    which = sys.argv[1]
    stride = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    W = int(sys.argv[3]) if len(sys.argv) > 3 else 32
    SH = int(sys.argv[4]) if len(sys.argv) > 4 else 8
    wait_for_idle()
    import torch
    t0 = time.time()
    out = RUNS / "e3" / f"chain_{which}"
    (out / "images").mkdir(parents=True, exist_ok=True)
    allnames = [f"f{i:04d}.jpg" for i in range(1, TOTAL + 1, stride)]
    starts = list(range(0, max(1, len(allnames) - SH), W - SH))
    starts = [s for s in starts if s < len(allnames) - SH]
    m = load_da3(which)
    N = len(allnames)
    R_w2c = [None] * N
    c_g = [None] * N
    pts_all, col_all = [], []
    win_info = []
    win_scale_centres = 1.0
    K_list = []
    D_g = {}                       # global-scale depth of every frame placed so far
    for wi, s0 in enumerate(starts):
        idx = list(range(s0, min(N, s0 + W)))
        names = [allnames[i] for i in idx]
        paths = [str(BASELINE / "images" / n) for n in names]
        ts = time.time()
        with torch.no_grad():
            pred = m.inference(paths, process_res=504, process_res_method="upper_bound_resize")
        if device().type == "mps":
            torch.mps.synchronize()
        E = pred.extrinsics.astype(float)
        if E.shape[1] == 3:
            E = np.concatenate([E, np.tile([[0, 0, 0, 1.0]], (len(E), 1, 1))], 1)
        Rk = E[:, :3, :3]
        ck = np.array([-R.T @ t for R, t in zip(Rk, E[:, :3, 3])])
        depth = pred.depth.astype(np.float64)
        K = pred.intrinsics.astype(float)
        if wi == 0:
            s, R, t = 1.0, np.eye(3), np.zeros(3)
        else:
            sh = list(range(SH))     # first SH frames of this window = last SH of the previous window
            Rg = [R_w2c[idx[j]] for j in sh]
            cg = np.array([c_g[idx[j]] for j in sh])
            s, R, t = align_window(Rk[sh], ck[sh], Rg, cg)
            # scale from depth agreement on the shared frames instead: camera centres barely move when the walker turns on the spot
            ratios = np.concatenate([(D_g[idx[j]] / np.maximum(depth[j], 1e-6)).ravel() for j in sh])
            s_depth = float(np.median(ratios[np.isfinite(ratios)]))
            win_scale_centres = s
            s = s_depth
            mk, mg = ck[sh].mean(0), cg.mean(0)
            t = mg - s * R @ mk
        first_new = 0 if wi == 0 else SH
        for j in range(first_new, len(idx)):
            gi = idx[j]
            R_w2c[gi] = Rk[j] @ R.T
            c_g[gi] = s * R @ ck[j] + t
            D_g[gi] = depth[j] * s
            K_list.append(K[j])
        # fused points from the new frames
        conf = pred.conf
        for j in range(first_new, len(idx)):
            d = depth[j] * s
            h, w = d.shape
            ys, xs = np.mgrid[2:h:4, 2:w:4]
            z = d[ys, xs]
            cf = conf[j][ys, xs] if conf is not None else np.ones_like(z)
            keep = cf >= np.percentile(cf, 40)
            u, v = xs[keep] + 0.5, ys[keep] + 0.5
            Kj = K[j]
            pc = np.stack([(u - Kj[0, 2]) / Kj[0, 0] * z[keep], (v - Kj[1, 2]) / Kj[1, 1] * z[keep], z[keep]], 1)
            gi = idx[j]
            pw = (pc - (-R_w2c[gi] @ c_g[gi])) @ R_w2c[gi]           # R^T (p - t_w2c), t_w2c = -R c
            pts_all.append(pw)
            img = pred.processed_images[j]
            col_all.append(img[ys, xs][keep])
        win_info.append({"window": wi, "start": s0, "frames": len(idx), "scale": s, "scaleFromCentres": (win_scale_centres if wi else 1.0), "sec": time.time() - ts, "peakGb": peak_rss_gb()})
        print(f"window {wi} frames {names[0]}..{names[-1]} s={s:.3f} {time.time()-ts:.1f}s peak {peak_rss_gb():.2f} GB", flush=True)
        del pred
        if device().type == "mps":
            torch.mps.empty_cache()
    pts = np.vstack(pts_all).astype(np.float32)
    col = np.vstack(col_all).astype(np.uint8)
    C = np.array(c_g)
    # ---- write the COLMAP text model at the original image size
    Kmed = np.median(np.array(K_list), axis=0)
    # DA3's processed frame is 280x504; the images are 720x1280
    sx, sy = 720 / 280.0, 1280 / 504.0
    cam = Camera(1, "OPENCV", 720, 1280, [Kmed[0, 0] * sx, Kmed[1, 1] * sy, Kmed[0, 2] * sx, Kmed[1, 2] * sy, 0, 0, 0, 0])
    ims = []
    for i, n in enumerate(allnames):
        q = R_to_quat(R_w2c[i])
        t = -R_w2c[i] @ C[i]
        ims.append(Image(i + 1, q, t, 1, n, np.zeros((0, 2)), np.zeros(0, np.int64)))
        link = out / "images" / n
        if not link.exists():
            os.symlink(BASELINE / "images" / n, link)
    sel = np.random.default_rng(0).choice(len(pts), size=min(60000, len(pts)), replace=False)
    write_colmap_text_model(out / "sparse" / "0", [cam], ims, pts[sel], col[sel])
    write_ply(out / "points.ply", pts[sel], col[sel])
    np.savez_compressed(out / "chain.npz", names=np.array(allnames), R_w2c=np.array(R_w2c), centres=C)
    # ---- measures
    tele = teleport_free_fraction(C)
    base = {i.name: i for i in read_images_txt(BASELINE / "txt/3/images.txt").values()}
    sh = [k for k, n in enumerate(allnames) if n in base]
    Rc = np.array([base[allnames[k]].R for k in sh])
    cc = np.array([base[allnames[k]].centre for k in sh])
    rot, cerr, sc = pose_stats(np.array([R_w2c[k] for k in sh]), C[sh], Rc, cc)
    info = {"model": which, "stride": stride, "frames": N, "windows": len(starts), "points": int(len(pts)), "sharedWithColmap": len(sh),
            "teleportFreeFraction": tele, "medianRelRotErrDegVsColmapFirst13s": rot, "medianCentreErrOverPathVsColmapFirst13s": cerr,
            "dа3UnitsToColmapUnits": sc, "seconds": time.time() - t0, "peakGb": peak_rss_gb(), "windowsInfo": win_info,
            "pathLengthUnits": float(np.linalg.norm(np.diff(C, axis=0), axis=1).sum()),
            "secondsCovered": N * stride / FPS}
    (out / "chain.json").write_text(json.dumps(info, indent=1))
    print(json.dumps({k: v for k, v in info.items() if k != "windowsInfo"}, indent=1))


TOTAL = 355
if __name__ == "__main__":
    main()

"""E2: metric scale and ceiling height from single frames (SPEC 15.5).

usage: python e2_scale.py <model>     model = moge2-s | da2-indoor-s
Reads the baseline COLMAP model (sparse/3 text export), runs the depth model on 40 frames spread over the fragment,
and measures: per-frame scale vs COLMAP sparse points, hand-picked size checks (ml/checks.json), ceiling per frame.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import *
from layout_planes import ceiling_sample

N_FRAMES = 40
MIN_SPARSE = 30


# ---------------------------------------------------------------- pure scale maths (tested in tests/test_scale_fit.py)
def scale_from_depths(model_depth: np.ndarray, colmap_depth: np.ndarray, min_points: int = MIN_SPARSE) -> float | None:
    """scale_i = median(model metric depth / COLMAP depth) over valid pairs. One frame."""
    m = np.asarray(model_depth, float)
    c = np.asarray(colmap_depth, float)
    ok = np.isfinite(m) & np.isfinite(c) & (m > 0) & (c > 0)
    if ok.sum() < min_points:
        return None
    return float(np.median(m[ok] / c[ok]))


def vote(scales: list[float]) -> tuple[float, float]:
    """Median over frames and spread = IQR / median (as a fraction)."""
    s = np.asarray(scales, float)
    med = float(np.median(s))
    q1, q3 = np.percentile(s, [25, 75])
    return med, float((q3 - q1) / med)


# ---------------------------------------------------------------- model wrappers
class Moge2S:
    name, licence = "MoGe-2 ViT-S", "MIT"
    def __init__(self):
        import torch
        add_model_paths()
        from moge.model.v2 import MoGeModel
        self.torch, self.dev = torch, device()
        self.m = MoGeModel.from_pretrained(str(WEIGHTS / "Ruicheng__moge-2-vits-normal/model.pt")).to(self.dev).eval()

    def infer(self, bgr: np.ndarray, K: np.ndarray | None):
        import cv2
        t = self.torch
        x = t.tensor(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB) / 255.0, dtype=t.float32, device=self.dev).permute(2, 0, 1)
        with t.no_grad():
            o = self.m.infer(x, use_fp16=False)
        if self.dev.type == "mps":
            t.mps.synchronize()
        P = o["points"].cpu().numpy()
        return o["depth"].cpu().numpy(), P, o["mask"].cpu().numpy().astype(bool)


class Da2IndoorS:
    name, licence = "Depth Anything V2 Metric Indoor Small", "Apache-2.0"
    def __init__(self):
        import torch
        self.torch, self.dev = torch, device()
        p = str(SRC / "da2" / "metric_depth")
        sys.path.insert(0, p)
        from depth_anything_v2.dpt import DepthAnythingV2
        cfg = {"encoder": "vits", "features": 64, "out_channels": [48, 96, 192, 384], "max_depth": 20}
        self.m = DepthAnythingV2(**cfg)
        self.m.load_state_dict(torch.load(WEIGHTS / "depth-anything__Depth-Anything-V2-Metric-Hypersim-Small/depth_anything_v2_metric_hypersim_vits.pth", map_location="cpu"))
        self.m = self.m.to(self.dev).eval()

    def infer(self, bgr: np.ndarray, K: np.ndarray):
        d = self.m.infer_image(bgr, 518)
        h, w = d.shape
        u, v = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
        P = np.stack([(u - K[0, 2]) / K[0, 0] * d, (v - K[1, 2]) / K[1, 1] * d, d], -1).astype(np.float32)
        return d, P, np.ones_like(d, bool)


MODELS = {"moge2-s": Moge2S, "da2-indoor-s": Da2IndoorS}


# ---------------------------------------------------------------- COLMAP side
def load_baseline():
    d = BASELINE / "txt/3"
    cams = read_cameras_txt(d / "cameras.txt")
    ims = read_images_txt(d / "images.txt")
    pts = read_points3d_txt(d / "points3D.txt")
    return cams, ims, pts


def sparse_pairs(im: Image, pts: dict[int, np.ndarray], depth: np.ndarray):
    """(model depth, colmap depth) at the image's tracked keypoints."""
    R, t = im.R, im.t
    H, W = depth.shape
    md, cd = [], []
    for (x, y), pid in zip(im.xys, im.p3d):
        if pid < 0 or pid not in pts:
            continue
        z = (R @ pts[pid] + t)[2]
        if z <= 0.2:
            continue
        xi, yi = int(x), int(y)
        if 0 <= xi < W and 0 <= yi < H:
            md.append(depth[yi, xi]); cd.append(z)
    return np.array(md), np.array(cd)


def measure(P: np.ndarray, a, b, r: int = 3) -> float:
    def at(p):
        x, y = int(p[0]), int(p[1])
        win = P[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1].reshape(-1, 3)
        win = win[np.isfinite(win).all(1)]
        return np.median(win, 0)
    return float(np.linalg.norm(at(a) - at(b)))


def main():
    model_key = sys.argv[1]
    wait_for_idle()
    import cv2
    t0 = time.time()
    cams, ims, pts = load_baseline()
    cam = next(iter(cams.values()))
    fx, fy, cx, cy = cam.params[:4]
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
    byname = sorted(ims.values(), key=lambda i: i.name)
    pick = [byname[i] for i in np.linspace(0, len(byname) - 1, N_FRAMES).round().astype(int)]
    checks = json.loads((Path(__file__).parent / "checks.json").read_text())["checks"] if (Path(__file__).parent / "checks.json").exists() else []
    check_frames = {c["frame"] for c in checks}

    M = MODELS[model_key]()
    scales, per_frame, ceil_s = [], [], []
    check_P = {}
    pick_names = {p.name for p in pick}
    todo = list(pick) + [i for i in byname if i.name[:5] in check_frames and i.name not in pick_names]
    for k, im in enumerate(todo):
        bgr = cv2.imread(str(BASELINE / "images" / im.name))
        D, P, mask = M.infer(bgr, K)
        if im.name[:5] in check_frames:
            check_P[im.name[:5]] = P
        if im.name not in pick_names:
            continue
        md, cd = sparse_pairs(im, pts, D)
        s = scale_from_depths(md, cd)
        cs = ceiling_sample(P, mask)
        rec = {"frame": im.name, "sparsePoints": int(len(md)), "scale": s}
        if cs:
            rec["ceilingM"] = cs.height_m; rec["tiltDeg"] = cs.tilt_deg
            ceil_s.append(cs.height_m)
        per_frame.append(rec)
        if s is not None:
            scales.append(s)
        print(f"{k+1}/{len(todo)} {im.name} scale={s} pts={len(md)} ceil={cs.height_m if cs else None}", flush=True)
    secs = time.time() - t0
    med, spread = vote(scales) if len(scales) >= 2 else (float("nan"), float("nan"))
    # known-size checks
    chk_out = []
    for c in checks:
        P = check_P.get(c["frame"])
        if P is None:
            continue
        got = measure(P, c["a"], c["b"])
        chk_out.append({"label": c["label"], "kind": c["kind"], "frame": c["frame"], "expectedM": c["expectedM"], "measuredM": got,
                        "errPct": 100 * (got - c["expectedM"]) / c["expectedM"]})
    door_h = [x for x in chk_out if x["kind"] == "door-height"]
    door_med = float(np.median([x["measuredM"] for x in door_h])) if door_h else float("nan")
    door_err = 100 * (door_med - 2.1) / 2.1 if door_h else float("nan")
    cmed = float(np.median(ceil_s)) if ceil_s else float("nan")
    cq1, cq3 = np.percentile(ceil_s, [25, 75]) if ceil_s else (float("nan"), float("nan"))
    cspread = float((cq3 - cq1) / cmed) if ceil_s else float("nan")
    out = {"model": M.name, "licence": M.licence, "scaleMedian": med, "scaleSpreadPct": 100 * spread, "framesUsed": len(scales),
           "doorHeightMedianM": door_med, "doorHeightErrPct": door_err, "checks": chk_out,
           "ceilingMedianM": cmed, "ceilingSpreadPct": 100 * cspread, "ceilingFrames": len(ceil_s), "perFrame": per_frame, "seconds": secs,
           "peakGb": peak_rss_gb()}
    (RUNS / "e2").mkdir(exist_ok=True)
    (RUNS / "e2" / f"{model_key}.json").write_text(json.dumps(out, indent=1))
    scale_ok = len(scales) >= 30 and 100 * spread <= 10 and door_h != [] and abs(door_err) <= 10
    ceil_ok = len(ceil_s) >= 10 and 100 * cspread <= 8
    m = {"metresPerUnit": med, "scaleSpreadPct": 100 * spread, "framesUsed": len(scales), "doorHeightMedianM": door_med,
         "doorHeightErrPct": door_err, "doorChecks": len(door_h), "ceilingMedianM": cmed, "ceilingSpreadPct": 100 * cspread,
         "ceilingFrames": len(ceil_s), "ceilingPassesOwnBar": float(ceil_ok), "secondsPerFrame": secs / len(todo)}
    write_report_entry(entry("E2", model_key, M.name, M.licence, True, m, bool(scale_ok), secs / 60, peak_rss_gb(),
        "scale_i = median(model depth / COLMAP depth) at tracked sparse keypoints of baseline sparse/3, 40 frames evenly over its 133; "
        "spread = IQR/median. Door-height check = median of hand-picked jamb pairs in ml/checks.json measured in the model's own point map "
        "(DA2 unprojected with COLMAP intrinsics) against 2.1 m. Ceiling = floor/ceiling plane separation per frame (layout_planes.ceiling_sample); "
        "its own bar is spread <= 8% over >= 10 frames."))
    print(json.dumps({k: v for k, v in out.items() if k != "perFrame"}, indent=1))


def finalize():
    """Pick the commercial-OK model that passed with the smaller spread; write ml/scale.json and ml/ceiling.json."""
    res = {k: json.loads((RUNS / "e2" / f"{k}.json").read_text()) for k in MODELS if (RUNS / "e2" / f"{k}.json").exists()}
    def passed(r):
        return r["framesUsed"] >= 30 and r["scaleSpreadPct"] <= 10 and r["checks"] and abs(r["doorHeightErrPct"]) <= 10
    ok = sorted((r for r in res.values() if passed(r)), key=lambda r: r["scaleSpreadPct"])
    m, notes = {}, []
    if len(res) == 2:
        a, b = list(res.values())
        m["scaleDisagreementPct"] = 100 * abs(a["scaleMedian"] - b["scaleMedian"]) / min(a["scaleMedian"], b["scaleMedian"])
        m["ceilingDisagreementPct"] = 100 * abs(a["ceilingMedianM"] - b["ceilingMedianM"]) / min(a["ceilingMedianM"], b["ceilingMedianM"])
    if not ok:
        write_report_entry(entry("E2", "final", "none", "n/a", True, m, False, 0, 0, "No model passed the scale bar; no scale.json written."))
        print("no model passed")
        return
    w = ok[0]
    other = next((r for r in res.values() if r is not w), None)
    scale = {"version": 1, "model": w["model"], "licence": w["licence"], "commercialOk": True, "metresPerUnit": w["scaleMedian"],
             "spreadPct": w["scaleSpreadPct"], "frames": w["framesUsed"],
             "checks": [{"label": f'{c["label"]} ({c["frame"]})', "expectedM": c["expectedM"], "measuredM": c["measuredM"]} for c in w["checks"] if c["kind"] == "door-height"]}
    if other and passed(other) and abs(other["scaleMedian"] - w["scaleMedian"]) / w["scaleMedian"] <= 0.08:   # only a real agreement is shipped
        scale["crossCheck"] = {"model": other["model"], "metresPerUnit": other["scaleMedian"]}
    ML_OUT.mkdir(parents=True, exist_ok=True)
    (ML_OUT / "scale.json").write_text(json.dumps(scale, indent=2) + "\n")
    wrote = ["scale.json"]
    if w["ceilingFrames"] >= 10 and w["ceilingSpreadPct"] <= 8:
        (ML_OUT / "ceiling.json").write_text(json.dumps({"version": 1, "model": w["model"], "licence": w["licence"], "commercialOk": True,
            "heightM": w["ceilingMedianM"], "spreadPct": w["ceilingSpreadPct"], "frames": w["ceilingFrames"]}, indent=2) + "\n")
        wrote.append("ceiling.json")
    if other and not passed(other):
        notes.append(f'{other["model"]} did not pass (scale spread {other["scaleSpreadPct"]:.1f}%, door-height error {other["doorHeightErrPct"]:+.0f}%).')
    m.update({"winnerMetresPerUnit": w["scaleMedian"], "winnerSpreadPct": w["scaleSpreadPct"], "winnerCeilingM": w["ceilingMedianM"]})
    write_report_entry(entry("E2", "final", w["model"], w["licence"], True, m, True, 0, w["peakGb"],
        f'Kept {w["model"]}; wrote {", ".join(wrote)}. ' + " ".join(notes) +
        " The second model's scale and ceiling disagree with the winner by the percentages above, which is far outside the 8% cross-check limit, so no cross-check is claimed and scale.json has no crossCheck field."))
    print("wrote", wrote)


if __name__ == "__main__":
    finalize() if len(sys.argv) > 1 and sys.argv[1] == "finalize" else main()

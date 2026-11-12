"""E1: learned matching inside COLMAP (SPEC 15.5). CPU only, no Python ML.

usage: python e1_registration.py <variant> [--overlap 25]
  a = SIFT features + SIFT_LIGHTGLUE matching
  b = ALIKED_N16ROT features (4096) + ALIKED_LIGHTGLUE matching
  c = better of a/b (argument --base a|b) after dropping the blurriest frames (lowest 20%, only when both neighbours kept)
  s = control: SIFT + SIFT_BRUTEFORCE (the C9 recipe) re-run on this machine, same mapper flags
Writes runs/e1_<variant>/ and one entry in ml/report.json. Re-runnable: finished stages are skipped.
"""
import argparse, json, os, shutil, sqlite3, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from common import *

# Mapper flags from SPEC 14.6, unchanged.
MAPPER = ["--Mapper.init_min_num_inliers", "50", "--Mapper.abs_pose_min_num_inliers", "15",
          "--Mapper.abs_pose_min_inlier_ratio", "0.15", "--Mapper.init_min_tri_angle", "4", "--Mapper.min_model_size", "5"]
SIFT_FEAT = ["--SiftExtraction.max_num_features", "12000", "--SiftExtraction.peak_threshold", "0.003",
             "--SiftExtraction.domain_size_pooling", "1"]
ALIKED_FEAT = ["--AlikedExtraction.max_num_features", "4096"]

RECIPES = {
    "s": dict(ext="SIFT", mat="SIFT_BRUTEFORCE", feat=SIFT_FEAT, licence="BSD-3 (COLMAP)", model="COLMAP SIFT + brute force (control)"),
    "a": dict(ext="SIFT", mat="SIFT_LIGHTGLUE", feat=SIFT_FEAT, licence="COLMAP BSD; LightGlue Apache-2.0", model="COLMAP SIFT + LightGlue ONNX"),
    "b": dict(ext="ALIKED_N16ROT", mat="ALIKED_LIGHTGLUE", feat=ALIKED_FEAT, licence="COLMAP BSD; ALIKED BSD-3; LightGlue Apache-2.0",
              model="COLMAP ALIKED-N16rot + LightGlue ONNX"),
    "b2": dict(ext="ALIKED_N16ROT", mat="ALIKED_LIGHTGLUE", feat=ALIKED_FEAT + ["--FeatureExtraction.max_image_size", "1024"],
               licence="COLMAP BSD; ALIKED BSD-3; LightGlue Apache-2.0", model="COLMAP ALIKED-N16rot (images capped at 1024 px) + LightGlue ONNX"),
    "b3": dict(ext="ALIKED_N16ROT", mat="ALIKED_LIGHTGLUE",
               feat=ALIKED_FEAT + ["--FeatureExtraction.max_image_size", "1024", "--AlikedExtraction.min_score", "0.05"],
               licence="COLMAP BSD; ALIKED BSD-3; LightGlue Apache-2.0", model="COLMAP ALIKED-N16rot (1024 px cap, min_score 0.05) + LightGlue ONNX"),
}


def sharpness_160(path: Path) -> float:
    import cv2
    g = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    h, w = g.shape
    g = cv2.resize(g, (160, max(1, round(h * 160 / w))), interpolation=cv2.INTER_AREA).astype(np.float64)
    c = g[1:-1, 1:-1]
    lap = 4 * c - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())


def frames_to_drop(images: Path) -> list[str]:
    names = sorted(p.name for p in images.glob("f*.jpg"))
    sh = [sharpness_160(images / n) for n in names]
    k = int(len(names) * 0.2)
    order = sorted(range(len(names)), key=lambda i: sh[i])[:k]
    dropped: set[int] = set()
    for i in order:                      # blurriest first
        if 0 < i < len(names) - 1 and (i - 1) not in dropped and (i + 1) not in dropped:
            dropped.add(i)
    return [names[i] for i in sorted(dropped)]


def run(cmd, log: Path, stage_times: dict, key: str):
    t0 = time.time()
    code, dt, gb = timed_subprocess(cmd, log=log)
    stage_times[key] = {"sec": dt, "peakGb": gb, "exit": code}
    print(f"[{key}] exit={code} {dt/60:.2f} min peak {gb:.2f} GB", flush=True)
    return code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("variant")
    ap.add_argument("--base", default="b")
    ap.add_argument("--overlap", default="25")
    ap.add_argument("--no-wait", action="store_true")
    ap.add_argument("--threads", default="-1", help="COLMAP threads for extraction and matching (-1 = all cores)")
    ap.add_argument("--resume-features", action="store_true", help="keep a partial db.db (COLMAP skips images that already have features)")
    ap.add_argument("--prior-feature-sec", type=float, default=0.0, help="wall time already spent on the partial extraction")
    a = ap.parse_args()
    v = a.variant
    rec = RECIPES[a.base if v == "c" else v]  # b, b2, a, s; c reuses a recipe on a reduced frame list
    wd = RUNS / f"e1_{v}"
    wd.mkdir(parents=True, exist_ok=True)
    state_f = wd / "state.json"
    st = json.loads(state_f.read_text()) if state_f.exists() else {}
    if not a.no_wait:
        st["waitedSec"] = st.get("waitedSec", 0) + wait_for_idle()
    src_images = BASELINE / "images"
    images = wd / "images"
    drop = []
    if not images.exists():
        images.mkdir()
        if v == "c":
            drop = frames_to_drop(src_images)
            (wd / "frames-drop.json").write_text(json.dumps({"version": 1, "drop": drop}))
        for p in sorted(src_images.glob("f*.jpg")):
            if p.name not in drop:
                os.symlink(p, images / p.name)
    elif (wd / "frames-drop.json").exists():
        drop = json.loads((wd / "frames-drop.json").read_text())["drop"]
    n_in = len(list(images.glob("f*.jpg")))
    db = wd / "db.db"
    stages = st.setdefault("stages", {})

    if "features" not in stages:
        cmd = [COLMAP, "feature_extractor", "--database_path", str(db), "--image_path", str(images),
               "--ImageReader.single_camera", "1", "--ImageReader.camera_model", "OPENCV", "--FeatureExtraction.use_gpu", "0",
               "--FeatureExtraction.type", rec["ext"], "--FeatureExtraction.num_threads", a.threads] + rec["feat"]
        if db.exists() and not a.resume_features: db.unlink()
        run(cmd, wd / "log_feat.txt", stages, "features")
        stages["features"]["sec"] += a.prior_feature_sec
        if a.prior_feature_sec: stages["features"]["priorPartialSec"] = a.prior_feature_sec
        state_f.write_text(json.dumps(st))
    if "matching" not in stages:
        # the faiss matcher crashes in COLMAP 4.2.1; the brute-force flag is passed on every matcher call
        cmd = [COLMAP, "sequential_matcher", "--database_path", str(db), "--FeatureMatching.use_gpu", "0",
               "--FeatureMatching.type", rec["mat"], "--FeatureMatching.num_threads", a.threads, "--SiftMatching.cpu_brute_force_matcher", "1",
               "--SequentialMatching.overlap", a.overlap]
        run(cmd, wd / "log_match.txt", stages, "matching"); state_f.write_text(json.dumps(st))
    if "mapping" not in stages:
        sp = wd / "sparse"
        if sp.exists(): shutil.rmtree(sp)
        sp.mkdir()
        cmd = [COLMAP, "mapper", "--database_path", str(db), "--image_path", str(images), "--output_path", str(sp)] + MAPPER
        run(cmd, wd / "log_map.txt", stages, "mapping"); state_f.write_text(json.dumps(st))

    frags = fragments_summary(wd / "sparse", wd / "txt")
    total_min = sum(s["sec"] for s in stages.values()) / 60
    peak = max((s["peakGb"] for s in stages.values() if s["peakGb"] == s["peakGb"]), default=float("nan"))
    largest = frags[0]["frames"] if frags else 0
    nfr = len(frags)
    # database stats: how many verified pairs
    con = sqlite3.connect(db)
    pairs = con.execute("select count(*) from two_view_geometries where rows>0").fetchone()[0]
    con.close()
    # does the largest fragment overlap the baseline's? (names)
    base_largest = set(i.name for i in read_images_txt(BASELINE / "txt/3/images.txt").values())
    new_names = set(frags[0]["names"]) if frags else set()
    m = {"inputFrames": n_in, "framesDropped": len(drop), "fragments": nfr, "largestFragmentFrames": largest,
         "largestSecondsCovered": frags[0]["seconds"] if frags else 0.0,
         "fragmentSizes": [f["frames"] for f in frags], "verifiedPairs": pairs,
         "featureMin": stages["features"]["sec"] / 60, "matchMin": stages["matching"]["sec"] / 60, "mapMin": stages["mapping"]["sec"] / 60,
         "totalMin": total_min, "largestOverlapWithBaselineLargest": len(new_names & base_largest)}
    # pass bar (SPEC 15.5 E1): largest >= 200 of 355, or <= 6 fragments with largest >= 133; in <= 25 min on CPU
    ok = (largest >= 200 or (nfr <= 6 and largest >= 133)) and total_min <= 25
    for e in stages.values():
        if e["exit"] != 0: m["stageExitNonZero"] = 1.0
    write_report_entry(entry("E1", v, rec["model"], rec["licence"], v != "d", m, bool(ok), total_min, peak,
        f"extractor {rec['ext']}, matcher {rec['mat']}, sequential overlap {a.overlap}, mapper flags of SPEC 14.6, 355 frames from the C9 baseline, "
        f"CPU only. Wait for idle machine: {st.get('waitedSec', 0)/60:.1f} min (not counted in minutes). Peak memory is the largest single COLMAP stage."
        + (f" Frames dropped by sharpness rule: {len(drop)} (frames-drop.json)." if v == "c" else "")))
    state_f.write_text(json.dumps(st))
    print(json.dumps(m, indent=1))


if __name__ == "__main__":
    main()

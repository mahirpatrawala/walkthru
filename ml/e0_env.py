"""E0: environment + baseline (SPEC 15.5). Confirms MPS, loads MoGe-2 ViT-S, runs one frame, records baseline from C9's logs."""
import re, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from common import *

def main():
    wait_for_idle()
    import torch, cv2
    add_model_paths()
    t0 = time.time()
    mps = torch.backends.mps.is_available()
    from moge.model.v2 import MoGeModel
    ck = WEIGHTS / "Ruicheng__moge-2-vits-normal" / "model.pt"
    dev = torch.device("mps" if mps else "cpu")
    model = MoGeModel.from_pretrained(str(ck)).to(dev).eval()
    img = cv2.cvtColor(cv2.imread(str(BASELINE / "images" / "f0100.jpg")), cv2.COLOR_BGR2RGB)
    x = torch.tensor(img / 255.0, dtype=torch.float32, device=dev).permute(2, 0, 1)
    t1 = time.time()
    with torch.no_grad():
        out = model.infer(x, use_fp16=False)
    if dev.type == "mps":
        torch.mps.synchronize()
    t2 = time.time()
    with torch.no_grad():
        out = model.infer(x, use_fp16=False)
    if dev.type == "mps":
        torch.mps.synchronize()
    t3 = time.time()
    pts = out["points"].cpu().numpy(); mask = out["mask"].cpu().numpy()
    depth = out["depth"].cpu().numpy()
    print("keys", list(out.keys()), "points", pts.shape, "valid frac", float(mask.mean()),
          "depth median (m, raw)", float(np.median(depth[mask])))
    # baseline from C9's logs
    def mins(f):
        return float(re.findall(r"Elapsed time: ([\d.]+) \[minutes\]", (BASELINE / f).read_text())[-1])
    feat, match, mapm = mins("log_feat.txt"), mins("log_match.txt"), mins("log_map.txt")
    frags = [{"fragment": i, "frames": sum(1 for l in (BASELINE / f"txt/{i}/images.txt").read_text().splitlines()
                                        if not l.startswith("#") and len(l.split()) >= 10 and not re.fullmatch(r"[\d.\-e+]+", l.split()[9]))}
             for i in range(12)]
    frags.sort(key=lambda r: -r["frames"])
    best = read_images_txt(BASELINE / "txt/3/images.txt")
    cov = coverage_seconds([i.name for i in best.values()])
    m = {"torchVersion": torch.__version__, "mpsAvailable": float(mps), "mogeFirstCallSec": t2 - t1, "mogeSecondCallSec": t3 - t2,
         "mogeLoadSec": t1 - t0, "validPixelFraction": float(mask.mean()),
         "baselineFragments": len(frags), "baselineLargestFrames": frags[0]["frames"], "baselineTotalFrames": 355,
         "baselineLargestSecondsCovered": cov, "baselineFeatureMin": feat, "baselineMatchMin": match, "baselineMapMin": mapm,
         "baselineWallMin": feat + match + mapm, "peakRssGbInProcess": peak_rss_gb()}
    ok = mps and np.isfinite(depth[mask]).all() and mask.mean() > 0.5
    write_report_entry(entry("E0", "env+baseline", "MoGe-2 ViT-S (MPS) + COLMAP baseline logs", "MIT", True, m, bool(ok),
        (time.time() - t0) / 60, peak_rss_gb(),
        "Baseline numbers parsed from the C9 run's COLMAP logs in ~/walkthru-tools/scenes/sample2 (feature/match/map 'Elapsed time' lines) and txt/*/images.txt. "
        f"Fragment sizes: {[f['frames'] for f in frags]}. Seconds covered counts spans of registered frames at 10 fps, gap <= 2 frames."))
    print(m)

if __name__ == "__main__":
    main()

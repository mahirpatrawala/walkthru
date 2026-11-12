"""Shared helpers for the C10 ML experiments (SPEC 15). No heavy imports at module load except numpy."""
from __future__ import annotations

import json
import os
import re
import resource
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HOME = Path.home()
TOOLS = Path(os.environ.get("WALKTHRU_TOOLS", HOME / "walkthru-tools"))
ML_ROOT = TOOLS / "ml"
RUNS = ML_ROOT / "runs"
WEIGHTS = ML_ROOT / "weights"
SRC = ML_ROOT / "src"
REPO = Path(__file__).resolve().parent.parent
SCENE_ID = os.environ.get("WALKTHRU_SCENE", "video-sample")
SCENE_DIR = REPO / "public" / "scenes" / SCENE_ID
ML_OUT = SCENE_DIR / "ml"
BASELINE = TOOLS / "scenes" / "sample2"     # images/, db.db, sparse/0..11 from the C9 baseline run
FPS = 10.0
COLMAP = os.environ.get("WALKTHRU_COLMAP", "/opt/homebrew/bin/colmap")


# ---------------------------------------------------------------- scheduling
def wait_for_idle(poll_s: float = 30.0, quiet: bool = False) -> float:
    """Block while another agent runs COLMAP or Brush (SPEC 15.1). Returns seconds waited.

    The `[c]` trick keeps pgrep from matching its own command line.
    """
    t0 = time.time()
    mine = {str(os.getpid())}
    p = os.getpid()
    for _ in range(8):      # ancestors too: a parent shell whose command line mentions colmap must not block us
        try:
            p = int(subprocess.run(["ps", "-o", "ppid=", "-p", str(p)], capture_output=True, text=True).stdout.strip())
        except ValueError:
            break
        if p <= 1:
            break
        mine.add(str(p))
    while True:
        out = subprocess.run(["pgrep", "-f", "[c]olmap|[b]rush_app"], capture_output=True, text=True).stdout.split()
        out = [p for p in out if p not in mine]
        if not out:
            return time.time() - t0
        if not quiet:
            print(f"[wait_for_idle] busy pids {out[:4]}, sleeping {poll_s:.0f}s", flush=True)
        time.sleep(poll_s)


def peak_rss_gb() -> float:
    """Peak memory of this process in GB. On macOS this is the lifetime-max physical footprint from proc_pid_rusage,
    the same number `/usr/bin/time -l` prints as 'peak memory footprint' (it includes MPS/Metal allocations).
    Falls back to ru_maxrss."""
    try:
        import ctypes
        lib = ctypes.CDLL("/usr/lib/libproc.dylib")
        buf = (ctypes.c_uint64 * 64)()
        if lib.proc_pid_rusage(os.getpid(), 4, ctypes.byref(buf)) == 0 and buf[30] > 0:
            return buf[30] / (1024 ** 3)
    except Exception:
        pass
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / (1024 ** 3) if sys.platform == "darwin" else r / (1024 ** 2)


def timed_subprocess(cmd: list[str], log: Path | None = None, env: dict | None = None) -> tuple[int, float, float]:
    """Run with `/usr/bin/time -l`; return (exit code, seconds, peak memory GB of the child tree's max single process)."""
    t0 = time.time()
    full = ["/usr/bin/time", "-l"] + cmd
    p = subprocess.run(full, capture_output=True, text=True, env=env)
    dt = time.time() - t0
    text = (p.stdout or "") + (p.stderr or "")
    if log:
        log.write_text(text)
    m = re.search(r"(\d+)\s+peak memory footprint", text) or re.search(r"(\d+)\s+maximum resident set size", text)
    gb = int(m.group(1)) / (1024 ** 3) if m else float("nan")
    return p.returncode, dt, gb


# ---------------------------------------------------------------- COLMAP text model
@dataclass
class Camera:
    id: int
    model: str
    width: int
    height: int
    params: list[float]


@dataclass
class Image:
    id: int
    q: np.ndarray          # (qw, qx, qy, qz) world -> camera
    t: np.ndarray          # world -> camera
    camera_id: int
    name: str
    xys: np.ndarray        # (n, 2)
    p3d: np.ndarray        # (n,) point ids, -1 = none

    @property
    def R(self) -> np.ndarray:
        return quat_to_R(self.q)

    @property
    def centre(self) -> np.ndarray:
        return -self.R.T @ self.t


def quat_to_R(q) -> np.ndarray:
    w, x, y, z = (float(v) for v in q)
    n = (w * w + x * x + y * y + z * z) ** 0.5 or 1.0
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def R_to_quat(R: np.ndarray) -> np.ndarray:
    """Rotation matrix -> (qw, qx, qy, qz)."""
    t = np.trace(R)
    if t > 0:
        s = (t + 1.0) ** 0.5 * 2
        q = [0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = (1.0 + R[0, 0] - R[1, 1] - R[2, 2]) ** 0.5 * 2
        q = [(R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s]
    elif R[1, 1] > R[2, 2]:
        s = (1.0 + R[1, 1] - R[0, 0] - R[2, 2]) ** 0.5 * 2
        q = [(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s]
    else:
        s = (1.0 + R[2, 2] - R[0, 0] - R[1, 1]) ** 0.5 * 2
        q = [(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def read_cameras_txt(path: Path) -> dict[int, Camera]:
    out = {}
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        tok = line.split()
        out[int(tok[0])] = Camera(int(tok[0]), tok[1], int(tok[2]), int(tok[3]), [float(v) for v in tok[4:]])
    return out


def read_images_txt(path: Path) -> dict[int, Image]:
    lines = [l for l in Path(path).read_text().splitlines() if not l.startswith("#")]
    out = {}
    i = 0
    while i < len(lines):
        head = lines[i].split()
        if len(head) < 10:
            i += 1
            continue
        pts = lines[i + 1].split() if i + 1 < len(lines) else []
        arr = np.array(pts, dtype=float).reshape(-1, 3) if pts else np.zeros((0, 3))
        im = Image(int(head[0]), np.array(head[1:5], float), np.array(head[5:8], float), int(head[8]), head[9],
                   arr[:, :2], arr[:, 2].astype(np.int64))
        out[im.id] = im
        i += 2
    return out


def read_points3d_txt(path: Path) -> dict[int, np.ndarray]:
    out = {}
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        tok = line.split()
        out[int(tok[0])] = np.array(tok[1:4], float)
    return out


def write_colmap_text_model(out_dir: Path, cameras: list[Camera], images: list[Image], points: np.ndarray | None = None,
                            colors: np.ndarray | None = None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "cameras.txt", "w") as f:
        f.write("# Camera list with one line of data per camera:\n#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n")
        f.write(f"# Number of cameras: {len(cameras)}\n")
        for c in cameras:
            f.write(f"{c.id} {c.model} {c.width} {c.height} " + " ".join(repr(float(p)) for p in c.params) + "\n")
    with open(out_dir / "images.txt", "w") as f:
        f.write("# Image list with two lines of data per image:\n#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME\n")
        f.write("#   POINTS2D[] as (X, Y, POINT3D_ID)\n")
        f.write(f"# Number of images: {len(images)}\n")
        for im in images:
            f.write(f"{im.id} " + " ".join(repr(float(v)) for v in list(im.q) + list(im.t)) + f" {im.camera_id} {im.name}\n\n")
    with open(out_dir / "points3D.txt", "w") as f:
        f.write("# 3D point list with one line of data per point:\n#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n")
        n = 0 if points is None else len(points)
        f.write(f"# Number of points: {n}\n")
        for i in range(n):
            c = (128, 128, 128) if colors is None else tuple(int(v) for v in colors[i])
            f.write(f"{i + 1} {points[i][0]} {points[i][1]} {points[i][2]} {c[0]} {c[1]} {c[2]} 0\n")


def frame_number(name: str) -> int:
    m = re.search(r"(\d+)\.[A-Za-z0-9]+$", name)
    return int(m.group(1)) if m else -1


def frame_time(name: str, fps: float = FPS) -> float:
    return (frame_number(name) - 1) / fps


def coverage_seconds(names: list[str], fps: float = FPS, gap_frames: int = 2) -> float:
    """Seconds covered: registered frames closer than gap_frames+1 frame intervals share one span (SPEC 14.6)."""
    ns = sorted(frame_number(n) for n in names)
    if not ns:
        return 0.0
    total, start, prev = 0.0, ns[0], ns[0]
    for n in ns[1:]:
        if n - prev > gap_frames:
            total += (prev - start + 1) / fps
            start = n
        prev = n
    total += (prev - start + 1) / fps
    return total


def fragments_summary(sparse_dir: Path, tmp_txt: Path | None = None) -> list[dict]:
    """Convert every sparse/<n> to TXT via colmap model_converter and report frames per fragment."""
    res = []
    for d in sorted(sparse_dir.iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else 1 << 30):
        if not d.is_dir():
            continue
        txt = (tmp_txt or sparse_dir.parent / "txt") / d.name
        txt.mkdir(parents=True, exist_ok=True)
        subprocess.run([COLMAP, "model_converter", "--input_path", str(d), "--output_path", str(txt), "--output_type", "TXT"],
                       capture_output=True)
        if not (txt / "images.txt").exists():
            continue
        ims = read_images_txt(txt / "images.txt")
        names = [i.name for i in ims.values()]
        res.append({"fragment": d.name, "frames": len(names), "seconds": coverage_seconds(names), "names": sorted(names)})
    res.sort(key=lambda r: -r["frames"])
    return res


# ---------------------------------------------------------------- PLY + report
def write_ply(path: Path, xyz: np.ndarray, rgb: np.ndarray | None = None) -> None:
    n = len(xyz)
    with open(path, "wb") as f:
        hdr = f"ply\nformat binary_little_endian 1.0\nelement vertex {n}\nproperty float x\nproperty float y\nproperty float z\n"
        if rgb is not None:
            hdr += "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        f.write((hdr + "end_header\n").encode())
        if rgb is None:
            f.write(np.asarray(xyz, "<f4").tobytes())
        else:
            rec = np.zeros(n, dtype=[("p", "<f4", 3), ("c", "u1", 3)])
            rec["p"], rec["c"] = xyz, rgb
            f.write(rec.tobytes())


REPORT = ML_OUT / "report.json"


def write_report_entry(entry: dict) -> None:
    """Upsert one experiment entry (keyed by id+variant) into ml/report.json. Never copies numbers from the spec."""
    ML_OUT.mkdir(parents=True, exist_ok=True)
    doc = json.loads(REPORT.read_text()) if REPORT.exists() else {"version": 1, "experiments": []}
    doc["generatedAt"] = datetime.now(timezone.utc).isoformat()
    doc["experiments"] = [e for e in doc["experiments"] if not (e["id"] == entry["id"] and e.get("variant") == entry.get("variant"))]
    doc["experiments"].append(entry)
    doc["experiments"].sort(key=lambda e: (e["id"], e.get("variant", "")))
    REPORT.write_text(json.dumps(doc, indent=2) + "\n")


def entry(id: str, variant: str, model: str, licence: str, commercial_ok: bool, metrics: dict, passed: bool,
          minutes: float, peak_gb: float, notes: str) -> dict:
    clean = {k: (None if isinstance(v, float) and (v != v) else v) for k, v in metrics.items()}
    return {"id": id, "variant": variant, "model": model, "licence": licence, "commercialOk": commercial_ok,
            "metrics": clean, "passed": passed, "minutes": round(minutes, 2), "peakMemoryGb": None if (peak_gb is None or peak_gb != peak_gb) else round(peak_gb, 2),
            "notes": notes}


def add_model_paths() -> None:
    for p in (SRC / "moge", SRC / "da3" / "src", SRC / "da2"):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))


def device():
    import torch
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")

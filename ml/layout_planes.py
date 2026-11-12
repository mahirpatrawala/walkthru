"""Plane and wall-line fitting. numpy only, no torch (SPEC 15.7).

Two users:
  * E2 ceiling: `ceiling_sample` finds floor and ceiling in one frame's metric point map.
  * E4 layout: `fit_floor`, `level_cloud`, `wall_lines`, `rooms_from_cloud` turn a levelled cloud into a LayoutProposal dict.
World convention here is the app's: Y up, metres, floor at y = 0, plan axes x and z.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


# ------------------------------------------------------------------ small helpers
def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def normals_from_map(P: np.ndarray, step: int = 2) -> np.ndarray:
    """Per-pixel normals of an (H, W, 3) point map from central differences over `step` pixels (unit, may be nan)."""
    dx = np.zeros_like(P)
    dy = np.zeros_like(P)
    dx[:, step:-step] = P[:, 2 * step:] - P[:, :-2 * step]
    dy[step:-step] = P[2 * step:] - P[:-2 * step]
    n = np.cross(dx, dy)
    l = np.linalg.norm(n, axis=-1, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        n = n / l
    return n


def _principal_axis(normals: np.ndarray) -> np.ndarray:
    C = normals.T @ normals
    w, V = np.linalg.eigh(C)
    return V[:, -1]


# ------------------------------------------------------------------ E2: ceiling from one frame
@dataclass
class CeilingSample:
    height_m: float
    floor_h: float          # signed distance below the camera along the vertical (positive = below)
    ceil_h: float           # negative = above the camera
    n_floor: int
    n_ceil: int
    tilt_deg: float         # angle between the estimated vertical and the camera's y axis


def ceiling_sample(P: np.ndarray, mask: np.ndarray | None = None, stride: int = 3, min_frac: float = 0.03,
                   min_sep_m: float = 1.5, bin_m: float = 0.03) -> CeilingSample | None:
    """Fit the two largest near-parallel horizontal planes in a camera-frame metric point map (OpenCV axes, y down).

    The vertical is found from the surface normals nearest the camera's y axis (iterated), so no pose is needed.
    Floor must be below the camera and ceiling above it. Returns None when either is not visible.
    """
    H, W, _ = P.shape
    Ps = P[::stride, ::stride]
    ok = np.isfinite(Ps).all(-1)
    if mask is not None:
        ok &= mask[::stride, ::stride]
    N = normals_from_map(P, step=max(2, stride))[::stride, ::stride]
    ok &= np.isfinite(N).all(-1)
    if ok.sum() < 500:
        return None
    pts = Ps[ok]
    nrm = N[ok]
    cam_down = np.array([0.0, 1.0, 0.0])
    v = cam_down.copy()
    for lim in (35, 25, 15):
        sel = np.abs(nrm @ v) > math.cos(math.radians(lim))
        if sel.sum() < 200:
            return None
        v2 = _principal_axis(nrm[sel])
        v = v2 if v2 @ cam_down > 0 else -v2
    tilt = math.degrees(math.acos(float(np.clip(v @ cam_down, -1, 1))))
    sel = np.abs(nrm @ v) > math.cos(math.radians(12))
    h = pts[sel] @ v                                  # positive = below camera
    if len(h) < 200:
        return None
    lo, hi = -6.0, 6.0
    nb = int((hi - lo) / bin_m)
    hist, edges = np.histogram(h, bins=nb, range=(lo, hi))
    k = np.ones(5) / 5
    hs = np.convolve(hist, k, mode="same")
    centres = (edges[:-1] + edges[1:]) / 2
    thresh = min_frac * len(h)
    peaks = [i for i in range(2, nb - 2) if hs[i] >= thresh and hs[i] == hs[max(0, i - 8):i + 9].max()]
    below = [i for i in peaks if centres[i] > 0.3]
    above = [i for i in peaks if centres[i] < -0.3]
    if not below or not above:
        return None
    fb = max(below, key=lambda i: hs[i])
    ab = max(above, key=lambda i: hs[i])

    def refine(i0):
        # centre on the raw-histogram maximum near the smoothed peak (plateaus make the smoothed argmax ambiguous)
        lo_i, hi_i = max(0, i0 - 4), min(nb, i0 + 5)
        c = centres[lo_i + int(np.argmax(hist[lo_i:hi_i]))]
        m = np.abs(h - c) < 0.08
        return float(np.median(h[m])), int(m.sum())

    fh, nf = refine(fb)
    ah, na = refine(ab)
    if fh - ah < min_sep_m:
        return None
    return CeilingSample(fh - ah, fh, ah, nf, na, tilt)


# ------------------------------------------------------------------ E4: floor, levelling, walls
def fit_plane_ransac(pts: np.ndarray, n_iter: int = 300, tol: float = 0.03, normal_hint: np.ndarray | None = None,
                     max_angle_deg: float = 20.0, rng: np.random.Generator | None = None):
    """RANSAC plane (n, d) with n.x + d = 0. When a hint is given only planes whose normal is within max_angle of +-hint count."""
    rng = rng or np.random.default_rng(0)
    best, best_cnt = None, 0
    cosmax = math.cos(math.radians(max_angle_deg))
    N = len(pts)
    if N < 3:
        return None, np.zeros(0, bool)
    for _ in range(n_iter):
        idx = rng.choice(N, 3, replace=False)
        a, b, c = pts[idx]
        n = np.cross(b - a, c - a)
        l = np.linalg.norm(n)
        if l < 1e-9:
            continue
        n /= l
        if normal_hint is not None and abs(n @ normal_hint) < cosmax:
            continue
        d = -n @ a
        cnt = int((np.abs(pts @ n + d) < tol).sum())
        if cnt > best_cnt:
            best, best_cnt = (n, d), cnt
    if best is None:
        return None, np.zeros(N, bool)
    n, d = best
    inl = np.abs(pts @ n + d) < tol
    # least-squares refit on inliers
    c = pts[inl].mean(0)
    u, s, vt = np.linalg.svd(pts[inl] - c, full_matrices=False)
    n = vt[-1]
    if normal_hint is not None and n @ normal_hint < 0:
        n = -n
    d = -n @ c
    inl = np.abs(pts @ n + d) < tol
    return (n, d), inl


def level_cloud(pts: np.ndarray, up_hint: np.ndarray, tol: float = 0.03):
    """Rotate/translate a cloud so the floor is y = 0 and +y is up.

    up_hint: approximate up direction in the cloud's frame (e.g. from camera poses). The floor is the lowest large plane
    whose normal matches it, found by RANSAC on the points in the lowest 40% of heights along the hint.
    Returns (pts_levelled, R, t, floor_inlier_fraction) with p' = R p + t.
    """
    up = _unit(up_hint)
    h = pts @ up
    lo = np.quantile(h, 0.40)
    cand = pts[h <= lo]
    plane, inl = fit_plane_ransac(cand, normal_hint=up, tol=tol, max_angle_deg=25, n_iter=500)
    if plane is None:
        raise ValueError("no floor plane")
    n, d = plane
    # rotation taking n to +y
    y = np.array([0.0, 1.0, 0.0])
    v = np.cross(n, y)
    c = float(n @ y)
    if np.linalg.norm(v) < 1e-9:
        R = np.eye(3)
    else:
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R = np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))
    t = np.array([0.0, d, 0.0])    # plane: n.x + d = 0 -> y' = n.x + d
    return (pts @ R.T) + t, R, t, float(inl.mean())


def _line_ransac(P: np.ndarray, direction: np.ndarray, tol: float, min_pts: int):
    """Best line parallel to `direction` (unit 2-vector) in P (n,2): histogram of offsets along the normal."""
    nrm = np.array([-direction[1], direction[0]])
    off = P @ nrm
    return off, nrm


def wall_lines(xz: np.ndarray, cell: float = 0.02, manhattan_deg_step: float = 1.0):
    """Dominant Manhattan direction from the plan density, then wall offsets on both axes.

    xz: (n, 2) horizontal coordinates of the wall-height slice. Returns (theta, offsets_a, offsets_b) where axis a has
    direction (cos t, sin t) and axis b is perpendicular; offsets are positions along each axis' normal of the wall lines.
    """
    best_t, best_s = 0.0, -1.0
    for t in np.arange(0.0, 90.0, manhattan_deg_step):
        r = math.radians(t)
        a = xz @ np.array([math.cos(r), math.sin(r)])
        b = xz @ np.array([-math.sin(r), math.cos(r)])
        ha, _ = np.histogram(a, bins=np.arange(a.min(), a.max() + cell, cell))
        hb, _ = np.histogram(b, bins=np.arange(b.min(), b.max() + cell, cell))
        s = float((ha.astype(float) ** 2).sum() + (hb.astype(float) ** 2).sum())
        if s > best_s:
            best_s, best_t = s, t
    r = math.radians(best_t)
    ax = np.array([math.cos(r), math.sin(r)])
    bx = np.array([-math.sin(r), math.cos(r)])
    return best_t, xz @ ax, xz @ bx


def peaks_1d(vals: np.ndarray, bin_m: float = 0.03, min_count: int = 50, min_sep: float = 0.5, smooth: int = 3):
    """Wall positions along one axis: histogram peaks, strongest first, at least min_sep apart. Returns positions (refined by mean)."""
    if len(vals) == 0:
        return []
    lo, hi = vals.min() - bin_m, vals.max() + bin_m
    nb = max(3, int((hi - lo) / bin_m))
    hist, edges = np.histogram(vals, bins=nb, range=(lo, hi))
    hs = np.convolve(hist, np.ones(smooth) / smooth, mode="same")
    centres = (edges[:-1] + edges[1:]) / 2
    order = np.argsort(-hs)
    chosen = []
    min_count = max(min_count, 0.25 * float(hs.max()))      # a wall peak, not the flat spread of a perpendicular wall
    for i in order:
        if hs[i] < min_count:
            break
        if all(abs(centres[i] - c) >= min_sep for c in chosen):
            chosen.append(centres[i])
    out = []
    for c in sorted(chosen):
        m = np.abs(vals - c) < 2 * bin_m
        out.append(float(vals[m].mean()))
    return out


def polygon_area(poly: np.ndarray) -> float:
    x, z = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z))


def room_rectangle(xz: np.ndarray, min_count: int = 60, bin_m: float = 0.03, min_sep: float = 0.8, max_span_outlier: float = 0.0):
    """One rectangular room from wall-slice points: Manhattan axes, then the outermost strong peaks on each axis.

    Returns dict(theta_deg, a0, a1, b0, b1, corners (4x2 world, CCW with positive signed area), area, wall_pts_frac) or None.
    """
    theta, a, b = wall_lines(xz)
    pa = peaks_1d(a, bin_m, min_count, min_sep)
    pb = peaks_1d(b, bin_m, min_count, min_sep)
    if len(pa) < 2 or len(pb) < 2:
        return None
    a0, a1, b0, b1 = pa[0], pa[-1], pb[0], pb[-1]
    r = math.radians(theta)
    ax = np.array([math.cos(r), math.sin(r)])
    bx = np.array([-math.sin(r), math.cos(r)])
    corners = np.array([a0 * ax + b0 * bx, a1 * ax + b0 * bx, a1 * ax + b1 * bx, a0 * ax + b1 * bx])
    if polygon_area(corners) < 0:
        corners = corners[::-1]
    return {"theta_deg": theta, "a": (a0, a1), "b": (b0, b1), "corners": corners, "area": abs(polygon_area(corners)),
            "wall_lines_a": pa, "wall_lines_b": pb}


# ------------------------------------------------------------------ E4: whole proposal
def _signed_area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def _snap(v: float, lines: list[float], tol: float) -> float:
    if not lines:
        return v
    j = int(np.argmin([abs(v - l) for l in lines]))
    return lines[j] if abs(v - lines[j]) <= tol else v


def _rectilinear_from_mask(mask: np.ndarray, cell: float, a0: float, b0: float, la: list[float], lb: list[float], snap_tol: float):
    """Largest connected blob of `mask` -> rectilinear polygon in (a, b) coordinates, edges snapped to the wall lines."""
    import cv2
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=4)
    if n <= 1:
        return None
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    blob = (lab == k).astype(np.uint8)
    cs, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea)[:, 0, :].astype(float)
    ap = cv2.approxPolyDP(c.astype(np.float32).reshape(-1, 1, 2), max(1.0, 0.12 / cell), True)[:, 0, :].astype(float)
    # pixel centres -> metres in the (a, b) frame; contour pixels sit on cell centres, so the boundary is half a cell outside
    cen = np.array([a0, b0]) + (ap + 0.5) * cell
    cx, cy = cen[:, 0].mean(), cen[:, 1].mean()
    out = []
    for p in cen:
        # push half a cell away from the centroid so the polygon bounds the cells instead of passing through their centres
        sx = 0.5 * cell * (1 if p[0] >= cx else -1)
        sy = 0.5 * cell * (1 if p[1] >= cy else -1)
        out.append([_snap(p[0] + sx, la, snap_tol), _snap(p[1] + sy, lb, snap_tol)])
    # drop consecutive duplicates
    res = [out[0]]
    for p in out[1:]:
        if abs(p[0] - res[-1][0]) > 1e-6 or abs(p[1] - res[-1][1]) > 1e-6:
            res.append(p)
    return _drop_collinear(np.array(res), 0.1)


def _drop_collinear(poly: np.ndarray, tol: float) -> np.ndarray:
    """Remove vertices that sit within `tol` metres of the line through their neighbours (contour jitter on straight walls)."""
    p = [tuple(v) for v in poly]
    changed = True
    while changed and len(p) > 3:
        changed = False
        for i in range(len(p)):
            a, b, c = np.array(p[i - 1]), np.array(p[i]), np.array(p[(i + 1) % len(p)])
            ac = c - a
            L = np.linalg.norm(ac)
            d = np.linalg.norm(b - a) if L < 1e-9 else abs(ac[0] * (b - a)[1] - ac[1] * (b - a)[0]) / L
            if d < tol:
                del p[i]
                changed = True
                break
    return np.array(p)


def propose_layout(pts: np.ndarray, wall_h: float | None = None, cell: float = 0.05, min_room_m2: float = 3.0,
                   confidence: float = 0.4, source: str = "ml-planes@1") -> dict:
    """A LayoutProposal (SPEC 3.2) from a levelled, metric cloud (Y up, floor at y = 0).

    Steps: wall slice 0.3 to 2.0 m -> Manhattan axes (histogram sharpness) -> wall lines (histogram peaks) ->
    footprint mask from floor + ceiling + wall points projected to the plan, closed and filled -> rectilinear polygon
    snapped to the wall lines -> openings where a wall segment has no points in the slice.
    """
    import cv2
    y = pts[:, 1]
    band = pts[(y > 0.3) & (y < 2.0)]
    if len(band) < 200:
        raise ValueError("too few points in the wall band")
    xz = band[:, [0, 2]]
    theta, a, b = wall_lines(xz)
    pa = peaks_1d(a, 0.03, max(30, len(band) // 400), 0.5)
    pb = peaks_1d(b, 0.03, max(30, len(band) // 400), 0.5)
    r = math.radians(theta)
    ax = np.array([math.cos(r), math.sin(r)])
    bx = np.array([-math.sin(r), math.cos(r)])
    allxz = pts[:, [0, 2]]
    A = allxz @ ax
    B = allxz @ bx
    a0, b0 = A.min() - 0.3, B.min() - 0.3
    nx = int((A.max() + 0.3 - a0) / cell) + 1
    nz = int((B.max() + 0.3 - b0) / cell) + 1
    foot = (y < 0.1) | (y > 2.2) | ((y > 0.3) & (y < 2.0))
    ia = ((A[foot] - a0) / cell).astype(int)
    ib = ((B[foot] - b0) / cell).astype(int)
    ok = (ia >= 0) & (ia < nx) & (ib >= 0) & (ib < nz)
    cnt = np.zeros((nz, nx), np.float32)
    np.add.at(cnt, (ib[ok], ia[ok]), 1.0)
    cnt = cv2.GaussianBlur(cnt, (5, 5), 0)          # isolated outliers blur away, surfaces do not
    nz_vals = cnt[cnt > 0.05]
    thr = 0.25 * float(np.median(nz_vals)) if len(nz_vals) else 1.0
    m = (cnt > max(thr, 0.3)).astype(np.uint8)
    # stay inside the outermost strong wall lines when there are any
    if len(pa) >= 2 and len(pb) >= 2:
        ia_lo, ia_hi = int((pa[0] - 0.2 - a0) / cell), int((pa[-1] + 0.2 - a0) / cell)
        ib_lo, ib_hi = int((pb[0] - 0.2 - b0) / cell), int((pb[-1] + 0.2 - b0) / cell)
        box = np.zeros_like(m)
        box[max(0, ib_lo):ib_hi + 1, max(0, ia_lo):ia_hi + 1] = 1
        m = m * box
    k = max(3, int(0.4 / cell) | 1)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    # fill holes
    ff = m.copy()
    h, w = ff.shape
    flood = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, flood, (0, 0), 2)
    m = np.where(ff == 2, 0, 1).astype(np.uint8)
    poly_ab = _rectilinear_from_mask(m, cell, a0, b0, pa, pb, snap_tol=0.30)
    if poly_ab is None or len(poly_ab) < 3:
        raise ValueError("no footprint")
    poly = [[float(p[0] * ax[0] + p[1] * bx[0]), float(p[0] * ax[1] + p[1] * bx[1])] for p in poly_ab]
    if _signed_area(poly) < 0:
        poly = poly[::-1]
    area = _signed_area(poly)
    if area < min_room_m2:
        raise ValueError(f"footprint only {area:.1f} m2")
    n = len(poly)
    rooms = [{"id": "ml-room-1", "roomType": "other", "label": "Room 1 (scan)",
              "polygon": [{"x": p[0], "z": p[1]} for p in poly], "edges": ["wall"] * n}]
    openings = []
    # gaps: along each edge look for runs with no wall-slice points within 0.15 m of the wall
    for e in range(n):
        p0, p1 = np.array(poly[e]), np.array(poly[(e + 1) % n])
        L = float(np.linalg.norm(p1 - p0))
        if L < 0.9:
            continue
        d = (p1 - p0) / L
        nrm = np.array([d[1], -d[0]])
        rel = xz - p0
        u = rel @ d
        w_ = rel @ nrm
        near = band[(np.abs(w_) < 0.15) & (u > 0) & (u < L)]
        uu = u[(np.abs(w_) < 0.15) & (u > 0) & (u < L)]
        nbin = max(1, int(L / 0.05))
        hist, _ = np.histogram(uu, bins=nbin, range=(0, L))
        thr = max(1.0, 0.05 * np.median(hist[hist > 0])) if (hist > 0).any() else 1.0
        empty = hist < thr
        i = 0
        while i < nbin:
            if empty[i]:
                j = i
                while j < nbin and empty[j]:
                    j += 1
                wid = (j - i) * 0.05
                if 0.6 <= wid <= 2.4 and i > 0 and j < nbin:      # interior gap only, not a run to a corner
                    openings.append({"id": f"ml-open-{len(openings) + 1}", "roomId": "ml-room-1", "edge": e,
                                     "type": "opening", "centreM": (i + j) / 2 * 0.05, "widthM": wid, "sillM": 0.0, "headM": 2.0})
                i = j
            else:
                i += 1
    ceil = [] if wall_h is None else [wall_h]
    out = {"version": 1, "source": source, "rooms": rooms, "openings": openings, "confidence": confidence,
           "notes": [f"Manhattan axis {theta:.0f} deg; footprint {area:.1f} m2 from {len(pts)} points; wall lines a={['%.2f' % v for v in pa]} b={['%.2f' % v for v in pb]}"]}
    if wall_h is not None:
        out["wallHeightM"] = float(wall_h)
    return out

"""E4 synthetic bar: the truth flat's bedroom (4 x 5 m = 20 m2), 2 cm noise, 30% of wall points removed, 5% outliers.
Recovered area within 5% of 20 m2 and each wall line within 5 cm."""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from layout_planes import ceiling_sample, level_cloud, propose_layout, room_rectangle, polygon_area


def bedroom_cloud(seed=0, W=4.0, D=5.0, H=2.6, noise=0.02, wall_drop=0.30, outliers=0.05, rot_deg=0.0):
    rng = np.random.default_rng(seed)
    pts = []
    def wall(p0, p1, n):
        t = rng.random(n)
        h = rng.random(n) * H
        return np.stack([p0[0] + t * (p1[0] - p0[0]), h, p0[1] + t * (p1[1] - p0[1])], 1)
    walls = np.vstack([wall((0, 0), (W, 0), 12000), wall((W, 0), (W, D), 15000), wall((W, D), (0, D), 12000), wall((0, D), (0, 0), 15000)])
    walls = walls[rng.random(len(walls)) > wall_drop]
    floor = np.stack([rng.random(20000) * W, np.zeros(20000), rng.random(20000) * D], 1)
    ceil = np.stack([rng.random(10000) * W, np.full(10000, H), rng.random(10000) * D], 1)
    pts = np.vstack([walls, floor, ceil])
    pts = pts + rng.normal(0, noise, pts.shape)
    n_out = int(outliers * len(pts))
    out = np.stack([rng.uniform(-1, W + 1, n_out), rng.uniform(-0.5, H + 0.5, n_out), rng.uniform(-1, D + 1, n_out)], 1)
    pts = np.vstack([pts, out])
    if rot_deg:
        r = math.radians(rot_deg)
        R = np.array([[math.cos(r), 0, math.sin(r)], [0, 1, 0], [-math.sin(r), 0, math.cos(r)]])
        pts = pts @ R.T
    return pts


def test_area_and_walls_synthetic():
    pts = bedroom_cloud()
    prop = propose_layout(pts, wall_h=2.6)
    poly = np.array([[p["x"], p["z"]] for p in prop["rooms"][0]["polygon"]])
    area = polygon_area(poly)
    assert abs(area - 20.0) / 20.0 < 0.05, area
    assert polygon_area(poly) > 0
    # each wall line within 5 cm: compare polygon vertices with the corners of the truth rectangle (rotation-free case)
    xs, zs = sorted(set(np.round(poly[:, 0], 2))), sorted(set(np.round(poly[:, 1], 2)))
    assert len(poly) == 4
    assert abs(poly[:, 0].min() - 0) < 0.05 and abs(poly[:, 0].max() - 4) < 0.05
    assert abs(poly[:, 1].min() - 0) < 0.05 and abs(poly[:, 1].max() - 5) < 0.05
    assert prop["confidence"] <= 0.4


def test_rotated_room_walls_and_area():
    pts = bedroom_cloud(seed=3, rot_deg=23.0)
    prop = propose_layout(pts, wall_h=2.6)
    poly = np.array([[p["x"], p["z"]] for p in prop["rooms"][0]["polygon"]])
    assert abs(polygon_area(poly) - 20.0) / 20.0 < 0.05
    sides = sorted(np.linalg.norm(poly[(i + 1) % 4] - poly[i]) for i in range(4))
    assert abs(sides[0] - 4) < 0.05 and abs(sides[1] - 4) < 0.05 and abs(sides[2] - 5) < 0.05 and abs(sides[3] - 5) < 0.05


def test_no_false_openings_from_random_dropout():
    prop = propose_layout(bedroom_cloud(seed=5), wall_h=2.6)
    assert prop["openings"] == []


def test_level_cloud_recovers_floor():
    pts = bedroom_cloud(seed=2)
    # tilt the whole cloud by 12 deg about x and give the leveller a rough up hint
    a = math.radians(12)
    R = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    tilted = pts @ R.T + np.array([3, -1, 7])
    lv, Rl, t, frac = level_cloud(tilted, up_hint=R @ np.array([0, 1.0, 0]) + np.array([0.05, 0, 0.03]))
    floor = lv[lv[:, 1] < 0.3]
    assert abs(np.median(floor[:, 1])) < 0.03
    ceil = lv[lv[:, 1] > 2.0]
    assert abs(np.median(ceil[ceil[:, 1] < 3.5][:, 1]) - 2.6) < 0.05


def test_ceiling_sample_on_pointmap():
    # camera at 1.4 m height in a 2.6 m room, looking along +z, pinhole 60 deg vertical FOV (y down)
    H_, W_ = 240, 135
    f = (H_ / 2) / math.tan(math.radians(30))
    u, v = np.meshgrid(np.arange(W_) + 0.5, np.arange(H_) + 0.5)
    ray = np.stack([(u - W_ / 2) / f, (v - H_ / 2) / f, np.ones_like(u)], -1)
    P = np.full((H_, W_, 3), np.nan)
    cam_h, room_h, back = 1.4, 2.6, 5.0
    for i in range(H_):
        for j in range(W_):
            r = ray[i, j]
            cands = []
            if r[1] > 1e-6: cands.append(cam_h / r[1])           # floor (y down is positive)
            if r[1] < -1e-6: cands.append((room_h - cam_h) / -r[1])  # ceiling
            cands.append(back / r[2])                          # back wall
            P[i, j] = r * min(cands)
    cs = ceiling_sample(P)
    assert cs is not None and abs(cs.height_m - 2.6) < 0.08, cs

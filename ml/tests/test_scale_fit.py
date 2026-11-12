import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from e2_scale import scale_from_depths, vote


def test_recovers_scale_with_noise_and_outliers():
    rng = np.random.default_rng(1)
    colmap = rng.uniform(0.5, 6.0, 400)
    model = colmap * 0.37 * (1 + rng.normal(0, 0.05, 400))
    bad = rng.random(400) < 0.10
    model[bad] = rng.uniform(0.1, 20.0, bad.sum())      # gross outliers
    s = scale_from_depths(model, colmap)
    assert abs(s - 0.37) / 0.37 < 0.02


def test_vote_median_and_iqr():
    med, spread = vote([0.36, 0.37, 0.38, 0.37, 0.37, 0.39, 0.35])
    assert abs(med - 0.37) < 1e-9
    assert 0 < spread < 0.06


def test_too_few_points_returns_none():
    assert scale_from_depths(np.ones(5), np.ones(5)) is None

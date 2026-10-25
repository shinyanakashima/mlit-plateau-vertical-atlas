"""LT11 mansion areas: absolute heights, terrain layer and coverage (skipped if not built)."""
from pathlib import Path

import numpy as np
import pytest
import zarr

DATA = Path(__file__).resolve().parents[2] / "public" / "data"
AREAS = {"minato-shibaura": (-2.0, 8.0), "tama-tachikawa": (78.0, 90.0)}


def _open(area):
    p = DATA / area / "atlas.zarr"
    if not p.exists():
        pytest.skip(f"{area} not built")
    return zarr.open_group(str(p), mode="r")


@pytest.mark.parametrize("area,bounds", AREAS.items())
def test_grid_is_absolute_and_floor_aligned(area, bounds):
    g = _open(area)
    a = g.attrs["grid"]
    # z0 = 0 and dz = 2: the representative height of every 10 m floor is a level centre
    assert a["z0"] == 0.0 and a["dz"] == 2.0
    for floor in range(1, 21):
        h = 10 * floor - 5
        k = int(h // a["dz"])
        assert a["z0"] + (k + 0.5) * a["dz"] == h


@pytest.mark.parametrize("area,bounds", AREAS.items())
def test_ground_and_coverage(area, bounds):
    g = _open(area)
    ground = g["ground"][:]
    lo, hi = bounds
    med = float(np.nanmedian(ground))
    assert lo < med < hi, med
    cov = g["coverage"][:]
    assert cov.shape == ground.shape and cov.dtype == np.uint8
    assert cov.mean() > 0.99  # both sample areas lie inside PLATEAU 2025 coverage


def test_tachikawa_8f_is_underground_and_minato_has_towers():
    tama = _open("tama-tachikawa")
    minato = _open("minato-shibaura")
    k = int(75 // 2)  # 8F representative height 75 m
    g = tama["ground"][:]
    assert (g > 75).mean() > 0.99
    assert (tama["lod2/occupancy"][k] == 255).mean() > 0.99
    assert (minato["lod2/occupancy"][k] == 1).sum() > 500  # tower floors at 75 m above sea level


def test_mansion_meshes_exist():
    for area in AREAS:
        d = DATA / area
        if not d.exists():
            pytest.skip("not built")
        for f in ("terrain.glb", "lod1_abs.glb", "lod2_abs.glb"):
            assert (d / f).stat().st_size > 10_000, f

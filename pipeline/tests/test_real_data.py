"""Checks on the generated PLATEAU dataset (skipped if it has not been built)."""
import json
from pathlib import Path

import numpy as np
import pytest
import zarr
from pyproj import Transformer

from atlas import analysis

DATA = Path(__file__).resolve().parents[2] / "public" / "data" / "tokyo-station"
pytestmark = pytest.mark.skipif(not (DATA / "atlas.zarr").exists(), reason="dataset not built")


@pytest.fixture(scope="module")
def atlas():
    g = zarr.open_group(str(DATA / "atlas.zarr"), mode="r")
    return g, json.loads((DATA / "buildings.json").read_text())


def test_metadata(atlas):
    g, _ = atlas
    a = g.attrs
    assert a["crs"]["horizontal"] == "EPSG:6677"
    assert a["grid"]["dx"] == 2.0 and a["grid"]["dz"] == 3.0
    occ = g["lod2/occupancy"]
    assert occ.shape == (a["grid"]["nz"], a["grid"]["ny"], a["grid"]["nx"])
    assert occ.dtype == np.uint8
    assert set(np.unique(occ[:])) <= {0, 1, 255}


def test_building_positions_align(atlas):
    """Named landmarks: the voxel column at the building's LOD2 roof centroid carries its id."""
    g, bj = atlas
    a = g.attrs["grid"]
    bid = g["lod1/building"][:]
    tr = Transformer.from_crs(6697, a["epsg"], always_xy=True)
    checked = 0
    for b in bj:
        if not b["name"] or (b["measuredHeight"] or 0) < 60:
            continue
        x, y = tr.transform(b["lon"], b["lat"])
        i = int((x - a["x0"]) // a["dx"])
        j = int((a["y1"] - y) // a["dx"])
        if not (0 <= i < a["nx"] and 0 <= j < a["ny"]):
            continue
        col = bid[:, max(j - 3, 0):j + 4, max(i - 3, 0):i + 4]
        assert (col == b["id"]).any(), b["name"]
        checked += 1
    assert checked >= 5


def test_voxel_tops_match_attributes(atlas):
    g, bj = atlas
    a = g.attrs["grid"]
    bid = g["lod2/building"][:]
    tr = Transformer.from_crs(6697, a["epsg"], always_xy=True)
    checked = 0
    for b in bj:
        if (b["measuredHeight"] or 0) < 100:
            continue
        x, y = tr.transform(b["lon"], b["lat"])
        if not (a["x0"] + 40 < x < a["x1"] - 40 and a["y0"] + 40 < y < a["y1"] - 40):
            continue  # towers cut by the area boundary
        ks = np.where((bid == b["id"]).any(axis=(1, 2)))[0]
        if len(ks) == 0:
            continue  # outside the grid
        top_centre = a["z0"] + (ks.max() + 0.5) * a["dz"]
        # never above the true roof; thin rooftop features narrower than a 2 m cell can be
        # missed by centre sampling, so allow the voxel top to sit a few levels lower
        assert top_centre <= b["lod2TopTP"] + 1e-6, b["name"]
        assert top_centre >= b["lod2TopTP"] - 3 * a["dz"], b["name"]
        checked += 1
    assert checked >= 3


def test_ground_is_tp(atlas):
    g, _ = atlas
    ground = g["ground"][:]
    # Tokyo Station area: ground about 2-5 m above T.P. (Marunouchi / Yaesu)
    assert 1.0 < float(np.nanmedian(ground)) < 6.0


def test_stats_json_matches(atlas):
    g, _ = atlas
    stats = json.loads((DATA / "stats.json").read_text())
    occ = g["lod2/occupancy"]
    for k in (5, 20, 40):
        s = stats["lod2"][k]
        r = analysis.occupancy_ratio(occ[k])
        assert r["occupied"] == s["occupied"] and r["judged"] == s["judged"]

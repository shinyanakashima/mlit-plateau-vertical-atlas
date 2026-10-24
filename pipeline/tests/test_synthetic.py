"""Analytically known answers on the synthetic scene (see build_synthetic.py)."""
import numpy as np
import pytest

import build_synthetic
from atlas import analysis
from atlas.voxelize import BUILDING, NODATA


@pytest.fixture(scope="module")
def scene():
    return build_synthetic.build()


def test_grid_shape(scene):
    g = scene["grid"]
    assert (g.nx, g.ny, g.nz) == (64, 64, 11)
    assert scene["occ"].shape == (11, 64, 64)


def test_heights_by_level(scene):
    occ = scene["occ"]
    # tower 8..15 x 8..15, top T.P. 31 m -> level 9 (centre 28.5) yes, level 10 (31.5) no
    assert occ[9, 8:16, 8:16].min() == BUILDING
    assert (occ[10] == BUILDING).sum() == 0
    # ring top T.P. 16 m -> level 4 (13.5) yes, level 5 (16.5) no
    assert occ[4, 22, 22] == BUILDING and occ[5, 22, 22] == 0
    # courtyard is never occupied
    assert (occ[:, 24:40, 24:40] == BUILDING).sum() == 0
    # walls top T.P. 7 m -> level 1 (4.5) yes, level 2 (7.5) no
    assert occ[1, 0, 48] == BUILDING and occ[2, 0, 48] == 0
    # wall gap rows 30..33 stays free
    assert (occ[0, 30:34, 48:50] == 0).all()


def test_nodata_mound(scene):
    occ = scene["occ"]
    assert (occ[0, 56:, 56:] == NODATA).all()
    assert (occ[1, 56:, 56:] == NODATA).all()
    assert (occ[2, 56:, 56:] == 0).all()
    assert (occ[0] == NODATA).sum() == 64


def test_occupancy_ratio(scene):
    r = analysis.occupancy_ratio(scene["occ"][0])
    assert r["judged"] == 4096 - 64
    assert r["occupied"] == 64 + (400 - 256) + 120
    assert r["ratio"] == pytest.approx(328 / 4032 * 100)


def test_components_courtyard(scene):
    c = analysis.components(scene["occ"][0], 2.0)
    assert c["count"] == 2  # main space + courtyard
    assert c["free_cells"] == 4032 - 328
    assert c["largest_cells"] == 4032 - 328 - 256
    c5 = analysis.components(scene["occ"][5], 2.0)
    assert c5["count"] == 1


def test_clearance_cuts_gap(scene):
    lv = scene["occ"][2 - 2]  # level 0: walls present
    # gap is 8 m wide: cell centres in the gap are >= 4 m from the wall
    assert analysis.components(lv, 2.0, clearance_m=4.0)["count"] == 2
    split = analysis.components(lv, 2.0, clearance_m=5.0)
    assert split["count"] == 3  # west, east, courtyard


def test_clearance_d2_exact():
    lv = np.zeros((5, 7), np.uint8)
    lv[2, 3] = BUILDING
    d2 = analysis.clearance_d2(lv)
    assert d2[2, 3] == 0
    assert d2[0, 0] == 2 * 2 + 3 * 3
    assert d2[2, 6] == 9


def test_boundary_margin():
    lv = np.zeros((10, 10), np.uint8)
    lv[3:7, 5] = BUILDING  # partial wall: open space connects around it
    assert analysis.components(lv, 2.0)["count"] == 1
    lv[:, 5] = BUILDING  # full wall
    assert analysis.components(lv, 2.0)["count"] == 2
    lv[:, 5] = 0
    lv[1:9, 5] = BUILDING  # wall that only leaves the outermost row open
    assert analysis.components(lv, 2.0)["count"] == 1
    # excluding a 1-cell boundary band removes the detour along the edge
    assert analysis.components(lv, 2.0, margin_cells=1)["count"] == 2

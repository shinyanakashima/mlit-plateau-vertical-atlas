import numpy as np
import pytest

from atlas.citygml import Building
from atlas.grid import Grid, grid_enu_affine
from atlas.voxelize import BUILDING, voxelize_lod1, voxelize_lod2


def grid():
    return Grid(epsg=6677, x0=-6000.0, y1=-35000.0, nx=20, ny=20, dx=2.0, z0=0.0, nz=20, dz=3.0)


def box_polys(x0, x1, y0, y1, z0, z1):
    """Closed box as 6 planar rings (projected coordinates)."""
    p = lambda pts: (np.array(pts + [pts[0]], dtype=float), [])
    return [
        p([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]),
        p([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]),
        p([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]),
        p([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]),
        p([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]),
        p([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]),
    ]


def make_building(polys, x0, x1, y0, y1, z0, z1):
    b = Building("t", None, None, z1 - z0, None, None, None)
    b.lod1_footprints = [np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]])]
    b.lod1_bottom, b.lod1_top = z0, z1
    b.lod2_polys = polys
    return b


def test_lod1_prism_counts():
    g = grid()
    ground = np.full((g.ny, g.nx), 0.0, np.float32)
    # 10 m x 6 m footprint aligned on cell edges -> 5 x 3 cells; 0..12 m -> 4 levels
    x0, y1 = g.x0 + 4, g.y1 - 4
    b = make_building([], x0, x0 + 10, y1 - 6, y1, 0.0, 12.0)
    occ, bid = voxelize_lod1([b], g, ground)
    assert (occ == BUILDING).sum() == 5 * 3 * 4
    assert set(np.unique(bid)) == {0, 1}
    # placement: rows 2..4 (north origin), cols 2..6
    assert occ[0, 2:5, 2:7].min() == BUILDING
    assert occ[0, 1, 2] == 0 and occ[0, 5, 2] == 0


def test_lod2_box_matches_lod1():
    g = grid()
    ground = np.full((g.ny, g.nx), 0.0, np.float32)
    x0, y1 = g.x0 + 4, g.y1 - 4
    args = (x0, x0 + 10, y1 - 6, y1, 0.0, 12.0)
    b = make_building(box_polys(*args), *args)
    o1, _ = voxelize_lod1([b], g, ground)
    o2, _ = voxelize_lod2([b], g, ground)
    assert np.array_equal(o1, o2)


def test_lod2_terraced_tower():
    """Podium 0..9 m plus a narrower tower 9..30 m: LOD2 keeps the setback."""
    g = grid()
    ground = np.full((g.ny, g.nx), 0.0, np.float32)
    x0, y1 = g.x0 + 4, g.y1 - 4
    podium = box_polys(x0, x0 + 20, y1 - 20, y1, 0.0, 9.0)
    tower = box_polys(x0 + 6, x0 + 14, y1 - 14, y1 - 6, 9.0, 30.0)
    # drop the shared faces as a real terraced shell would: podium roof with a hole is
    # approximated by keeping both boxes (hits pair up per column)
    b = make_building(podium + tower, x0, x0 + 20, y1 - 20, y1, 0.0, 30.0)
    o2, _ = voxelize_lod2([b], g, ground)
    # podium level 1 (4.5 m) covers 10x10 cells, tower level 5 (16.5 m) 4x4 cells
    assert (o2[1] == BUILDING).sum() == 100
    assert (o2[5] == BUILDING).sum() == 16
    o1, _ = voxelize_lod1([b], g, ground)
    assert (o1[5] == BUILDING).sum() == 100  # LOD1 prism overestimates the upper floors


def test_overhang_keeps_void_below():
    """A floating slab (canopy) 9..12 m must not be filled down to the ground."""
    g = grid()
    ground = np.full((g.ny, g.nx), 0.0, np.float32)
    x0, y1 = g.x0 + 4, g.y1 - 4
    b = make_building([], x0, x0 + 4, y1 - 4, y1, 0.0, 3.0)
    b.lod2_polys = box_polys(x0, x0 + 4, y1 - 4, y1, 0.0, 3.0)
    b.lod2_installations = [box_polys(x0 + 4, x0 + 10, y1 - 4, y1, 9.0, 12.0)]
    o2, _ = voxelize_lod2([b], g, ground)
    assert o2[3, 2, 5] == BUILDING  # canopy level (10.5 m)
    assert o2[0, 2, 5] == 0 and o2[1, 2, 5] == 0  # open space under the canopy


def test_ground_nodata():
    g = grid()
    ground = np.full((g.ny, g.nx), 4.0, np.float32)
    occ, _ = voxelize_lod1([], g, ground)
    assert (occ[0] == 255).all() and (occ[1] == 0).all()  # centres 1.5 m and 4.5 m


def test_enu_affine_roundtrip():
    from atlas.grid import grid_for_area
    g = grid_for_area((139.7671, 35.6812), 512, 2.0, 0, 30, 3.0)
    a = grid_enu_affine(g, 139.7671, 35.6812)
    assert a["max_residual_m"] < 1e-3
    E = a["grid_to_enu"]
    G = a["enu_to_grid"]
    col, row = 37.25, 201.5
    e = E[0] * col + E[1] * row + E[2]
    n = E[3] * col + E[4] * row + E[5]
    assert G[0] * e + G[1] * n + G[2] == pytest.approx(col, abs=1e-6)
    assert G[3] * e + G[4] * n + G[5] == pytest.approx(row, abs=1e-6)
    # grid is centred on the ENU origin to within a cell
    cx = E[0] * 128 + E[1] * 128 + E[2]
    cy = E[3] * 128 + E[4] * 128 + E[5]
    assert abs(cx) < 2.0 and abs(cy) < 2.0

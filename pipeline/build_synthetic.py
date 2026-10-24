"""Synthetic verification dataset with analytically known answers.

    python pipeline/build_synthetic.py

Writes public/data/synthetic/ in exactly the same format as a PLATEAU area so the web app
and the tests can exercise every code path.  The scene (64 x 64 cells, dx = 2 m, dz = 3 m,
flat ground at T.P. 1.0 m) contains:
  * tower    : cols 8..15, rows 8..15           height 30 m  (64 cells)
  * ring     : 20x20 cells, wall 2 cells thick   height 15 m  → an enclosed courtyard
               (16x16 = 256 cells) that is its own connected component below 15 m
  * wall     : a north-south wall, col 48..49, rows 0..63 except a 4-cell gap at rows 30..33,
               height 6 m  → splits the domain unless one passes the 4-cell (8 m) gap
  * mound    : ground raised to T.P. 5.0 m in the SE corner (cols 56..63, rows 56..63)
               → those cells are NODATA (255) for the level centred at 1.5 m and 4.5 m
The real location is fictitious: the grid is anchored in Tokyo Bay purely for display.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from atlas import analysis  # noqa: E402
from atlas.citygml import Building  # noqa: E402
from atlas.gltf import build_glb  # noqa: E402
from atlas.grid import Grid, grid_enu_affine, grid_for_area  # noqa: E402
from atlas.store import write_atlas  # noqa: E402
from atlas.voxelize import voxelize_lod1  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CENTER = (139.80, 35.60)
GROUND = 1.0


def make_grid() -> Grid:
    g = grid_for_area(CENTER, 128, 2.0, 0.0, 33.0, 3.0)
    return g


def rect_building(grid: Grid, name: str, c0: int, c1: int, r0: int, r1: int, height: float,
                  hole: tuple[int, int, int, int] | None = None) -> Building:
    """Prism covering cells [c0, c1) x [r0, r1) (optionally with a rectangular courtyard)."""
    t = grid.to_lonlat()

    def ring(a0, a1, b0, b1):
        xs = [grid.x0 + a0 * grid.dx, grid.x0 + a1 * grid.dx, grid.x0 + a1 * grid.dx, grid.x0 + a0 * grid.dx]
        ys = [grid.y1 - b0 * grid.dx, grid.y1 - b0 * grid.dx, grid.y1 - b1 * grid.dx, grid.y1 - b1 * grid.dx]
        xs.append(xs[0]); ys.append(ys[0])
        return np.column_stack([xs, ys])

    outer = ring(c0, c1, r0, r1)
    rings = [outer]
    if hole:
        rings.append(ring(*hole)[::-1])
    b = Building(gml_id=f"synthetic-{name}", name=name, usage="合成データ", measured_height=height,
                 storeys_above=int(height // 3.5), storeys_below=0, building_id=None)
    b.lod1_bottom = GROUND
    b.lod1_top = GROUND + height
    lon, lat = t.transform(outer[:, 0], outer[:, 1])
    b.lon, b.lat = float(np.mean(lon)), float(np.mean(lat))
    # footprint with a hole is passed as outer ring; the hole is handled in voxelize via shapely
    b.lod1_footprints = [outer] if not hole else []
    b._hole = hole  # type: ignore[attr-defined]
    faces = []
    for r in rings:
        lo, la = t.transform(r[:, 0], r[:, 1])
        bottom = np.column_stack([lo, la, np.full(len(lo), b.lod1_bottom)])
        top = np.column_stack([lo, la, np.full(len(lo), b.lod1_top)])
        faces += [bottom[::-1], top]
        for i in range(len(lo) - 1):
            faces.append(np.array([bottom[i], bottom[i + 1], top[i + 1], top[i], bottom[i]]))
    b.lod1_faces_ll = faces
    return b


def build() -> dict:
    grid = make_grid()
    ground = np.full((grid.ny, grid.nx), GROUND, dtype=np.float32)
    ground[56:64, 56:64] = 5.0
    tower = rect_building(grid, "タワー（合成）", 8, 16, 8, 16, 30.0)
    ring = rect_building(grid, "中庭のある建物（合成）", 22, 42, 22, 42, 15.0, hole=(24, 40, 24, 40))
    wall_n = rect_building(grid, "壁（北・合成）", 48, 50, 0, 30, 6.0)
    wall_s = rect_building(grid, "壁（南・合成）", 48, 50, 34, 64, 6.0)
    buildings = [tower, ring, wall_n, wall_s]
    # the courtyard building: footprint = outer minus hole, built from shapely
    from shapely.geometry import Polygon
    outer = Polygon([(grid.x0 + 22 * 2, grid.y1 - 22 * 2), (grid.x0 + 42 * 2, grid.y1 - 22 * 2),
                     (grid.x0 + 42 * 2, grid.y1 - 42 * 2), (grid.x0 + 22 * 2, grid.y1 - 42 * 2)])
    inner = Polygon([(grid.x0 + 24 * 2, grid.y1 - 24 * 2), (grid.x0 + 40 * 2, grid.y1 - 24 * 2),
                     (grid.x0 + 40 * 2, grid.y1 - 40 * 2), (grid.x0 + 24 * 2, grid.y1 - 40 * 2)])
    occ, bid = voxelize_lod1(buildings, grid, ground)
    # carve the hole explicitly (LOD1 footprints are simple rings in this helper)
    from atlas.voxelize import _cells_in, _fill, apply_ground
    j, i = _cells_in(grid, outer.difference(inner))
    _fill(occ, bid, grid, j, i, np.full(len(j), GROUND), np.full(len(j), GROUND + 15.0), 2)
    apply_ground(occ, grid, ground)
    bid[occ != 1] = 0
    return {"grid": grid, "ground": ground, "buildings": buildings, "occ": occ, "bid": bid}


def main() -> None:
    d = build()
    grid, ground, buildings, occ, bid = d["grid"], d["ground"], d["buildings"], d["occ"], d["bid"]
    out = ROOT / "public" / "data" / "synthetic"
    out.mkdir(parents=True, exist_ok=True)
    enu = grid_enu_affine(grid, *CENTER)
    attrs = {
        "atlas_version": 1, "area_id": "synthetic", "title": "合成テストデータ",
        "subtitle": "検証用・実在しない街区 128m四方",
        "synthetic": True,
        "crs": {"horizontal": f"EPSG:{grid.epsg}", "name": "JGD2011 / Japan Plane Rectangular CS IX",
                "vertical": "T.P.", "axis_order": "x=easting, y=northing"},
        "grid": {**grid.as_dict(), "x1": grid.x1, "y0": grid.y0, "y_index_origin": "north",
                 "z_sample": "level centre z0 + (k + 0.5) * dz"},
        "corners_lonlat": grid.corners_lonlat(),
        "enu": {**enu, "origin_lonlat": list(CENTER), "origin_height_ellipsoid": 0.0},
        "center_lonlat": list(CENTER),
        "display": {"height_offset_m": -GROUND, "base_tp_m": GROUND},
        "codes": {"0": "free", "1": "building", "255": "not judged (below ground / no data)"},
        "lods": {"lod1": "synthetic prisms", "lod2": "identical to lod1"},
        "ground": {"source": "synthetic flat ground T.P. 1.0 m with a 5.0 m mound"},
        "sources": {"buildings": "合成データ（検証用・実在しません）", "files": [], "license": "CC0"},
        "building_count": len(buildings),
    }
    write_atlas(out / "atlas.zarr", grid, attrs,
                {"lod1": {"occupancy": occ, "building": bid}, "lod2": {"occupancy": occ, "building": bid}},
                ground)
    bj = [{"id": i, "gmlId": b.gml_id, "buildingId": None, "name": b.name, "usage": b.usage,
           "measuredHeight": b.measured_height, "storeysAbove": b.storeys_above, "storeysBelow": 0,
           "groundTP": b.lod1_bottom, "topTP": b.lod1_top, "lod2TopTP": b.lod1_top, "alias": None,
           "lon": b.lon, "lat": b.lat} for i, b in enumerate(buildings, start=1)]
    (out / "buildings.json").write_text(json.dumps(bj, ensure_ascii=False))
    glb, info = build_glb([[(f, []) for f in b.lod1_faces_ll] for b in buildings], CENTER[0], CENTER[1], -GROUND)
    (out / "lod1.glb").write_bytes(glb)
    (out / "lod2.glb").write_bytes(glb)
    manifest = {"id": "synthetic", "title": attrs["title"], "subtitle": attrs["subtitle"], "kind": "synthetic",
                "zarr": "atlas.zarr", "buildings": "buildings.json",
                "models": {"lod1": "lod1.glb", "lod2": "lod2.glb"}, "ortho": None, "glb": {"lod1": info}}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    stats = analysis.level_stats(occ, grid.dx)
    (out / "stats.json").write_text(json.dumps({"lod1": stats, "lod2": stats}, separators=(",", ":")))
    print(f"synthetic dataset written: {grid.nx}x{grid.ny}x{grid.nz}")


if __name__ == "__main__":
    main()

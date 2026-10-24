"""Build a PLATEAU Vertical Atlas dataset.

    python pipeline/build_atlas.py tokyo-station

Outputs to public/data/<area>/ :
    atlas.zarr/        Zarr v3: lod1|lod2/{occupancy,building}[z,y,x], ground[y,x]
    buildings.json     building attributes (index = value in */building arrays)
    lod1.glb lod2.glb  building shells in a local ENU frame (for CesiumJS)
    ortho.jpg          bundled aerial photo (GSI)
    stats.json         reference per-level statistics computed in Python (for cross-checks)
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from atlas import analysis  # noqa: E402
from atlas.citygml import parse_buildings  # noqa: E402
from atlas.dem import ground_grid  # noqa: E402
from atlas.fetch import plateau_bldg_files  # noqa: E402
from atlas.gltf import build_glb  # noqa: E402
from atlas.grid import grid_enu_affine, grid_for_area  # noqa: E402
from atlas.ortho import build_ortho  # noqa: E402
from atlas.store import write_atlas  # noqa: E402
from atlas.voxelize import BUILDING, NODATA, voxelize_lod1, voxelize_lod2  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache"


def log(msg: str, t0=[time.time()]):
    print(f"[{time.time() - t0[0]:6.1f}s] {msg}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("area")
    ap.add_argument("--out", default=str(ROOT / "public" / "data"))
    ap.add_argument("--no-ortho", action="store_true")
    args = ap.parse_args()

    areas = json.loads((Path(__file__).parent / "areas.json").read_text())
    cfg = areas[args.area]
    out = Path(args.out) / args.area
    out.mkdir(parents=True, exist_ok=True)

    log(f"area {args.area}: {cfg['title']}")
    grid = grid_for_area(tuple(cfg["center_lonlat"]), cfg["size_m"], cfg["dx_m"],
                         cfg["z_min_tp"], cfg["z_min_tp"] + 1, cfg["dz_m"], cfg["epsg"])
    corners = grid.corners_lonlat()
    lons = [c[0] for c in corners.values()]
    lats = [c[1] for c in corners.values()]
    bbox = (min(lons), min(lats), max(lons), max(lats))

    paths, sources = plateau_bldg_files(cfg["meshes"], CACHE)
    log(f"citygml files: {[p.name for p in paths]}")
    buildings = parse_buildings(paths, bbox, grid.epsg)
    log(f"parsed {len(buildings)} buildings intersecting the area")

    top = max(max(b.lod1_top or 0, max((p[0][:, 2].max() for p in b.lod2_polys_ll), default=0)) for b in buildings)
    grid.nz = int(math.ceil((top + cfg["dz_m"] - grid.z0) / grid.dz))
    log(f"grid {grid.nx}x{grid.ny}x{grid.nz} (dx={grid.dx} m, dz={grid.dz} m), max height {top:.1f} m T.P.")

    ground, dem_info = ground_grid(grid, CACHE)
    log(f"ground {np.nanmin(ground):.2f}..{np.nanmax(ground):.2f} m T.P. {dem_info}")

    occ1, bid1 = voxelize_lod1(buildings, grid, ground)
    log(f"LOD1 voxelized: {int((occ1 == BUILDING).sum())} building voxels")
    occ2, bid2 = voxelize_lod2(buildings, grid, ground)
    log(f"LOD2 voxelized: {int((occ2 == BUILDING).sum())} building voxels")

    enu_affine = grid_enu_affine(grid, *cfg["center_lonlat"])
    log(f"ENU<->grid affine residual {enu_affine['max_residual_m']:.4f} m")
    base_tp = float(np.nanpercentile(ground, 5))
    display_offset = -base_tp  # Cesium ellipsoidal height = T.P. + display_offset (no terrain)

    sources_unique = []
    for s in sources:
        if s["url"] not in [u["url"] for u in sources_unique]:
            sources_unique.append(s)
    attrs = {
        "atlas_version": 1,
        "area_id": args.area,
        "title": cfg["title"],
        "subtitle": cfg.get("subtitle", ""),
        "crs": {"horizontal": f"EPSG:{grid.epsg}", "name": "JGD2011 / Japan Plane Rectangular CS IX",
                "vertical": "T.P. (東京湾平均海面, JGD2011)", "axis_order": "x=easting, y=northing"},
        "grid": {**grid.as_dict(), "x1": grid.x1, "y0": grid.y0,
                 "y_index_origin": "north", "z_sample": "level centre z0 + (k + 0.5) * dz"},
        "corners_lonlat": corners,
        "enu": {**enu_affine, "origin_lonlat": cfg["center_lonlat"], "origin_height_ellipsoid": 0.0},
        "center_lonlat": cfg["center_lonlat"],
        "display": {"height_offset_m": display_offset, "base_tp_m": base_tp,
                    "note": "Cesium ellipsoidal height = T.P. + height_offset_m (globe without terrain)"},
        "codes": {"0": "free", "1": "building", "255": "not judged (below ground / no data)"},
        "lods": {
            "lod1": "LOD1 prism: footprint × [ground, measured top]",
            "lod2": "LOD2 vertical ray casting of roof/ground/installation surfaces",
        },
        "ground": {"source": "国土地理院 標高タイル (DEM5A→DEM5B→DEM10B)", "pixels": dem_info},
        "sources": {
            "buildings": "国土交通省 Project PLATEAU 3D都市モデル (CityGML, 建築物)",
            "files": sources_unique,
            "license": "PLATEAU: CC BY 4.0 互換（PLATEAU利用規約） / 地理院タイル: 国土地理院コンテンツ利用規約",
        },
        "building_count": len(buildings),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    write_atlas(out / "atlas.zarr", grid, attrs,
                {"lod1": {"occupancy": occ1, "building": bid1},
                 "lod2": {"occupancy": occ2, "building": bid2}}, ground)
    log("zarr written")

    # building attributes (+ footprint inside the grid, from the LOD2 voxels)
    present = {}
    flat = bid2.reshape(grid.nz, -1)
    for k in range(grid.nz):
        ids, cnt = np.unique(flat[k], return_counts=True)
        for i_, c_ in zip(ids.tolist(), cnt.tolist()):
            if i_:
                p = present.setdefault(i_, [0, k])
                p[0] = max(p[0], c_)
                p[1] = max(p[1], k)
    bj = []
    for idx, b in enumerate(buildings, start=1):
        lod2_top = max((p[0][:, 2].max() for p in b.lod2_polys_ll), default=None)
        bj.append({
            "id": idx, "gmlId": b.gml_id, "buildingId": b.building_id, "name": b.name,
            "usage": b.usage, "measuredHeight": b.measured_height,
            "storeysAbove": b.storeys_above if b.storeys_above and b.storeys_above < 9999 else None,
            "storeysBelow": b.storeys_below if b.storeys_below is not None and b.storeys_below < 9999 else None,
            "alias": cfg.get("aliases", {}).get(b.name or ""),
            "groundTP": round(b.lod1_bottom, 2) if b.lod1_bottom is not None else None,
            "topTP": round(b.lod1_top, 2) if b.lod1_top is not None else None,
            "lod2TopTP": round(float(lod2_top), 2) if lod2_top is not None else None,
            "lon": round(b.lon, 7), "lat": round(b.lat, 7),
            "gridCells": present.get(idx, [0, 0])[0],
            "topLevel": present.get(idx, [0, None])[1],
        })
    (out / "buildings.json").write_text(json.dumps(bj, ensure_ascii=False, separators=(",", ":")))

    lon0, lat0 = cfg["center_lonlat"]
    lod1_polys = [[(f, []) for f in b.lod1_faces_ll] for b in buildings]
    glb, info1 = build_glb(lod1_polys, lon0, lat0, display_offset)
    (out / "lod1.glb").write_bytes(glb)
    lod2_polys = [b.lod2_polys_ll or [(f, []) for f in b.lod1_faces_ll] for b in buildings]
    glb, info2 = build_glb(lod2_polys, lon0, lat0, display_offset)
    (out / "lod2.glb").write_bytes(glb)
    log(f"glb written lod1={info1} lod2={info2}")

    ortho = None
    if not args.no_ortho:
        pad = 0.004
        ortho = build_ortho((bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad), 18,
                            out / "ortho.jpg", CACHE)
        log(f"ortho written {ortho}")

    stats = {lod: analysis.level_stats(o, grid.dx) for lod, o in (("lod1", occ1), ("lod2", occ2))}
    manifest = {
        "id": args.area, "title": cfg["title"], "subtitle": cfg.get("subtitle", ""),
        "kind": "plateau", "zarr": "atlas.zarr", "buildings": "buildings.json",
        "models": {"lod1": "lod1.glb", "lod2": "lod2.glb"}, "ortho": ortho,
        "glb": {"lod1": info1, "lod2": info2},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    (out / "stats.json").write_text(json.dumps(stats, separators=(",", ":")))
    nod = [int((occ1[k] == NODATA).sum()) for k in range(grid.nz)]
    log(f"stats written; NODATA per level (first 5): {nod[:5]}")


if __name__ == "__main__":
    main()

"""Building → occupancy voxel grid.

Codes:  0 = free (air, judged), 1 = building, 255 = not judged (below ground / no DEM).

LOD1: each building is a prism.  A column (cell centre) inside the footprint is occupied
      for every level whose centre lies in [min(bottom, ground), top).
LOD2: vertical ray casting.  For every non-vertical surface polygon, the cell centres it
      covers (2D) get a hit at the polygon plane's height.  Per building and column the
      sorted hits are paired (entering/leaving the solid); an odd number of hits (open or
      slightly broken shells) falls back to the [min, max] interval.  Building
      installations (canopies, rooftop structures) are handled the same way.
"""
from __future__ import annotations

import numpy as np
import shapely
from shapely.geometry import Polygon

from .citygml import Building
from .grid import Grid

FREE, BUILDING, NODATA = 0, 1, 255


def _cells_in(grid: Grid, poly: Polygon) -> tuple[np.ndarray, np.ndarray]:
    """Row/col indices of the cell centres strictly inside *poly*."""
    minx, miny, maxx, maxy = poly.bounds
    i0 = max(int(np.floor((minx - grid.x0) / grid.dx - 0.5)), 0)
    i1 = min(int(np.ceil((maxx - grid.x0) / grid.dx - 0.5)), grid.nx - 1)
    j0 = max(int(np.floor((grid.y1 - maxy) / grid.dx - 0.5)), 0)
    j1 = min(int(np.ceil((grid.y1 - miny) / grid.dx - 0.5)), grid.ny - 1)
    if i0 > i1 or j0 > j1:
        return np.empty(0, int), np.empty(0, int)
    ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
    xs = grid.x0 + (ii.ravel() + 0.5) * grid.dx
    ys = grid.y1 - (jj.ravel() + 0.5) * grid.dx
    m = shapely.contains_xy(poly, xs, ys)
    return jj.ravel()[m], ii.ravel()[m]


def _fill(occ: np.ndarray, bid: np.ndarray, grid: Grid, j: np.ndarray, i: np.ndarray,
          zlo: np.ndarray, zhi: np.ndarray, value_id: int) -> None:
    """Mark levels whose centre is within [zlo, zhi) for each column (j, i)."""
    zc = grid.level_centers()
    k0 = np.ceil((zlo - grid.z0) / grid.dz - 0.5).astype(int)
    k1 = np.ceil((zhi - grid.z0) / grid.dz - 0.5).astype(int)  # exclusive
    k0 = np.clip(k0, 0, grid.nz)
    k1 = np.clip(k1, 0, grid.nz)
    for jj, ii, a, b in zip(j, i, k0, k1):
        if b > a:
            occ[a:b, jj, ii] = BUILDING
            bid[a:b, jj, ii] = value_id
    del zc


def new_volume(grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    occ = np.zeros((grid.nz, grid.ny, grid.nx), dtype=np.uint8)
    bid = np.zeros((grid.nz, grid.ny, grid.nx), dtype=np.uint16)
    return occ, bid


def apply_ground(occ: np.ndarray, grid: Grid, ground: np.ndarray) -> None:
    """Every voxel whose centre is below the ground surface becomes NODATA (地中・判定対象外)."""
    zc = grid.level_centers()[:, None, None]
    g = np.where(np.isnan(ground), np.inf, ground)[None, :, :]
    occ[zc < g] = NODATA


def voxelize_lod1(buildings: list[Building], grid: Grid, ground: np.ndarray):
    occ, bid = new_volume(grid)
    for idx, b in enumerate(buildings, start=1):
        if b.lod1_top is None:
            continue
        for ring in b.lod1_footprints:
            if len(ring) < 4:
                continue
            poly = Polygon(ring).buffer(0)
            if poly.is_empty:
                continue
            j, i = _cells_in(grid, poly)
            if len(j) == 0:
                continue
            g = ground[j, i]
            zlo = np.fmin(np.full(len(j), b.lod1_bottom), np.where(np.isnan(g), b.lod1_bottom, g))
            zhi = np.full(len(j), b.lod1_top)
            _fill(occ, bid, grid, j, i, zlo, zhi, idx)
    apply_ground(occ, grid, ground)
    bid[occ != BUILDING] = 0
    return occ, bid


def _plane_hits(grid: Grid, ext: np.ndarray, holes: list[np.ndarray]):
    """Cells covered by a (non-vertical) planar polygon and the polygon height there."""
    pts = ext[:-1] if np.allclose(ext[0], ext[-1]) else ext
    if len(pts) < 3:
        return None
    # Newell normal
    nxv = nyv = nzv = 0.0
    for a, b in zip(pts, np.roll(pts, -1, axis=0)):
        nxv += (a[1] - b[1]) * (a[2] + b[2])
        nyv += (a[2] - b[2]) * (a[0] + b[0])
        nzv += (a[0] - b[0]) * (a[1] + b[1])
    norm = np.sqrt(nxv * nxv + nyv * nyv + nzv * nzv)
    if norm == 0 or abs(nzv) / norm < 0.02:  # vertical wall: no area in plan view
        return None
    try:
        poly = Polygon(ext[:, :2], [h[:, :2] for h in holes])
        if not poly.is_valid:
            poly = poly.buffer(0)
    except (ValueError, shapely.errors.GEOSException):
        return None
    if poly.is_empty or poly.area < 1e-4:
        return None
    j, i = _cells_in(grid, poly)
    if len(j) == 0:
        return None
    c = pts.mean(axis=0)
    xs = grid.x0 + (i + 0.5) * grid.dx
    ys = grid.y1 - (j + 0.5) * grid.dx
    z = c[2] - (nxv * (xs - c[0]) + nyv * (ys - c[1])) / nzv
    return j, i, z


def _cast(grid, polys, occ, bid, idx, ground, extend_to_ground: bool):
    js, is_, zs = [], [], []
    for ext, holes in polys:
        r = _plane_hits(grid, ext, holes)
        if r is not None:
            js.append(r[0]); is_.append(r[1]); zs.append(r[2])
    if not js:
        return 0
    j = np.concatenate(js); i = np.concatenate(is_); z = np.concatenate(zs)
    key = j * grid.nx + i
    order = np.lexsort((z, key))
    key, z = key[order], z[order]
    starts = np.flatnonzero(np.r_[True, key[1:] != key[:-1]])
    ends = np.r_[starts[1:], len(key)]
    lo_l, hi_l, jj_l, ii_l = [], [], [], []
    for s, e in zip(starts, ends):
        zz = z[s:e]
        # merge duplicate hits (shared edges / coplanar faces)
        keep = np.r_[True, np.diff(zz) > 0.05]
        zz = zz[keep]
        cj, ci = divmod(int(key[s]), grid.nx)
        if len(zz) == 1:
            pairs = [(zz[0] - grid.dz * 0.5, zz[0] + grid.dz * 0.5)] if not extend_to_ground else [(zz[0], zz[0])]
        elif len(zz) % 2 == 0:
            pairs = list(zip(zz[0::2], zz[1::2]))
        else:
            pairs = [(zz[0], zz[-1])]
        if extend_to_ground:
            g = ground[cj, ci]
            if not np.isnan(g):
                lo0, hi0 = pairs[0]
                # the shell's ground surface may float slightly above the DEM
                if lo0 - g < 1.5:
                    pairs[0] = (min(lo0, g), hi0)
                if len(zz) == 1:  # lone roof hit: treat as a solid down to the ground
                    pairs = [(min(g, zz[0]), zz[0])]
        for a, b in pairs:
            lo_l.append(a); hi_l.append(b); jj_l.append(cj); ii_l.append(ci)
    _fill(occ, bid, grid, np.array(jj_l), np.array(ii_l), np.array(lo_l), np.array(hi_l), idx)
    return len(starts)


def voxelize_lod2(buildings: list[Building], grid: Grid, ground: np.ndarray):
    occ, bid = new_volume(grid)
    for idx, b in enumerate(buildings, start=1):
        if b.lod2_polys:
            _cast(grid, b.lod2_polys, occ, bid, idx, ground, extend_to_ground=True)
        elif b.lod1_footprints:  # no LOD2 for this building → fall back to LOD1 prism
            for ring in b.lod1_footprints:
                poly = Polygon(ring).buffer(0)
                j, i = _cells_in(grid, poly)
                if len(j):
                    _fill(occ, bid, grid, j, i, np.full(len(j), b.lod1_bottom),
                          np.full(len(j), b.lod1_top), idx)
        for inst in b.lod2_installations:
            _cast(grid, inst, occ, bid, idx, ground, extend_to_ground=False)
    apply_ground(occ, grid, ground)
    bid[occ != BUILDING] = 0
    return occ, bid

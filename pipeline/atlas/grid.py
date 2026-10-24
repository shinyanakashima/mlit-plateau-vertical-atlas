"""Voxel grid definition shared by every pipeline step.

Conventions (kept identical in the web app, see src/data/types.ts):
  * Horizontal CRS: JGD2011 / Japan Plane Rectangular CS (default EPSG:6677, zone IX), metres.
    x = easting, y = northing (pyproj always_xy order).
  * Array order: occupancy[z, y, x].  y index 0 is the NORTH edge (raster convention),
    x index 0 is the WEST edge, z index 0 is the LOWEST level.
  * Cell (j, i) covers easting  [x0 + i*dx, x0 + (i+1)*dx)
                       northing (y1 - (j+1)*dx, y1 - j*dx]
  * Level k covers T.P. elevation [z0 + k*dz, z0 + (k+1)*dz); a voxel is classified by the
    sample at its centre z0 + (k + 0.5) * dz.
  * Heights are orthometric heights above Tokyo Peil (T.P., JGD2011 vertical datum), which is
    the vertical reference of PLATEAU CityGML (EPSG:6697) and of GSI DEM tiles.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import math

import numpy as np
from pyproj import Transformer


@dataclass
class Grid:
    epsg: int
    x0: float  # west edge easting
    y1: float  # north edge northing
    nx: int
    ny: int
    dx: float
    z0: float
    nz: int
    dz: float

    @property
    def x1(self) -> float:
        return self.x0 + self.nx * self.dx

    @property
    def y0(self) -> float:
        return self.y1 - self.ny * self.dx

    def cell_centers(self) -> tuple[np.ndarray, np.ndarray]:
        """Return (xc[nx], yc[ny]) arrays of cell centre coordinates."""
        xc = self.x0 + (np.arange(self.nx) + 0.5) * self.dx
        yc = self.y1 - (np.arange(self.ny) + 0.5) * self.dx
        return xc, yc

    def level_centers(self) -> np.ndarray:
        return self.z0 + (np.arange(self.nz) + 0.5) * self.dz

    def to_proj(self) -> Transformer:
        return Transformer.from_crs(6697, self.epsg, always_xy=True)

    def to_lonlat(self) -> Transformer:
        return Transformer.from_crs(self.epsg, 6697, always_xy=True)

    def corners_lonlat(self) -> dict[str, list[float]]:
        t = self.to_lonlat()
        pts = {
            "nw": (self.x0, self.y1),
            "ne": (self.x1, self.y1),
            "se": (self.x1, self.y0),
            "sw": (self.x0, self.y0),
        }
        return {k: list(t.transform(x, y)) for k, (x, y) in pts.items()}

    def as_dict(self) -> dict:
        return asdict(self)


def grid_for_area(center_lonlat: tuple[float, float], size_m: float, dx: float,
                  z0: float, z_top: float, dz: float, epsg: int = 6677) -> Grid:
    t = Transformer.from_crs(6697, epsg, always_xy=True)
    cx, cy = t.transform(*center_lonlat)
    n = int(round(size_m / dx))
    # snap the origin to the dx lattice so that re-runs are bit-identical
    x0 = math.floor((cx - n * dx / 2) / dx) * dx
    y1 = math.floor((cy + n * dx / 2) / dx) * dx
    nz = int(math.ceil((z_top - z0) / dz))
    return Grid(epsg=epsg, x0=x0, y1=y1, nx=n, ny=n, dx=dx, z0=z0, nz=nz, dz=dz)


# --- GRS80 helpers (local ENU frame for the glTF meshes) ------------------
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)


def geodetic_to_ecef(lon: np.ndarray, lat: np.ndarray, h: np.ndarray) -> np.ndarray:
    lam = np.radians(lon)
    phi = np.radians(lat)
    n = _A / np.sqrt(1 - _E2 * np.sin(phi) ** 2)
    x = (n + h) * np.cos(phi) * np.cos(lam)
    y = (n + h) * np.cos(phi) * np.sin(lam)
    z = (n * (1 - _E2) + h) * np.sin(phi)
    return np.stack([x, y, z], axis=-1)


def ecef_to_enu(p: np.ndarray, lon0: float, lat0: float, h0: float = 0.0) -> np.ndarray:
    o = geodetic_to_ecef(np.array(lon0), np.array(lat0), np.array(h0))
    lam = math.radians(lon0)
    phi = math.radians(lat0)
    r = np.array([
        [-math.sin(lam), math.cos(lam), 0.0],
        [-math.sin(phi) * math.cos(lam), -math.sin(phi) * math.sin(lam), math.cos(phi)],
        [math.cos(phi) * math.cos(lam), math.cos(phi) * math.sin(lam), math.sin(phi)],
    ])
    return (p - o) @ r.T


def grid_enu_affine(grid: Grid, lon0: float, lat0: float) -> dict:
    """Affine maps between fractional grid coords (col, row; 0..nx at cell edges) and local ENU (E, N).

    The plane-rectangular grid is rotated by the meridian convergence and scaled by the
    projection scale factor relative to ENU; over a few hundred metres an affine map is exact
    to well below a millimetre (the residual is reported).
    """
    cols, rows = np.meshgrid(np.linspace(0, grid.nx, 5), np.linspace(0, grid.ny, 5))
    cols, rows = cols.ravel(), rows.ravel()
    x = grid.x0 + cols * grid.dx
    y = grid.y1 - rows * grid.dx
    lon, lat = grid.to_lonlat().transform(x, y)
    enu = ecef_to_enu(geodetic_to_ecef(np.asarray(lon), np.asarray(lat), np.zeros_like(cols)), lon0, lat0)
    A = np.column_stack([enu[:, 0], enu[:, 1], np.ones_like(cols)])
    to_grid, *_ = np.linalg.lstsq(A, np.column_stack([cols, rows]), rcond=None)
    G = np.column_stack([cols, rows, np.ones_like(cols)])
    to_enu, *_ = np.linalg.lstsq(G, enu[:, :2], rcond=None)
    resid = np.abs(G @ to_enu - enu[:, :2]).max()
    return {
        # col = a*E + b*N + c ; row = d*E + e*N + f
        "enu_to_grid": [to_grid[0, 0], to_grid[1, 0], to_grid[2, 0], to_grid[0, 1], to_grid[1, 1], to_grid[2, 1]],
        # E = a*col + b*row + c ; N = d*col + e*row + f
        "grid_to_enu": [to_enu[0, 0], to_enu[1, 0], to_enu[2, 0], to_enu[0, 1], to_enu[1, 1], to_enu[2, 1]],
        "max_residual_m": float(resid),
    }

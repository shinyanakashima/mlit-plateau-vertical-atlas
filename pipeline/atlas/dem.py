"""Ground elevation from GSI elevation tiles (標高タイル, PNG encoding).

DEM5A (laser survey, 5 m) is used first; missing pixels fall back to DEM5B and DEM10B.
Values are orthometric heights (T.P.).  https://maps.gsi.go.jp/development/demtile.html
"""
from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
from PIL import Image

from .fetch import cached_get
from .grid import Grid

LAYERS = ["dem5a_png", "dem5b_png", "dem_png"]
ZOOM = {"dem5a_png": 15, "dem5b_png": 15, "dem_png": 14}


def _decode(png: bytes) -> np.ndarray:
    a = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(np.int64)
    x = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h = np.where(x < 2**23, x, x - 2**24).astype(np.float64) * 0.01
    h[x == 2**23] = np.nan
    return h


def _lonlat_to_pixel(lon, lat, z):
    n = 2**z * 256
    px = (lon + 180.0) / 360.0 * n
    s = np.sin(np.radians(lat))
    py = (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return px, py


def sample_dem(lon: np.ndarray, lat: np.ndarray, cache: Path) -> tuple[np.ndarray, np.ndarray]:
    """Bilinear sample of ground height; returns (height, source_index)."""
    out = np.full(lon.shape, np.nan)
    src = np.full(lon.shape, -1, dtype=np.int8)
    for li, layer in enumerate(LAYERS):
        todo = np.isnan(out)
        if not todo.any():
            break
        z = ZOOM[layer]
        px, py = _lonlat_to_pixel(lon[todo], lat[todo], z)
        px -= 0.5
        py -= 0.5
        tx0, tx1 = int(np.floor(px.min() / 256)), int(np.floor((px.max() + 1) / 256))
        ty0, ty1 = int(np.floor(py.min() / 256)), int(np.floor((py.max() + 1) / 256))
        mosaic = np.full(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.nan)
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                url = f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{tx}/{ty}.png"
                data = cached_get(url, cache / "gsi" / layer / f"{z}_{tx}_{ty}.png", allow_404=True)
                if data is None:
                    continue
                mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256,
                       (tx - tx0) * 256:(tx - tx0 + 1) * 256] = _decode(data)
        fx = px - tx0 * 256
        fy = py - ty0 * 256
        ix = np.floor(fx).astype(int)
        iy = np.floor(fy).astype(int)
        wx = fx - ix
        wy = fy - iy
        v = (mosaic[iy, ix] * (1 - wx) * (1 - wy) + mosaic[iy, ix + 1] * wx * (1 - wy)
             + mosaic[iy + 1, ix] * (1 - wx) * wy + mosaic[iy + 1, ix + 1] * wx * wy)
        idx = np.flatnonzero(todo.ravel())
        flat = out.ravel()
        flat[idx] = v
        out = flat.reshape(out.shape)
        s = src.ravel()
        s[idx[~np.isnan(v)]] = li
        src = s.reshape(src.shape)
    return out, src


def ground_grid(grid: Grid, cache: Path) -> tuple[np.ndarray, dict]:
    xc, yc = grid.cell_centers()
    X, Y = np.meshgrid(xc, yc)
    lon, lat = grid.to_lonlat().transform(X, Y)
    h, src = sample_dem(np.asarray(lon), np.asarray(lat), cache)
    info = {LAYERS[i]: int((src == i).sum()) for i in range(len(LAYERS))}
    info["missing"] = int(np.isnan(h).sum())
    return h.astype(np.float32), info

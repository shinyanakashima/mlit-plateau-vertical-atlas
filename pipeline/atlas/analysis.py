"""Reference implementation of the slice analytics (mirrors src/analysis/*.ts).

Used for unit tests and to cross-check the browser implementation (stats.json).
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from .voxelize import BUILDING, FREE, NODATA

FOUR = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])


def occupancy_ratio(level: np.ndarray) -> dict:
    judged = int((level != NODATA).sum())
    occupied = int((level == BUILDING).sum())
    return {
        "judged": judged,
        "occupied": occupied,
        "ratio": (occupied / judged * 100.0) if judged else None,
    }


def clearance_d2(level: np.ndarray) -> np.ndarray:
    """Squared distance (in cells, integer) from each cell centre to the nearest building cell."""
    obstacle = level == BUILDING
    if not obstacle.any():
        return np.full(level.shape, np.iinfo(np.int64).max, dtype=np.int64)
    _, (iy, ix) = ndimage.distance_transform_edt(~obstacle, return_indices=True)
    yy, xx = np.indices(level.shape)
    return (yy - iy) ** 2 + (xx - ix) ** 2


def passable(level: np.ndarray, dx: float, clearance_m: float = 0.0, margin_cells: int = 0) -> np.ndarray:
    free = level == FREE
    if clearance_m > 0:
        free &= clearance_d2(level) * dx * dx >= clearance_m * clearance_m
    if margin_cells > 0:
        m = margin_cells
        free[:m, :] = False
        free[-m:, :] = False
        free[:, :m] = False
        free[:, -m:] = False
    return free


def components(level: np.ndarray, dx: float, clearance_m: float = 0.0, margin_cells: int = 0) -> dict:
    free = passable(level, dx, clearance_m, margin_cells)
    labels, n = ndimage.label(free, structure=FOUR)
    sizes = np.bincount(labels.ravel())[1:] if n else np.array([], dtype=int)
    total = int(free.sum())
    largest = int(sizes.max()) if n else 0
    return {
        "count": int(n),
        "free_cells": total,
        "largest_cells": largest,
        "largest_share": (largest / total) if total else None,
    }


def level_stats(occ: np.ndarray, dx: float) -> list[dict]:
    out = []
    for k in range(occ.shape[0]):
        lv = occ[k]
        r = occupancy_ratio(lv)
        c = components(lv, dx)
        out.append({"k": k, **r, **{f"cc_{key}": v for key, v in c.items()}})
    return out

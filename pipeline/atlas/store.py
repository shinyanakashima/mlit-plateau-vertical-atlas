"""Write the voxel atlas as a Zarr v3 store that the browser reads with zarrita."""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import zarr
from zarr.codecs import GzipCodec

from .grid import Grid


def write_atlas(path: Path, grid: Grid, attrs: dict, volumes: dict[str, dict[str, np.ndarray]],
                ground: np.ndarray, extra2d: dict[str, tuple[np.ndarray, dict]] | None = None) -> None:
    if path.exists():
        shutil.rmtree(path)
    root = zarr.open_group(zarr.storage.LocalStore(str(path)), mode="w", zarr_format=3)
    root.attrs.update(attrs)
    for lod, arrays in volumes.items():
        g = root.create_group(lod)
        occ = g.create_array(
            "occupancy", shape=arrays["occupancy"].shape, chunks=(1, grid.ny, grid.nx),
            dtype="uint8", fill_value=255, compressors=[GzipCodec(level=6)],
            dimension_names=["z", "y", "x"], config={"write_empty_chunks": True},
            attributes={"codes": {"0": "free", "1": "building", "255": "not judged (below ground / no data)"}},
        )
        occ[:] = arrays["occupancy"]
        bid = g.create_array(
            "building", shape=arrays["building"].shape, chunks=(1, grid.ny, grid.nx),
            dtype="uint16", fill_value=0, compressors=[GzipCodec(level=6)],
            dimension_names=["z", "y", "x"], config={"write_empty_chunks": True},
            attributes={"description": "1-based index into buildings.json, 0 = none"},
        )
        bid[:] = arrays["building"]
    gr = root.create_array(
        "ground", shape=ground.shape, chunks=ground.shape, dtype="float32",
        fill_value=float("nan"), compressors=[GzipCodec(level=6)], dimension_names=["y", "x"],
        attributes={"units": "m", "datum": "T.P."},
    )
    gr[:] = ground
    for name, (arr, a) in (extra2d or {}).items():
        x = root.create_array(
            name, shape=arr.shape, chunks=arr.shape, dtype=arr.dtype, fill_value=0,
            compressors=[GzipCodec(level=6)], dimension_names=["y", "x"], attributes=a,
        )
        x[:] = arr

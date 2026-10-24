"""Minimal binary glTF 2.0 writer for building shells (positions, normals, building index).

Vertices are expressed in a local East-North-Up frame (metres) whose origin is the area
centre on the GRS80 ellipsoid.  glTF is Y-up, so (E, N, U) is stored as (E, U, -N);
CesiumJS converts it back to Z-up when the model is placed with an ENU model matrix.
A custom vertex attribute `_BID` carries the 1-based building index (buildings.json).
"""
from __future__ import annotations

import json
import struct

import mapbox_earcut as earcut
import numpy as np

from .grid import ecef_to_enu, geodetic_to_ecef


def _triangulate(ext: np.ndarray, holes: list[np.ndarray]):
    rings = [ext[:-1] if np.allclose(ext[0], ext[-1]) else ext]
    for h in holes:
        rings.append(h[:-1] if np.allclose(h[0], h[-1]) else h)
    pts = np.vstack(rings)
    if len(pts) < 3:
        return None
    # Newell normal of the exterior ring
    p = rings[0]
    q = np.roll(p, -1, axis=0)
    n = np.array([
        np.sum((p[:, 1] - q[:, 1]) * (p[:, 2] + q[:, 2])),
        np.sum((p[:, 2] - q[:, 2]) * (p[:, 0] + q[:, 0])),
        np.sum((p[:, 0] - q[:, 0]) * (p[:, 1] + q[:, 1])),
    ])
    ln = np.linalg.norm(n)
    if ln < 1e-9:
        return None
    n = n / ln
    drop = int(np.argmax(np.abs(n)))
    keep = [a for a in range(3) if a != drop]
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    tri = earcut.triangulate_float64(pts[:, keep].astype(np.float64), ends)
    if len(tri) == 0:
        return None
    return pts, tri.reshape(-1, 3), n


def build_glb(polys_by_building: list[list[tuple[np.ndarray, list[np.ndarray]]]],
              lon0: float, lat0: float, height_offset: float) -> tuple[bytes, dict]:
    """polys are rings of (lon, lat, T.P. height).  Cesium height = T.P. + height_offset."""
    pos_l, nrm_l, bid_l, idx_l = [], [], [], []
    base = 0
    for bi, polys in enumerate(polys_by_building, start=1):
        for ext, holes in polys:
            def enu(r):
                e = geodetic_to_ecef(r[:, 0], r[:, 1], r[:, 2] + height_offset)
                return ecef_to_enu(e, lon0, lat0, 0.0)
            res = _triangulate(enu(ext), [enu(h) for h in holes])
            if res is None:
                continue
            pts, tri, n = res
            pos_l.append(pts)
            nrm_l.append(np.repeat(n[None, :], len(pts), axis=0))
            bid_l.append(np.full(len(pts), bi, dtype=np.float32))
            idx_l.append(tri + base)
            base += len(pts)
    pos = np.vstack(pos_l)
    nrm = np.vstack(nrm_l)
    # ENU -> glTF Y-up
    pos_g = np.column_stack([pos[:, 0], pos[:, 2], -pos[:, 1]]).astype(np.float32)
    nrm_g = np.column_stack([nrm[:, 0], nrm[:, 2], -nrm[:, 1]]).astype(np.float32)
    bid = np.concatenate(bid_l).astype(np.float32)
    idx = np.vstack(idx_l).astype(np.uint32).ravel()

    chunks = [pos_g.tobytes(), nrm_g.tobytes(), bid.tobytes(), idx.tobytes()]
    views, offset, binary = [], 0, b""
    for c, target in zip(chunks, [34962, 34962, 34962, 34963]):
        pad = (-len(c)) % 4
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(c), "target": target})
        binary += c + b"\0" * pad
        offset += len(c) + pad
    gltf = {
        "asset": {"version": "2.0", "generator": "plateau-vertical-atlas"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0, "NORMAL": 1, "_BID": 2},
            "indices": 3,
            "material": 0,
        }]}],
        "materials": [{
            "pbrMetallicRoughness": {"baseColorFactor": [0.85, 0.87, 0.9, 1], "metallicFactor": 0.0,
                                     "roughnessFactor": 0.9},
            "doubleSided": True,
        }],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos_g), "type": "VEC3",
             "min": pos_g.min(axis=0).tolist(), "max": pos_g.max(axis=0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(nrm_g), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(bid), "type": "SCALAR"},
            {"bufferView": 3, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(binary), 0x004E4942) + binary)
    return glb, {"vertices": int(len(pos_g)), "triangles": int(len(idx) // 3)}

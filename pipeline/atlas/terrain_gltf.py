"""Terrain block (diorama) as glTF: DEM top surface textured with the aerial photo, vertical
skirts and a flat bottom at `base_tp`.  Heights are absolute T.P. (no display offset), in the
same local ENU frame as the building meshes (see gltf.py).
A custom vertex attribute `_PART` is 0 on the top surface and 1 on the sides/bottom.
"""
from __future__ import annotations

import io
import json
import struct

import numpy as np
from PIL import Image

from .grid import Grid, ecef_to_enu, geodetic_to_ecef


def _pad4(b: bytes, fill: bytes = b"\0") -> bytes:
    return b + fill * ((-len(b)) % 4)


def build_terrain_glb(grid: Grid, ground: np.ndarray, lon0: float, lat0: float, base_tp: float,
                      ortho_path=None, ortho_rect=None, step: int = 2, max_tex: int = 2048) -> tuple[bytes, dict]:
    g = ground.astype(np.float64).copy()
    g[np.isnan(g)] = 0.0  # no DEM (water etc.): drawn at sea level; classified as 未整備 in the UI
    rows = np.arange(0, grid.ny + 1, step)
    cols = np.arange(0, grid.nx + 1, step)
    # heights at grid nodes: sample the nearest cell centre
    rr = np.clip(rows, 0, grid.ny - 1)
    cc = np.clip(cols, 0, grid.nx - 1)
    H = g[np.ix_(rr, cc)]
    C, R = np.meshgrid(cols, rows)
    x = grid.x0 + C * grid.dx
    y = grid.y1 - R * grid.dx
    lon, lat = grid.to_lonlat().transform(x, y)
    lon = np.asarray(lon)
    lat = np.asarray(lat)

    def enu(lo, la, h):
        return ecef_to_enu(geodetic_to_ecef(lo, la, h), lon0, lat0)

    top = enu(lon.ravel(), lat.ravel(), H.ravel())
    nr, nc = H.shape
    idx = np.arange(nr * nc).reshape(nr, nc)
    a, b, c_, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, :-1], idx[1:, 1:]
    tri_top = np.stack([np.stack([a, c_, b], -1), np.stack([b, c_, d], -1)], -2).reshape(-1, 3)
    # texture coordinates (linear in lon/lat; error negligible over 0.5 km)
    if ortho_rect is not None:
        l0, b0, l1, b1 = ortho_rect
        uv = np.column_stack([(lon.ravel() - l0) / (l1 - l0), (b1 - lat.ravel()) / (b1 - b0)])
    else:
        uv = np.zeros((len(top), 2))

    # skirts: walk the boundary ring, duplicate vertices at top and base
    ring = list(idx[0, :]) + list(idx[1:, -1]) + list(idx[-1, -2::-1]) + list(idx[-2:0:-1, 0]) + [idx[0, 0]]
    ring_ll = [(lon.ravel()[i], lat.ravel()[i], H.ravel()[i]) for i in ring]
    side_pos, side_tri = [], []
    for j in range(len(ring_ll) - 1):
        (lo_a, la_a, ha), (lo_b, la_b, hb) = ring_ll[j], ring_ll[j + 1]
        quad = enu(np.array([lo_a, lo_b, lo_a, lo_b]), np.array([la_a, la_b, la_a, la_b]),
                   np.array([ha, hb, base_tp, base_tp]))
        o = len(side_pos) * 4
        side_pos.append(quad)
        side_tri += [[o, o + 2, o + 1], [o + 1, o + 2, o + 3]]
    side = np.vstack(side_pos)
    # bottom
    corners = [idx[0, 0], idx[0, -1], idx[-1, -1], idx[-1, 0]]
    bot = enu(np.array([lon.ravel()[i] for i in corners]), np.array([lat.ravel()[i] for i in corners]),
              np.full(4, base_tp))
    o = len(side)
    side = np.vstack([side, bot])
    side_tri += [[o, o + 1, o + 2], [o, o + 2, o + 3]]
    side_tri = np.array(side_tri)

    def normals(pos, tri):
        n = np.zeros_like(pos)
        fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
        for k in range(3):
            np.add.at(n, tri[:, k], fn)
        ln = np.linalg.norm(n, axis=1, keepdims=True)
        return n / np.where(ln == 0, 1, ln)

    n_top = normals(top, tri_top)
    # flat normals for the skirt (each quad has its own vertices)
    n_side = normals(side, side_tri)

    def yup(v):
        return np.column_stack([v[:, 0], v[:, 2], -v[:, 1]]).astype(np.float32)

    # make the triangles counter-clockwise when seen from outside (Cesium culls nothing: doubleSided)
    bufs: list[bytes] = []
    views, accessors = [], []

    def add(arr: np.ndarray, target: int | None, comp: int, typ: str, minmax=False):
        data = arr.tobytes()
        off = sum(len(x) for x in bufs)
        bufs.append(_pad4(data))
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), **({"target": target} if target else {})})
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = arr.min(axis=0).tolist()
            acc["max"] = arr.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    prims = []
    for pos, nrm, tri, part, tex in ((top, n_top, tri_top, 0.0, True), (side, n_side, side_tri, 1.0, False)):
        attrs = {
            "POSITION": add(yup(pos), 34962, 5126, "VEC3", True),
            "NORMAL": add(yup(nrm), 34962, 5126, "VEC3"),
            "_PART": add(np.full(len(pos), part, np.float32), 34962, 5126, "SCALAR"),
        }
        if tex:
            attrs["TEXCOORD_0"] = add(uv.astype(np.float32), 34962, 5126, "VEC2")
        ind = add(tri.astype(np.uint32).ravel(), 34963, 5125, "SCALAR")
        prims.append({"attributes": attrs, "indices": ind, "material": 0 if tex and ortho_path else 1})

    images, textures, samplers = [], [], []
    materials = [
        {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1},
         "doubleSided": True},
        {"pbrMetallicRoughness": {"baseColorFactor": [0.55, 0.42, 0.30, 1], "metallicFactor": 0, "roughnessFactor": 1},
         "doubleSided": True},
    ]
    if ortho_path is not None:
        im = Image.open(ortho_path).convert("RGB")
        if max(im.size) > max_tex:
            s = max_tex / max(im.size)
            im = im.resize((int(im.size[0] * s), int(im.size[1] * s)), Image.LANCZOS)
        jb = io.BytesIO()
        im.save(jb, "JPEG", quality=78)
        jdata = jb.getvalue()
        off = sum(len(x) for x in bufs)
        bufs.append(_pad4(jdata))
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(jdata)})
        images.append({"bufferView": len(views) - 1, "mimeType": "image/jpeg"})
        samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
        textures.append({"source": 0, "sampler": 0})
    binary = b"".join(bufs)
    gltf = {
        "asset": {"version": "2.0", "generator": "plateau-vertical-atlas terrain"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": prims}],
        "materials": materials,
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(binary)}],
    }
    if images:
        gltf.update({"images": images, "textures": textures, "samplers": samplers})
    js = _pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(binary), 0x004E4942) + binary)
    return glb, {"vertices": int(len(top) + len(side)), "triangles": int(len(tri_top) + len(side_tri)),
                 "base_tp": base_tp, "step_cells": step}

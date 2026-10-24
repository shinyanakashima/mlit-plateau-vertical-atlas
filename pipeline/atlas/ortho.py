"""Bundled aerial photo (GSI seamlessphoto) so the demo works without a tile server."""
from __future__ import annotations

import io
import math
from pathlib import Path

from PIL import Image

from .fetch import cached_get


def _tile(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def _tile_lon(x: float, z: int) -> float:
    return x / 2**z * 360 - 180


def _tile_lat(y: float, z: int) -> float:
    n = math.pi - 2 * math.pi * y / 2**z
    return math.degrees(math.atan(math.sinh(n)))


def build_ortho(bbox: tuple[float, float, float, float], z: int, out: Path, cache: Path,
                layer: str = "seamlessphoto", quality: int = 80) -> dict:
    lon0, lat0, lon1, lat1 = bbox
    x0, y0 = _tile(lon0, lat1, z)
    x1, y1 = _tile(lon1, lat0, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    img = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            url = f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{tx}/{ty}.jpg"
            data = cached_get(url, cache / "gsi" / layer / f"{z}_{tx}_{ty}.jpg", allow_404=True)
            if data:
                img.paste(Image.open(io.BytesIO(data)).convert("RGB"), ((tx - tx0) * 256, (ty - ty0) * 256))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return {
        "file": out.name,
        "rectangle": [_tile_lon(tx0, z), _tile_lat(ty1 + 1, z), _tile_lon(tx1 + 1, z), _tile_lat(ty0, z)],
        "zoom": z,
        "layer": layer,
        "attribution": "地理院タイル（全国最新写真・シームレス）",
    }

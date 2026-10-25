"""Download helpers with an on-disk cache (pipeline/.cache, git-ignored)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

PLATEAU_API = "https://api.plateauview.mlit.go.jp/datacatalog/citygml/m:{mesh}"
UA = {"User-Agent": "plateau-vertical-atlas/0.1 (+https://github.com/shinyanakashima/mlit-plateau-vertical-atlas)"}


def cached_get(url: str, dest: Path, allow_404: bool = False, retries: int = 4) -> bytes | None:
    if dest.exists():
        data = dest.read_bytes()
        return None if data == b"__404__" else data
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
                data = r.read()
            dest.write_bytes(data)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404 and allow_404:
                dest.write_bytes(b"__404__")
                return None
            if attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(2 ** (attempt + 1))
    return None


def plateau_bldg_files(meshes: list[str], cache: Path) -> tuple[list[Path], list[dict]]:
    """Resolve and download the bldg CityGML of each 3rd-order mesh via the PLATEAU data catalog API."""
    paths: list[Path] = []
    sources: list[dict] = []
    seen_urls: set[str] = set()
    for mesh in meshes:
        meta = json.loads(cached_get(PLATEAU_API.format(mesh=mesh), cache / "api" / f"{mesh}.json"))
        for city in meta["cities"]:
            for f in city["files"].get("bldg", []):
                if f["code"] != mesh:
                    continue
                # 23 wards are published per ward but the mesh files are identical
                # (prefecture-wide datasets); download each mesh only once.
                key = f"{mesh}-{f['fileSize']}"
                if key in seen_urls:
                    continue
                seen_urls.add(key)
                name = f["url"].rsplit("/", 1)[-1]
                dest = cache / "citygml" / f"{city['cityCode']}_{name}"
                if not dest.exists():
                    print(f"  downloading {f['url']} ({f['fileSize'] / 1e6:.0f} MB)")
                cached_get(f["url"], dest)
                paths.append(dest)
                sources.append({
                    "mesh": mesh,
                    "city_code": city["cityCode"],
                    "city_name": city["cityName"],
                    "year": city["year"],
                    "spec": city["spec"],
                    "url": f["url"],
                    "dataset_zip": city.get("url"),
                })
    return paths, sources


# --- JIS X 0410 standard area mesh (3rd order, ~1 km) ---------------------------------------
def mesh3_code(lat: float, lon: float) -> str:
    p = int(lat * 1.5)
    u = int(lon - 100)
    r1 = lat * 1.5 - p
    r2 = (lon - 100) - u
    q = int(r1 * 8)
    v = int(r2 * 8)
    r = int((r1 * 8 - q) * 10)
    w = int((r2 * 8 - v) * 10)
    return f"{p:02d}{u:02d}{q}{v}{r}{w}"


def mesh3_bounds(code: str) -> tuple[float, float, float, float]:
    """(lon0, lat0, lon1, lat1) of a 3rd-order mesh."""
    p, u, q, v, r, w = int(code[:2]), int(code[2:4]), int(code[4]), int(code[5]), int(code[6]), int(code[7])
    lat0 = p / 1.5 + q * (5 / 60) + r * (0.5 / 60)
    lon0 = u + 100 + v * (7.5 / 60) + w * (0.75 / 60)
    return lon0, lat0, lon0 + 0.75 / 60, lat0 + 0.5 / 60


def meshes_for_bbox(bbox: tuple[float, float, float, float]) -> list[str]:
    lon0, lat0, lon1, lat1 = bbox
    codes: list[str] = []
    lat = lat0
    while lat <= lat1 + 1e-9:
        lon = lon0
        while lon <= lon1 + 1e-9:
            c = mesh3_code(lat, lon)
            if c not in codes:
                codes.append(c)
            lon = min(lon + 0.002, lon1) if lon < lon1 else lon1 + 1
        lat = min(lat + 0.002, lat1) if lat < lat1 else lat1 + 1
    return codes

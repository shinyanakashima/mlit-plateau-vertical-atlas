"""Reference elevations for the "空中のご近所さん" / "山とくらべる" features.

    python pipeline/build_reference.py

* Ground elevation at well-known stations: 国土地理院 標高API (DEM, T.P.).
* Summit elevations: 国土地理院「日本の主な山岳標高」の値（三角点・標高点）.
* Trail profiles: the API sampled along the straight line trailhead → summit.  This is a
  straight cross-section, NOT the hiking trail itself, and is labelled as such in the UI.
Output: public/data/reference.json
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from atlas.fetch import UA  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
API = "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon={lon}&lat={lat}&outtype=JSON"
CACHE = Path(__file__).resolve().parent / ".cache" / "elev.json"

STATIONS = [
    ("東京駅", 35.6812, 139.7671), ("新宿駅", 35.6896, 139.7006), ("渋谷駅", 35.6580, 139.7016),
    ("池袋駅", 35.7295, 139.7109), ("吉祥寺駅", 35.7030, 139.5797), ("立川駅", 35.6980, 139.4137),
    ("八王子駅", 35.6556, 139.3389), ("高尾山口駅", 35.6325, 139.2697), ("青梅駅", 35.7907, 139.2584),
    ("奥多摩駅", 35.8094, 139.0966), ("横浜駅", 35.4658, 139.6223), ("箱根湯本駅", 35.2325, 139.1050),
    ("甲府駅", 35.6668, 138.5690), ("軽井沢駅", 36.3428, 138.6349), ("松本駅", 36.2309, 137.9643),
    ("帯広駅", 42.9175, 143.2040), ("札幌駅", 43.0687, 141.3508),
]

# name, summit elevation (GSI), summit lat/lon, trailhead name, trailhead lat/lon
ROUTES = [
    ("高尾山", 599, (35.6251, 139.2436), "高尾山口駅", (35.6325, 139.2697)),
    ("筑波山（女体山）", 877, (36.2253, 140.1067), "南側の山麓", (36.2105, 140.1006)),
    ("富士山（剣ヶ峰）", 3776, (35.3606, 138.7274), "富士スバルライン五合目", (35.3953, 138.7339)),
]

STRUCTURES = [("東京タワー", 333), ("東京スカイツリー", 634)]


def elevation(lat: float, lon: float, cache: dict) -> float | None:
    key = f"{lat:.5f},{lon:.5f}"
    if key in cache:
        return cache[key]
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(API.format(lat=lat, lon=lon), headers=UA), timeout=30) as r:
                v = json.loads(r.read())["elevation"]
            break
        except Exception:  # noqa: BLE001
            time.sleep(2 ** attempt)
    else:
        return None
    val = float(v) if v not in ("-----", None, "") else None
    cache[key] = val
    time.sleep(0.12)
    return val


def main() -> None:
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    stations = []
    for name, lat, lon in STATIONS:
        e = elevation(lat, lon, cache)
        if e is not None:
            stations.append({"name": name, "lat": lat, "lon": lon, "elevation": round(e, 1)})
    routes = []
    for name, summit, (slat, slon), th_name, (tlat, tlon) in ROUTES:
        n = 40
        prof = []
        dist_total = 0.0
        prev = None
        for i in range(n + 1):
            t = i / n
            lat = tlat + (slat - tlat) * t
            lon = tlon + (slon - tlon) * t
            if prev:
                dy = (lat - prev[0]) * 111320
                dx = (lon - prev[1]) * 111320 * math.cos(math.radians(lat))
                dist_total += math.hypot(dx, dy)
            prev = (lat, lon)
            e = elevation(lat, lon, cache)
            if e is not None:
                prof.append([round(dist_total), round(e, 1)])
        start = prof[0][1]
        routes.append({
            "name": name, "summit": summit, "trailhead": th_name, "trailheadElevation": start,
            "gain": round(summit - start), "profile": prof,
        })
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache))
    out = {
        "stations": sorted(stations, key=lambda s: s["elevation"]),
        "routes": routes,
        "structures": [{"name": n, "height": h} for n, h in STRUCTURES],
        "sources": {
            "stations": "国土地理院 標高API（駅付近の地表面標高・T.P.）",
            "summits": "国土地理院 日本の主な山岳標高",
            "profiles": "国土地理院 標高API（登山口と山頂を結ぶ直線上の断面。実際の登山道ではありません）",
        },
    }
    (ROOT / "public" / "data" / "reference.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(json.dumps([(s["name"], s["elevation"]) for s in out["stations"]], ensure_ascii=False))
    print([(r["name"], r["trailheadElevation"], r["gain"]) for r in routes])


if __name__ == "__main__":
    main()

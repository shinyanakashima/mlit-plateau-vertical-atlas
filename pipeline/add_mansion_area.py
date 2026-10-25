"""Add a comparison area ("物件") to the LT11 mansion prototype and build its data.

    python pipeline/add_mansion_area.py <id> <lon> <lat> <区分> <地名> [--size 512] [--subtitle "..."]

    例) python pipeline/add_mansion_area.py tama-tamacenter 139.4237 35.6250 多摩 多摩センター

1. pipeline/areas.json に範囲（中心経緯度・一辺・2m×2m格子・海抜0m起点）を追加
2. PLATEAU データカタログAPIでメッシュを自動判定し、CityGMLを取得してボクセル化（build_atlas.py）
3. public/data/mansion.json の選択肢に追加
PLATEAU 2025年度のデータがない場所では、建物が「整備範囲外（未整備）」になります。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("id", help="英数字とハイフン（例: tama-tamacenter）")
    ap.add_argument("lon", type=float)
    ap.add_argument("lat", type=float)
    ap.add_argument("label", help="区分（例: 港区, 多摩）")
    ap.add_argument("name", help="地名（例: 多摩センター）")
    ap.add_argument("--size", type=float, default=512.0, help="一辺 (m)")
    ap.add_argument("--subtitle", default=None)
    args = ap.parse_args()

    areas_path = HERE / "areas.json"
    areas = json.loads(areas_path.read_text())
    areas[args.id] = {
        "title": f"{args.label} {args.name}",
        "subtitle": args.subtitle or f"{args.name}周辺 {int(args.size)}m四方",
        "center_lonlat": [args.lon, args.lat],
        "size_m": args.size, "dx_m": 2.0, "dz_m": 2.0, "z_min_tp": 0.0,
        "meshes": "auto", "epsg": 6677, "mansion": True,
    }
    areas_path.write_text(json.dumps(areas, ensure_ascii=False, indent=2) + "\n")

    subprocess.run([sys.executable, str(HERE / "build_atlas.py"), args.id], check=True)

    cfg_path = ROOT / "public" / "data" / "mansion.json"
    cfg = json.loads(cfg_path.read_text())
    cfg["areas"] = [a for a in cfg["areas"] if a["id"] != args.id] + [
        {"id": args.id, "label": args.label, "name": args.name}]
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
    print(f"added {args.id}: open ?left={cfg['default']['left']}&right={args.id}")


if __name__ == "__main__":
    main()

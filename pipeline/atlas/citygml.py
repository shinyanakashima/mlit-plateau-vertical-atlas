"""Streaming parser for PLATEAU CityGML building files (bldg, i-UR 3.x / CityGML 2.0).

Only what the atlas needs is extracted:
  * attributes: gml:id, name, usage, measuredHeight, storeysAboveGround/BelowGround, buildingID
  * LOD1: footprint (bottom face of lod1Solid) + bottom/top elevation
  * LOD2: every surface polygon of boundedBy (Roof/Wall/Ground/...) and of
          outerBuildingInstallation, as 3D rings in the projected CRS
Coordinates in the files are EPSG:6697 (lat, lon, T.P. height).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from lxml import etree
from pyproj import Transformer

NS = {
    "gml": "http://www.opengis.net/gml",
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "core": "http://www.opengis.net/citygml/2.0",
    "uro": "https://www.geospatial.jp/iur/uro/3.2",
    "gen": "http://www.opengis.net/citygml/generics/2.0",
}
G = "{%s}" % NS["gml"]
B = "{%s}" % NS["bldg"]

# PLATEAU Building_usage codelist (主な用途)
USAGE = {
    "401": "業務施設", "402": "商業施設", "403": "宿泊施設", "404": "商業系複合施設",
    "411": "住宅", "412": "共同住宅", "413": "店舗等併用住宅", "414": "店舗等併用共同住宅",
    "415": "作業所併用住宅", "421": "官公庁施設", "422": "文教厚生施設", "431": "運輸倉庫施設",
    "441": "工場", "451": "農林漁業用施設", "452": "供給処理施設", "453": "防衛施設",
    "454": "その他", "461": "不明",
}


@dataclass
class Building:
    gml_id: str
    name: str | None
    usage: str | None
    measured_height: float | None
    storeys_above: int | None
    storeys_below: int | None
    building_id: str | None
    lon: float = 0.0
    lat: float = 0.0
    # LOD1
    lod1_footprints: list[np.ndarray] = field(default_factory=list)  # (n,2) projected rings
    lod1_bottom: float | None = None
    lod1_top: float | None = None
    lod1_faces_ll: list[np.ndarray] = field(default_factory=list)  # (n,3) lon,lat,h rings
    # LOD2: list of (exterior ring (n,3) projected, [interior rings])
    lod2_polys: list[tuple[np.ndarray, list[np.ndarray]]] = field(default_factory=list)
    lod2_polys_ll: list[tuple[np.ndarray, list[np.ndarray]]] = field(default_factory=list)
    lod2_installations: list[list[tuple[np.ndarray, list[np.ndarray]]]] = field(default_factory=list)


def _poslist(el) -> np.ndarray:
    v = np.array(el.text.split(), dtype=np.float64).reshape(-1, 3)  # lat lon h
    return v[:, [1, 0, 2]]  # -> lon lat h


def _polygon_rings(poly) -> tuple[np.ndarray, list[np.ndarray]] | None:
    ext = poly.find(f"{G}exterior/{G}LinearRing/{G}posList")
    if ext is None or not ext.text:
        return None
    holes = [
        _poslist(p) for p in poly.findall(f"{G}interior/{G}LinearRing/{G}posList") if p.text
    ]
    return _poslist(ext), holes


def _text(el, path):
    f = el.find(path, NS)
    return f.text.strip() if f is not None and f.text and f.text.strip() else None


def _num(v, cast=float):
    try:
        return cast(v) if v is not None else None
    except ValueError:
        return None


def _release(el) -> None:
    """Free memory of already-processed city objects during iterparse."""
    member = el.getparent()
    el.clear()
    if member is None:
        return
    root = member.getparent()
    if root is None:
        return
    while member.getprevious() is not None:
        del root[0]


def parse_buildings(paths: list[Path], bbox_lonlat: tuple[float, float, float, float],
                    epsg: int) -> list[Building]:
    """Parse all bldg:Building in *paths* whose LOD1 centroid lies in bbox (lon0,lat0,lon1,lat1)."""
    tr = Transformer.from_crs(6697, epsg, always_xy=True)
    lon0, lat0, lon1, lat1 = bbox_lonlat
    out: list[Building] = []
    seen: set[str] = set()

    def proj(ring: np.ndarray) -> np.ndarray:
        x, y = tr.transform(ring[:, 0], ring[:, 1])
        return np.column_stack([x, y, ring[:, 2]])

    for path in paths:
        for _, el in etree.iterparse(str(path), events=("end",), tag=f"{B}Building", huge_tree=True):
            gid = el.get(f"{G}id")
            if gid in seen:
                _release(el)
                continue
            lod1 = el.find(f"{B}lod1Solid")
            if lod1 is None:
                _release(el)
                continue
            faces = []
            for poly in lod1.iter(f"{G}Polygon"):
                r = _polygon_rings(poly)
                if r:
                    faces.append(r[0])
            if not faces:
                _release(el)
                continue
            allpts = np.vstack(faces)
            # quick reject by bbox overlap
            if (allpts[:, 0].max() < lon0 or allpts[:, 0].min() > lon1
                    or allpts[:, 1].max() < lat0 or allpts[:, 1].min() > lat1):
                _release(el)
                continue
            seen.add(gid)
            name = _text(el, "gml:name")
            usage = _text(el, "bldg:usage")
            b = Building(
                gml_id=gid,
                name=name,
                usage=USAGE.get(usage, usage) if usage else None,
                measured_height=_num(_text(el, "bldg:measuredHeight")),
                storeys_above=_num(_text(el, "bldg:storeysAboveGround"), int),
                storeys_below=_num(_text(el, "bldg:storeysBelowGround"), int),
                building_id=_text(el, ".//uro:buildingID"),
                lon=float(allpts[:, 0].mean()),
                lat=float(allpts[:, 1].mean()),
            )
            zmin = allpts[:, 2].min()
            zmax = allpts[:, 2].max()
            b.lod1_bottom = float(zmin)
            b.lod1_top = float(zmax)
            for f in faces:
                if np.all(np.abs(f[:, 2] - zmin) < 1e-6):
                    b.lod1_footprints.append(proj(f)[:, :2])
            b.lod1_faces_ll = faces
            # LOD2 surfaces
            for bb in el.findall(f"{B}boundedBy"):
                for poly in bb.iter(f"{G}Polygon"):
                    r = _polygon_rings(poly)
                    if r:
                        b.lod2_polys.append((proj(r[0]), [proj(h) for h in r[1]]))
                        b.lod2_polys_ll.append(r)
            for inst in el.findall(f"{B}outerBuildingInstallation"):
                polys = []
                for poly in inst.iter(f"{G}Polygon"):
                    r = _polygon_rings(poly)
                    if r:
                        polys.append((proj(r[0]), [proj(h) for h in r[1]]))
                        b.lod2_polys_ll.append(r)
                if polys:
                    b.lod2_installations.append(polys)
            out.append(b)
            _release(el)
    return out

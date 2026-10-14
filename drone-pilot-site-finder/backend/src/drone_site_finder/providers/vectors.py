import asyncio
import os
from datetime import UTC, datetime

from shapely import force_2d, make_valid
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import polygonize, unary_union

from drone_site_finder.providers.http import SourceUnavailable
from drone_site_finder.providers.models import GeoRecord
from drone_site_finder.schemas.sites import SourceReport

WFS = "https://data.geopf.fr/wfs/ows"
IGN_LAYERS = {
    "batiment": "building",
    "troncon_de_route": "road",
    "zone_de_vegetation": "vegetation",
    "surface_hydrographique": "water",
    "terrain_de_sport": "open",
    "ligne_electrique": "obstacle",
    "pylone": "obstacle",
    "troncon_de_voie_ferree": "rail",
}


def source_report(id, status="available", detail="", count=0):
    osm = id == "osm"
    return SourceReport(
        id=id,
        name="OpenStreetMap / Overpass" if osm else f"IGN BD TOPO · {id.split(':')[-1]}",
        url=os.getenv("DRONE_OVERPASS_URL", "https://overpass-api.de/api/interpreter")
        if osm
        else WFS,
        license="ODbL 1.0" if osm else "Licence Ouverte 2.0",
        attribution="© OpenStreetMap contributors" if osm else "© IGN · BD TOPO",
        status=status,
        detail=detail,
        feature_count=count,
        fetched_at=datetime.now(UTC).isoformat() if status != "disabled" else None,
    )


def clean_geometry(geometry):
    geometry = force_2d(geometry)
    return geometry if geometry.is_valid else make_valid(geometry)


async def ign_layer(http, bbox, layer, kind=None, id=None):
    id = id or f"ign:{layer}"
    kind = kind or IGN_LAYERS[layer]
    type_name = layer if ":" in layer else f"BDTOPO_V3:{layer}"
    records = []
    try:
        for start in (0, 1000, 2000):
            data = await http.json(
                WFS,
                params={
                    "service": "WFS",
                    "version": "2.0.0",
                    "request": "GetFeature",
                    "typeNames": type_name,
                    "srsName": "urn:ogc:def:crs:OGC:1.3:CRS84",
                    "bbox": ",".join(map(str, bbox)) + ",urn:ogc:def:crs:OGC:1.3:CRS84",
                    "outputFormat": "application/json",
                    "count": 1000,
                    "startIndex": start,
                },
            )
            features = data.get("features")
            if not isinstance(features, list):
                raise SourceUnavailable("Missing WFS features.")
            for item in features:
                if item.get("geometry"):
                    geom = clean_geometry(shape(item["geometry"]))
                    if not geom.is_empty:
                        records.append(GeoRecord(geom, kind, id, item.get("properties", {})))
            matched = data.get("numberMatched", "unknown")
            if len(features) < 1000 or isinstance(matched, int) and start + 1000 >= matched:
                return records, source_report(id, count=len(records))
        return records, source_report(
            id, "partial", "WFS limited to 3000 features; incomplete extent.", len(records)
        )
    except (SourceUnavailable, ValueError, TypeError, KeyError) as exc:
        return [], source_report(id, "unavailable", str(exc))


def osm_kind(tags):
    # Access restrictions must never shrink a known building's physical setback.
    if "building" in tags and tags["building"] != "no":
        return "building"
    if tags.get("access") in {"no", "private", "military"} or tags.get("military"):
        return "restricted"
    if tags.get("natural") in {"water", "wetland"} or "waterway" in tags:
        return "water"
    if tags.get("natural") in {"wood", "scrub", "tree", "tree_row", "heath"} or tags.get(
        "landuse"
    ) in {"forest", "orchard", "vineyard"}:
        return "vegetation"
    if (
        tags.get("power") in {"line", "minor_line", "tower", "pole", "generator"}
        or "barrier" in tags
        or tags.get("man_made") in {"mast", "tower", "antenna", "chimney"}
    ):
        return "obstacle"
    if tags.get("railway"):
        return "rail"
    if "highway" in tags:
        return "road"
    if (
        tags.get("landuse") in {"grass", "meadow", "recreation_ground", "village_green"}
        or tags.get("leisure") in {"park", "pitch", "recreation_ground"}
        or tags.get("amenity") == "parking"
        or tags.get("natural") in {"bare_rock", "sand"}
    ):
        return "open"
    return None


def osm_geometry(item):
    def coords(points):
        return [(point["lon"], point["lat"]) for point in points]

    if item["type"] == "node":
        return Point(item["lon"], item["lat"])
    if item["type"] == "way":
        points = coords(item.get("geometry", []))
        if len(points) < 2:
            return None
        if len(points) >= 4 and points[0] == points[-1] and "highway" not in item.get("tags", {}):
            return clean_geometry(Polygon(points))
        return LineString(points)
    outer, inner = [], []
    for member in item.get("members", []):
        points = coords(member.get("geometry", []))
        if len(points) >= 2:
            (inner if member.get("role") == "inner" else outer).append(LineString(points))
    outer = list(polygonize(unary_union(outer)))
    holes = list(polygonize(unary_union(inner)))
    return clean_geometry(unary_union(outer).difference(unary_union(holes))) if outer else None


async def osm(http, bbox):
    west, south, east, north = bbox
    bounds = f"({south},{west},{north},{east})"
    filters = [
        '["building"]',
        '["highway"]',
        '["landuse"]',
        '["leisure"]',
        '["natural"]',
        '["amenity"="parking"]',
        '["power"]',
        '["barrier"]',
        '["waterway"]',
        '["railway"]',
        '["military"]',
        '["man_made"~"^(mast|tower|antenna|chimney)$"]',
    ]
    query = (
        "[out:json][timeout:18][maxsize:24000000];("
        + "".join(f"nwr{condition}{bounds};" for condition in filters)
        + ");out geom;"
    )
    try:
        data = await http.json(
            os.getenv("DRONE_OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
            form={"data": query},
        )
        if not isinstance(data.get("elements"), list):
            raise SourceUnavailable("Missing Overpass elements.")
        records, skipped = [], 0
        for item in data["elements"]:
            kind = osm_kind(item.get("tags", {}))
            if not kind:
                continue
            try:
                geom = osm_geometry(item)
                if geom is not None and not geom.is_empty:
                    records.append(GeoRecord(geom, kind, "osm", item.get("tags", {})))
            except (ValueError, KeyError, TypeError):
                skipped += 1
        partial = bool(data.get("remark")) or skipped > 0
        report = source_report(
            "osm",
            "partial" if partial else "available",
            f"OSM is not an exhaustive obstacle/access inventory. Skipped: {skipped}.",
            len(records),
        )
        report.acquisition_date = data.get("osm3s", {}).get("timestamp_osm_base")
        return records, report
    except (SourceUnavailable, ValueError, KeyError, TypeError) as exc:
        return [], source_report("osm", "unavailable", str(exc))


RPG_LAYER = "IGNF_RPG_PARCELLES-AGRICOLES-CATEGORISEES_2024:parcelles_agricole_categorisees_2024"


async def rpg_layer(http, bbox):
    """Registre parcellaire graphique 2024: declared agricultural parcels and crop category."""
    records, report = await ign_layer(http, bbox, RPG_LAYER, kind="farmland", id="ign:rpg")
    report.name = "IGN RPG 2024 · parcelles agricoles"
    report.detail = (report.detail + " Catégorie de culture déclarée (PAC 2024).").strip()
    return records, report


async def fetch_vectors(http, bbox, options):
    jobs = ([osm(http, bbox)] if options.use_osm else []) + (
        [ign_layer(http, bbox, layer) for layer in IGN_LAYERS] + [rpg_layer(http, bbox)]
        if options.use_ign
        else []
    )
    results = await asyncio.gather(*jobs)
    return [record for records, _ in results for record in records], [
        report for _, report in results
    ]

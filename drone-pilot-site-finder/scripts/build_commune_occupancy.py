"""Area-wide takeoff occupancy map of a whole French commune, tiled over live open data.

The commune contour comes from geo.api.gouv.fr. Vectors (OSM once, IGN BD TOPO by blocks) are
acquired for the whole commune; relief (LiDAR HD MNT/MNS, RGE ALTI) and BD ORTHO are acquired
per tile so their resolution stays useful. Each tile is mapped by the same engine as the API
(``build_occupancy`` in territory mode: no operation area, so no range or masking), clipped to the
tile and the commune, then merged. Requests are sequential-ish and cached to respect public
services. Output: a static JSON file read by the frontend. Never an operational authorization.

    uv run python scripts/build_commune_occupancy.py --insee 09194
"""

import argparse
import asyncio
import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

import shapely
from pyproj import CRS, Transformer
from shapely import transform
from shapely.geometry import MultiPolygon, box, mapping, shape
from shapely.ops import unary_union

from drone_site_finder.geospatial.occupancy import (
    OCCUPIED_REASONS,
    STATUS_LABELS,
    TAKEOFF,
    build_occupancy,
)
from drone_site_finder.geospatial.processing import metric_context
from drone_site_finder.geospatial.surfaces import geodesic_area_m2, polygon_parts
from drone_site_finder.providers.http import PublicHTTP, SourceUnavailable
from drone_site_finder.providers.models import DataBundle
from drone_site_finder.providers.rasters import fetch_imagery, fetch_terrain
from drone_site_finder.providers.vectors import IGN_LAYERS, ign_layer, osm
from drone_site_finder.schemas.sites import OccupancyMap, OccupancyZone, SearchRequest

ROOT = Path(__file__).resolve().parents[1]
GEO_API = "https://geo.api.gouv.fr/communes/{code}"
STATUS_ORDER = list(TAKEOFF)


async def commune_contour(http, code):
    data = await http.json(
        GEO_API.format(code=code),
        params={
            "fields": "nom,code,codeDepartement,surface",
            "format": "geojson",
            "geometry": "contour",
        },
    )
    return data["properties"], shape(data["geometry"])


async def acquire_vectors(http, bounds, block_m, to_wgs84):
    """OSM in one query (retried), IGN BD TOPO per block to stay under the 3000-feature cap."""
    west, south, east, north = to_wgs84(box(*bounds)).bounds
    records, reports = [], []
    for _attempt in range(3):
        osm_records, report = await osm(http, (west, south, east, north))
        if report.status != "unavailable":
            break
        print(f"  OSM indisponible ({report.detail}), nouvel essai dans 30 s…", flush=True)
        await asyncio.sleep(30)
    records += osm_records
    reports.append(report)
    x0, y0, x1, y1 = bounds
    blocks = [
        to_wgs84(box(x, y, min(x + block_m, x1), min(y + block_m, y1))).bounds
        for x in _steps(x0, x1, block_m)
        for y in _steps(y0, y1, block_m)
    ]
    for layer in IGN_LAYERS:
        layer_records, unavailable, partial, queried = [], 0, 0, 0
        pending = [(block, 0) for block in blocks]
        while pending:
            block, depth = pending.pop()
            found, report = await ign_layer(http, block, layer)
            queried += 1
            if report.status == "partial" and depth < 3:
                # WFS 3000-feature cap reached: split the block in four and query again.
                w, s_, e, n = block
                mx, my = (w + e) / 2, (s_ + n) / 2
                pending += [
                    ((w, s_, mx, my), depth + 1),
                    ((mx, s_, e, my), depth + 1),
                    ((w, my, mx, n), depth + 1),
                    ((mx, my, e, n), depth + 1),
                ]
                continue
            layer_records += found
            unavailable += report.status == "unavailable"
            partial += report.status == "partial"
        records += layer_records
        report.feature_count = len(layer_records)
        report.status = (
            "unavailable"
            if unavailable == queried
            else "partial"
            if unavailable or partial
            else "available"
        )
        report.detail = (
            f"{queried} requêtes par blocs (redécoupés si plafond WFS atteint), "
            f"{unavailable} indisponibles, {partial} tronquées."
        )
        reports.append(report)
    return records, reports


def _steps(start, stop, step):
    value = start
    while value < stop:
        yield value
        value += step


async def map_tile(http, tile_wgs84, records, tree, args):
    request = SearchRequest(
        operation_area=mapping(tile_wgs84),
        options={
            "surroundings_only": False,
            "search_radius_m": args.margin,
            "occupancy_cell_m": args.cell,
            "include_rooftops": False,
            "use_panoramax": False,
            "terrain_spacing_m": 5,
        },
    )
    context = metric_context(request)
    search_wgs84 = context.to_wgs84(context.search)
    nearby = [records[i] for i in tree.query(search_wgs84)]
    (imagery, imagery_report), (terrain, terrain_reports) = await asyncio.gather(
        fetch_imagery(http, context, True), fetch_terrain(http, context, request.options)
    )
    bundle = DataBundle(records=nearby, imagery=imagery, terrain=terrain)
    occupancy = await asyncio.to_thread(
        build_occupancy, context, bundle, request.options, relative_to_operation=False
    )
    return occupancy, [imagery_report, *terrain_reports]


async def run(args):
    started = perf_counter()
    http = PublicHTTP()
    try:
        properties, commune = await commune_contour(http, args.insee)
        centre = commune.representative_point()
        crs = CRS.from_proj4(
            f"+proj=aeqd +lat_0={centre.y} +lon_0={centre.x} +datum=WGS84 +units=m"
        )
        to_metric = Transformer.from_crs(4326, crs, always_xy=True).transform
        to_wgs = Transformer.from_crs(crs, 4326, always_xy=True).transform

        def to_wgs84(geometry):
            return transform(geometry, to_wgs, interleaved=False)

        commune_m = transform(commune, to_metric, interleaved=False)
        bounds = commune_m.bounds
        print(
            f"{properties['nom']} ({properties['code']}) · "
            f"{geodesic_area_m2(commune) / 1e6:.1f} km²",
            flush=True,
        )
        records, sources = await acquire_vectors(
            http, commune_m.buffer(args.margin + 50).bounds, args.block, to_wgs84
        )
        for report in sources:
            print(f"  {report.name}: {report.status}, {report.feature_count} objets", flush=True)
        if not any(s.id in {"osm", "ign:batiment"} and s.status != "unavailable" for s in sources):
            raise SystemExit("Aucune source bâtiments disponible : carte non produite.")
        tree = shapely.STRtree([record.geometry for record in records])
        x0, y0, x1, y1 = bounds
        tiles = [
            box(x, y, min(x + args.tile, x1), min(y + args.tile, y1))
            for y in _steps(y0, y1, args.tile)
            for x in _steps(x0, x1, args.tile)
        ]
        tiles = [tile for tile in tiles if tile.intersects(commune_m)]
        if args.max_tiles:
            tiles = tiles[: args.max_tiles]
        print(f"  {len(tiles)} tuiles de {args.tile} m · cellules {args.cell} m", flush=True)
        parts: dict[tuple[str, str | None], list] = {}
        assessed_counts: dict[str, int] = {}
        raster_reports: dict[str, list] = {}
        failed, cells = [], 0
        semaphore = asyncio.Semaphore(args.concurrency)

        async def process(index, tile):
            nonlocal cells
            clip = to_wgs84(tile.intersection(commune_m))
            async with semaphore:
                for attempt in range(3):
                    try:
                        occupancy, reports = await map_tile(
                            http, to_wgs84(tile), records, tree, args
                        )
                        break
                    except (SourceUnavailable, ValueError, OSError) as exc:
                        if attempt == 2:
                            failed.append({"tile": index, "error": str(exc)})
                            print(f"  tuile {index + 1}: ÉCHEC {exc}", flush=True)
                            return
                        await asyncio.sleep(5)
            cells += occupancy.cells_evaluated
            for key, value in occupancy.assessed.items():
                assessed_counts[key] = assessed_counts.get(key, 0) + int(value)
            for report in reports:
                raster_reports.setdefault(report.id, []).append(report)
            for zone in occupancy.zones:
                geometry = shape(zone.geometry.model_dump()).intersection(clip)
                if not geometry.is_empty:
                    parts.setdefault((zone.status, zone.reason), []).append(geometry)
            print(f"  tuile {index + 1}/{len(tiles)} ✓", flush=True)

        await asyncio.gather(*(process(i, tile) for i, tile in enumerate(tiles)))
    finally:
        await http.close()

    zones, areas = [], {}
    for (status, reason), geometries in sorted(
        parts.items(), key=lambda item: (STATUS_ORDER.index(item[0][0]), item[0][1] or "")
    ):
        merged = shapely.set_precision(unary_union(geometries), 1e-6)
        polygons = polygon_parts(merged)
        if not polygons:
            continue
        geometry = MultiPolygon(polygons)
        area = geodesic_area_m2(geometry)
        areas[status] = areas.get(status, 0) + area
        zones.append(
            OccupancyZone(
                status=status,
                reason=reason,
                label=STATUS_LABELS[status],
                reason_label=OCCUPIED_REASONS.get(reason, reason) if reason else None,
                takeoff=TAKEOFF[status],
                area_m2=round(area, 1),
                geometry=mapping(geometry),
            )
        )
    done = len(tiles) - len(failed)
    total = sum(areas.values()) or 1
    occupancy = OccupancyMap(
        cell_size_m=args.cell,
        rows=math.ceil((bounds[3] - bounds[1]) / args.cell),
        cols=math.ceil((bounds[2] - bounds[0]) / args.cell),
        cells_evaluated=cells,
        pilot_range_m=1000,
        zones=zones,
        area_by_status_m2={key: round(value, 1) for key, value in areas.items()},
        share_by_status={key: round(value / total, 4) for key, value in areas.items()},
        assessed={key: value == done for key, value in assessed_counts.items()},
        notes=[
            f"Commune entière : {done}/{len(tiles)} tuiles de {args.tile} m, cellules d’environ "
            f"{args.cell} m (agrandies si nécessaire), un statut principal par cellule.",
            "Carte de territoire : portée et masquage vers une zone d’opération non évalués. "
            "Dessinez une zone d’opération et lancez une analyse pour les obtenir.",
            "Relief et orthophoto échantillonnés par tuile (pas ~20 m) : petits obstacles et "
            "pentes locales peuvent manquer.",
            "« Libre » exige une surface ouverte cartographiée ; « Libre non confirmé » signifie "
            "seulement qu’aucune occupation n’est connue. Vérification terrain obligatoire.",
            *[
                f"{key} évalué sur {value}/{done} tuiles."
                for key, value in assessed_counts.items()
                if value != done
            ],
        ],
    )
    for items in raster_reports.values():
        report = items[0].model_copy()
        unavailable = sum(item.status == "unavailable" for item in items)
        report.status = (
            "unavailable"
            if unavailable == len(items)
            else "partial"
            if unavailable
            else "available"
        )
        report.feature_count = sum(item.feature_count for item in items)
        report.detail = f"{len(items)} tuiles, {unavailable} indisponibles. " + items[0].detail
        sources.append(report)
    output = {
        "kind": "commune_takeoff_occupancy",
        "commune": {
            "name": properties["nom"],
            "insee": properties["code"],
            "department": properties.get("codeDepartement"),
            "area_m2": round(geodesic_area_m2(commune), 1),
            "geometry": mapping(commune),
        },
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "elapsed_seconds": round(perf_counter() - started, 1),
        "tile_size_m": args.tile,
        "tiles": {"total": len(tiles), "failed": failed},
        "sources": [report.model_dump() for report in sources],
        "occupancy": occupancy.model_dump(),
    }
    path = Path(args.out or ROOT / f"frontend/public/occupancy/commune-{args.insee}.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Écrit {path} ({path.stat().st_size / 1e6:.1f} Mo) en {output['elapsed_seconds']} s · "
        + ", ".join(f"{k} {v / total:.1%}" for k, v in areas.items()),
        flush=True,
    )


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--insee", default="09194", help="Code INSEE (défaut : Mirepoix, Ariège)")
    parser.add_argument("--tile", type=float, default=800, help="Côté des tuiles (m)")
    parser.add_argument("--cell", type=float, default=10, help="Taille des cellules (m)")
    parser.add_argument("--block", type=float, default=3000, help="Blocs IGN BD TOPO (m)")
    parser.add_argument("--margin", type=float, default=40, help="Marge de données autour (m)")
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--max-tiles", type=int, default=0, help="Limiter (essai)")
    parser.add_argument("--out", help="Fichier de sortie")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()

"""On-demand occupancy of one map tile (territory mode), for map clients such as the main app."""

import asyncio
import hashlib
import json
import os
from pathlib import Path

from shapely.geometry import MultiPolygon, box, mapping, shape

from drone_site_finder.geospatial.occupancy import build_occupancy
from drone_site_finder.geospatial.processing import AnalysisError, metric_context
from drone_site_finder.geospatial.surfaces import geodesic_area_m2, polygon_parts
from drone_site_finder.providers.open_data import OpenDataProvider
from drone_site_finder.schemas.sites import OccupancyMap, SearchRequest

MAX_TILE_M = 2500
# Bump when the occupancy algorithm changes: cached tiles of older versions are ignored.
ALGORITHM_VERSION = "2"
_MEMORY: dict[str, dict] = {}


def _cache_dir():
    path = Path(
        os.getenv(
            "DRONE_TILE_CACHE", Path(__file__).resolve().parents[3] / ".cache" / "occupancy-tiles"
        )
    )
    path.mkdir(parents=True, exist_ok=True)
    return path


def _cache_key(bbox, cell_m):
    raw = json.dumps([ALGORITHM_VERSION, [round(v, 6) for v in bbox], cell_m])
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def data_dates_note(sources):
    """Consultation date and, when the source provides it, the data date."""
    consulted = sorted(s.fetched_at[:10] for s in sources if s.fetched_at)
    osm = next((s.acquisition_date for s in sources if s.id == "osm" and s.acquisition_date), None)
    note = (
        f"Données consultées le {consulted[-1]}" if consulted else "Date de consultation inconnue"
    )
    note += f" ; OpenStreetMap à jour du {osm[:10]}" if osm else ""
    return note + " ; dates de l’orthophoto et du LiDAR non fournies par les services IGN."


def tile_request(bbox, cell_m, margin_m=40):
    west, south, east, north = bbox
    request = SearchRequest(
        operation_area=mapping(box(west, south, east, north)),
        options={
            "surroundings_only": False,
            "search_radius_m": margin_m,
            "occupancy_cell_m": cell_m,
            "include_rooftops": False,
            "use_panoramax": False,
            "terrain_spacing_m": 5,
        },
    )
    context = metric_context(request)
    width, height = (
        context.operation.bounds[2] - context.operation.bounds[0],
        context.operation.bounds[3] - context.operation.bounds[1],
    )
    if max(width, height) > MAX_TILE_M or min(width, height) < 50:
        raise AnalysisError(
            f"Tuile de 50 m à {MAX_TILE_M} m de côté attendue.", "invalid_tile", 422
        )
    return request, context


async def occupancy_tile(bbox, cell_m=10, provider=None):
    """Tile occupancy, cached in memory and on disk (live provider only)."""
    key = _cache_key(bbox, cell_m)
    cacheable = provider is None
    if cacheable:
        if key in _MEMORY:
            return OccupancyMap.model_validate(_MEMORY[key])
        path = _cache_dir() / f"{key}.json"
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            _MEMORY[key] = data
            return OccupancyMap.model_validate(data)
    result = await _compute_tile(bbox, cell_m, provider or OpenDataProvider())
    if cacheable:
        data = result.model_dump()
        _MEMORY[key] = data
        if len(_MEMORY) > 400:
            _MEMORY.pop(next(iter(_MEMORY)))
        (_cache_dir() / f"{key}.json").write_text(json.dumps(data), encoding="utf-8")
    return result


async def _compute_tile(bbox, cell_m, provider):
    request, context = tile_request(bbox, cell_m)
    try:
        async with asyncio.timeout(110):
            bundle = await provider.acquire(context, request.options)
    except TimeoutError as exc:
        raise AnalysisError(
            "Délai des sources dépassé pour cette tuile.", "tile_timeout", 504
        ) from exc
    if not any(s.id in {"osm", "ign:batiment"} and s.status == "available" for s in bundle.sources):
        raise AnalysisError(
            "Aucune couverture bâtiments exploitable : tuile non calculée.", sources=bundle.sources
        )
    occupancy = await asyncio.to_thread(
        build_occupancy, context, bundle, request.options, relative_to_operation=False
    )
    # Return exactly the tile: neighbouring tiles then join without overlap.
    tile = box(*bbox)
    zones, areas = [], {}
    for zone in occupancy.zones:
        parts = polygon_parts(shape(zone.geometry.model_dump()).intersection(tile))
        if not parts:
            continue
        geometry = MultiPolygon(parts)
        area = geodesic_area_m2(geometry)
        areas[zone.status] = areas.get(zone.status, 0) + area
        zones.append(
            zone.model_copy(update={"geometry": mapping(geometry), "area_m2": round(area, 1)})
        )
    total = sum(areas.values()) or 1
    return OccupancyMap(
        **{
            **occupancy.model_dump(exclude={"zones", "area_by_status_m2", "share_by_status"}),
            "zones": [zone.model_dump() for zone in zones],
            "area_by_status_m2": {k: round(v, 1) for k, v in areas.items()},
            "share_by_status": {k: round(v / total, 4) for k, v in areas.items()},
            "notes": [*occupancy.notes, data_dates_note(bundle.sources)],
        }
    )

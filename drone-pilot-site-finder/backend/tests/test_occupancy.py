"""Takeoff occupancy map on controlled offline fixtures (tests only)."""

import numpy as np
import pytest
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import unary_union

from drone_site_finder.geospatial.occupancy import build_occupancy
from drone_site_finder.geospatial.processing import metric_context
from drone_site_finder.providers.models import DataBundle, GeoRecord, TerrainGrid
from drone_site_finder.schemas.sites import SearchRequest

# About 200 m × 200 m around Paris.
OPERATION = mapping(box(2.35, 48.85, 2.35274, 48.8518))


def scenario(terrain=True, **options):
    request = SearchRequest(
        operation_area=OPERATION,
        options={"search_radius_m": 600, "pilot_range_m": 400, "occupancy_cell_m": 5, **options},
    )
    context = metric_context(request)
    a, b, c, d = context.search.bounds
    op = context.operation.bounds  # operation centred near (0, 0)
    records = [
        GeoRecord(context.to_wgs84(context.search.envelope), "open", "osm"),
        # Accessible road along the north side of the operation area.
        GeoRecord(
            context.to_wgs84(LineString([(a, op[3] + 40), (c, op[3] + 40)])),
            "road",
            "osm",
            {"highway": "service"},
        ),
        GeoRecord(
            context.to_wgs84(box(op[2] + 60, op[1], op[2] + 90, op[1] + 30)), "building", "osm"
        ),
    ]
    grid = None
    if terrain:
        spacing = 5.0
        rows, cols = int((d - b) / spacing) + 3, int((c - a) / spacing) + 3
        x0, y0 = a - spacing, d + spacing
        xs = x0 + np.arange(cols) * spacing
        ys = y0 - np.arange(rows) * spacing
        x, y = np.meshgrid(xs, ys)
        ground = np.full((rows, cols), 100.0)
        slope = np.zeros_like(ground)
        # Steep patch south-east, outside the obstacle margins.
        steep = (x > op[2] + 150) & (x < op[2] + 220) & (y < op[1] - 150) & (y > op[1] - 220)
        slope[steep] = 25
        surface = ground.copy()
        # 60 m wall west of the operation area: masks the cells behind it.
        wall = (x > op[0] - 160) & (x < op[0] - 150) & (y > op[1] - 300) & (y < op[3] + 30)
        surface[wall] = 160
        grid = TerrainGrid(ground, surface, x0, y0, spacing, slope)
    return context, DataBundle(records=records, terrain=grid), request.options


def status_at(occupancy, context, x, y):
    point = context.to_wgs84(Point(x, y))
    for zone in occupancy.zones:
        if shape(zone.geometry.model_dump()).buffer(1e-7).contains(point):
            return zone.status, zone.reason
    return None


def test_each_cause_is_classified_with_its_reason():
    context, bundle, options = scenario()
    occupancy = build_occupancy(context, bundle, options)
    op = context.operation.bounds
    building = (op[2] + 75, op[1] + 15)
    assert status_at(occupancy, context, *building) == ("occupied", "building")
    assert status_at(occupancy, context, op[2] + 97, op[1] + 15)[0] == "obstacle_buffer"
    assert status_at(occupancy, context, (op[0] + op[2]) / 2, op[3] + 40) == ("occupied", "road")
    assert status_at(occupancy, context, (op[0] + op[2]) / 2, op[3] + 70)[0] == "free"
    assert status_at(occupancy, context, op[2] + 185, op[1] - 185)[0] == "steep"
    assert status_at(occupancy, context, op[0] - 155, op[1] + 50) == ("occupied", "raised_surface")
    assert status_at(occupancy, context, op[0] - 250, op[1] + 50)[0] == "masked"
    assert status_at(occupancy, context, (op[0] + op[2]) / 2, op[1] - 150)[0] == "no_access"
    assert status_at(occupancy, context, (op[0] + op[2]) / 2, op[3] + 550)[0] == "out_of_range"
    takeoff = {zone.status: zone.takeoff for zone in occupancy.zones}
    assert takeoff["free"] == "possible" and takeoff["occupied"] == "impossible"
    assert takeoff["out_of_range"] == "impossible" and takeoff["masked"] == "conditional"
    assert {key for key, value in occupancy.assessed.items() if not value} == {"imagery"}


def test_zones_partition_the_search_area_without_overlap():
    context, bundle, options = scenario()
    occupancy = build_occupancy(context, bundle, options)
    shapes = [context.to_metric(shape(zone.geometry.model_dump())) for zone in occupancy.zones]
    union = unary_union(shapes)
    assert union.symmetric_difference(context.search).area < 0.02 * context.search.area
    overlap = sum(s.area for s in shapes) - union.area
    assert overlap < 0.01 * context.search.area
    assert sum(occupancy.share_by_status.values()) == pytest.approx(1, abs=1e-3)


def test_missing_terrain_is_reported_not_invented():
    context, bundle, options = scenario(terrain=False)
    occupancy = build_occupancy(context, bundle, options)
    statuses = {zone.status for zone in occupancy.zones}
    assert "steep" not in statuses and "masked" not in statuses
    assert not occupancy.assessed["terrain"] and not occupancy.assessed["masking"]
    assert any("Relief indisponible" in note for note in occupancy.notes)


def test_without_open_evidence_free_is_unconfirmed_and_range_drives_out_of_range():
    context, bundle, options = scenario(terrain=False, pilot_range_m=200)
    bundle.records = [record for record in bundle.records if record.kind != "open"]
    occupancy = build_occupancy(context, bundle, options)
    statuses = {zone.status for zone in occupancy.zones}
    assert "free" not in statuses and "free_unconfirmed" in statuses
    op = context.operation.bounds
    assert status_at(occupancy, context, (op[0] + op[2]) / 2, op[3] + 300)[0] == "out_of_range"


def test_search_response_exposes_occupancy_and_can_disable_it(client, polygon):
    body = client.post(
        "/api/v1/sites/search", json={"operation_area": polygon, "options": {"pilot_range_m": 150}}
    ).json()
    occupancy = body["occupancy"]
    assert occupancy["kind"] == "takeoff_occupancy" and occupancy["pilot_range_m"] == 150
    assert {zone["status"] for zone in occupancy["zones"]} >= {"out_of_range", "free"}
    assert all(zone["geometry"]["type"] == "MultiPolygon" for zone in occupancy["zones"])
    assert "occupancy" in body["metadata"]["phase_seconds"]
    disabled = client.post(
        "/api/v1/sites/search",
        json={"operation_area": polygon, "options": {"include_occupancy": False}},
    ).json()
    assert disabled["occupancy"] is None


def test_territory_mode_ignores_range_and_masking():
    context, bundle, options = scenario(pilot_range_m=50)
    occupancy = build_occupancy(context, bundle, options, relative_to_operation=False)
    statuses = {zone.status for zone in occupancy.zones}
    assert not statuses & {"out_of_range", "limited_range", "masked"}
    assert {"occupied", "steep", "free"} <= statuses
    assert occupancy.assessed["range"] is False and occupancy.assessed["masking"] is False
    assert any("Carte de territoire" in note for note in occupancy.notes)


def test_occupancy_tile_endpoint_returns_the_clipped_tile(client):
    from conftest import FixtureProvider

    from drone_site_finder.api.routes import get_tile_provider

    client.app.dependency_overrides[get_tile_provider] = lambda: FixtureProvider()
    bbox = [2.35, 48.85, 2.3605, 48.8572]
    body = client.post("/api/v1/occupancy/tile", json={"bbox": bbox}).json()
    assert body["kind"] == "takeoff_occupancy" and body["assessed"]["range"] is False
    tile = box(*bbox)
    union = unary_union([shape(zone["geometry"]) for zone in body["zones"]])
    assert tile.buffer(1e-9).covers(union)
    assert union.area > 0.95 * tile.area
    assert (
        client.post("/api/v1/occupancy/tile", json={"bbox": [2.3, 48.8, 2.4, 48.9]}).status_code
        == 422
    )
    assert (
        client.post("/api/v1/occupancy/tile", json={"bbox": [2.36, 48.85, 2.35, 48.86]}).status_code
        == 422
    )

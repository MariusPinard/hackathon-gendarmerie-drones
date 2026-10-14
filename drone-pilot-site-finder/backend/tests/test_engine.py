import asyncio
import io

import numpy as np
import pytest
from conftest import FixtureProvider
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import TypeAdapter, ValidationError
from rasterio.transform import from_bounds
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiPolygon,
    Point,
    Polygon,
    box,
    mapping,
)

from drone_site_finder.api.routes import get_engine
from drone_site_finder.candidates.surfaces import extract_candidates
from drone_site_finder.geospatial.processing import (
    AnalysisError,
    metric_context,
)
from drone_site_finder.geospatial.surfaces import geodesic_area_m2, polygon_parts
from drone_site_finder.geospatial.visibility import estimate_visibility
from drone_site_finder.image_analysis.aerial import analyse_rgb
from drone_site_finder.main import create_app
from drone_site_finder.providers.http import SourceUnavailable
from drone_site_finder.providers.local_terrain import terrain_metric
from drone_site_finder.providers.models import DataBundle, GeoRecord, TerrainGrid
from drone_site_finder.providers.rasters import elevation_value, sample_elevations
from drone_site_finder.providers.vectors import ign_layer, osm_geometry, osm_kind
from drone_site_finder.schemas.geojson import PolygonGeometry, SurfaceGeometry
from drone_site_finder.schemas.sites import AnalysisOptions, SearchRequest, SearchResponse
from drone_site_finder.scoring.multicriteria import assess_zone
from drone_site_finder.services.engine import SiteFinderEngine


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_coordinates(value):
    with pytest.raises(ValidationError):
        PolygonGeometry(type="Polygon", coordinates=[[[value, 0], [1, 0], [1, 1], [value, 0]]])


def test_geodesic_area_units_holes_and_winding():
    outer, hole = box(0, 0, 0.001, 0.001), box(0.00025, 0.00025, 0.00075, 0.00075)
    geometry = Polygon(outer.exterior.coords, [hole.exterior.coords])
    assert geodesic_area_m2(outer) == pytest.approx(12309, rel=0.002)
    assert geodesic_area_m2(geometry) == pytest.approx(
        geodesic_area_m2(outer) - geodesic_area_m2(hole), rel=1e-8
    )
    assert geodesic_area_m2(
        Polygon(list(geometry.exterior.coords)[::-1], [hole.exterior.coords])
    ) == pytest.approx(geodesic_area_m2(geometry))


def test_multipart_contract_and_surface_extraction():
    geometry = MultiPolygon([box(0, 0, 1, 1), box(2, 2, 3, 3)])
    model = TypeAdapter(SurfaceGeometry).validate_python(mapping(geometry))
    assert model.type == "MultiPolygon" and len(model.coordinates) == 2
    assert (
        len(
            polygon_parts(GeometryCollection([geometry, Point(0, 0), LineString([(0, 0), (1, 1)])]))
        )
        == 2
    )


@pytest.mark.parametrize(
    "geometry",
    [
        {"type": "Point", "coordinates": [0, 0]},
        {"type": "MultiPolygon", "coordinates": []},
        mapping(MultiPolygon([box(0, 0, 2, 2), box(1, 1, 3, 3)])),
        mapping(MultiPolygon([box(0, 0, 1, 1), box(1, 0, 2, 1)])),
    ],
)
def test_invalid_surface_types(geometry):
    with pytest.raises(ValidationError):
        TypeAdapter(SurfaceGeometry).validate_python(geometry)


@pytest.mark.parametrize(
    "changes",
    [
        {"search_radius_m": -1},
        {"min_area_m2": 1},
        {"min_width_m": 0},
        {"max_slope_deg": 50},
        {"surroundings_only": True, "search_radius_m": 0},
        {"weights": {"slope": 1}},
        {"weights": {key: 0 for key in AnalysisOptions().weights}},
        {"terrain_spacing_m": float("nan")},
    ],
)
def test_invalid_configuration(changes):
    with pytest.raises(ValidationError):
        AnalysisOptions(**changes)


def test_study_area_limit_is_checked_before_network():
    request = SearchRequest(operation_area=mapping(box(0, 0, 1, 1)))
    with pytest.raises(AnalysisError, match="25 km"):
        metric_context(request)


def test_surface_exclusions_holes_width_and_containment(polygon):
    request = SearchRequest(
        operation_area=polygon, options={"surroundings_only": False, "search_radius_m": 100}
    )
    context = metric_context(request)
    a, b, c, d = context.search.bounds
    positive = box(a + 10, b + 10, a + 200, b + 200)
    hole = box(a + 80, b + 80, a + 100, b + 100)
    bundle = DataBundle(
        records=[
            GeoRecord(context.to_wgs84(positive), "open", "osm"),
            GeoRecord(context.to_wgs84(hole), "water", "osm"),
        ]
    )
    zones, *_ = extract_candidates(context, bundle, request.options)
    assert zones
    assert all(
        context.search.buffer(1e-6).covers(zone) and positive.buffer(1e-6).covers(zone)
        for zone in zones
    )
    assert all(zone.intersection(hole).area == 0 for zone in zones)
    assert all(zone.geom_type == "Polygon" and zone.is_valid for zone in zones)
    bundle.records = [
        GeoRecord(context.to_wgs84(box(a + 10, b + 10, a + 200, b + 11)), "open", "osm")
    ]
    assert not extract_candidates(context, bundle, request.options)[0]


def test_no_positive_evidence_never_invents_zone(polygon):
    context = metric_context(SearchRequest(operation_area=polygon))
    assert extract_candidates(context, DataBundle(), AnalysisOptions())[0] == []


def test_missing_measurements_lower_score_without_redistribution(polygon):
    request = SearchRequest(operation_area=polygon)
    context = metric_context(request)
    zone = box(*context.operation.bounds)
    score, criteria, missing, coverage = assess_zone(
        zone,
        geodesic_area_m2(context.to_wgs84(zone)),
        context,
        DataBundle(),
        GeometryCollection(),
        GeometryCollection(),
        request.options,
    )
    assert {"slope", "openness", "obstacles", "accessibility"} <= set(missing)
    assert coverage == pytest.approx(0.25)
    assert score <= 25
    assert all(
        item.score is None and item.value is None for item in criteria if item.key in missing
    )


def test_local_slope_from_measured_plane_and_missing_samples():
    xy = np.array([(x, y) for x in [2, 5, 8] for y in [2, 5, 8]], dtype=float)
    z = 100 + 0.1 * xy[:, 0]
    metric = terrain_metric(box(0, 0, 10, 10), xy, z)
    assert metric["slope"] == pytest.approx(np.rad2deg(np.arctan(0.1)))
    z[:4] = np.nan
    assert terrain_metric(box(0, 0, 10, 10), xy, z)["slope"] is None


def test_visibility_flat_blocked_and_missing():
    ground = np.zeros((31, 31))
    grid = TerrainGrid(ground, ground.copy(), 0, 300, 10)
    options = AnalysisOptions(target_height_agl_m=10)
    zone, operation = box(20, 120, 40, 160), box(250, 120, 270, 160)
    clear = estimate_visibility(zone, operation, grid, options)
    assert clear.clear_fraction == 1 and clear.status == "surface_model"
    grid.surface[:, 14:17] = 100
    blocked = estimate_visibility(zone, operation, grid, options)
    assert blocked.clear_fraction == 0 and blocked.blocked_rays > 0
    grid.surface[:, 14:17] = np.nan
    unknown = estimate_visibility(zone, operation, grid, options)
    assert unknown.clear_fraction is None and unknown.unknown_rays > 0
    assert estimate_visibility(zone, operation, None, options).status == "not_assessed"
    grid.surface[:] = np.nan
    assert estimate_visibility(zone, operation, grid, options).status == "terrain_only"


def test_rgb_vision_uses_real_pixels_and_rejects_empty_image():
    array = np.tile(np.linspace(80, 160, 64, dtype=np.uint8), (64, 1))
    rgb = np.stack([array, array, array], axis=-1)
    stream = io.BytesIO()
    Image.fromarray(rgb).save(stream, format="PNG")
    evidence = analyse_rgb(stream.getvalue(), from_bounds(0, 0, 64, 64, 64, 64), 1)
    assert evidence.clear_mask.mean() > 0.9
    stream = io.BytesIO()
    Image.fromarray(np.zeros((64, 64, 3), dtype=np.uint8)).save(stream, format="PNG")
    with pytest.raises(ValueError):
        analyse_rgb(stream.getvalue(), None, 1)


def test_osm_relations_preserve_holes_and_access_tags():
    def ring(a, b, c, d):
        return [{"lon": x, "lat": y} for x, y in box(a, b, c, d).exterior.coords]

    geom = osm_geometry(
        {
            "type": "relation",
            "members": [
                {"role": "outer", "geometry": ring(0, 0, 10, 10)},
                {"role": "inner", "geometry": ring(2, 2, 4, 4)},
            ],
        }
    )
    assert geom.area == 96 and len(geom.interiors) == 1
    assert osm_kind({"landuse": "grass", "access": "private"}) == "restricted"
    assert osm_kind({"natural": "wood"}) == "vegetation"
    assert osm_kind({"building": "yes"}) == "building"
    assert osm_kind({"building": "yes", "access": "private"}) == "building"


def test_ign_failure_reports_missing_not_empty_success():
    class Failed:
        async def json(self, *args, **kwargs):
            raise SourceUnavailable("offline")

    records, report = asyncio.run(ign_layer(Failed(), (2, 48, 2.001, 48.001), "batiment"))
    assert not records and report.status == "unavailable"


def test_nodata_altitude_and_length_mismatch():
    assert np.isnan(elevation_value(-99999)) and np.isnan(elevation_value(None))

    class Truncated:
        async def json(self, *args, **kwargs):
            return {"elevations": []}

    ground, surface, failures = asyncio.run(sample_elevations(Truncated(), [2.0], [48.0], "test"))
    assert np.isnan(ground).all() and np.isnan(surface).all() and failures == 1


def test_provider_failure_returns_503_and_provenance(polygon):
    class Failed:
        async def acquire(self, *args):
            return DataBundle()

    app = create_app()
    app.dependency_overrides[get_engine] = lambda: SiteFinderEngine(Failed())
    with TestClient(app) as client:
        response = client.post("/api/v1/sites/search", json={"operation_area": polygon})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "analysis_unavailable"
    assert "sources" in response.json()["error"]


def test_real_engine_default_is_not_fixture():
    from drone_site_finder.providers.open_data import OpenDataProvider

    assert isinstance(SiteFinderEngine().provider, OpenDataProvider)


def test_missing_optional_data_and_strict_terrain_are_distinct(polygon):
    class Missing(FixtureProvider):
        async def acquire(self, context, options):
            bundle = await super().acquire(context, options)
            bundle.terrain = bundle.imagery = None
            return bundle

    app = create_app()
    app.dependency_overrides[get_engine] = lambda: SiteFinderEngine(Missing())
    with TestClient(app) as client:
        response = client.post("/api/v1/sites/search", json={"operation_area": polygon})
        assert response.status_code == 200
        zone = response.json()["features"][0]["properties"]
        assert {"slope", "openness"} <= set(zone["missing_data"])
        assert zone["visibility_estimate"]["status"] == "not_assessed"
        assert zone["uncertainty"] == "high"
        strict = client.post(
            "/api/v1/sites/search",
            json={"operation_area": polygon, "options": {"require_terrain": True}},
        )
        assert strict.status_code == 503


def test_no_candidate_response_does_not_fall_back_to_fiction(polygon):
    class Empty(FixtureProvider):
        async def acquire(self, context, options):
            bundle = await super().acquire(context, options)
            bundle.records = []
            return bundle

    app = create_app()
    app.dependency_overrides[get_engine] = lambda: SiteFinderEngine(Empty())
    with TestClient(app) as client:
        response = client.post("/api/v1/sites/search", json={"operation_area": polygon})
    assert response.status_code == 200
    result = response.json()
    assert result["features"] == [] and result["metadata"]["status"] == "no_candidates"
    assert result["metadata"]["is_demo"] is False


def test_geometry_identity_stable_and_contract_rejects_points(client, polygon):
    payload = client.post("/api/v1/sites/search", json={"operation_area": polygon}).json()
    model = SearchResponse.model_validate(payload)
    assert all(feature.properties.pilot_position is None for feature in model.features)
    payload["features"][0]["geometry"] = {"type": "Point", "coordinates": [2.31, 48.85]}
    with pytest.raises(ValidationError):
        SearchResponse.model_validate(payload)

from copy import deepcopy

import numpy as np
import pytest
from fastapi.testclient import TestClient
from rasterio.transform import from_bounds
from shapely.geometry import LineString, box

from drone_site_finder.api.routes import get_engine
from drone_site_finder.main import create_app
from drone_site_finder.providers.models import DataBundle, GeoRecord, ImageEvidence, TerrainGrid
from drone_site_finder.schemas.sites import SourceReport
from drone_site_finder.services.engine import SiteFinderEngine

SQUARE = {
    "type": "Polygon",
    "coordinates": [
        [
            [2.31, 48.85],
            [2.34, 48.85],
            [2.34, 48.87],
            [2.31, 48.87],
            [2.31, 48.85],
        ]
    ],
}


@pytest.fixture
def polygon():
    return deepcopy(SQUARE)


@pytest.fixture
def client():
    app = create_app()
    app.dependency_overrides[get_engine] = lambda: SiteFinderEngine(FixtureProvider())
    with TestClient(app) as test_client:
        yield test_client


class FixtureProvider:
    """Offline spatial fixtures for tests ONLY; production uses OpenDataProvider."""

    async def acquire(self, context, options):
        a, b, c, d = context.search.bounds
        spacing = max(5, (c - a) / 100, (d - b) / 100)
        rows, cols = int(np.ceil((d - b) / spacing)) + 1, int(np.ceil((c - a) / spacing)) + 1
        ground = np.full((rows, cols), 100.0)
        grid = TerrainGrid(ground, ground.copy(), a, d, spacing, np.zeros_like(ground))
        return DataBundle(
            records=[
                GeoRecord(context.to_wgs84(context.search), "open", "osm"),
                GeoRecord(
                    context.to_wgs84(LineString([(a, (b + d) / 2), (c, (b + d) / 2)])),
                    "road",
                    "osm",
                    {"highway": "path"},
                ),
                GeoRecord(context.to_wgs84(box(a + 20, b + 20, a + 35, b + 35)), "building", "osm"),
            ],
            terrain=grid,
            imagery=ImageEvidence(
                np.ones((64, 64), bool),
                np.zeros((64, 64), bool),
                from_bounds(a, b, c, d, 64, 64),
                context.crs.to_string(),
                spacing,
            ),
            sources=[
                SourceReport(
                    id="osm",
                    name="OFFLINE TEST FIXTURE",
                    url="https://example.test",
                    license="TEST ONLY",
                    attribution="Test fixture",
                    status="available",
                )
            ],
        )

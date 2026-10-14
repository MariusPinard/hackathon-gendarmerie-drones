import asyncio

import numpy as np

from drone_site_finder.providers.http import SourceUnavailable
from drone_site_finder.providers.panoramax import fetch_photos
from drone_site_finder.providers.rasters import sample_elevations
from drone_site_finder.providers.vectors import ign_layer


def test_lidar_distinguishes_ground_surface_and_nodata():
    class API:
        async def json(self, *args, **kwargs):
            return {
                "elevations": [
                    {
                        "z": 2,
                        "measures": [
                            {"z": 100, "title": "IGN - LIDAR HD - MNT - France"},
                            {"z": 115, "title": "IGN - LIDAR HD - MNS - France"},
                            {"z": 15, "title": "IGN - LIDAR HD - MNH - France"},
                        ],
                    },
                    {"z": -99999, "measures": []},
                ]
            }

    ground, surface, failed = asyncio.run(
        sample_elevations(API(), [2.0, 2.01], [48.0, 48.01], "lidar", multi=True)
    )
    assert ground[0] == 100 and surface[0] == 115
    assert np.isnan(ground[1]) and np.isnan(surface[1]) and failed == 0


def test_wfs_truncation_is_not_complete_coverage():
    class API:
        async def json(self, *args, **kwargs):
            return {
                "features": [
                    {"geometry": {"type": "Point", "coordinates": [2.0, 48.0]}, "properties": {}}
                ]
                * 1000,
                "numberMatched": 10000,
            }

    records, report = asyncio.run(ign_layer(API(), (2, 48, 2.1, 48.1), "pylone"))
    assert len(records) == 3000 and report.status == "partial"


def test_photos_preserve_author_license_and_capture_date():
    feature = {
        "id": "photo-id",
        "geometry": {"type": "Point", "coordinates": [2.0, 48.0]},
        "properties": {"datetime": "2024-01-01T10:00:00Z", "geovisio:producer": "Author"},
        "links": [
            {"rel": "license", "href": "https://creativecommons.org/licenses/by-sa/4.0/"},
            {"rel": "via", "href": "https://panoramax.openstreetmap.fr"},
        ],
        "assets": {"thumb": {"href": "https://panoramax.openstreetmap.fr/thumb.jpg"}},
    }

    class API:
        async def json(self, *args, **kwargs):
            return {"features": [feature]}

    photos, report = asyncio.run(fetch_photos(API(), (2, 48, 2.1, 48.1), True))
    assert report.status == "available" and photos[0]["attribution"] == "Author"
    assert photos[0]["license_url"].startswith("https://creativecommons.org/")
    assert photos[0]["captured_at"].startswith("2024")
    feature["links"] = []
    assert asyncio.run(fetch_photos(API(), (2, 48, 2.1, 48.1), True))[0] == []


def test_optional_source_failure_is_explicit():
    class API:
        async def json(self, *args, **kwargs):
            raise SourceUnavailable("offline")

    photos, report = asyncio.run(fetch_photos(API(), (2, 48, 2.1, 48.1), True))
    assert not photos and report.status == "unavailable"

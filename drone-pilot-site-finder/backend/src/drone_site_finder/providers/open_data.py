import asyncio

from shapely.geometry import shape

from drone_site_finder.providers.http import PublicHTTP
from drone_site_finder.providers.models import DataBundle
from drone_site_finder.providers.panoramax import fetch_photos
from drone_site_finder.providers.rasters import fetch_imagery, fetch_terrain
from drone_site_finder.providers.vectors import fetch_vectors


class OpenDataProvider:
    async def rooftop_zones(self, context, bundle, options):
        from drone_site_finder.candidates.rooftops import analyse_rooftops

        http = PublicHTTP()
        try:
            return await analyse_rooftops(http, context, bundle, options)
        finally:
            await http.close()

    async def nearby_photos(self, context, features, enabled):
        http = PublicHTTP()
        try:
            if not features or not enabled:
                photos, source = await fetch_photos(
                    http, context.to_wgs84(context.search).bounds, False
                )
                source.detail = "Not queried: no candidates or Panoramax disabled."
                return {}, source
            jobs = []
            for feature in features:
                region = context.to_metric(shape(feature.geometry.model_dump())).buffer(200)
                jobs.append(fetch_photos(http, context.to_wgs84(region).bounds, True))
            try:
                async with asyncio.timeout(15):
                    values = await asyncio.gather(*jobs)
            except TimeoutError:
                _, source = await fetch_photos(http, context.to_wgs84(context.search).bounds, False)
                source.status, source.detail = (
                    "unavailable",
                    "Optional local photo queries timed out.",
                )
                return {}, source
            source = values[0][1].model_copy(deep=True)
            source.feature_count = sum(len(photos) for photos, _ in values)
            failed = sum(report.status == "unavailable" for _, report in values)
            source.status = (
                "unavailable" if failed == len(values) else "partial" if failed else "available"
            )
            source.detail = (
                f"Queries within 200 m: {len(features)} zones, {failed} failures. "
                "Up to 60 images per query; dates and coverage vary."
            )
            return {
                feature.id: photos for feature, (photos, _) in zip(features, values, strict=True)
            }, source
        finally:
            await http.close()

    async def refine_terrain(self, context, zones, options):
        from drone_site_finder.providers.local_terrain import refine_terrain

        http = PublicHTTP()
        try:
            return await refine_terrain(http, context, zones, options)
        finally:
            await http.close()

    async def acquire(self, context, options):
        http = PublicHTTP()
        try:
            bbox = context.to_wgs84(context.search).bounds
            vectors, imagery, terrain = await asyncio.gather(
                fetch_vectors(http, bbox, options),
                fetch_imagery(http, context, options.use_imagery),
                fetch_terrain(http, context, options),
            )
            return DataBundle(
                records=vectors[0],
                sources=vectors[1] + [imagery[1]] + terrain[1],
                imagery=imagery[0],
                terrain=terrain[0],
            )
        finally:
            await http.close()

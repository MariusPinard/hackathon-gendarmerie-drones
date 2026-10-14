from datetime import UTC, datetime

import numpy as np
from pyproj import Transformer
from rasterio.transform import from_bounds

from drone_site_finder.image_analysis.aerial import analyse_rgb
from drone_site_finder.providers.http import SourceUnavailable
from drone_site_finder.providers.models import TerrainGrid
from drone_site_finder.schemas.sites import SourceReport

ALTI = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
WMS = "https://data.geopf.fr/wms-r"


def report(id, name, status, detail, count=0):
    return SourceReport(
        id=id,
        name=name,
        status=status,
        detail=detail,
        feature_count=count,
        url=WMS if id == "ign:ortho" else ALTI,
        license="Licence Ouverte 2.0",
        attribution=f"© IGN · {name}",
        fetched_at=datetime.now(UTC).isoformat(),
    )


async def fetch_imagery(http, context, enabled):
    if not enabled:
        return None, report("ign:ortho", "BD ORTHO", "disabled", "Disabled by request.")
    mercator = Transformer.from_crs(context.crs, 3857, always_xy=True)
    bounds = mercator.transform_bounds(*context.search.bounds, densify_pts=21)
    width_m, height_m = bounds[2] - bounds[0], bounds[3] - bounds[1]
    width = min(1024, max(64, int(1024 * width_m / max(width_m, height_m))))
    height = min(1024, max(64, int(1024 * height_m / max(width_m, height_m))))
    try:
        raw = await http.request(
            WMS,
            params={
                "service": "WMS",
                "version": "1.3.0",
                "request": "GetMap",
                "layers": "ORTHOIMAGERY.ORTHOPHOTOS",
                "styles": "",
                "crs": "EPSG:3857",
                "bbox": ",".join(map(str, bounds)),
                "width": width,
                "height": height,
                "format": "image/jpeg",
            },
        )
        # Mercator length is corrected by local latitude to report approximate ground pixel size.
        latitude = context.to_wgs84(context.operation).centroid.y
        pixel_m = width_m / width * np.cos(np.deg2rad(latitude))
        evidence = analyse_rgb(raw, from_bounds(*bounds, width, height), float(pixel_m))
        return evidence, report(
            "ign:ortho",
            "BD ORTHO",
            "available",
            f"RGB/texture proxies only; ~{pixel_m:.2f} m/pixel. "
            "Capture date unknown; shadows/clouds/season can mislead.",
            width * height,
        )
    except (SourceUnavailable, ValueError, OSError) as exc:
        return None, report("ign:ortho", "BD ORTHO", "unavailable", str(exc))


def elevation_value(value):
    try:
        number = float(value)
        return number if np.isfinite(number) and -500 < number < 10000 else np.nan
    except (ValueError, TypeError):
        return np.nan


async def sample_elevations(http, lon, lat, resource, multi=False):
    ground = np.full(len(lon), np.nan)
    surface = np.full(len(lon), np.nan)
    failures = 0
    for start in range(0, len(lon), 500):
        stop = min(start + 500, len(lon))
        try:
            data = await http.json(
                ALTI,
                body={
                    "lon": "|".join(f"{value:.7f}" for value in lon[start:stop]),
                    "lat": "|".join(f"{value:.7f}" for value in lat[start:stop]),
                    "resource": resource,
                    "delimiter": "|",
                    "zonly": "false",
                    "measures": "true" if multi else "false",
                },
            )
            values = data["elevations"]
            if len(values) != stop - start:
                raise SourceUnavailable("Elevation response length mismatch.")
            for index, item in enumerate(values, start):
                if multi:
                    for measure in item.get("measures", []):
                        title = measure.get("title", "").upper()
                        if " - MNT - " in title:
                            ground[index] = elevation_value(measure.get("z"))
                        elif " - MNS - " in title:
                            surface[index] = elevation_value(measure.get("z"))
                else:
                    ground[index] = elevation_value(item.get("z"))
        except (SourceUnavailable, ValueError, TypeError, KeyError):
            failures += 1
    return ground, surface, failures


async def fetch_terrain(http, context, options):
    x0, y0, x1, y1 = context.search.bounds
    # Regional grid for masking/visibility; candidate slope gets a separate local refinement.
    spacing = max(options.terrain_spacing_m, (x1 - x0) / 40, (y1 - y0) / 40)
    cols, rows = int(np.ceil((x1 - x0) / spacing)) + 1, int(np.ceil((y1 - y0) / spacing)) + 1
    yy, xx = np.indices((rows, cols))
    lon, lat = context.unproject.transform(x0 + xx.ravel() * spacing, y1 - yy.ravel() * spacing)
    sources = []
    ground, surface = np.full(len(lon), np.nan), np.full(len(lon), np.nan)
    if options.use_lidar:
        ground, surface, failures = await sample_elevations(
            http,
            lon,
            lat,
            "ign_lidar_hd_mnx_mono_wld",
            multi=True,
        )
        count = int(np.sum(np.isfinite(surface) & np.isfinite(ground)))
        sources.append(
            report(
                "ign:lidar",
                "LiDAR HD MNT/MNS",
                "available" if count == len(lon) else "partial" if count else "unavailable",
                f"Derived MNT/MNS sampled every {spacing:.1f} m; not raw points. "
                f"{count}/{len(lon)} paired samples; {failures} failed batches.",
                count,
            )
        )
    else:
        sources.append(report("ign:lidar", "LiDAR HD MNT/MNS", "disabled", "Disabled by request."))
    missing = ~np.isfinite(ground)
    if missing.any():
        fallback, _, failures = await sample_elevations(
            http, lon[missing], lat[missing], "ign_rge_alti_wld"
        )
        ground[missing] = fallback
        count = int(np.sum(np.isfinite(fallback)))
        sources.append(
            report(
                "ign:alti",
                "RGE ALTI",
                "available" if count == len(fallback) else "partial" if count else "unavailable",
                f"Ground-only fallback: {count}/{len(fallback)} samples; "
                f"{failures} failed batches. No surface obstacles invented.",
                count,
            )
        )
    if not np.isfinite(ground).any():
        return None, sources
    grid = TerrainGrid(ground.reshape(rows, cols), surface.reshape(rows, cols), x0, y1, spacing)
    dy, dx = np.gradient(grid.ground, spacing)
    grid.slope = np.rad2deg(np.arctan(np.hypot(dx, dy)))
    return grid, sources

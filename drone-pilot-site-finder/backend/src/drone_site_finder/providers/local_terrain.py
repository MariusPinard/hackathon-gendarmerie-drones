import numpy as np
from scipy.spatial import Delaunay, QhullError
from shapely.geometry import Point, Polygon

from drone_site_finder.providers.rasters import report, sample_elevations


def terrain_metric(zone, points, elevations):
    finite = np.isfinite(elevations)
    coverage = float(np.mean(finite)) if len(finite) else 0
    slopes = []
    if finite.sum() >= 4 and coverage >= 0.8:
        xy, z = points[finite], elevations[finite]
        try:
            for indices in Delaunay(xy).simplices:
                triangle = xy[indices]
                if not zone.covers(Polygon(triangle)):
                    continue
                offsets = triangle - triangle[0]
                coefficients = np.linalg.lstsq(
                    np.column_stack((offsets, np.ones(3))), z[indices], rcond=None
                )[0]
                slopes.append(float(np.rad2deg(np.arctan(np.hypot(*coefficients[:2])))))
        except QhullError:
            pass
    return {
        "slope": max(slopes) if slopes else None,
        "coverage": coverage,
        "samples": int(finite.sum()),
    }


async def refine_terrain(http, context, zones, options):
    positions, groups = [], []
    for zone in zones:
        a, b, c, d = zone.bounds
        points = [
            Point(x, y)
            for x in np.linspace(a, c, 5)[1:-1]
            for y in np.linspace(b, d, 5)[1:-1]
            if zone.covers(Point(x, y))
        ]
        points.append(zone.representative_point())
        unique = np.unique(np.array([(p.x, p.y) for p in points]), axis=0)
        groups.append((len(positions), len(positions) + len(unique), zone, unique))
        positions.extend(unique)
    if not positions:
        return {}, None
    xy = np.array(positions)
    lon, lat = context.unproject.transform(xy[:, 0], xy[:, 1])
    resource = "ign_lidar_hd_mnt_mono_wld" if options.use_lidar else "ign_rge_alti_wld"
    ground, _, failures = await sample_elevations(http, lon, lat, resource)
    missing = ~np.isfinite(ground)
    if missing.any() and options.use_lidar:
        fallback, _, more_failures = await sample_elevations(
            http, lon[missing], lat[missing], "ign_rge_alti_wld"
        )
        ground[missing] = fallback
        failures += more_failures
    metrics = {
        zone.wkb_hex: terrain_metric(zone, points, ground[start:stop])
        for start, stop, zone, points in groups
    }
    count = int(np.isfinite(ground).sum())
    return metrics, report(
        "ign:local_alti",
        "Relief local LiDAR / RGE ALTI",
        "available" if count == len(ground) else "partial" if count else "unavailable",
        f"{count}/{len(ground)} local ground samples; {failures} failed batches. "
        "Triangulated slopes inside each zone; sub-sample microrelief unknown.",
        count,
    )

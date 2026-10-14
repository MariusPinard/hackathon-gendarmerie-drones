"""Sampled straight-line geometric masking only. No VLOS or radio propagation claim."""

import numpy as np
from scipy.ndimage import map_coordinates
from shapely import get_coordinates
from shapely.geometry import LineString, Point

from drone_site_finder.schemas.sites import VisibilityEstimate


def sample_grid(values, grid, x, y):
    rows = (grid.y0 - np.asarray(y)) / grid.spacing
    cols = (np.asarray(x) - grid.x0) / grid.spacing
    return map_coordinates(
        values, np.array([rows, cols]), order=1, mode="constant", cval=np.nan, prefilter=False
    )


def estimate_visibility(zone, operation, grid, options, *, roof=None, buildings=(), footprint=None):
    summary = VisibilityEstimate(
        observer_height_m=options.observer_height_m,
        target_height_agl_m=options.target_height_agl_m,
        explanation="Aucune donnée altimétrique exploitable. Aucun résultat de visibilité inventé.",
        observer_surface="rooftop" if roof else "ground",
    )
    if grid is None:
        return summary
    observers = [zone.representative_point()]
    min_x, min_y, max_x, max_y = zone.bounds
    for x, y in [
        (min_x + (max_x - min_x) * 0.25, min_y + (max_y - min_y) * 0.25),
        (min_x + (max_x - min_x) * 0.75, min_y + (max_y - min_y) * 0.75),
    ]:
        point = Point(x, y)
        if zone.contains(point):
            observers.append(point)
    targets = [operation.representative_point()]
    a, b, c, d = operation.bounds
    targets.extend(
        Point(x, y)
        for x in np.linspace(a, c, 5)[1:-1]
        for y in np.linspace(b, d, 5)[1:-1]
        if operation.contains(Point(x, y))
    )
    surface_available = np.isfinite(grid.surface).any()
    clear = blocked = unknown = vector_tests = 0
    for observer in observers:
        for target in targets:
            steps = min(256, max(3, int(observer.distance(target) / grid.spacing) + 2))
            x, y = (
                np.linspace(observer.x, target.x, steps),
                np.linspace(observer.y, target.y, steps),
            )
            ground = sample_grid(grid.ground, grid, x, y)
            obstacles = sample_grid(grid.surface if surface_available else grid.ground, grid, x, y)
            if not np.isfinite(ground[[0, -1]]).all() or not np.isfinite(obstacles).all():
                unknown += 1
                continue
            line = np.linspace(
                (roof.surface_elevation_m if roof else ground[0]) + options.observer_height_m,
                ground[-1] + options.target_height_agl_m,
                steps,
            )
            # Endpoint surface heights matter: the target can lie under an elevated canopy.
            masked, unresolved = bool(np.any(obstacles[1:] > line[1:])), False
            ray = LineString([(observer.x, observer.y), (target.x, target.y)])
            for building, absolute, height in buildings:
                if (
                    footprint is not None
                    and building.intersects(footprint)
                    and building.intersection(footprint).area
                    > 0.6 * min(building.area, footprint.area)
                ):
                    continue
                intersection = ray.intersection(building)
                if intersection.is_empty:
                    continue
                vector_tests += 1
                if absolute is None and height is None:
                    unresolved = True
                    continue
                coordinates = get_coordinates(intersection)
                fractions = np.array(
                    [ray.project(Point(xy), normalized=True) for xy in coordinates]
                )
                bases = sample_grid(grid.ground, grid, coordinates[:, 0], coordinates[:, 1])
                tops = (
                    np.full(len(coordinates), absolute) if absolute is not None else bases + height
                )
                if not np.isfinite(tops).all():
                    unresolved = True
                elif np.any(tops > line[0] + fractions * (line[-1] - line[0])):
                    masked = True
            if masked:
                blocked += 1
            elif unresolved:
                unknown += 1
            else:
                clear += 1
    known = clear + blocked
    summary.status = "surface_model" if surface_available else "terrain_only"
    summary.clear_fraction = clear / known if known else None
    summary.evaluated_rays, summary.blocked_rays, summary.unknown_rays = known, blocked, unknown
    summary.sampling_m = grid.spacing
    summary.vector_obstacles_tested = vector_tests
    summary.explanation = (
        f"{len(observers)} échantillons internes × {len(targets)} cibles AGL. "
        + (
            "MNS LiDAR échantillonné."
            if surface_available
            else "Terrain seul : bâtiments et végétation non modélisés."
        )
        + (
            " Empreintes et hauteurs cartographiées testées en complément du raster. "
            "Les hauteurs de gouttière peuvent sous-estimer les faîtages. "
            "Les échantillons ne sont pas des positions conseillées. "
            "Masquages fins/temporaires non résolus ; ni VLOS ni liaison radio"
            " garanties."
        )
    )
    return summary

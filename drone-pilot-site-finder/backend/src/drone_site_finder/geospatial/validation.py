"""Validate WGS84 rings without repairing or silently changing user geometry."""

from shapely.geometry import MultiPolygon, Polygon
from shapely.validation import explain_validity

MAX_VERTICES = 2_000


def validate_polygon_rings(rings: list[list[tuple[float, float]]]) -> None:
    if sum(len(ring) for ring in rings) > MAX_VERTICES:
        raise ValueError(f"Polygon must contain at most {MAX_VERTICES} positions in total.")
    for ring in rings:
        if ring[0] != ring[-1]:
            raise ValueError("Each linear ring must be closed (first position equals last).")
        if len(set(ring[:-1])) < 3:
            raise ValueError("Each ring must contain at least three distinct vertices.")
    longitudes = [position[0] for ring in rings for position in ring]
    if max(longitudes) - min(longitudes) > 180:
        raise ValueError(
            "Polygons spanning more than 180 degrees or the antimeridian are unsupported."
        )
    polygon = Polygon(rings[0], rings[1:])
    if not polygon.is_valid:
        raise ValueError(f"Invalid polygon topology: {explain_validity(polygon)}")
    if polygon.is_empty or polygon.area <= 0:
        raise ValueError("Polygon must enclose a non-zero area.")


def validate_multipolygon_rings(polygons: list[list[list[tuple[float, float]]]]) -> None:
    if sum(len(ring) for rings in polygons for ring in rings) > MAX_VERTICES:
        raise ValueError(f"MultiPolygon must contain at most {MAX_VERTICES} positions in total.")
    for rings in polygons:
        validate_polygon_rings(rings)
    geometry = MultiPolygon([Polygon(rings[0], rings[1:]) for rings in polygons])
    if geometry.bounds[2] - geometry.bounds[0] > 180:
        raise ValueError("MultiPolygon must not span more than 180 degrees longitude.")
    if not geometry.is_valid:
        raise ValueError(f"Invalid MultiPolygon topology: {explain_validity(geometry)}")

"""Reusable surface primitives. No terrain, access or operational suitability inference."""

from pyproj import Geod
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient

_WGS84 = Geod(ellps="WGS84")


def polygon_parts(geometry: BaseGeometry) -> list[Polygon]:
    """Extract continuous positive-area components, dropping lines and isolated points."""
    if geometry.is_empty:
        return []
    if isinstance(geometry, Polygon):
        return [geometry] if geometry.is_valid and geometry.area > 0 else []
    if isinstance(geometry, MultiPolygon | GeometryCollection):
        return [part for child in geometry.geoms for part in polygon_parts(child)]
    return []


def geodesic_area_m2(geometry: Polygon | MultiPolygon) -> float:
    """WGS84 ellipsoidal area, subtracting holes regardless of input ring winding."""
    return sum(
        abs(_WGS84.geometry_area_perimeter(orient(part, sign=1.0))[0])
        for part in polygon_parts(geometry)
    )

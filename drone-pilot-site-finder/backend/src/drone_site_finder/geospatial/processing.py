import numpy as np
from pyproj import CRS, Transformer
from rasterio.features import geometry_mask, shapes
from rasterio.transform import from_origin
from shapely import coverage_union_all, transform
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from drone_site_finder.providers.models import MetricContext


class AnalysisError(Exception):
    def __init__(self, message, code="analysis_unavailable", status_code=503, sources=None):
        self.message, self.code, self.status_code, self.sources = (
            message,
            code,
            status_code,
            sources or [],
        )


def metric_context(request):
    area = shape(request.operation_area.model_dump())
    center = area.centroid
    crs = CRS.from_proj4(f"+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m")
    project = Transformer.from_crs(4326, crs, always_xy=True)
    unproject = Transformer.from_crs(crs, 4326, always_xy=True)
    operation = transform(area, project.transform, interleaved=False)
    expanded = operation.buffer(request.options.search_radius_m, quad_segs=12)
    if (
        expanded.area > 25_000_000
        or max(expanded.bounds[2] - expanded.bounds[0], expanded.bounds[3] - expanded.bounds[1])
        > 7000
    ):
        raise AnalysisError(
            "Limit the operation and search perimeter to 25 km² and 7 km across.",
            "area_too_large",
            422,
        )
    search = expanded.difference(operation) if request.options.surroundings_only else expanded
    return MetricContext(crs, operation, search, project, unproject)


def grid_transform(grid):
    return from_origin(
        grid.x0 - grid.spacing / 2, grid.y0 + grid.spacing / 2, grid.spacing, grid.spacing
    )


def mask_geometry(mask, affine, crs, context):
    parts = [
        shape(geometry)
        for geometry, value in shapes(mask.astype("uint8"), mask=mask, transform=affine)
        if value == 1
    ]
    # Raster polygonization produces a non-overlapping coverage. Coverage union avoids
    # expensive general overlay and preserves every small pixel exclusion.
    union = coverage_union_all(parts) if parts else unary_union(parts)
    if not union.is_empty and CRS.from_user_input(crs) != context.crs:
        union = transform(
            union,
            Transformer.from_crs(crs, context.crs, always_xy=True).transform,
            interleaved=False,
        )
    return union


def cells_for_zone(zone, grid):
    return geometry_mask(
        [mapping(zone)], grid.ground.shape, grid_transform(grid), invert=True, all_touched=True
    )


def image_fraction(zone, image, context):
    projected = transform(
        zone,
        Transformer.from_crs(context.crs, image.crs, always_xy=True).transform,
        interleaved=False,
    )
    selected = geometry_mask(
        [mapping(projected)], image.clear_mask.shape, image.transform, invert=True
    )
    if not selected.any():
        return None
    return float(np.mean(image.clear_mask[selected]))

from dataclasses import dataclass, field

import numpy as np
from pyproj import CRS, Transformer
from shapely import transform
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

from drone_site_finder.schemas.sites import SourceReport


@dataclass
class MetricContext:
    crs: CRS
    operation: Polygon
    search: BaseGeometry
    project: Transformer
    unproject: Transformer

    def to_metric(self, geometry):
        return transform(geometry, self.project.transform, interleaved=False)

    def to_wgs84(self, geometry):
        return transform(geometry, self.unproject.transform, interleaved=False)


@dataclass
class GeoRecord:
    geometry: BaseGeometry
    kind: str
    source_id: str
    properties: dict = field(default_factory=dict)


@dataclass
class TerrainGrid:
    ground: np.ndarray
    surface: np.ndarray
    x0: float
    y0: float
    spacing: float
    slope: np.ndarray | None = None

    def xy(self):
        rows, cols = np.indices(self.ground.shape)
        return self.x0 + cols * self.spacing, self.y0 - rows * self.spacing


@dataclass
class ImageEvidence:
    clear_mask: np.ndarray
    obstruction_mask: np.ndarray
    transform: object
    crs: str
    pixel_size_m: float


@dataclass
class DataBundle:
    records: list[GeoRecord] = field(default_factory=list)
    sources: list[SourceReport] = field(default_factory=list)
    terrain: TerrainGrid | None = None
    imagery: ImageEvidence | None = None
    photos: list[dict] = field(default_factory=list)
    local_terrain: dict = field(default_factory=dict)

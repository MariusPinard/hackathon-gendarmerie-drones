from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from drone_site_finder.geospatial.validation import (
    validate_multipolygon_rings,
    validate_polygon_rings,
)

Longitude = Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)]
Latitude = Annotated[float, Field(strict=True, ge=-90, le=90, allow_inf_nan=False)]
Position = tuple[Longitude, Latitude]
Ring = Annotated[list[Position], Field(min_length=4, max_length=2_000)]
PolygonRings = Annotated[list[Ring], Field(min_length=1, max_length=32)]


class PolygonGeometry(BaseModel):
    """RFC 7946 geometry, [longitude, latitude], two dimensions, holes supported."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["Polygon"]
    coordinates: PolygonRings

    @field_validator("coordinates")
    @classmethod
    def valid_geometry(cls, value: list[list[Position]]) -> list[list[Position]]:
        validate_polygon_rings(value)
        return value


class MultiPolygonGeometry(BaseModel):
    """Multipart surface transport; parts remain distinct, including their interior holes."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["MultiPolygon"]
    coordinates: Annotated[list[PolygonRings], Field(min_length=1, max_length=32)]

    @field_validator("coordinates")
    @classmethod
    def valid_geometry(cls, value: list[list[list[Position]]]) -> list[list[list[Position]]]:
        validate_multipolygon_rings(value)
        return value


SurfaceGeometry = Annotated[PolygonGeometry | MultiPolygonGeometry, Field(discriminator="type")]


class PointGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["Point"] = "Point"
    coordinates: Position

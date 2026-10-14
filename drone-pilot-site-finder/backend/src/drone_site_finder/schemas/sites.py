from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from drone_site_finder.schemas.geojson import PointGeometry, PolygonGeometry, SurfaceGeometry


class SearchRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "operation_area": {
                    "type": "Polygon",
                    "coordinates": [
                        [[2.31, 48.85], [2.34, 48.85], [2.34, 48.87], [2.31, 48.87], [2.31, 48.85]]
                    ],
                },
                "max_candidates": 3,
            }
        },
    )
    operation_area: PolygonGeometry
    max_candidates: Annotated[int, Field(strict=True, ge=1, le=10)] = 3
    options: "AnalysisOptions" = Field(default_factory=lambda: AnalysisOptions())


class AnalysisOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    search_radius_m: float = Field(default=300, ge=0, le=2000)
    surroundings_only: bool = True
    min_area_m2: float = Field(default=100, ge=25, le=100000)
    min_width_m: float = Field(default=5, ge=2, le=100)
    obstacle_buffer_m: float = Field(default=10, ge=1, le=100)
    max_access_distance_m: float = Field(default=100, ge=5, le=1000)
    max_slope_deg: float = Field(default=12, ge=1, le=40)
    terrain_spacing_m: float = Field(default=25, ge=5, le=100)
    observer_height_m: float = Field(default=1.7, ge=1, le=10)
    target_height_agl_m: float = Field(default=30, ge=1, le=500)
    use_osm: bool = True
    use_ign: bool = True
    use_imagery: bool = True
    use_lidar: bool = True
    use_panoramax: bool = True
    require_terrain: bool = False
    include_ground: bool = True
    include_rooftops: bool = True
    roof_edge_setback_m: float = Field(default=3, ge=2, le=20)
    max_roof_slope_deg: float = Field(default=8, ge=1, le=20)
    roof_sample_spacing_m: float = Field(default=3, ge=1, le=10)
    roof_shortlist_limit: int = Field(default=12, strict=True, ge=1, le=20)
    # Takeoff occupancy map (additive in 0.4): pilot range toward the operation area.
    include_occupancy: bool = True
    pilot_range_m: float = Field(default=1000, ge=50, le=5000)
    occupancy_cell_m: float = Field(default=10, ge=2, le=50)
    weights: dict[str, float] = Field(
        default_factory=lambda: {
            "accessibility": 0.20,
            "area": 0.15,
            "slope": 0.20,
            "obstacles": 0.15,
            "openness": 0.20,
            "proximity": 0.10,
        }
    )

    @model_validator(mode="after")
    def valid_weights(self) -> "AnalysisOptions":
        expected = {"accessibility", "area", "slope", "obstacles", "openness", "proximity"}
        if (
            set(self.weights) != expected
            or any(not 0 <= value <= 1 for value in self.weights.values())
            or sum(self.weights.values()) <= 0
        ):
            raise ValueError("Provide the six documented non-negative weights, with positive sum.")
        if self.surroundings_only and self.search_radius_m == 0:
            raise ValueError("A surrounding search requires a positive search_radius_m.")
        if not self.include_ground and not self.include_rooftops:
            raise ValueError("Enable ground zones, rooftop zones, or both.")
        return self


class SourceReport(BaseModel):
    id: str
    name: str
    url: str
    license: str
    attribution: str
    status: Literal["available", "partial", "unavailable", "disabled"]
    fetched_at: str | None = None
    acquisition_date: str | None = None
    feature_count: int = 0
    detail: str = ""


class VisibilityEstimate(BaseModel):
    status: Literal["not_assessed", "terrain_only", "surface_model"] = "not_assessed"
    clear_fraction: float | None = Field(default=None, ge=0, le=1)
    evaluated_rays: int = 0
    blocked_rays: int = 0
    unknown_rays: int = 0
    observer_height_m: float
    target_height_agl_m: float
    sampling_m: float | None = None
    explanation: str
    observer_surface: Literal["ground", "rooftop"] = "ground"
    vector_obstacles_tested: int = 0


class RoofAssessment(BaseModel):
    building_source: str
    surface_elevation_m: float
    height_above_ground_m: float
    slope_deg: float
    sample_spacing_m: float = Field(gt=0, le=10)
    valid_sample_fraction: float = Field(ge=0.8, le=1)
    surface_samples: int = Field(ge=4)
    roughness_m: float = Field(ge=0)
    equipment_status: Literal["suspected", "not_resolved"] = "not_resolved"
    access_status: Literal["mapped", "unknown"] = "unknown"
    structural_capacity: Literal["not_assessed"] = "not_assessed"
    fall_protection: Literal["not_assessed"] = "not_assessed"
    permission: Literal["not_assessed"] = "not_assessed"
    edge_setback_m: float
    checks_required: list[str]


class GroundPhoto(BaseModel):
    id: str
    url: str
    thumbnail_url: str | None = None
    license_url: str
    attribution: str
    captured_at: str | None = None
    distance_m: float


class CriterionScore(BaseModel):
    key: str
    label: str
    score: float | None = Field(ge=0, le=100)
    weight: float = Field(ge=0, le=1)
    source: str
    value: float | None = None
    unit: str | None = None
    explanation: str


class CandidateProperties(BaseModel):
    name: str
    surface_type: Literal["ground", "rooftop"] = "ground"
    score_profile: Literal["ground_v1", "rooftop_v1"] = "ground_v1"
    roof: RoofAssessment | None = None
    is_demo: Literal[False] = False
    score: float = Field(ge=0, le=100)
    score_kind: Literal["measured_heuristic"] = "measured_heuristic"
    uncertainty: Literal["medium", "high"] = "high"
    evidence_coverage: float = Field(ge=0, le=1)
    missing_data: list[str]
    evidence: list[str]
    source_ids: list[str]
    visibility_estimate: VisibilityEstimate
    ground_photos: list[GroundPhoto] = Field(default_factory=list)
    area_m2: float = Field(gt=0, allow_inf_nan=False)
    area_method: Literal["geodesic_wgs84"] = "geodesic_wgs84"
    component_count: int = Field(ge=1)
    relevance_level: Literal["high", "moderate", "low"]
    criteria: list[CriterionScore]
    justifications: list[str]
    pilot_position: None = None
    takeoff_position: PointGeometry | None = None
    visibility: Literal["not_assessed"] = "not_assessed"
    radio_link: Literal["not_assessed"] = "not_assessed"

    @model_validator(mode="after")
    def consistent_surface(self):
        rooftop = self.surface_type == "rooftop"
        if rooftop != (self.roof is not None) or self.score_profile != (
            "rooftop_v1" if rooftop else "ground_v1"
        ):
            raise ValueError("Surface type, score profile and roof evidence must agree.")
        if rooftop and self.uncertainty != "high":
            raise ValueError("Rooftop uncertainty must remain high pending human checks.")
        return self


class CandidateFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: str
    geometry: SurfaceGeometry
    properties: CandidateProperties

    @model_validator(mode="after")
    def matching_component_count(self) -> "CandidateFeature":
        count = 1 if self.geometry.type == "Polygon" else len(self.geometry.coordinates)
        if self.properties.component_count != count:
            raise ValueError("component_count must match the number of polygon components.")
        return self


OccupancyStatus = Literal[
    "free",
    "free_unconfirmed",
    "limited_range",
    "no_access",
    "masked",
    "out_of_range",
    "steep",
    "obstacle_buffer",
    "occupied",
]


class OccupancyGeometry(BaseModel):
    """Unbounded multipart transport for raster-derived occupancy surfaces (WGS84)."""

    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[list[tuple[float, float]]]]


class OccupancyZone(BaseModel):
    status: OccupancyStatus
    reason: str | None = None
    label: str
    reason_label: str | None = None
    takeoff: Literal["possible", "conditional", "impossible"]
    area_m2: float = Field(ge=0)
    geometry: OccupancyGeometry


class OccupancyMap(BaseModel):
    """Cell-based takeoff screening of the search area. Not a flight or access authorization."""

    kind: Literal["takeoff_occupancy"] = "takeoff_occupancy"
    cell_size_m: float = Field(gt=0)
    rows: int = Field(ge=1)
    cols: int = Field(ge=1)
    cells_evaluated: int = Field(ge=0)
    pilot_range_m: float = Field(gt=0)
    zones: list[OccupancyZone]
    area_by_status_m2: dict[str, float]
    share_by_status: dict[str, float]
    assessed: dict[str, bool]
    notes: list[str]


class SearchMetadata(BaseModel):
    contract_version: Literal["0.4"] = "0.4"
    candidate_kind: Literal["pilot_zone"] = "pilot_zone"
    mode: Literal["analysis"] = "analysis"
    is_demo: Literal[False] = False
    provider: Literal["open_geodata"] = "open_geodata"
    status: Literal["complete", "partial", "no_candidates"]
    sources: list[SourceReport]
    search_area: SurfaceGeometry
    metric_crs: str
    terrain_sampling_m: float | None = None
    elapsed_seconds: float = 0
    phase_seconds: dict[str, float] = Field(default_factory=dict)
    diagnostics: dict[str, int | str] = Field(default_factory=dict)
    ranking: str = "interleaved_by_surface_type"
    validation_status: Literal["awaiting_operator_review"] = "awaiting_operator_review"
    excluded_area_m2: float = 0
    options: AnalysisOptions
    count: int = Field(ge=0)
    requested_count: int = Field(ge=1, le=10)
    warnings: list[str]
    limitations: list[str]


class SearchResponse(BaseModel):
    """Evidence-based candidate surfaces, never exact pilot positions or flight approvals."""

    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[CandidateFeature]
    metadata: SearchMetadata
    occupancy: OccupancyMap | None = None


class ErrorDetail(BaseModel):
    location: list[str | int]
    message: str
    type: str


class ValidationErrorBody(BaseModel):
    code: Literal["invalid_request"] = "invalid_request"
    message: str = "Invalid request. Submit a valid two-dimensional WGS84 GeoJSON Polygon."
    details: list[ErrorDetail]


class ErrorResponse(BaseModel):
    error: ValidationErrorBody


class AnalysisFailureBody(BaseModel):
    code: str
    message: str
    sources: list[SourceReport] = Field(default_factory=list)


class AnalysisFailureResponse(BaseModel):
    error: AnalysisFailureBody

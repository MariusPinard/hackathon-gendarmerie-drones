import asyncio
import json
import os
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from drone_site_finder import __version__
from drone_site_finder.schemas.sites import (
    AnalysisFailureResponse,
    ErrorResponse,
    OccupancyMap,
    SearchRequest,
    SearchResponse,
)
from drone_site_finder.services.engine import SiteFinderEngine

router = APIRouter(prefix="/api/v1")
_ANALYSIS_LOCK = asyncio.Lock()
# At most two tiles at a time, to respect public data services.
_TILE_LOCK = asyncio.Semaphore(2)


def get_engine():
    return SiteFinderEngine()


def get_tile_provider():
    return None  # None: live open data (OpenDataProvider)


Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Latitude = Annotated[float, Field(ge=-85, le=85, allow_inf_nan=False)]


class TakeoffFeedback(BaseModel):
    """Field check of a takeoff spot, recorded to calibrate the occupancy map."""

    model_config = ConfigDict(extra="forbid")
    position: tuple[Longitude, Latitude]
    verdict: Literal["ok", "impossible"]
    comment: Annotated[str, Field(max_length=200)] = ""


def _feedback_file():
    from pathlib import Path

    default = Path(__file__).resolve().parents[3] / ".data" / "takeoff-feedback.jsonl"
    path = Path(os.getenv("DRONE_FEEDBACK_FILE", default))
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class OccupancyTileRequest(BaseModel):
    """WGS84 bounding box [west, south, east, north] of one tile, 50 m to 2.5 km across."""

    model_config = ConfigDict(extra="forbid")
    bbox: tuple[Longitude, Latitude, Longitude, Latitude]
    cell_m: float = Field(default=10, ge=5, le=30)


@router.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__, "mode": "analysis"}


@router.post(
    "/sites/search",
    response_model=SearchResponse,
    tags=["sites"],
    responses={
        422: {
            "model": ErrorResponse | AnalysisFailureResponse,
            "description": "Invalid geometry, parameters or study extent",
        },
        429: {"model": AnalysisFailureResponse, "description": "Analysis already running"},
        503: {"model": AnalysisFailureResponse, "description": "Essential data unavailable"},
        504: {"model": AnalysisFailureResponse, "description": "Analysis deadline exceeded"},
    },
)
async def search_sites(
    request: SearchRequest, engine: Annotated[SiteFinderEngine, Depends(get_engine)]
) -> SearchResponse:
    """Analyse open geographic data and return scored candidate surfaces with provenance."""
    from drone_site_finder.geospatial.processing import AnalysisError

    if _ANALYSIS_LOCK.locked():
        raise AnalysisError(
            "Une analyse est déjà en cours. Réessayez après sa fin.", "analysis_busy", 429
        )
    async with _ANALYSIS_LOCK:
        try:
            async with asyncio.timeout(165):
                return await engine.search(request)
        except TimeoutError as exc:
            raise AnalysisError(
                "Délai d’analyse dépassé. Réduisez l’emprise et réessayez.", "analysis_timeout", 504
            ) from exc


@router.post(
    "/occupancy/tile",
    response_model=OccupancyMap,
    tags=["occupancy"],
    responses={
        422: {"model": ErrorResponse | AnalysisFailureResponse, "description": "Invalid tile"},
        503: {"model": AnalysisFailureResponse, "description": "Essential data unavailable"},
        504: {"model": AnalysisFailureResponse, "description": "Tile deadline exceeded"},
    },
)
async def occupancy_tile_route(
    request: OccupancyTileRequest, provider: Annotated[object, Depends(get_tile_provider)]
) -> OccupancyMap:
    """Takeoff occupancy of one tile (territory mode: no range or masking). Screening only."""
    from drone_site_finder.geospatial.processing import AnalysisError
    from drone_site_finder.services.occupancy_tiles import occupancy_tile

    west, south, east, north = request.bbox
    if west >= east or south >= north:
        raise AnalysisError("Emprise de tuile invalide.", "invalid_tile", 422)
    async with _TILE_LOCK:
        return await occupancy_tile(request.bbox, request.cell_m, provider)


@router.post("/occupancy/feedback", tags=["occupancy"], status_code=201)
async def add_takeoff_feedback(feedback: TakeoffFeedback) -> dict:
    """Record a field check (« vérifié OK » / « impossible en vrai ») for later calibration."""
    entry = {
        **feedback.model_dump(),
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    with _feedback_file().open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


@router.get("/occupancy/feedback", tags=["occupancy"])
async def list_takeoff_feedback() -> dict:
    """All recorded field checks as a GeoJSON FeatureCollection."""
    path = _feedback_file()
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    features = []
    for line in lines[-2000:]:
        try:
            item = json.loads(line)
        except ValueError:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": item["position"]},
                "properties": {k: v for k, v in item.items() if k != "position"},
            }
        )
    return {"type": "FeatureCollection", "features": features}

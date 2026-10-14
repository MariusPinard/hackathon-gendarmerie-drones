import asyncio
from typing import Annotated

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
# Tiles are queued one at a time to respect public data services.
_TILE_LOCK = asyncio.Lock()


def get_engine():
    return SiteFinderEngine()


def get_tile_provider():
    return None  # None: live open data (OpenDataProvider)


Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Latitude = Annotated[float, Field(ge=-85, le=85, allow_inf_nan=False)]


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

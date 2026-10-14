import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends

from drone_site_finder import __version__
from drone_site_finder.schemas.sites import (
    AnalysisFailureResponse,
    ErrorResponse,
    SearchRequest,
    SearchResponse,
)
from drone_site_finder.services.engine import SiteFinderEngine

router = APIRouter(prefix="/api/v1")
_ANALYSIS_LOCK = asyncio.Lock()


def get_engine():
    return SiteFinderEngine()


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

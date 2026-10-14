import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from drone_site_finder import __version__
from drone_site_finder.api.routes import router
from drone_site_finder.geospatial.processing import AnalysisError
from drone_site_finder.schemas.sites import ErrorDetail, ErrorResponse, ValidationErrorBody


def create_app() -> FastAPI:
    app = FastAPI(
        title="Drone Pilot Site Finder",
        version=__version__,
        description=(
            "Evidence-based candidate pilot surfaces from open data. Human "
            "field verification required."
        ),
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    origins = os.getenv("DRONE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[item.strip() for item in origins.split(",") if item.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not echo request bodies or non-serializable exception context.
        body = ErrorResponse(
            error=ValidationErrorBody(
                details=[
                    ErrorDetail(
                        location=list(error["loc"]), message=error["msg"], type=error["type"]
                    )
                    for error in exc.errors()
                ]
            )
        )
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    app.include_router(router)

    @app.exception_handler(AnalysisError)
    async def unavailable(_request: Request, exc: AnalysisError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "sources": [source.model_dump(mode="json") for source in exc.sources],
                }
            },
        )

    return app


app = create_app()

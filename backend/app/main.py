import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from starlette.responses import JSONResponse

from .database import check_database, initialize_database, resolve_database_path
from .routers.backups import router as backups_router
from .routers.auth import router as auth_router
from .routers.books import router as books_router
from .routers.accounts import router as accounts_router
from .routers.options import router as options_router
from .routers.overview import router as overview_router
from .routers.records import router as records_router
from .services.development_service import ensure_development_user
from .services.errors import BusinessValidationError


NOT_FOUND_ERROR_CODES = {
    "book_not_found",
    "record_not_found",
    "account_not_found",
    "record_type_not_available",
    "category_not_available",
    "category_not_found",
    "record_type_not_found",
    "account_not_in_book",
    "to_account_not_in_book",
    "deposit_link_not_found",
}

INVALID_REQUEST_ERROR_CODES = {
    "invalid_date_range",
    "backup_invalid",
}

AUTH_ERROR_CODES = {
    "authentication_required",
    "invalid_credentials",
}


class HealthResponse(BaseModel):
    status: str
    database: str
    schema_version: int


def create_app(database_path: str | Path | None = None) -> FastAPI:
    resolved_path = resolve_database_path(database_path)
    allow_development_fallback = os.getenv("JIZHANGBEN_ALLOW_DEV_FALLBACK", "1").lower() in {
        "1", "true", "yes", "on"
    }

    @asynccontextmanager
    async def lifespan(app_instance: FastAPI) -> AsyncIterator[None]:
        initialize_database(resolved_path)
        development_user = ensure_development_user(resolved_path)
        app_instance.state.current_user_id = development_user["id"]
        app_instance.state.allow_development_fallback = allow_development_fallback
        app_instance.state.session_cookie_name = "jizhangben_session"
        yield

    application = FastAPI(
        title="记账本 API",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.database_path = resolved_path
    application.state.allow_development_fallback = allow_development_fallback
    application.state.session_cookie_name = "jizhangben_session"
    cors_origins = [
        origin.strip()
        for origin in os.getenv("JIZHANGBEN_CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    if cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    application.include_router(auth_router)
    application.include_router(backups_router)
    application.include_router(books_router)
    application.include_router(accounts_router)
    application.include_router(options_router)
    application.include_router(overview_router)
    application.include_router(records_router)

    @application.exception_handler(BusinessValidationError)
    async def handle_business_validation_error(
        _: Request,
        error: BusinessValidationError,
    ) -> JSONResponse:
        if error.code in AUTH_ERROR_CODES:
            response_status = status.HTTP_401_UNAUTHORIZED
        elif error.code in INVALID_REQUEST_ERROR_CODES:
            response_status = status.HTTP_422_UNPROCESSABLE_CONTENT
        elif error.code in NOT_FOUND_ERROR_CODES:
            response_status = status.HTTP_404_NOT_FOUND
        else:
            response_status = status.HTTP_409_CONFLICT
        return JSONResponse(
            status_code=response_status,
            content={"code": error.code, "message": error.message},
        )

    @application.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        _: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "code": "request_validation_failed",
                "message": "请求字段不合法",
                "details": jsonable_encoder(error.errors()),
            },
        )

    @application.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        database = check_database(application.state.database_path)
        return HealthResponse(
            status="ok",
            database=str(database["status"]),
            schema_version=int(database["schema_version"]),
        )

    return application


app = create_app()

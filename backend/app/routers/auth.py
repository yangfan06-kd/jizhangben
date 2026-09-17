import os

from fastapi import APIRouter, Depends, Request, Response, status

from ..dependencies import SESSION_COOKIE_NAME, get_authenticated_user
from ..schemas.auth import LoginRequest, RegisterRequest, UserResponse
from ..services.auth_service import (
    SESSION_TTL_SECONDS,
    authenticate_user,
    create_session,
    register_user,
    revoke_session,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _session_cookie_secure(request: Request) -> bool:
    configured = os.getenv("JIZHANGBEN_SESSION_SECURE", "auto").strip().lower()
    if configured in {"1", "true", "yes", "on"}:
        return True
    if configured in {"0", "false", "no", "off"}:
        return False
    return request.url.scheme.lower() == "https"


def _session_cookie_samesite() -> str:
    configured = os.getenv("JIZHANGBEN_SESSION_SAMESITE", "lax").strip().lower()
    return configured if configured in {"lax", "strict", "none"} else "lax"


def _set_session_cookie(response: Response, token: str, request: Request) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite=_session_cookie_samesite(),
        secure=_session_cookie_secure(request),
        path="/",
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
) -> dict[str, object]:
    user = register_user(
        request.app.state.database_path,
        payload.email,
        payload.password,
        payload.display_name,
    )
    _set_session_cookie(
        response,
        create_session(request.app.state.database_path, str(user["id"])),
        request,
    )
    return user


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
) -> dict[str, object]:
    user = authenticate_user(
        request.app.state.database_path,
        payload.email,
        payload.password,
    )
    _set_session_cookie(
        response,
        create_session(request.app.state.database_path, str(user["id"])),
        request,
    )
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> Response:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    revoke_session(request.app.state.database_path, token)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserResponse)
def current_user(user: dict[str, object] = Depends(get_authenticated_user)) -> dict[str, object]:
    return user

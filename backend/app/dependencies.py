from fastapi import Request

from .services.auth_service import user_for_session
from .services.errors import BusinessValidationError


SESSION_COOKIE_NAME = "jizhangben_session"


def get_authenticated_user(request: Request) -> dict[str, object]:
    token = request.cookies.get(getattr(request.app.state, "session_cookie_name", SESSION_COOKIE_NAME))
    user = user_for_session(request.app.state.database_path, token)
    if not user:
        raise BusinessValidationError("authentication_required", "请先登录")
    return user


def get_current_user_id(request: Request) -> str:
    """优先使用登录会话；兼容阶段迁移期间没有 Cookie 的本地开发请求。"""
    cookie_name = getattr(request.app.state, "session_cookie_name", SESSION_COOKIE_NAME)
    token = request.cookies.get(cookie_name)
    if token:
        user = user_for_session(request.app.state.database_path, token)
        if not user:
            raise BusinessValidationError("authentication_required", "登录状态已失效，请重新登录")
        return str(user["id"])
    if getattr(request.app.state, "allow_development_fallback", True):
        return str(request.app.state.current_user_id)
    raise BusinessValidationError("authentication_required", "请先登录")

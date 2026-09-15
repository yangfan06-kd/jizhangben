from fastapi import Request


def get_current_user_id(request: Request) -> str:
    """返回当前请求的用户；阶段 4 接入登录后只需替换这一层。"""
    return str(request.app.state.current_user_id)

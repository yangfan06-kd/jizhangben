class BusinessValidationError(ValueError):
    """带稳定代码的业务校验错误，供 API 层转换成统一错误响应。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

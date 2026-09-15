from pydantic import BaseModel, ConfigDict, Field


class BookCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    group_name: str = Field(default="", max_length=100)


class BookUpdateRequest(BookCreateRequest):
    pass


class BookResponse(BaseModel):
    id: str
    user_id: str
    name: str
    group_name: str
    created_at: str
    updated_at: str


class ApiWarning(BaseModel):
    code: str
    message: str


class BookCreateResponse(BookResponse):
    warnings: list[ApiWarning] = Field(default_factory=list)


class BookUpdateResponse(BookCreateResponse):
    pass


class BookListResponse(BaseModel):
    items: list[BookResponse]

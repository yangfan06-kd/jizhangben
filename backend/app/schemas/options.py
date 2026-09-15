from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CategoryResponse(BaseModel):
    id: str
    user_id: str
    name: str
    is_system: bool
    created_at: str
    updated_at: str


class CategoryListResponse(BaseModel):
    items: list[CategoryResponse]


class CategoryCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)


class CategoryUpdateRequest(CategoryCreateRequest):
    pass


class RecordTypeResponse(BaseModel):
    id: str
    user_id: str
    code: str
    name: str
    behavior: Literal[
        "income",
        "expense",
        "expense_reversal",
        "transfer",
        "outflow_neutral",
        "neutral",
        "deposit",
    ]
    is_system: bool
    created_at: str
    updated_at: str


class RecordTypeListResponse(BaseModel):
    items: list[RecordTypeResponse]


class RecordTypeCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    code: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,49}$")
    name: str = Field(min_length=1, max_length=100)
    behavior: Literal["income", "expense", "neutral"]


class RecordTypeUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)

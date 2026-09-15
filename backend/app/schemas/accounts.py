from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AccountCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    kind: Literal["asset", "liability"]
    initial_cents: int = Field(default=0, strict=True, ge=0)


class AccountUpdateRequest(AccountCreateRequest):
    pass


class AccountResponse(BaseModel):
    id: str
    book_id: str
    name: str
    kind: Literal["asset", "liability"]
    initial_cents: int
    created_at: str
    updated_at: str


class AccountListResponse(BaseModel):
    items: list[AccountResponse]

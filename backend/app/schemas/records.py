from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RecordCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    type_id: str = Field(min_length=1, max_length=100)
    category_id: str = Field(min_length=1, max_length=100)
    account_id: str | None = Field(default=None, min_length=1, max_length=100)
    to_account_id: str | None = Field(default=None, min_length=1, max_length=100)
    amount_cents: int = Field(strict=True, gt=0)
    occurred_on: date
    note: str = Field(default="", max_length=1000)
    deposit_direction: Literal[
        "receive",
        "return_to_other",
        "pay",
        "returned_to_me",
    ] | None = None
    deposit_target: str | None = Field(default=None, max_length=200)
    deposit_link_id: str | None = Field(default=None, min_length=1, max_length=100)
    deposit_final: bool = False


class RecordResponse(BaseModel):
    id: str
    book_id: str
    type_id: str
    category_id: str
    account_id: str | None
    to_account_id: str | None
    amount_cents: int
    occurred_on: str
    note: str
    deposit_direction: str | None
    deposit_target: str | None
    deposit_link_id: str | None
    deposit_final: bool
    created_at: str
    updated_at: str


class RecordListItem(RecordResponse):
    type_code: str
    type_name: str
    type_behavior: str
    category_name: str
    account_name: str | None
    to_account_name: str | None


class RecordListResponse(BaseModel):
    items: list[RecordListItem]


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: list[dict[str, object]] | None = None

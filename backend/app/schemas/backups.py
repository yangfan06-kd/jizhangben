from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BackupBook(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    group_name: str = Field(default="", max_length=100)


class BackupAccount(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=100)
    book_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["asset", "liability"]
    initial_cents: int = Field(strict=True, ge=0)


class BackupCategory(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    is_system: bool
    archived_at: str | None = None


class BackupRecordType(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
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
    archived_at: str | None = None


class BackupRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=100)
    book_id: str = Field(min_length=1, max_length=100)
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


class BackupPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: str
    version: int
    exported_at: str
    books: list[BackupBook]
    accounts: list[BackupAccount]
    categories: list[BackupCategory]
    record_types: list[BackupRecordType]
    records: list[BackupRecord]


class BackupCounts(BaseModel):
    books: int
    accounts: int
    categories: int
    record_types: int
    records: int


class BackupImportResponse(BaseModel):
    format: str
    version: int
    imported: BackupCounts
    id_map: dict[str, dict[str, str]]

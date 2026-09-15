from pydantic import BaseModel


class OverviewAccountResponse(BaseModel):
    id: str
    book_id: str
    name: str
    kind: str
    initial_cents: int
    balance_cents: int


class OverviewBookResponse(BaseModel):
    id: str
    user_id: str
    name: str
    group_name: str
    accounts: list[OverviewAccountResponse]
    income_cents: int
    expense_cents: int
    net_worth_cents: int


class OverviewTotalsResponse(BaseModel):
    income_cents: int
    expense_cents: int
    net_worth_cents: int


class OverviewResponse(BaseModel):
    period_from: str
    period_to: str
    items: list[OverviewBookResponse]
    totals: OverviewTotalsResponse

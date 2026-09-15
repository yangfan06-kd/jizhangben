import sqlite3
from datetime import date
from pathlib import Path

from ..database import connect_database
from .errors import BusinessValidationError


def _flow_direction(behavior: str, deposit_direction: str | None) -> str:
    if behavior in {"income", "expense_reversal"}:
        return "in"
    if behavior in {"expense", "outflow_neutral"}:
        return "out"
    if behavior == "transfer":
        return "transfer"
    if behavior == "deposit":
        if deposit_direction in {"receive", "returned_to_me"}:
            return "in"
        if deposit_direction in {"pay", "return_to_other"}:
            return "out"
    return "none"


def _apply_account_delta(
    balances: dict[str, int],
    account_kinds: dict[str, str],
    account_id: str | None,
    direction: str,
    amount_cents: int,
) -> None:
    if account_id is None or account_id not in balances:
        return
    sign = 1 if direction == "in" else -1
    if account_kinds[account_id] == "liability":
        sign *= -1
    balances[account_id] += sign * amount_cents


def _deposit_settlement_expense_income(
    record: sqlite3.Row,
    records_by_id: dict[str, sqlite3.Row],
) -> tuple[int, int]:
    if record["behavior"] != "deposit" or not record["deposit_final"]:
        return 0, 0
    original_id = record["deposit_link_id"]
    original = records_by_id.get(str(original_id)) if original_id else None
    if original is None or original["behavior"] != "deposit":
        return 0, 0

    returned_cents = 0
    for candidate in records_by_id.values():
        if candidate["deposit_link_id"] == original["id"]:
            returned_cents += int(candidate["amount_cents"])
    difference = max(0, int(original["amount_cents"]) - returned_cents)
    if original["deposit_direction"] == "pay":
        return 0, difference
    if original["deposit_direction"] == "receive":
        return difference, 0
    return 0, 0


def calculate_overview(
    database_path: str | Path,
    user_id: str,
    period_from: date | None = None,
    period_to: date | None = None,
) -> dict[str, object]:
    """按账本返回账户余额、期间收支和净资产。"""
    today = date.today()
    start = period_from or today.replace(day=1)
    end = period_to or today
    if start > end:
        raise BusinessValidationError("invalid_date_range", "开始日期不能晚于结束日期")

    with connect_database(database_path) as connection:
        books = connection.execute(
            """
            SELECT id, user_id, name, group_name
            FROM books
            WHERE user_id = ?
            ORDER BY created_at, id
            """,
            (user_id,),
        ).fetchall()
        accounts = connection.execute(
            """
            SELECT id, book_id, name, kind, initial_cents
            FROM accounts
            WHERE book_id IN (SELECT id FROM books WHERE user_id = ?)
            ORDER BY book_id, rowid
            """,
            (user_id,),
        ).fetchall()
        records = connection.execute(
            """
            SELECT
                records.id,
                records.book_id,
                records.account_id,
                records.to_account_id,
                records.amount_cents,
                records.occurred_on,
                records.deposit_direction,
                records.deposit_link_id,
                records.deposit_final,
                record_types.behavior
            FROM records
            JOIN record_types ON record_types.id = records.type_id
            WHERE records.book_id IN (SELECT id FROM books WHERE user_id = ?)
            ORDER BY records.book_id, records.occurred_on, records.rowid
            """,
            (user_id,),
        ).fetchall()

    accounts_by_book: dict[str, list[sqlite3.Row]] = {}
    for account in accounts:
        accounts_by_book.setdefault(str(account["book_id"]), []).append(account)
    records_by_book: dict[str, list[sqlite3.Row]] = {}
    for record in records:
        records_by_book.setdefault(str(record["book_id"]), []).append(record)

    items: list[dict[str, object]] = []
    total_income = 0
    total_expense = 0
    total_net_worth = 0
    for book in books:
        book_id = str(book["id"])
        book_accounts = accounts_by_book.get(book_id, [])
        book_records = records_by_book.get(book_id, [])
        balances = {str(account["id"]): int(account["initial_cents"]) for account in book_accounts}
        account_kinds = {str(account["id"]): str(account["kind"]) for account in book_accounts}
        records_by_id = {str(record["id"]): record for record in book_records}
        income_cents = 0
        expense_cents = 0
        for record in book_records:
            amount_cents = int(record["amount_cents"])
            direction = _flow_direction(str(record["behavior"]), record["deposit_direction"])
            if direction == "transfer":
                source_id = record["account_id"]
                target_id = record["to_account_id"]
                if source_id in balances and target_id in balances:
                    _apply_account_delta(balances, account_kinds, source_id, "out", amount_cents)
                    _apply_account_delta(balances, account_kinds, target_id, "in", amount_cents)
            elif direction in {"in", "out"}:
                _apply_account_delta(balances, account_kinds, record["account_id"], direction, amount_cents)

            occurred_on = date.fromisoformat(str(record["occurred_on"]))
            if not (start <= occurred_on <= end):
                continue
            behavior = str(record["behavior"])
            if behavior == "income":
                income_cents += amount_cents
            elif behavior == "expense":
                expense_cents += amount_cents
            elif behavior == "expense_reversal":
                expense_cents -= amount_cents
            elif behavior == "deposit":
                settlement_income, settlement_expense = _deposit_settlement_expense_income(
                    record,
                    records_by_id,
                )
                income_cents += settlement_income
                expense_cents += settlement_expense

        net_worth_cents = sum(
            balances[str(account["id"])]
            if account["kind"] == "asset"
            else -balances[str(account["id"])]
            for account in book_accounts
        )
        account_items = [
            {
                "id": str(account["id"]),
                "book_id": book_id,
                "name": str(account["name"]),
                "kind": str(account["kind"]),
                "initial_cents": int(account["initial_cents"]),
                "balance_cents": balances[str(account["id"])],
            }
            for account in book_accounts
        ]
        items.append(
            {
                "id": book_id,
                "user_id": str(book["user_id"]),
                "name": str(book["name"]),
                "group_name": str(book["group_name"]),
                "accounts": account_items,
                "income_cents": income_cents,
                "expense_cents": expense_cents,
                "net_worth_cents": net_worth_cents,
            }
        )
        total_income += income_cents
        total_expense += expense_cents
        total_net_worth += net_worth_cents

    return {
        "period_from": start.isoformat(),
        "period_to": end.isoformat(),
        "items": items,
        "totals": {
            "income_cents": total_income,
            "expense_cents": total_expense,
            "net_worth_cents": total_net_worth,
        },
    }

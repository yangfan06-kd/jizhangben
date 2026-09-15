from pathlib import Path
from uuid import uuid4

from ..database import connect_database
from .errors import BusinessValidationError


def _require_owned_book(connection, user_id: str, book_id: str) -> None:
    book = connection.execute(
        "SELECT 1 FROM books WHERE id = ? AND user_id = ?",
        (book_id, user_id),
    ).fetchone()
    if book is None:
        raise BusinessValidationError("book_not_found", "账本不存在")


def list_accounts(
    database_path: str | Path,
    user_id: str,
    book_id: str,
) -> list[dict[str, object]]:
    """返回当前用户在指定账本中的账户。"""
    with connect_database(database_path) as connection:
        _require_owned_book(connection, user_id, book_id)
        rows = connection.execute(
            """
            SELECT id, book_id, name, kind, initial_cents, created_at, updated_at
            FROM accounts
            WHERE book_id = ?
            ORDER BY rowid
            """,
            (book_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_account(
    database_path: str | Path,
    user_id: str,
    book_id: str,
    name: str,
    kind: str,
    initial_cents: int,
) -> dict[str, object]:
    """在当前用户拥有的账本中创建账户。"""
    with connect_database(database_path) as connection:
        _require_owned_book(connection, user_id, book_id)
        account_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO accounts (id, book_id, name, kind, initial_cents)
            VALUES (?, ?, ?, ?, ?)
            """,
            (account_id, book_id, name, kind, initial_cents),
        )
        saved = connection.execute(
            """
            SELECT id, book_id, name, kind, initial_cents, created_at, updated_at
            FROM accounts
            WHERE id = ?
            """,
            (account_id,),
        ).fetchone()
    return dict(saved)


def update_account(
    database_path: str | Path,
    user_id: str,
    book_id: str,
    account_id: str,
    name: str,
    kind: str,
    initial_cents: int,
) -> dict[str, object]:
    with connect_database(database_path) as connection:
        _require_owned_book(connection, user_id, book_id)
        exists = connection.execute(
            "SELECT 1 FROM accounts WHERE id = ? AND book_id = ?",
            (account_id, book_id),
        ).fetchone()
        if exists is None:
            raise BusinessValidationError("account_not_found", "账户不存在")
        connection.execute(
            """
            UPDATE accounts
            SET name = ?, kind = ?, initial_cents = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND book_id = ?
            """,
            (name, kind, initial_cents, account_id, book_id),
        )
        saved = connection.execute(
            "SELECT id, book_id, name, kind, initial_cents, created_at, updated_at FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
    return dict(saved)


def delete_account(
    database_path: str | Path,
    user_id: str,
    book_id: str,
    account_id: str,
) -> None:
    with connect_database(database_path) as connection:
        _require_owned_book(connection, user_id, book_id)
        exists = connection.execute(
            "SELECT 1 FROM accounts WHERE id = ? AND book_id = ?",
            (account_id, book_id),
        ).fetchone()
        if exists is None:
            raise BusinessValidationError("account_not_found", "账户不存在")
        connection.execute(
            "DELETE FROM accounts WHERE id = ? AND book_id = ?",
            (account_id, book_id),
        )

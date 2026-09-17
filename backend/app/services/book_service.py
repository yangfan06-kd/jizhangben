from pathlib import Path
from uuid import uuid4

from ..database import connect_database
from .errors import BusinessValidationError
from .local_backup_migration import DEFAULT_ACCOUNTS


def _ensure_default_accounts(connection, book_id: str) -> None:
    """为新账本补齐默认账户；已有同名账户时保留原数据。"""
    existing = {
        str(row["name"]).casefold()
        for row in connection.execute(
            "SELECT name FROM accounts WHERE book_id = ?",
            (book_id,),
        )
    }
    for _, name, kind in DEFAULT_ACCOUNTS:
        if name.casefold() in existing:
            continue
        connection.execute(
            """
            INSERT INTO accounts (id, book_id, name, kind, initial_cents)
            VALUES (?, ?, ?, ?, 0)
            """,
            (str(uuid4()), book_id, name, kind),
        )
        existing.add(name.casefold())


def list_books(database_path: str | Path, user_id: str) -> list[dict[str, object]]:
    """按创建顺序返回当前用户的账本。"""
    with connect_database(database_path) as connection:
        rows = connection.execute(
            """
            SELECT id, user_id, name, group_name, created_at, updated_at
            FROM books
            WHERE user_id = ?
            ORDER BY created_at, id
            """,
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_book(
    database_path: str | Path,
    user_id: str,
    name: str,
    group_name: str,
) -> tuple[dict[str, object], bool]:
    """创建账本，并告知调用方是否已有同名账本。"""
    with connect_database(database_path) as connection:
        duplicate_name = connection.execute(
            """
            SELECT 1 FROM books
            WHERE user_id = ? AND name = ? COLLATE NOCASE
            LIMIT 1
            """,
            (user_id, name),
        ).fetchone() is not None
        book_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO books (id, user_id, name, group_name)
            VALUES (?, ?, ?, ?)
            """,
            (book_id, user_id, name, group_name),
        )
        _ensure_default_accounts(connection, book_id)
        saved = connection.execute(
            """
            SELECT id, user_id, name, group_name, created_at, updated_at
            FROM books WHERE id = ?
            """,
            (book_id,),
        ).fetchone()
    return dict(saved), duplicate_name


def update_book(
    database_path: str | Path,
    user_id: str,
    book_id: str,
    name: str,
    group_name: str,
) -> tuple[dict[str, object], bool]:
    """修改当前用户的账本，并告知调用方是否与另一账本同名。"""
    with connect_database(database_path) as connection:
        exists = connection.execute(
            "SELECT 1 FROM books WHERE id = ? AND user_id = ?",
            (book_id, user_id),
        ).fetchone()
        if exists is None:
            raise BusinessValidationError("book_not_found", "账本不存在")
        duplicate_name = connection.execute(
            """
            SELECT 1 FROM books
            WHERE user_id = ? AND name = ? COLLATE NOCASE AND id <> ?
            LIMIT 1
            """,
            (user_id, name, book_id),
        ).fetchone() is not None
        connection.execute(
            """
            UPDATE books
            SET name = ?, group_name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (name, group_name, book_id),
        )
        saved = connection.execute(
            """
            SELECT id, user_id, name, group_name, created_at, updated_at
            FROM books WHERE id = ?
            """,
            (book_id,),
        ).fetchone()
    return dict(saved), duplicate_name


def delete_book(database_path: str | Path, user_id: str, book_id: str) -> None:
    """删除当前用户的账本，并由数据库级联删除账本内账户和账目。"""
    with connect_database(database_path) as connection:
        exists = connection.execute(
            "SELECT 1 FROM books WHERE id = ? AND user_id = ?",
            (book_id, user_id),
        ).fetchone()
        if exists is None:
            raise BusinessValidationError("book_not_found", "账本不存在")
        connection.execute("DELETE FROM books WHERE id = ? AND user_id = ?", (book_id, user_id))

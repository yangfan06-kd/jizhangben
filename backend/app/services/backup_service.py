import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from ..database import connect_database
from ..schemas.backups import BackupPayload
from .errors import BusinessValidationError


BACKUP_FORMAT = "jizhangben-server-backup"
BACKUP_VERSION = 1
ACCOUNT_BEHAVIORS = {
    "income",
    "expense",
    "expense_reversal",
    "outflow_neutral",
    "deposit",
}
DEPOSIT_RETURN_DIRECTIONS = {
    "return_to_other": "receive",
    "returned_to_me": "pay",
}


def _backup_error(message: str) -> None:
    raise BusinessValidationError("backup_invalid", message)


def _unique_ids(items, label: str) -> dict[str, object]:
    result: dict[str, object] = {}
    for item in items:
        source_id = str(item.id)
        if source_id in result:
            _backup_error(f"备份中的{label} ID 重复")
        result[source_id] = item
    return result


def _check_active_unique(items, field: str, label: str) -> None:
    seen: set[str] = set()
    for item in items:
        if item.archived_at is not None:
            continue
        value = str(getattr(item, field)).casefold()
        if value in seen:
            _backup_error(f"备份中的有效{label}名称重复")
        seen.add(value)


def _validate_payload(payload: BackupPayload) -> dict[str, dict[str, object]]:
    if payload.format != BACKUP_FORMAT:
        _backup_error("备份格式不受支持")
    if payload.version != BACKUP_VERSION:
        _backup_error("备份版本不受支持")

    books = _unique_ids(payload.books, "账本")
    accounts = _unique_ids(payload.accounts, "账户")
    categories = _unique_ids(payload.categories, "类别")
    record_types = _unique_ids(payload.record_types, "记账类型")
    records = _unique_ids(payload.records, "账目")
    _check_active_unique(payload.categories, "name", "类别")
    _check_active_unique(payload.record_types, "name", "记账类型")

    type_codes: set[str] = set()
    for record_type in payload.record_types:
        code = record_type.code.casefold()
        if code in type_codes:
            _backup_error("备份中的记账类型代码重复")
        type_codes.add(code)

    for account in payload.accounts:
        if account.book_id not in books:
            _backup_error("账户引用了不存在的账本")

    for record in payload.records:
        if record.book_id not in books:
            _backup_error("账目引用了不存在的账本")
        if record.type_id not in record_types:
            _backup_error("账目引用了不存在的记账类型")
        if record.category_id not in categories:
            _backup_error("账目引用了不存在的类别")

        behavior = record_types[record.type_id].behavior
        source = accounts.get(record.account_id) if record.account_id else None
        target = accounts.get(record.to_account_id) if record.to_account_id else None
        if source is not None and source.book_id != record.book_id:
            _backup_error("账目转出账户不属于账本")
        if target is not None and target.book_id != record.book_id:
            _backup_error("账目转入账户不属于账本")
        if behavior == "transfer":
            if source is None or target is None or source.id == target.id:
                _backup_error("转账必须有两个不同的同账本账户")
        elif behavior in ACCOUNT_BEHAVIORS:
            if source is None or target is not None:
                _backup_error("该记账类型的账户字段不完整")
        elif source is not None or target is not None:
            _backup_error("中性记账类型不能引用账户")

        if behavior != "deposit":
            if any(
                (
                    record.deposit_direction is not None,
                    record.deposit_target is not None,
                    record.deposit_link_id is not None,
                    record.deposit_final,
                )
            ):
                _backup_error("非押金账目不能包含押金字段")
            continue
        if record.deposit_direction is None or not (record.deposit_target or "").strip():
            _backup_error("押金账目缺少方向或对象")
        if record.deposit_direction in {"receive", "pay"}:
            if record.deposit_link_id is not None or record.deposit_final:
                _backup_error("原押金不能关联记录或标记最终结算")
        else:
            if record.deposit_link_id not in records:
                _backup_error("退回押金关联了不存在的原押金")
            original = records[record.deposit_link_id]
            original_type = record_types[original.type_id]
            if original.book_id != record.book_id:
                _backup_error("退回押金不能关联其他账本的原押金")
            if original_type.behavior != "deposit" or original.deposit_direction != DEPOSIT_RETURN_DIRECTIONS[record.deposit_direction]:
                _backup_error("退回押金与原押金方向不匹配")

    return {
        "books": books,
        "accounts": accounts,
        "categories": categories,
        "record_types": record_types,
        "records": records,
    }


def export_backup(database_path: str | Path, user_id: str) -> dict[str, object]:
    """导出当前用户的完整服务端备份，不包含认证凭据。"""
    with connect_database(database_path) as connection:
        books = connection.execute(
            "SELECT id, name, group_name FROM books WHERE user_id = ? ORDER BY created_at, id",
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
        categories = connection.execute(
            """
            SELECT id, name, is_system, archived_at
            FROM categories WHERE user_id = ? ORDER BY is_system DESC, name COLLATE NOCASE, id
            """,
            (user_id,),
        ).fetchall()
        record_types = connection.execute(
            """
            SELECT id, code, name, behavior, is_system, archived_at
            FROM record_types WHERE user_id = ? ORDER BY is_system DESC, name COLLATE NOCASE, id
            """,
            (user_id,),
        ).fetchall()
        records = connection.execute(
            """
            SELECT
                records.id, records.book_id, records.type_id, records.category_id,
                records.account_id, records.to_account_id, records.amount_cents,
                records.occurred_on, records.note, records.deposit_direction,
                records.deposit_target, records.deposit_link_id, records.deposit_final
            FROM records
            JOIN books ON books.id = records.book_id
            WHERE books.user_id = ?
            ORDER BY records.book_id, records.occurred_on, records.rowid
            """,
            (user_id,),
        ).fetchall()

    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "books": [dict(book) for book in books],
        "accounts": [dict(account) for account in accounts],
        "categories": [
            {**dict(category), "is_system": bool(category["is_system"])}
            for category in categories
        ],
        "record_types": [
            {**dict(record_type), "is_system": bool(record_type["is_system"])}
            for record_type in record_types
        ],
        "records": [
            {**dict(record), "deposit_final": bool(record["deposit_final"])}
            for record in records
        ],
    }


def import_backup(
    database_path: str | Path,
    user_id: str,
    payload: BackupPayload,
) -> dict[str, object]:
    """校验并替换当前用户数据，所有 ID 和关联在同一事务中重建。"""
    grouped = _validate_payload(payload)
    id_map = {
        label: {source_id: str(uuid4()) for source_id in items}
        for label, items in grouped.items()
    }

    with connect_database(database_path) as connection:
        current_books = [
            row["id"]
            for row in connection.execute(
                "SELECT id FROM books WHERE user_id = ?", (user_id,)
            ).fetchall()
        ]
        if current_books:
            placeholders = ", ".join("?" for _ in current_books)
            connection.execute(
                f"DELETE FROM records WHERE book_id IN ({placeholders})",
                current_books,
            )
            connection.execute(
                f"DELETE FROM accounts WHERE book_id IN ({placeholders})",
                current_books,
            )
            connection.execute(
                f"DELETE FROM books WHERE id IN ({placeholders}) AND user_id = ?",
                [*current_books, user_id],
            )
        connection.execute("DELETE FROM categories WHERE user_id = ?", (user_id,))
        connection.execute("DELETE FROM record_types WHERE user_id = ?", (user_id,))

        for book in payload.books:
            connection.execute(
                "INSERT INTO books (id, user_id, name, group_name) VALUES (?, ?, ?, ?)",
                (id_map["books"][book.id], user_id, book.name, book.group_name),
            )
        for account in payload.accounts:
            connection.execute(
                """
                INSERT INTO accounts (id, book_id, name, kind, initial_cents)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    id_map["accounts"][account.id],
                    id_map["books"][account.book_id],
                    account.name,
                    account.kind,
                    account.initial_cents,
                ),
            )
        for category in payload.categories:
            connection.execute(
                """
                INSERT INTO categories (id, user_id, name, is_system, archived_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    id_map["categories"][category.id],
                    user_id,
                    category.name,
                    int(category.is_system),
                    category.archived_at,
                ),
            )
        for record_type in payload.record_types:
            connection.execute(
                """
                INSERT INTO record_types
                    (id, user_id, code, name, behavior, is_system, archived_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    id_map["record_types"][record_type.id],
                    user_id,
                    record_type.code,
                    record_type.name,
                    record_type.behavior,
                    int(record_type.is_system),
                    record_type.archived_at,
                ),
            )

        pending = list(payload.records)
        inserted_records: set[str] = set()
        while pending:
            remaining = []
            progressed = False
            for record in pending:
                if record.deposit_link_id is not None and record.deposit_link_id not in inserted_records:
                    remaining.append(record)
                    continue
                connection.execute(
                    """
                    INSERT INTO records (
                        id, book_id, type_id, category_id, account_id, to_account_id,
                        amount_cents, occurred_on, note, deposit_direction,
                        deposit_target, deposit_link_id, deposit_final
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        id_map["records"][record.id],
                        id_map["books"][record.book_id],
                        id_map["record_types"][record.type_id],
                        id_map["categories"][record.category_id],
                        id_map["accounts"].get(record.account_id) if record.account_id else None,
                        id_map["accounts"].get(record.to_account_id) if record.to_account_id else None,
                        record.amount_cents,
                        record.occurred_on.isoformat(),
                        record.note,
                        record.deposit_direction,
                        record.deposit_target,
                        id_map["records"].get(record.deposit_link_id) if record.deposit_link_id else None,
                        int(record.deposit_final),
                    ),
                )
                inserted_records.add(record.id)
                progressed = True
            if not progressed:
                _backup_error("押金关联存在循环或无法重建")
            pending = remaining

    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "imported": {label: len(items) for label, items in grouped.items()},
        "id_map": id_map,
    }

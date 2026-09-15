import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from ..database import connect_database
from .errors import BusinessValidationError


ACCOUNT_BEHAVIORS = {
    "income",
    "expense",
    "expense_reversal",
    "outflow_neutral",
    "deposit",
}

DEPOSIT_ORIGINAL_DIRECTIONS = {"receive", "pay"}
DEPOSIT_RETURN_DIRECTIONS = {
    "return_to_other": "receive",
    "returned_to_me": "pay",
}


class RecordValidationError(BusinessValidationError):
    """账目创建期间的业务校验错误。"""


@dataclass(frozen=True)
class NewRecord:
    book_id: str
    type_id: str
    category_id: str
    amount_cents: int
    occurred_on: str
    account_id: str | None = None
    to_account_id: str | None = None
    note: str = ""
    deposit_direction: str | None = None
    deposit_target: str | None = None
    deposit_link_id: str | None = None
    deposit_final: bool = False
    record_id: str = field(default_factory=lambda: str(uuid4()))


def _raise(code: str, message: str) -> None:
    raise RecordValidationError(code, message)


def _account_belongs_to_book(
    connection: sqlite3.Connection,
    account_id: str,
    book_id: str,
) -> bool:
    return connection.execute(
        "SELECT 1 FROM accounts WHERE id = ? AND book_id = ?",
        (account_id, book_id),
    ).fetchone() is not None


def _validate_deposit(
    connection: sqlite3.Connection,
    record: NewRecord,
    behavior: str,
) -> None:
    has_deposit_fields = any(
        (
            record.deposit_direction is not None,
            record.deposit_target is not None,
            record.deposit_link_id is not None,
            record.deposit_final,
        )
    )

    if behavior != "deposit":
        if has_deposit_fields:
            _raise("deposit_fields_not_allowed", "只有押金类型可以填写押金信息")
        return

    direction = record.deposit_direction
    if direction is None:
        _raise("deposit_direction_required", "押金账目必须选择方向")
    if not record.deposit_target or not record.deposit_target.strip():
        _raise("deposit_target_required", "押金账目必须填写对象")

    if direction in DEPOSIT_ORIGINAL_DIRECTIONS:
        if record.deposit_link_id is not None or record.deposit_final:
            _raise("original_deposit_cannot_settle", "原押金不能关联自身或标记最终结算")
        return

    expected_original_direction = DEPOSIT_RETURN_DIRECTIONS.get(direction)
    if expected_original_direction is None:
        _raise("deposit_direction_invalid", "押金方向无效")
    if record.deposit_link_id is None:
        _raise("deposit_link_required", "退回押金必须关联原押金")

    original = connection.execute(
        """
        SELECT records.deposit_direction
        FROM records
        JOIN record_types ON record_types.id = records.type_id
        WHERE records.id = ?
          AND records.book_id = ?
          AND record_types.behavior = 'deposit'
        """,
        (record.deposit_link_id, record.book_id),
    ).fetchone()
    if original is None:
        _raise("deposit_link_not_found", "当前账本中不存在对应的原押金")
    if original["deposit_direction"] != expected_original_direction:
        _raise("deposit_direction_mismatch", "退回方向与原押金方向不匹配")


def validate_new_record(
    connection: sqlite3.Connection,
    user_id: str,
    record: NewRecord,
) -> str:
    """校验所有需要查询其他表或其他账目的创建规则，并返回类型行为。"""
    book = connection.execute(
        "SELECT 1 FROM books WHERE id = ? AND user_id = ?",
        (record.book_id, user_id),
    ).fetchone()
    if book is None:
        _raise("book_not_found", "账本不存在")

    record_type = connection.execute(
        """
        SELECT behavior FROM record_types
        WHERE id = ? AND user_id = ? AND archived_at IS NULL
        """,
        (record.type_id, user_id),
    ).fetchone()
    if record_type is None:
        _raise("record_type_not_available", "记账类型不存在、已归档或不属于当前用户")
    behavior = str(record_type["behavior"])

    category = connection.execute(
        """
        SELECT 1 FROM categories
        WHERE id = ? AND user_id = ? AND archived_at IS NULL
        """,
        (record.category_id, user_id),
    ).fetchone()
    if category is None:
        _raise("category_not_available", "类别不存在、已归档或不属于当前用户")

    if behavior == "transfer":
        if record.account_id is None:
            _raise("account_required", "转账必须选择转出账户")
        if record.to_account_id is None:
            _raise("to_account_required", "转账必须选择转入账户")
        if record.account_id == record.to_account_id:
            _raise("same_account", "转出账户和转入账户不能相同")
    elif behavior in ACCOUNT_BEHAVIORS:
        if record.account_id is None:
            _raise("account_required", "该记账类型必须选择账户")
        if record.to_account_id is not None:
            _raise("to_account_not_allowed", "只有转账可以选择转入账户")
    else:
        if record.account_id is not None or record.to_account_id is not None:
            _raise("account_not_allowed", "该中性类型不使用账户")

    if record.account_id is not None and not _account_belongs_to_book(
        connection, record.account_id, record.book_id
    ):
        _raise("account_not_in_book", "转出账户不存在或不属于当前账本")
    if record.to_account_id is not None and not _account_belongs_to_book(
        connection, record.to_account_id, record.book_id
    ):
        _raise("to_account_not_in_book", "转入账户不存在或不属于当前账本")

    _validate_deposit(connection, record, behavior)
    return behavior


def create_record(
    database_path: str | Path,
    user_id: str,
    record: NewRecord,
) -> dict[str, object]:
    """在一个事务中校验并创建账目，失败时不留下部分写入。"""
    with connect_database(database_path) as connection:
        validate_new_record(connection, user_id, record)
        connection.execute(
            """
            INSERT INTO records (
                id, book_id, type_id, category_id, account_id, to_account_id,
                amount_cents, occurred_on, note, deposit_direction,
                deposit_target, deposit_link_id, deposit_final
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.record_id,
                record.book_id,
                record.type_id,
                record.category_id,
                record.account_id,
                record.to_account_id,
                record.amount_cents,
                record.occurred_on,
                record.note,
                record.deposit_direction,
                record.deposit_target,
                record.deposit_link_id,
                int(record.deposit_final),
            ),
        )
        saved = connection.execute(
            "SELECT * FROM records WHERE id = ?",
            (record.record_id,),
        ).fetchone()

    return dict(saved)


def list_records(
    database_path: str | Path,
    user_id: str,
    book_id: str,
    from_date: str | None = None,
    to_date: str | None = None,
    account_id: str | None = None,
    category_id: str | None = None,
    query: str | None = None,
) -> list[dict[str, object]]:
    """读取当前用户账本中的账目，并按常用条件筛选。"""
    if from_date is not None and to_date is not None and from_date > to_date:
        raise BusinessValidationError("invalid_date_range", "开始日期不能晚于结束日期")

    conditions = ["records.book_id = ?"]
    parameters: list[object] = [book_id]
    if from_date is not None:
        conditions.append("records.occurred_on >= ?")
        parameters.append(from_date)
    if to_date is not None:
        conditions.append("records.occurred_on <= ?")
        parameters.append(to_date)
    if account_id is not None:
        conditions.append(
            "(records.account_id = ? OR records.to_account_id = ?)"
        )
        parameters.extend((account_id, account_id))
    if category_id is not None:
        conditions.append("records.category_id = ?")
        parameters.append(category_id)
    if query and query.strip():
        keyword = f"%{query.strip()}%"
        conditions.append(
            "(records.note LIKE ? OR categories.name LIKE ? OR record_types.name LIKE ?)"
        )
        parameters.extend((keyword, keyword, keyword))

    with connect_database(database_path) as connection:
        book = connection.execute(
            "SELECT 1 FROM books WHERE id = ? AND user_id = ?",
            (book_id, user_id),
        ).fetchone()
        if book is None:
            raise BusinessValidationError("book_not_found", "账本不存在")

        rows = connection.execute(
            f"""
            SELECT
                records.id,
                records.book_id,
                records.type_id,
                records.category_id,
                records.account_id,
                records.to_account_id,
                records.amount_cents,
                records.occurred_on,
                records.note,
                records.deposit_direction,
                records.deposit_target,
                records.deposit_link_id,
                records.deposit_final,
                records.created_at,
                records.updated_at,
                record_types.code AS type_code,
                record_types.name AS type_name,
                record_types.behavior AS type_behavior,
                categories.name AS category_name,
                source_account.name AS account_name,
                target_account.name AS to_account_name
            FROM records
            JOIN record_types ON record_types.id = records.type_id
            JOIN categories ON categories.id = records.category_id
            LEFT JOIN accounts AS source_account ON source_account.id = records.account_id
            LEFT JOIN accounts AS target_account ON target_account.id = records.to_account_id
            WHERE {' AND '.join(conditions)}
            ORDER BY records.occurred_on DESC, records.rowid DESC
            """,
            parameters,
        ).fetchall()
    return [dict(row) for row in rows]


def delete_record(
    database_path: str | Path,
    user_id: str,
    book_id: str,
    record_id: str,
) -> None:
    """删除当前用户账本中的普通账目，保留押金关联的对账完整性。"""
    with connect_database(database_path) as connection:
        book = connection.execute(
            "SELECT 1 FROM books WHERE id = ? AND user_id = ?",
            (book_id, user_id),
        ).fetchone()
        if book is None:
            raise BusinessValidationError("book_not_found", "账本不存在")

        record = connection.execute(
            "SELECT 1 FROM records WHERE id = ? AND book_id = ?",
            (record_id, book_id),
        ).fetchone()
        if record is None:
            raise BusinessValidationError("record_not_found", "账目不存在")

        linked_record = connection.execute(
            "SELECT 1 FROM records WHERE deposit_link_id = ? LIMIT 1",
            (record_id,),
        ).fetchone()
        if linked_record is not None:
            raise BusinessValidationError(
                "deposit_record_in_use",
                "该原押金已有关联退回记录，不能直接删除",
            )

        connection.execute(
            "DELETE FROM records WHERE id = ? AND book_id = ?",
            (record_id, book_id),
        )


def update_record(
    database_path: str | Path,
    user_id: str,
    record: NewRecord,
) -> dict[str, object]:
    """完整替换一条未参与押金结算链路的账目。"""
    with connect_database(database_path) as connection:
        book = connection.execute(
            "SELECT 1 FROM books WHERE id = ? AND user_id = ?",
            (record.book_id, user_id),
        ).fetchone()
        if book is None:
            _raise("book_not_found", "账本不存在")

        existing = connection.execute(
            """
            SELECT deposit_link_id FROM records
            WHERE id = ? AND book_id = ?
            """,
            (record.record_id, record.book_id),
        ).fetchone()
        if existing is None:
            _raise("record_not_found", "账目不存在")

        linked_record = connection.execute(
            "SELECT 1 FROM records WHERE deposit_link_id = ? LIMIT 1",
            (record.record_id,),
        ).fetchone()
        if linked_record is not None:
            _raise(
                "deposit_record_in_use",
                "该原押金已有关联退回记录，不能修改",
            )
        if existing["deposit_link_id"] is not None:
            _raise(
                "deposit_settlement_locked",
                "已关联原押金的退回记录不能修改",
            )
        if record.deposit_link_id == record.record_id:
            _raise("deposit_link_cannot_reference_self", "押金不能关联自身")

        validate_new_record(connection, user_id, record)
        connection.execute(
            """
            UPDATE records
            SET
                type_id = ?,
                category_id = ?,
                account_id = ?,
                to_account_id = ?,
                amount_cents = ?,
                occurred_on = ?,
                note = ?,
                deposit_direction = ?,
                deposit_target = ?,
                deposit_link_id = ?,
                deposit_final = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND book_id = ?
            """,
            (
                record.type_id,
                record.category_id,
                record.account_id,
                record.to_account_id,
                record.amount_cents,
                record.occurred_on,
                record.note,
                record.deposit_direction,
                record.deposit_target,
                record.deposit_link_id,
                int(record.deposit_final),
                record.record_id,
                record.book_id,
            ),
        )
        saved = connection.execute(
            "SELECT * FROM records WHERE id = ?",
            (record.record_id,),
        ).fetchone()
    return dict(saved)

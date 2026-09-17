from pathlib import Path
from uuid import uuid4

from ..database import connect_database
from .errors import BusinessValidationError
from .local_backup_migration import BUILTIN_CATEGORIES, BUILTIN_TYPES


def ensure_system_options(
    database_path: str | Path,
    user_id: str,
) -> None:
    """幂等补齐当前用户的系统类别和记账类型。

    老用户可能在选项表建立前就已注册，新用户也不应因为只创建了账号
    而拿不到内置选项。按名称和代码检查后再插入，保留已有自定义数据。
    """
    with connect_database(database_path) as connection:
        existing_categories = {
            str(row["name"]).casefold()
            for row in connection.execute(
                """
                SELECT name FROM categories
                WHERE user_id = ? AND archived_at IS NULL
                """,
                (user_id,),
            )
        }
        for name in BUILTIN_CATEGORIES:
            if name.casefold() in existing_categories:
                continue
            connection.execute(
                """
                INSERT INTO categories (id, user_id, name, is_system)
                VALUES (?, ?, ?, 1)
                """,
                (str(uuid4()), user_id, name),
            )
            existing_categories.add(name.casefold())

        existing_names = {
            str(row["name"]).casefold()
            for row in connection.execute(
                """
                SELECT name FROM record_types
                WHERE user_id = ? AND archived_at IS NULL
                """,
                (user_id,),
            )
        }
        existing_codes = {
            str(row["code"]).casefold()
            for row in connection.execute(
                "SELECT code FROM record_types WHERE user_id = ?",
                (user_id,),
            )
        }
        for name, code, behavior in BUILTIN_TYPES:
            if name.casefold() in existing_names or code.casefold() in existing_codes:
                continue
            connection.execute(
                """
                INSERT INTO record_types
                    (id, user_id, code, name, behavior, is_system)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (str(uuid4()), user_id, code, name, behavior),
            )
            existing_names.add(name.casefold())
            existing_codes.add(code.casefold())


def list_categories(
    database_path: str | Path,
    user_id: str,
) -> list[dict[str, object]]:
    """返回当前用户可用于新建账目的未归档类别。"""
    with connect_database(database_path) as connection:
        rows = connection.execute(
            """
            SELECT id, user_id, name, is_system, created_at, updated_at
            FROM categories
            WHERE user_id = ? AND archived_at IS NULL
            ORDER BY is_system DESC, name COLLATE NOCASE, id
            """,
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_record_types(
    database_path: str | Path,
    user_id: str,
) -> list[dict[str, object]]:
    """返回当前用户可用于新建账目的未归档记账类型。"""
    with connect_database(database_path) as connection:
        rows = connection.execute(
            """
            SELECT id, user_id, code, name, behavior, is_system, created_at, updated_at
            FROM record_types
            WHERE user_id = ? AND archived_at IS NULL
            ORDER BY is_system DESC, name COLLATE NOCASE, id
            """,
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_category(
    database_path: str | Path,
    user_id: str,
    name: str,
) -> dict[str, object]:
    """为当前用户创建自定义类别。"""
    with connect_database(database_path) as connection:
        duplicate = connection.execute(
            """
            SELECT 1 FROM categories
            WHERE user_id = ? AND name = ? COLLATE NOCASE AND archived_at IS NULL
            LIMIT 1
            """,
            (user_id, name),
        ).fetchone()
        if duplicate is not None:
            raise BusinessValidationError("category_name_conflict", "当前用户已有同名有效类别")

        category_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO categories (id, user_id, name, is_system)
            VALUES (?, ?, ?, 0)
            """,
            (category_id, user_id, name),
        )
        saved = connection.execute(
            """
            SELECT id, user_id, name, is_system, created_at, updated_at
            FROM categories WHERE id = ?
            """,
            (category_id,),
        ).fetchone()
    return dict(saved)


def create_record_type(
    database_path: str | Path,
    user_id: str,
    code: str,
    name: str,
    behavior: str,
) -> dict[str, object]:
    """为当前用户创建收入、支出或中性自定义记账类型。"""
    with connect_database(database_path) as connection:
        duplicate_code = connection.execute(
            """
            SELECT 1 FROM record_types
            WHERE user_id = ? AND code = ? COLLATE NOCASE
            LIMIT 1
            """,
            (user_id, code),
        ).fetchone()
        if duplicate_code is not None:
            raise BusinessValidationError(
                "record_type_code_conflict",
                "当前用户已有相同记账类型代码",
            )

        duplicate_name = connection.execute(
            """
            SELECT 1 FROM record_types
            WHERE user_id = ? AND name = ? COLLATE NOCASE AND archived_at IS NULL
            LIMIT 1
            """,
            (user_id, name),
        ).fetchone()
        if duplicate_name is not None:
            raise BusinessValidationError(
                "record_type_name_conflict",
                "当前用户已有同名有效记账类型",
            )

        type_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO record_types (id, user_id, code, name, behavior, is_system)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (type_id, user_id, code, name, behavior),
        )
        saved = connection.execute(
            """
            SELECT id, user_id, code, name, behavior, is_system, created_at, updated_at
            FROM record_types WHERE id = ?
            """,
            (type_id,),
        ).fetchone()
    return dict(saved)


def update_category(
    database_path: str | Path,
    user_id: str,
    category_id: str,
    name: str,
) -> dict[str, object]:
    """修改当前用户的自定义有效类别名称。"""
    with connect_database(database_path) as connection:
        current = connection.execute(
            """
            SELECT id, is_system, archived_at
            FROM categories
            WHERE id = ? AND user_id = ?
            """,
            (category_id, user_id),
        ).fetchone()
        if current is None:
            raise BusinessValidationError("category_not_found", "类别不存在")
        if current["is_system"]:
            raise BusinessValidationError("system_option_immutable", "系统内置选项不能修改")
        if current["archived_at"] is not None:
            raise BusinessValidationError("category_archived", "类别已经归档")

        duplicate = connection.execute(
            """
            SELECT 1 FROM categories
            WHERE user_id = ? AND name = ? COLLATE NOCASE
              AND archived_at IS NULL AND id <> ?
            LIMIT 1
            """,
            (user_id, name, category_id),
        ).fetchone()
        if duplicate is not None:
            raise BusinessValidationError("category_name_conflict", "当前用户已有同名有效类别")

        connection.execute(
            """
            UPDATE categories
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (name, category_id, user_id),
        )
        saved = connection.execute(
            """
            SELECT id, user_id, name, is_system, created_at, updated_at
            FROM categories WHERE id = ?
            """,
            (category_id,),
        ).fetchone()
    return dict(saved)


def archive_category(database_path: str | Path, user_id: str, category_id: str) -> None:
    """归档当前用户的自定义类别，保留历史账目引用。"""
    with connect_database(database_path) as connection:
        current = connection.execute(
            """
            SELECT is_system, archived_at
            FROM categories
            WHERE id = ? AND user_id = ?
            """,
            (category_id, user_id),
        ).fetchone()
        if current is None:
            raise BusinessValidationError("category_not_found", "类别不存在")
        if current["is_system"]:
            raise BusinessValidationError("system_option_immutable", "系统内置选项不能归档")
        if current["archived_at"] is not None:
            raise BusinessValidationError("category_archived", "类别已经归档")
        connection.execute(
            """
            UPDATE categories
            SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (category_id, user_id),
        )


def update_record_type(
    database_path: str | Path,
    user_id: str,
    type_id: str,
    name: str,
) -> dict[str, object]:
    """修改当前用户的自定义有效记账类型显示名称。"""
    with connect_database(database_path) as connection:
        current = connection.execute(
            """
            SELECT id, is_system, archived_at
            FROM record_types
            WHERE id = ? AND user_id = ?
            """,
            (type_id, user_id),
        ).fetchone()
        if current is None:
            raise BusinessValidationError("record_type_not_found", "记账类型不存在")
        if current["is_system"]:
            raise BusinessValidationError("system_option_immutable", "系统内置选项不能修改")
        if current["archived_at"] is not None:
            raise BusinessValidationError("record_type_archived", "记账类型已经归档")

        duplicate = connection.execute(
            """
            SELECT 1 FROM record_types
            WHERE user_id = ? AND name = ? COLLATE NOCASE
              AND archived_at IS NULL AND id <> ?
            LIMIT 1
            """,
            (user_id, name, type_id),
        ).fetchone()
        if duplicate is not None:
            raise BusinessValidationError(
                "record_type_name_conflict",
                "当前用户已有同名有效记账类型",
            )

        connection.execute(
            """
            UPDATE record_types
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (name, type_id, user_id),
        )
        saved = connection.execute(
            """
            SELECT id, user_id, code, name, behavior, is_system, created_at, updated_at
            FROM record_types WHERE id = ?
            """,
            (type_id,),
        ).fetchone()
    return dict(saved)


def archive_record_type(database_path: str | Path, user_id: str, type_id: str) -> None:
    """归档当前用户的自定义记账类型，保留历史账目引用。"""
    with connect_database(database_path) as connection:
        current = connection.execute(
            """
            SELECT is_system, archived_at
            FROM record_types
            WHERE id = ? AND user_id = ?
            """,
            (type_id, user_id),
        ).fetchone()
        if current is None:
            raise BusinessValidationError("record_type_not_found", "记账类型不存在")
        if current["is_system"]:
            raise BusinessValidationError("system_option_immutable", "系统内置选项不能归档")
        if current["archived_at"] is not None:
            raise BusinessValidationError("record_type_archived", "记账类型已经归档")
        connection.execute(
            """
            UPDATE record_types
            SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (type_id, user_id),
        )

import os
import sqlite3
from pathlib import Path


DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[1] / "data" / "jizhangben.db"

MIGRATIONS: tuple[tuple[int, tuple[str, ...]], ...] = (
    (
        1,
        (
            """
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(email)) > 0),
                display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
            CREATE TABLE books (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                group_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
            "CREATE INDEX index_books_user_id ON books(user_id)",
        ),
    ),
    (
        2,
        (
            """
            CREATE TABLE accounts (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability')),
                initial_cents INTEGER NOT NULL DEFAULT 0
                    CHECK (typeof(initial_cents) = 'integer' AND initial_cents >= 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
            )
            """,
            "CREATE INDEX index_accounts_book_id ON accounts(book_id)",
        ),
    ),
    (
        3,
        (
            """
            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
                is_system INTEGER NOT NULL DEFAULT 0
                    CHECK (typeof(is_system) = 'integer' AND is_system IN (0, 1)),
                archived_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
            "CREATE INDEX index_categories_user_id ON categories(user_id)",
            """
            CREATE UNIQUE INDEX index_categories_active_name
            ON categories(user_id, name)
            WHERE archived_at IS NULL
            """,
            """
            CREATE TABLE record_types (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                code TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(code)) > 0),
                name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
                behavior TEXT NOT NULL CHECK (
                    behavior IN (
                        'income',
                        'expense',
                        'expense_reversal',
                        'transfer',
                        'outflow_neutral',
                        'neutral',
                        'deposit'
                    )
                ),
                is_system INTEGER NOT NULL DEFAULT 0
                    CHECK (typeof(is_system) = 'integer' AND is_system IN (0, 1)),
                archived_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
            "CREATE INDEX index_record_types_user_id ON record_types(user_id)",
            """
            CREATE UNIQUE INDEX index_record_types_user_code
            ON record_types(user_id, code)
            """,
            """
            CREATE UNIQUE INDEX index_record_types_active_name
            ON record_types(user_id, name)
            WHERE archived_at IS NULL
            """,
        ),
    ),
    (
        4,
        (
            """
            CREATE TABLE records (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                type_id TEXT NOT NULL,
                category_id TEXT NOT NULL,
                account_id TEXT,
                to_account_id TEXT,
                amount_cents INTEGER NOT NULL
                    CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
                occurred_on TEXT NOT NULL CHECK (
                    date(occurred_on, '+0 days') IS NOT NULL
                    AND occurred_on = date(occurred_on, '+0 days')
                ),
                note TEXT NOT NULL DEFAULT '',
                deposit_direction TEXT,
                deposit_target TEXT,
                deposit_link_id TEXT,
                deposit_final INTEGER NOT NULL DEFAULT 0
                    CHECK (typeof(deposit_final) = 'integer' AND deposit_final IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
                FOREIGN KEY (type_id) REFERENCES record_types(id),
                FOREIGN KEY (category_id) REFERENCES categories(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
                FOREIGN KEY (to_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
                FOREIGN KEY (deposit_link_id) REFERENCES records(id),
                CHECK (
                    account_id IS NULL
                    OR to_account_id IS NULL
                    OR account_id <> to_account_id
                ),
                CHECK (deposit_link_id IS NULL OR deposit_link_id <> id),
                CHECK (
                    (
                        deposit_direction IS NULL
                        AND deposit_target IS NULL
                        AND deposit_link_id IS NULL
                        AND deposit_final = 0
                    )
                    OR (
                        deposit_direction IN ('receive', 'pay')
                        AND length(trim(deposit_target)) > 0
                        AND deposit_link_id IS NULL
                        AND deposit_final = 0
                    )
                    OR (
                        deposit_direction IN ('return_to_other', 'returned_to_me')
                        AND length(trim(deposit_target)) > 0
                        AND deposit_link_id IS NOT NULL
                    )
                )
            )
            """,
            "CREATE INDEX index_records_book_date ON records(book_id, occurred_on)",
            "CREATE INDEX index_records_type_id ON records(type_id)",
            "CREATE INDEX index_records_category_id ON records(category_id)",
            "CREATE INDEX index_records_account_id ON records(account_id)",
            "CREATE INDEX index_records_to_account_id ON records(to_account_id)",
            "CREATE INDEX index_records_deposit_link_id ON records(deposit_link_id)",
        ),
    ),
)


def resolve_database_path(database_path: str | Path | None = None) -> Path:
    """确定数据库位置；测试可以传入临时路径，运行时也可以使用环境变量。"""
    raw_path = database_path or os.getenv("JIZHANGBEN_DB_PATH") or DEFAULT_DATABASE_PATH
    return Path(raw_path).expanduser().resolve()


def connect_database(database_path: str | Path | None = None) -> sqlite3.Connection:
    """创建启用外键约束的 SQLite 连接。"""
    path = resolve_database_path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def apply_migrations(connection: sqlite3.Connection) -> None:
    """按版本顺序执行尚未应用的迁移，并在成功后记录版本。"""
    applied_versions = {
        int(row["version"])
        for row in connection.execute("SELECT version FROM schema_migrations")
    }

    for version, statements in MIGRATIONS:
        if version in applied_versions:
            continue

        for statement in statements:
            connection.execute(statement)
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)",
            (version,),
        )


def initialize_database(database_path: str | Path | None = None) -> None:
    """建立迁移记录表，并在同一个事务中应用所有待执行迁移。"""
    with connect_database(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        apply_migrations(connection)


def check_database(database_path: str | Path | None = None) -> dict[str, int | str]:
    """执行真实查询，返回健康状态和当前数据库 schema 版本。"""
    initialize_database(database_path)
    with connect_database(database_path) as connection:
        connection.execute("SELECT 1").fetchone()
        row = connection.execute(
            "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
        ).fetchone()
    return {"status": "ok", "schema_version": int(row["version"])}

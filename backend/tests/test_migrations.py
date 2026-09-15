import sqlite3

import pytest

from backend.app import database
from backend.app.database import connect_database, initialize_database


def insert_record_dependencies(connection):
    connection.execute(
        "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
        ("user-1", "learner@example.com", "学习者"),
    )
    connection.execute(
        "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
        ("book-1", "user-1", "日常账本"),
    )
    connection.executemany(
        """
        INSERT INTO accounts (id, book_id, name, kind, initial_cents)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            ("account-1", "book-1", "银行卡", "asset", 10000),
            ("account-2", "book-1", "信用卡", "liability", 5000),
        ),
    )
    connection.execute(
        """
        INSERT INTO categories (id, user_id, name, is_system)
        VALUES (?, ?, ?, ?)
        """,
        ("category-1", "user-1", "餐饮", 1),
    )
    connection.executemany(
        """
        INSERT INTO record_types (id, user_id, code, name, behavior, is_system)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            ("type-expense", "user-1", "expense", "支出", "expense", 1),
            ("type-transfer", "user-1", "transfer", "转账", "transfer", 1),
            ("type-deposit", "user-1", "deposit", "押金", "deposit", 1),
        ),
    )


def test_migrations_are_idempotent_and_enable_foreign_keys(tmp_path):
    database_path = tmp_path / "migration-test.db"

    initialize_database(database_path)
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        versions = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).fetchall()
        foreign_keys_enabled = connection.execute("PRAGMA foreign_keys").fetchone()[0]

    assert [row["version"] for row in versions] == [1, 2, 3, 4, 5]
    assert foreign_keys_enabled == 1


def test_users_email_is_unique_ignoring_case(tmp_path):
    database_path = tmp_path / "unique-email-test.db"
    initialize_database(database_path)

    with pytest.raises(sqlite3.IntegrityError):
        with connect_database(database_path) as connection:
            connection.execute(
                "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
                ("user-1", "learner@example.com", "学习者"),
            )
            connection.execute(
                "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
                ("user-2", "LEARNER@example.com", "另一位用户"),
            )


def test_books_require_an_existing_user_and_cascade_on_delete(tmp_path):
    database_path = tmp_path / "book-foreign-key-test.db"
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
                ("book-without-user", "missing-user", "不存在的用户账本"),
            )

        connection.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            ("user-1", "learner@example.com", "学习者"),
        )
        connection.execute(
            "INSERT INTO books (id, user_id, name, group_name) VALUES (?, ?, ?, ?)",
            ("book-1", "user-1", "日常账本", "个人"),
        )
        connection.execute("DELETE FROM users WHERE id = ?", ("user-1",))
        remaining_books = connection.execute("SELECT COUNT(*) FROM books").fetchone()[0]

    assert remaining_books == 0


def test_existing_schema_v1_upgrades_to_v2(tmp_path, monkeypatch):
    database_path = tmp_path / "upgrade-from-v1-test.db"
    all_migrations = database.MIGRATIONS

    monkeypatch.setattr(database, "MIGRATIONS", all_migrations[:1])
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        before_upgrade = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'"
        ).fetchone()
    assert before_upgrade is None

    monkeypatch.setattr(database, "MIGRATIONS", all_migrations[:2])
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        versions = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).fetchall()
        accounts_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'"
        ).fetchone()

    assert [row["version"] for row in versions] == [1, 2]
    assert accounts_table["name"] == "accounts"


def test_accounts_enforce_domain_rules_and_follow_book_deletion(tmp_path):
    database_path = tmp_path / "account-constraints-test.db"
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            ("user-1", "learner@example.com", "学习者"),
        )
        connection.execute(
            "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
            ("book-1", "user-1", "日常账本"),
        )

        invalid_accounts = (
            ("missing-book", "missing-book", "现金", "asset", 0),
            ("wrong-kind", "book-1", "其他", "credit", 0),
            ("negative-balance", "book-1", "银行卡", "asset", -1),
            ("fractional-balance", "book-1", "零钱", "asset", 1.5),
            ("blank-name", "book-1", "   ", "asset", 0),
        )
        for account in invalid_accounts:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO accounts (id, book_id, name, kind, initial_cents)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    account,
                )

        connection.execute(
            """
            INSERT INTO accounts (id, book_id, name, kind, initial_cents)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("asset-1", "book-1", "银行卡", "asset", 12345),
        )
        connection.execute(
            """
            INSERT INTO accounts (id, book_id, name, kind, initial_cents)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("liability-1", "book-1", "信用卡", "liability", 5000),
        )
        saved_accounts = connection.execute(
            "SELECT kind, initial_cents FROM accounts ORDER BY id"
        ).fetchall()

        connection.execute("DELETE FROM books WHERE id = ?", ("book-1",))
        remaining_accounts = connection.execute(
            "SELECT COUNT(*) FROM accounts"
        ).fetchone()[0]

    assert [(row["kind"], row["initial_cents"]) for row in saved_accounts] == [
        ("asset", 12345),
        ("liability", 5000),
    ]
    assert remaining_accounts == 0


def test_existing_schema_v2_upgrades_to_v3(tmp_path, monkeypatch):
    database_path = tmp_path / "upgrade-from-v2-test.db"
    all_migrations = database.MIGRATIONS

    monkeypatch.setattr(database, "MIGRATIONS", all_migrations[:2])
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        before_upgrade = {
            row["name"]
            for row in connection.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name IN ('categories', 'record_types')
                """
            )
        }
    assert before_upgrade == set()

    monkeypatch.setattr(database, "MIGRATIONS", all_migrations[:3])
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        versions = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).fetchall()
        new_tables = {
            row["name"]
            for row in connection.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name IN ('categories', 'record_types')
                """
            )
        }

    assert [row["version"] for row in versions] == [1, 2, 3]
    assert new_tables == {"categories", "record_types"}


def test_categories_are_unique_while_active_and_can_be_archived(tmp_path):
    database_path = tmp_path / "category-constraints-test.db"
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            ("user-1", "learner@example.com", "学习者"),
        )

        invalid_categories = (
            ("missing-user", "missing-user", "餐饮", 0),
            ("blank-name", "user-1", "   ", 0),
            ("wrong-flag", "user-1", "交通", 2),
        )
        for category in invalid_categories:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO categories (id, user_id, name, is_system)
                    VALUES (?, ?, ?, ?)
                    """,
                    category,
                )

        connection.execute(
            """
            INSERT INTO categories (id, user_id, name, is_system)
            VALUES (?, ?, ?, ?)
            """,
            ("category-1", "user-1", "Travel", 0),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO categories (id, user_id, name, is_system)
                VALUES (?, ?, ?, ?)
                """,
                ("category-2", "user-1", "travel", 0),
            )

        connection.execute(
            "UPDATE categories SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
            ("category-1",),
        )
        connection.execute(
            """
            INSERT INTO categories (id, user_id, name, is_system)
            VALUES (?, ?, ?, ?)
            """,
            ("category-2", "user-1", "travel", 0),
        )
        counts = connection.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active
            FROM categories
            """
        ).fetchone()

    assert (counts["total"], counts["active"]) == (2, 1)


def test_record_types_enforce_behavior_code_and_active_name(tmp_path):
    database_path = tmp_path / "record-type-constraints-test.db"
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            ("user-1", "learner@example.com", "学习者"),
        )
        connection.execute(
            """
            INSERT INTO record_types (id, user_id, code, name, behavior, is_system)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("type-1", "user-1", "expense", "支出", "expense", 1),
        )

        invalid_types = (
            ("bad-behavior", "user-1", "unknown", "未知", "unknown", 0),
            ("duplicate-code", "user-1", "EXPENSE", "另一支出", "expense", 0),
            ("duplicate-name", "user-1", "other-expense", "支出", "expense", 0),
            ("wrong-flag", "user-1", "income", "收入", "income", 1.5),
        )
        for record_type in invalid_types:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO record_types
                        (id, user_id, code, name, behavior, is_system)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    record_type,
                )

        connection.execute(
            "UPDATE record_types SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
            ("type-1",),
        )
        connection.execute(
            """
            INSERT INTO record_types (id, user_id, code, name, behavior, is_system)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("type-2", "user-1", "expense-custom", "支出", "expense", 0),
        )
        active_type = connection.execute(
            """
            SELECT code, name, behavior, is_system
            FROM record_types
            WHERE archived_at IS NULL
            """
        ).fetchone()

        connection.execute("DELETE FROM users WHERE id = ?", ("user-1",))
        remaining_types = connection.execute(
            "SELECT COUNT(*) FROM record_types"
        ).fetchone()[0]

    assert tuple(active_type) == ("expense-custom", "支出", "expense", 0)
    assert remaining_types == 0


def test_existing_schema_v3_upgrades_to_v4(tmp_path, monkeypatch):
    database_path = tmp_path / "upgrade-from-v3-test.db"
    all_migrations = database.MIGRATIONS

    monkeypatch.setattr(database, "MIGRATIONS", all_migrations[:3])
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        before_upgrade = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'records'"
        ).fetchone()
    assert before_upgrade is None

    monkeypatch.setattr(database, "MIGRATIONS", all_migrations)
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        versions = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).fetchall()
        records_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'records'"
        ).fetchone()

    assert [row["version"] for row in versions] == [1, 2, 3, 4, 5]
    assert records_table["name"] == "records"


def test_records_enforce_amount_date_references_and_distinct_accounts(tmp_path):
    database_path = tmp_path / "record-constraints-test.db"
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        insert_record_dependencies(connection)

        invalid_records = (
            ("missing-book", "missing", "type-expense", "category-1", "account-1", None, 100, "2026-09-14"),
            ("missing-type", "book-1", "missing", "category-1", "account-1", None, 100, "2026-09-14"),
            ("missing-category", "book-1", "type-expense", "missing", "account-1", None, 100, "2026-09-14"),
            ("zero-amount", "book-1", "type-expense", "category-1", "account-1", None, 0, "2026-09-14"),
            ("negative-amount", "book-1", "type-expense", "category-1", "account-1", None, -1, "2026-09-14"),
            ("fractional-amount", "book-1", "type-expense", "category-1", "account-1", None, 1.5, "2026-09-14"),
            ("invalid-date", "book-1", "type-expense", "category-1", "account-1", None, 100, "2026-02-30"),
            ("same-account", "book-1", "type-transfer", "category-1", "account-1", "account-1", 100, "2026-09-14"),
        )
        for record in invalid_records:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO records (
                        id, book_id, type_id, category_id, account_id,
                        to_account_id, amount_cents, occurred_on
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    record,
                )

        connection.execute(
            """
            INSERT INTO records (
                id, book_id, type_id, category_id, account_id,
                amount_cents, occurred_on, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "record-1",
                "book-1",
                "type-expense",
                "category-1",
                "account-1",
                1234,
                "2026-09-14",
                "午餐",
            ),
        )
        saved = connection.execute(
            "SELECT amount_cents, occurred_on, note FROM records WHERE id = ?",
            ("record-1",),
        ).fetchone()

    assert tuple(saved) == (1234, "2026-09-14", "午餐")


def test_deposit_fields_require_valid_single_record_combinations(tmp_path):
    database_path = tmp_path / "deposit-record-constraints-test.db"
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        insert_record_dependencies(connection)
        connection.execute(
            """
            INSERT INTO records (
                id, book_id, type_id, category_id, account_id,
                amount_cents, occurred_on, deposit_direction, deposit_target
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "deposit-original",
                "book-1",
                "type-deposit",
                "category-1",
                "account-1",
                100000,
                "2026-09-01",
                "pay",
                "房东",
            ),
        )

        invalid_deposits = (
            ("bad-direction", "unknown", "房东", None, 0),
            ("missing-target", "pay", "   ", None, 0),
            ("return-without-link", "returned_to_me", "房东", None, 1),
            ("original-marked-final", "pay", "房东", None, 1),
            ("self-linked", "returned_to_me", "房东", "self-linked", 1),
        )
        for record_id, direction, target, link_id, final in invalid_deposits:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO records (
                        id, book_id, type_id, category_id, account_id,
                        amount_cents, occurred_on, deposit_direction,
                        deposit_target, deposit_link_id, deposit_final
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record_id,
                        "book-1",
                        "type-deposit",
                        "category-1",
                        "account-1",
                        100,
                        "2026-09-14",
                        direction,
                        target,
                        link_id,
                        final,
                    ),
                )

        connection.execute(
            """
            INSERT INTO records (
                id, book_id, type_id, category_id, account_id,
                amount_cents, occurred_on, deposit_direction,
                deposit_target, deposit_link_id, deposit_final
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "deposit-return",
                "book-1",
                "type-deposit",
                "category-1",
                "account-1",
                70000,
                "2026-09-14",
                "returned_to_me",
                "房东",
                "deposit-original",
                1,
            ),
        )
        saved = connection.execute(
            """
            SELECT deposit_direction, deposit_link_id, deposit_final
            FROM records WHERE id = ?
            """,
            ("deposit-return",),
        ).fetchone()

    assert tuple(saved) == ("returned_to_me", "deposit-original", 1)


def test_record_references_preserve_history_and_follow_book_deletion(tmp_path):
    database_path = tmp_path / "record-delete-actions-test.db"
    initialize_database(database_path)

    with connect_database(database_path) as connection:
        insert_record_dependencies(connection)
        connection.execute(
            """
            INSERT INTO records (
                id, book_id, type_id, category_id, account_id,
                amount_cents, occurred_on, deposit_direction, deposit_target
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "deposit-original",
                "book-1",
                "type-deposit",
                "category-1",
                "account-1",
                100000,
                "2026-09-01",
                "pay",
                "房东",
            ),
        )
        connection.execute(
            """
            INSERT INTO records (
                id, book_id, type_id, category_id, account_id,
                amount_cents, occurred_on, deposit_direction,
                deposit_target, deposit_link_id, deposit_final
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "deposit-return",
                "book-1",
                "type-deposit",
                "category-1",
                "account-1",
                70000,
                "2026-09-14",
                "returned_to_me",
                "房东",
                "deposit-original",
                1,
            ),
        )

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("DELETE FROM categories WHERE id = ?", ("category-1",))
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("DELETE FROM record_types WHERE id = ?", ("type-deposit",))
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("DELETE FROM records WHERE id = ?", ("deposit-original",))

        connection.execute("DELETE FROM accounts WHERE id = ?", ("account-1",))
        remaining_account_links = connection.execute(
            "SELECT COUNT(*) FROM records WHERE account_id IS NOT NULL"
        ).fetchone()[0]

        connection.execute("DELETE FROM books WHERE id = ?", ("book-1",))
        remaining_records = connection.execute("SELECT COUNT(*) FROM records").fetchone()[0]

    assert remaining_account_links == 0
    assert remaining_records == 0

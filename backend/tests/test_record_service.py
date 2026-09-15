import pytest

from backend.app.database import connect_database, initialize_database
from backend.app.services.record_service import (
    NewRecord,
    RecordValidationError,
    create_record,
)


def seed_service_data(database_path):
    initialize_database(database_path)
    with connect_database(database_path) as connection:
        connection.executemany(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            (
                ("user-1", "learner@example.com", "学习者"),
                ("user-2", "other@example.com", "其他用户"),
            ),
        )
        connection.executemany(
            "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
            (
                ("book-1", "user-1", "日常账本"),
                ("book-2", "user-2", "其他账本"),
            ),
        )
        connection.executemany(
            """
            INSERT INTO accounts (id, book_id, name, kind, initial_cents)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                ("account-1", "book-1", "银行卡", "asset", 10000),
                ("account-2", "book-1", "信用卡", "liability", 5000),
                ("other-account", "book-2", "其他账户", "asset", 0),
            ),
        )
        connection.executemany(
            """
            INSERT INTO categories (id, user_id, name, is_system, archived_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                ("category-1", "user-1", "餐饮", 1, None),
                ("archived-category", "user-1", "旧类别", 0, "2026-09-01"),
                ("other-category", "user-2", "其他类别", 0, None),
            ),
        )
        connection.executemany(
            """
            INSERT INTO record_types
                (id, user_id, code, name, behavior, is_system, archived_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ("type-expense", "user-1", "expense", "支出", "expense", 1, None),
                ("type-transfer", "user-1", "transfer", "转账", "transfer", 1, None),
                ("type-neutral", "user-1", "balance", "余额", "neutral", 1, None),
                ("type-deposit", "user-1", "deposit", "押金", "deposit", 1, None),
                ("archived-type", "user-1", "old", "旧类型", "expense", 0, "2026-09-01"),
                ("other-type", "user-2", "other", "其他类型", "expense", 0, None),
            ),
        )


def assert_validation_code(database_path, record, expected_code):
    with pytest.raises(RecordValidationError) as error:
        create_record(database_path, "user-1", record)
    assert error.value.code == expected_code


def base_record(**changes):
    values = {
        "record_id": "record-1",
        "book_id": "book-1",
        "type_id": "type-expense",
        "category_id": "category-1",
        "account_id": "account-1",
        "amount_cents": 1234,
        "occurred_on": "2026-09-14",
        "note": "午餐",
    }
    values.update(changes)
    return NewRecord(**values)


def test_service_creates_expense_and_transfer_in_one_book(tmp_path):
    database_path = tmp_path / "valid-record-service-test.db"
    seed_service_data(database_path)

    expense = create_record(database_path, "user-1", base_record())
    transfer = create_record(
        database_path,
        "user-1",
        base_record(
            record_id="record-2",
            type_id="type-transfer",
            to_account_id="account-2",
            amount_cents=5000,
            note="还信用卡",
        ),
    )

    assert (expense["amount_cents"], expense["note"]) == (1234, "午餐")
    assert (transfer["account_id"], transfer["to_account_id"]) == (
        "account-1",
        "account-2",
    )


@pytest.mark.parametrize(
    ("changes", "expected_code"),
    (
        ({"book_id": "missing-book"}, "book_not_found"),
        ({"type_id": "other-type"}, "record_type_not_available"),
        ({"type_id": "archived-type"}, "record_type_not_available"),
        ({"category_id": "other-category"}, "category_not_available"),
        ({"category_id": "archived-category"}, "category_not_available"),
        ({"account_id": "other-account"}, "account_not_in_book"),
    ),
)
def test_service_rejects_cross_owner_archived_or_cross_book_data(
    tmp_path, changes, expected_code
):
    database_path = tmp_path / "ownership-record-service-test.db"
    seed_service_data(database_path)

    assert_validation_code(database_path, base_record(**changes), expected_code)

    with connect_database(database_path) as connection:
        count = connection.execute("SELECT COUNT(*) FROM records").fetchone()[0]
    assert count == 0


def test_service_hides_another_users_book(tmp_path):
    database_path = tmp_path / "caller-ownership-record-service-test.db"
    seed_service_data(database_path)

    with pytest.raises(RecordValidationError) as error:
        create_record(database_path, "user-2", base_record())

    assert error.value.code == "book_not_found"
    with connect_database(database_path) as connection:
        count = connection.execute("SELECT COUNT(*) FROM records").fetchone()[0]
    assert count == 0


@pytest.mark.parametrize(
    ("changes", "expected_code"),
    (
        ({"account_id": None}, "account_required"),
        ({"to_account_id": "account-2"}, "to_account_not_allowed"),
        (
            {"type_id": "type-transfer", "to_account_id": None},
            "to_account_required",
        ),
        (
            {"type_id": "type-transfer", "to_account_id": "other-account"},
            "to_account_not_in_book",
        ),
        (
            {"type_id": "type-transfer", "to_account_id": "account-1"},
            "same_account",
        ),
        ({"type_id": "type-neutral"}, "account_not_allowed"),
    ),
)
def test_service_enforces_account_rules_by_behavior(tmp_path, changes, expected_code):
    database_path = tmp_path / "behavior-record-service-test.db"
    seed_service_data(database_path)

    assert_validation_code(database_path, base_record(**changes), expected_code)


def test_service_matches_returned_deposit_to_original_direction(tmp_path):
    database_path = tmp_path / "deposit-record-service-test.db"
    seed_service_data(database_path)

    original = create_record(
        database_path,
        "user-1",
        base_record(
            record_id="deposit-original",
            type_id="type-deposit",
            amount_cents=100000,
            note="",
            deposit_direction="pay",
            deposit_target="房东",
        ),
    )
    returned = create_record(
        database_path,
        "user-1",
        base_record(
            record_id="deposit-return",
            type_id="type-deposit",
            amount_cents=70000,
            note="",
            deposit_direction="returned_to_me",
            deposit_target="房东",
            deposit_link_id="deposit-original",
            deposit_final=True,
        ),
    )

    assert original["deposit_direction"] == "pay"
    assert returned["deposit_link_id"] == "deposit-original"


def test_service_rejects_wrong_or_cross_book_deposit_links(tmp_path):
    database_path = tmp_path / "invalid-deposit-link-service-test.db"
    seed_service_data(database_path)

    create_record(
        database_path,
        "user-1",
        base_record(
            record_id="received-original",
            type_id="type-deposit",
            amount_cents=100000,
            deposit_direction="receive",
            deposit_target="租客",
        ),
    )

    assert_validation_code(
        database_path,
        base_record(
            record_id="wrong-return",
            type_id="type-deposit",
            deposit_direction="returned_to_me",
            deposit_target="租客",
            deposit_link_id="received-original",
        ),
        "deposit_direction_mismatch",
    )
    assert_validation_code(
        database_path,
        base_record(
            record_id="missing-return",
            type_id="type-deposit",
            deposit_direction="returned_to_me",
            deposit_target="房东",
            deposit_link_id="missing-original",
        ),
        "deposit_link_not_found",
    )
    assert_validation_code(
        database_path,
        base_record(deposit_direction="pay", deposit_target="房东"),
        "deposit_fields_not_allowed",
    )

    with connect_database(database_path) as connection:
        saved_ids = [
            row["id"]
            for row in connection.execute("SELECT id FROM records ORDER BY id")
        ]
    assert saved_ids == ["received-original"]

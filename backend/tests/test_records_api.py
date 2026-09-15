from uuid import UUID

import pytest
from httpx2 import ASGITransport, AsyncClient

from backend.app.database import connect_database
from backend.app.main import create_app


@pytest.fixture
def anyio_backend():
    return "asyncio"


def seed_api_data(database_path, user_id):
    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
            ("book-1", user_id, "日常账本"),
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
        connection.executemany(
            """
            INSERT INTO categories (id, user_id, name, is_system)
            VALUES (?, ?, ?, ?)
            """,
            (
                ("category-1", user_id, "餐饮", 1),
                ("category-2", user_id, "交通", 1),
            ),
        )
        connection.executemany(
            """
            INSERT INTO record_types (id, user_id, code, name, behavior, is_system)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                ("type-expense", user_id, "expense", "支出", "expense", 1),
                ("type-deposit", user_id, "deposit", "押金", "deposit", 1),
                ("type-income", user_id, "income", "收入", "income", 1),
            ),
        )


def expense_payload(**changes):
    payload = {
        "type_id": "type-expense",
        "category_id": "category-1",
        "account_id": "account-1",
        "amount_cents": 1234,
        "occurred_on": "2026-09-14",
        "note": "午餐",
    }
    payload.update(changes)
    return payload


async def post_record(application, payload, book_id="book-1"):
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.post(f"/api/books/{book_id}/records", json=payload)


async def get_records(application, book_id="book-1", params=None):
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get(f"/api/books/{book_id}/records", params=params)


async def delete_record_request(application, record_id, book_id="book-1"):
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.delete(f"/api/books/{book_id}/records/{record_id}")


async def put_record(application, record_id, payload, book_id="book-1"):
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.put(
            f"/api/books/{book_id}/records/{record_id}",
            json=payload,
        )


@pytest.mark.anyio
async def test_post_record_returns_201_and_persists_generated_id(tmp_path):
    database_path = tmp_path / "records-api-success.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        response = await post_record(application, expense_payload())

    assert response.status_code == 201
    body = response.json()
    UUID(body["id"])
    assert body["book_id"] == "book-1"
    assert body["amount_cents"] == 1234
    assert body["occurred_on"] == "2026-09-14"
    assert body["note"] == "午餐"

    with connect_database(database_path) as connection:
        saved = connection.execute(
            "SELECT id, amount_cents, note FROM records"
        ).fetchone()
    assert tuple(saved) == (body["id"], 1234, "午餐")


@pytest.mark.anyio
async def test_post_record_maps_missing_resource_to_404(tmp_path):
    database_path = tmp_path / "records-api-not-found.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        response = await post_record(
            application,
            expense_payload(account_id="missing-account"),
        )

    assert response.status_code == 404
    assert response.json() == {
        "code": "account_not_in_book",
        "message": "转出账户不存在或不属于当前账本",
    }


@pytest.mark.anyio
async def test_post_record_hides_another_users_book(tmp_path):
    database_path = tmp_path / "records-api-owner-boundary.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        with connect_database(database_path) as connection:
            connection.execute(
                "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
                ("other-user", "other@example.com", "其他用户"),
            )
            connection.execute(
                "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
                ("other-book", "other-user", "其他账本"),
            )
        response = await post_record(
            application,
            expense_payload(),
            book_id="other-book",
        )
        listed_response = await get_records(application, book_id="other-book")

    assert response.status_code == 404
    assert response.json() == {"code": "book_not_found", "message": "账本不存在"}
    assert listed_response.status_code == 404
    assert listed_response.json() == {"code": "book_not_found", "message": "账本不存在"}


@pytest.mark.anyio
async def test_post_record_maps_business_conflict_to_409(tmp_path):
    database_path = tmp_path / "records-api-conflict.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        response = await post_record(application, expense_payload(account_id=None))

    assert response.status_code == 409
    assert response.json() == {
        "code": "account_required",
        "message": "该记账类型必须选择账户",
    }


@pytest.mark.anyio
@pytest.mark.parametrize(
    "changes",
    (
        {"amount_cents": 0},
        {"amount_cents": 12.34},
        {"occurred_on": "2026-02-30"},
    ),
)
async def test_post_record_maps_invalid_request_to_422(tmp_path, changes):
    database_path = tmp_path / "records-api-invalid-request.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        response = await post_record(application, expense_payload(**changes))

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "request_validation_failed"
    assert body["message"] == "请求字段不合法"
    assert body["details"]


@pytest.mark.anyio
async def test_post_record_supports_linked_deposit_settlement(tmp_path):
    database_path = tmp_path / "records-api-deposit.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        original_response = await post_record(
            application,
            {
                "type_id": "type-deposit",
                "category_id": "category-1",
                "account_id": "account-1",
                "amount_cents": 100000,
                "occurred_on": "2026-09-01",
                "deposit_direction": "pay",
                "deposit_target": "房东",
            },
        )
        original_id = original_response.json()["id"]
        return_response = await post_record(
            application,
            {
                "type_id": "type-deposit",
                "category_id": "category-1",
                "account_id": "account-1",
                "amount_cents": 70000,
                "occurred_on": "2026-09-14",
                "deposit_direction": "returned_to_me",
                "deposit_target": "房东",
                "deposit_link_id": original_id,
                "deposit_final": True,
            },
        )

    assert original_response.status_code == 201
    assert return_response.status_code == 201
    returned = return_response.json()
    assert returned["deposit_link_id"] == original_id
    assert returned["deposit_final"] is True


@pytest.mark.anyio
async def test_get_records_returns_display_data_and_supports_filters(tmp_path):
    database_path = tmp_path / "records-api-list.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        newest = await post_record(application, expense_payload())
        middle = await post_record(
            application,
            expense_payload(
                type_id="type-income",
                category_id="category-2",
                account_id="account-2",
                amount_cents=5000,
                occurred_on="2026-09-13",
                note="兼职收入",
            ),
        )
        oldest = await post_record(
            application,
            expense_payload(
                category_id="category-2",
                amount_cents=300,
                occurred_on="2026-09-10",
                note="地铁",
            ),
        )
        all_records = await get_records(application)
        date_records = await get_records(
            application,
            params={"from": "2026-09-12", "to": "2026-09-14"},
        )
        account_records = await get_records(application, params={"account_id": "account-1"})
        category_records = await get_records(application, params={"category_id": "category-2"})
        type_keyword_records = await get_records(application, params={"q": "收入"})
        category_keyword_records = await get_records(application, params={"q": "交通"})

    assert newest.status_code == 201
    assert middle.status_code == 201
    assert oldest.status_code == 201
    newest_id = newest.json()["id"]
    middle_id = middle.json()["id"]
    oldest_id = oldest.json()["id"]
    all_items = all_records.json()["items"]
    assert [item["id"] for item in all_items] == [newest_id, middle_id, oldest_id]
    assert all_items[0]["type_name"] == "支出"
    assert all_items[0]["category_name"] == "餐饮"
    assert all_items[0]["account_name"] == "银行卡"
    assert all_items[1]["type_code"] == "income"
    assert all_items[1]["type_behavior"] == "income"
    assert all_items[1]["category_name"] == "交通"
    assert all_items[1]["account_name"] == "信用卡"
    assert [item["id"] for item in date_records.json()["items"]] == [newest_id, middle_id]
    assert [item["id"] for item in account_records.json()["items"]] == [newest_id, oldest_id]
    assert [item["id"] for item in category_records.json()["items"]] == [middle_id, oldest_id]
    assert [item["id"] for item in type_keyword_records.json()["items"]] == [middle_id]
    assert [item["id"] for item in category_keyword_records.json()["items"]] == [middle_id, oldest_id]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("params", "expected_code"),
    (
        ({"from": "2026-09-15", "to": "2026-09-14"}, "invalid_date_range"),
        ({"from": "2026-02-30"}, "request_validation_failed"),
    ),
)
async def test_get_records_rejects_invalid_dates(tmp_path, params, expected_code):
    database_path = tmp_path / "records-api-invalid-list-filter.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        response = await get_records(application, params=params)

    assert response.status_code == 422
    assert response.json()["code"] == expected_code


@pytest.mark.anyio
async def test_delete_record_removes_owned_record_and_hides_missing_id(tmp_path):
    database_path = tmp_path / "records-api-delete.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        created = await post_record(application, expense_payload())
        record_id = created.json()["id"]
        deleted = await delete_record_request(application, record_id)
        listed = await get_records(application)
        missing = await delete_record_request(application, record_id)

    assert deleted.status_code == 204
    assert deleted.content == b""
    assert listed.json() == {"items": []}
    assert missing.status_code == 404
    assert missing.json() == {"code": "record_not_found", "message": "账目不存在"}


@pytest.mark.anyio
async def test_delete_record_protects_original_deposit_with_settlement(tmp_path):
    database_path = tmp_path / "records-api-delete-deposit.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        original = await post_record(
            application,
            {
                "type_id": "type-deposit",
                "category_id": "category-1",
                "account_id": "account-1",
                "amount_cents": 100000,
                "occurred_on": "2026-09-01",
                "deposit_direction": "pay",
                "deposit_target": "房东",
            },
        )
        returned = await post_record(
            application,
            {
                "type_id": "type-deposit",
                "category_id": "category-1",
                "account_id": "account-1",
                "amount_cents": 70000,
                "occurred_on": "2026-09-14",
                "deposit_direction": "returned_to_me",
                "deposit_target": "房东",
                "deposit_link_id": original.json()["id"],
                "deposit_final": True,
            },
        )
        blocked = await delete_record_request(application, original.json()["id"])
        deleted_return = await delete_record_request(application, returned.json()["id"])
        deleted_original = await delete_record_request(application, original.json()["id"])

    assert blocked.status_code == 409
    assert blocked.json() == {
        "code": "deposit_record_in_use",
        "message": "该原押金已有关联退回记录，不能直接删除",
    }
    assert deleted_return.status_code == 204
    assert deleted_original.status_code == 204


@pytest.mark.anyio
async def test_put_record_revalidates_and_replaces_an_owned_record(tmp_path):
    database_path = tmp_path / "records-api-update.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        created = await post_record(application, expense_payload())
        updated = await put_record(
            application,
            created.json()["id"],
            expense_payload(
                type_id="type-income",
                category_id="category-2",
                account_id="account-2",
                amount_cents=5600,
                occurred_on="2026-09-16",
                note="兼职收入",
            ),
        )
        listed = await get_records(application)

    assert updated.status_code == 200
    body = updated.json()
    assert body["id"] == created.json()["id"]
    assert body["type_id"] == "type-income"
    assert body["category_id"] == "category-2"
    assert body["account_id"] == "account-2"
    assert body["amount_cents"] == 5600
    assert body["occurred_on"] == "2026-09-16"
    assert body["note"] == "兼职收入"
    assert listed.json()["items"][0]["type_behavior"] == "income"
    assert listed.json()["items"][0]["category_name"] == "交通"


@pytest.mark.anyio
async def test_put_record_rejects_invalid_data_without_changing_original(tmp_path):
    database_path = tmp_path / "records-api-update-invalid.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        created = await post_record(application, expense_payload())
        rejected = await put_record(
            application,
            created.json()["id"],
            expense_payload(amount_cents=9999, note="不应保存", account_id=None),
        )
        listed = await get_records(application)

    assert rejected.status_code == 409
    assert rejected.json()["code"] == "account_required"
    saved = listed.json()["items"][0]
    assert saved["amount_cents"] == 1234
    assert saved["note"] == "午餐"


@pytest.mark.anyio
async def test_put_record_locks_both_sides_of_a_deposit_settlement(tmp_path):
    database_path = tmp_path / "records-api-update-deposit.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_api_data(database_path, application.state.current_user_id)
        original = await post_record(
            application,
            {
                "type_id": "type-deposit",
                "category_id": "category-1",
                "account_id": "account-1",
                "amount_cents": 100000,
                "occurred_on": "2026-09-01",
                "deposit_direction": "pay",
                "deposit_target": "房东",
            },
        )
        returned = await post_record(
            application,
            {
                "type_id": "type-deposit",
                "category_id": "category-1",
                "account_id": "account-1",
                "amount_cents": 70000,
                "occurred_on": "2026-09-14",
                "deposit_direction": "returned_to_me",
                "deposit_target": "房东",
                "deposit_link_id": original.json()["id"],
                "deposit_final": True,
            },
        )
        blocked_original = await put_record(
            application,
            original.json()["id"],
            expense_payload(),
        )
        blocked_return = await put_record(
            application,
            returned.json()["id"],
            expense_payload(),
        )

    assert blocked_original.status_code == 409
    assert blocked_original.json()["code"] == "deposit_record_in_use"
    assert blocked_return.status_code == 409
    assert blocked_return.json()["code"] == "deposit_settlement_locked"

from uuid import UUID

import pytest
from httpx2 import ASGITransport, AsyncClient

from backend.app.database import connect_database
from backend.app.main import create_app


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def request(application, method, path, **kwargs):
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


async def create_book(application):
    response = await request(
        application,
        "POST",
        "/api/books",
        json={"name": "日常账本"},
    )
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.anyio
async def test_get_accounts_hides_a_missing_book(tmp_path):
    application = create_app(tmp_path / "missing-book-accounts.db")

    async with application.router.lifespan_context(application):
        response = await request(application, "GET", "/api/books/missing/accounts")

    assert response.status_code == 404
    assert response.json() == {"code": "book_not_found", "message": "账本不存在"}


@pytest.mark.anyio
async def test_post_account_persists_and_get_lists_book_accounts(tmp_path):
    application = create_app(tmp_path / "create-accounts.db")

    async with application.router.lifespan_context(application):
        book_id = await create_book(application)
        asset_response = await request(
            application,
            "POST",
            f"/api/books/{book_id}/accounts",
            json={"name": " 银行卡 ", "kind": "asset", "initial_cents": 12345},
        )
        liability_response = await request(
            application,
            "POST",
            f"/api/books/{book_id}/accounts",
            json={"name": "信用卡", "kind": "liability"},
        )
        listed_response = await request(
            application,
            "GET",
            f"/api/books/{book_id}/accounts",
        )

    assert asset_response.status_code == 201
    asset = asset_response.json()
    UUID(asset["id"])
    assert asset["book_id"] == book_id
    assert asset["name"] == "银行卡"
    assert asset["kind"] == "asset"
    assert asset["initial_cents"] == 12345

    assert liability_response.status_code == 201
    liability = liability_response.json()
    assert liability["kind"] == "liability"
    assert liability["initial_cents"] == 0
    listed = listed_response.json()["items"]
    assert len(listed) == 9
    assert [item["id"] for item in listed[-2:]] == [asset["id"], liability["id"]]


@pytest.mark.anyio
async def test_account_endpoints_hide_another_users_book(tmp_path):
    database_path = tmp_path / "other-user-accounts.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        with connect_database(database_path) as connection:
            connection.execute(
                "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
                ("other-user", "other@example.com", "其他用户"),
            )
            connection.execute(
                "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
                ("other-book", "other-user", "其他账本"),
            )
        listed = await request(application, "GET", "/api/books/other-book/accounts")
        created = await request(
            application,
            "POST",
            "/api/books/other-book/accounts",
            json={"name": "他人的银行卡", "kind": "asset"},
        )

    assert listed.status_code == 404
    assert created.status_code == 404
    assert listed.json()["code"] == "book_not_found"
    assert created.json()["code"] == "book_not_found"
    with connect_database(database_path) as connection:
        count = connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    assert count == 0


@pytest.mark.anyio
@pytest.mark.parametrize(
    "payload",
    (
        {"name": "", "kind": "asset"},
        {"name": "现金", "kind": "cash"},
        {"name": "现金", "kind": "asset", "initial_cents": -1},
        {"name": "现金", "kind": "asset", "initial_cents": 1.5},
    ),
)
async def test_post_account_maps_invalid_request_to_unified_422(tmp_path, payload):
    application = create_app(tmp_path / "invalid-account.db")

    async with application.router.lifespan_context(application):
        book_id = await create_book(application)
        response = await request(
            application,
            "POST",
            f"/api/books/{book_id}/accounts",
            json=payload,
        )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "request_validation_failed"
    assert body["message"] == "请求字段不合法"
    assert body["details"]


@pytest.mark.anyio
async def test_patch_and_delete_account_in_owned_book(tmp_path):
    application = create_app(tmp_path / "update-delete-account.db")

    async with application.router.lifespan_context(application):
        book_id = await create_book(application)
        created = await request(
            application,
            "POST",
            f"/api/books/{book_id}/accounts",
            json={"name": "现金", "kind": "asset", "initial_cents": 100},
        )
        account_id = created.json()["id"]
        updated = await request(
            application,
            "PATCH",
            f"/api/books/{book_id}/accounts/{account_id}",
            json={"name": "信用卡", "kind": "liability", "initial_cents": 5000},
        )
        deleted = await request(
            application,
            "DELETE",
            f"/api/books/{book_id}/accounts/{account_id}",
        )
        listed = await request(application, "GET", f"/api/books/{book_id}/accounts")
        missing = await request(
            application,
            "DELETE",
            f"/api/books/{book_id}/accounts/{account_id}",
        )

    assert updated.status_code == 200
    assert updated.json()["name"] == "信用卡"
    assert updated.json()["kind"] == "liability"
    assert updated.json()["initial_cents"] == 5000
    assert deleted.status_code == 204
    assert len(listed.json()["items"]) == 7
    assert all(item["id"] != account_id for item in listed.json()["items"])
    assert missing.status_code == 404
    assert missing.json() == {"code": "account_not_found", "message": "账户不存在"}


@pytest.mark.anyio
async def test_delete_account_keeps_historical_record_and_clears_reference(tmp_path):
    database_path = tmp_path / "delete-account-history.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        book_id = await create_book(application)
        created = await request(
            application,
            "POST",
            f"/api/books/{book_id}/accounts",
            json={"name": "现金", "kind": "asset"},
        )
        account_id = created.json()["id"]
        with connect_database(database_path) as connection:
            user_id = application.state.current_user_id
            connection.execute(
                "INSERT INTO categories (id, user_id, name, is_system) VALUES (?, ?, ?, ?)",
                ("category-history", user_id, "历史类别", 1),
            )
            connection.execute(
                """
                INSERT INTO record_types (id, user_id, code, name, behavior, is_system)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                ("type-history", user_id, "history", "历史类型", "expense", 1),
            )
            connection.execute(
                """
                INSERT INTO records (id, book_id, type_id, category_id, account_id, amount_cents, occurred_on)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("record-history", book_id, "type-history", "category-history", account_id, 100, "2026-09-15"),
            )
        deleted = await request(
            application,
            "DELETE",
            f"/api/books/{book_id}/accounts/{account_id}",
        )

    assert deleted.status_code == 204
    with connect_database(database_path) as connection:
        saved = connection.execute(
            "SELECT id, account_id FROM records WHERE id = ?",
            ("record-history",),
        ).fetchone()
    assert tuple(saved) == ("record-history", None)

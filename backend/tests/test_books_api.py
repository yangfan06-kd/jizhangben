from uuid import UUID

import pytest
from httpx2 import ASGITransport, AsyncClient

from backend.app.database import connect_database
from backend.app.main import create_app
from backend.app.services.development_service import DEVELOPMENT_USER_ID


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def request(application, method, path, **kwargs):
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


@pytest.mark.anyio
async def test_lifespan_creates_one_development_user_idempotently(tmp_path):
    database_path = tmp_path / "development-user.db"

    for _ in range(2):
        application = create_app(database_path)
        async with application.router.lifespan_context(application):
            assert application.state.current_user_id == DEVELOPMENT_USER_ID

    with connect_database(database_path) as connection:
        users = connection.execute(
            "SELECT id, email, display_name FROM users"
        ).fetchall()
    assert len(users) == 1
    assert users[0]["id"] == DEVELOPMENT_USER_ID


@pytest.mark.anyio
async def test_get_books_starts_with_empty_items(tmp_path):
    application = create_app(tmp_path / "empty-books.db")

    async with application.router.lifespan_context(application):
        response = await request(application, "GET", "/api/books")

    assert response.status_code == 200
    assert response.json() == {"items": []}


@pytest.mark.anyio
async def test_post_book_persists_for_current_user_and_get_lists_it(tmp_path):
    database_path = tmp_path / "create-book.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        created_response = await request(
            application,
            "POST",
            "/api/books",
            json={"name": " 日常账本 ", "group_name": " 个人 "},
        )
        listed_response = await request(application, "GET", "/api/books")

    assert created_response.status_code == 201
    created = created_response.json()
    UUID(created["id"])
    assert created["user_id"] == DEVELOPMENT_USER_ID
    assert created["name"] == "日常账本"
    assert created["group_name"] == "个人"
    assert created["warnings"] == []
    assert listed_response.json()["items"] == [
        {key: value for key, value in created.items() if key != "warnings"}
    ]

    with connect_database(database_path) as connection:
        owner = connection.execute(
            "SELECT user_id FROM books WHERE id = ?", (created["id"],)
        ).fetchone()["user_id"]
    assert owner == DEVELOPMENT_USER_ID


@pytest.mark.anyio
async def test_duplicate_book_name_is_allowed_with_warning(tmp_path):
    application = create_app(tmp_path / "duplicate-book.db")

    async with application.router.lifespan_context(application):
        first = await request(
            application, "POST", "/api/books", json={"name": "Travel"}
        )
        duplicate = await request(
            application, "POST", "/api/books", json={"name": "travel"}
        )
        listed = await request(application, "GET", "/api/books")

    assert first.json()["warnings"] == []
    assert duplicate.status_code == 201
    assert duplicate.json()["warnings"] == [
        {
            "code": "duplicate_book_name",
            "message": "当前用户已有同名账本，本次仍已创建",
        }
    ]
    assert len(listed.json()["items"]) == 2


@pytest.mark.anyio
async def test_post_book_maps_blank_name_to_unified_422(tmp_path):
    application = create_app(tmp_path / "invalid-book.db")

    async with application.router.lifespan_context(application):
        response = await request(
            application, "POST", "/api/books", json={"name": "   "}
        )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "request_validation_failed"
    assert body["message"] == "请求字段不合法"
    assert body["details"]


@pytest.mark.anyio
async def test_patch_book_updates_owned_book_and_warns_on_duplicate_name(tmp_path):
    application = create_app(tmp_path / "update-book.db")

    async with application.router.lifespan_context(application):
        first = await request(application, "POST", "/api/books", json={"name": "日常"})
        second = await request(application, "POST", "/api/books", json={"name": "旅行"})
        updated = await request(application, "PATCH", f"/api/books/{second.json()['id']}", json={"name": "日常", "group_name": "个人"})

    assert updated.status_code == 200
    assert updated.json()["name"] == "日常"
    assert updated.json()["group_name"] == "个人"
    assert updated.json()["warnings"][0]["code"] == "duplicate_book_name"


@pytest.mark.anyio
async def test_delete_book_cascades_accounts_and_records(tmp_path):
    database_path = tmp_path / "delete-book.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        created = await request(application, "POST", "/api/books", json={"name": "待删"})
        book_id = created.json()["id"]
        with connect_database(database_path) as connection:
            user_id = application.state.current_user_id
            connection.execute("INSERT INTO accounts (id, book_id, name, kind) VALUES (?, ?, ?, ?)", ("account-delete", book_id, "现金", "asset"))
            connection.execute("INSERT INTO categories (id, user_id, name, is_system) VALUES (?, ?, ?, ?)", ("category-delete", user_id, "类别", 1))
            connection.execute("INSERT INTO record_types (id, user_id, code, name, behavior, is_system) VALUES (?, ?, ?, ?, ?, ?)", ("type-delete", user_id, "delete", "类型", "expense", 1))
            connection.execute("INSERT INTO records (id, book_id, type_id, category_id, account_id, amount_cents, occurred_on) VALUES (?, ?, ?, ?, ?, ?, ?)", ("record-delete", book_id, "type-delete", "category-delete", "account-delete", 100, "2026-09-15"))
        deleted = await request(application, "DELETE", f"/api/books/{book_id}")
        listed = await request(application, "GET", "/api/books")

    assert deleted.status_code == 204
    assert listed.json() == {"items": []}
    with connect_database(database_path) as connection:
        counts = tuple(connection.execute("SELECT (SELECT COUNT(*) FROM books), (SELECT COUNT(*) FROM accounts), (SELECT COUNT(*) FROM records)").fetchone())
    assert counts == (0, 0, 0)

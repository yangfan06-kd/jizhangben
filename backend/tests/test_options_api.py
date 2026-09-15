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


async def get(application, path):
    return await request(application, "GET", path)


def seed_options(database_path, current_user_id):
    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            ("other-user", "other@example.com", "其他用户"),
        )
        connection.executemany(
            """
            INSERT INTO categories (id, user_id, name, is_system, archived_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                ("category-custom", current_user_id, "旅行", 0, None),
                ("category-system", current_user_id, "餐饮", 1, None),
                ("category-archived", current_user_id, "旧类别", 0, "2026-09-15"),
                ("category-other", "other-user", "他人类别", 1, None),
            ),
        )
        connection.executemany(
            """
            INSERT INTO record_types
                (id, user_id, code, name, behavior, is_system, archived_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ("type-expense", current_user_id, "expense", "支出", "expense", 1, None),
                ("type-custom", current_user_id, "neutral-custom", "临时", "neutral", 0, None),
                ("type-archived", current_user_id, "old", "旧类型", "expense", 0, "2026-09-15"),
                ("type-other", "other-user", "income", "他人收入", "income", 1, None),
            ),
        )


@pytest.mark.anyio
async def test_option_endpoints_start_with_empty_items(tmp_path):
    application = create_app(tmp_path / "empty-options.db")

    async with application.router.lifespan_context(application):
        categories = await get(application, "/api/categories")
        record_types = await get(application, "/api/record-types")

    assert categories.status_code == 200
    assert categories.json() == {"items": []}
    assert record_types.status_code == 200
    assert record_types.json() == {"items": []}


@pytest.mark.anyio
async def test_get_categories_returns_only_current_users_active_options(tmp_path):
    database_path = tmp_path / "categories-options.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_options(database_path, application.state.current_user_id)
        response = await get(application, "/api/categories")

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["id"] for item in items] == ["category-system", "category-custom"]
    assert [item["name"] for item in items] == ["餐饮", "旅行"]
    assert all(item["user_id"] == application.state.current_user_id for item in items)
    assert items[0]["is_system"] is True
    assert items[1]["is_system"] is False


@pytest.mark.anyio
async def test_get_record_types_returns_behavior_and_hides_archived_or_foreign(tmp_path):
    database_path = tmp_path / "record-types-options.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_options(database_path, application.state.current_user_id)
        response = await get(application, "/api/record-types")

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["id"] for item in items] == ["type-expense", "type-custom"]
    assert items[0]["code"] == "expense"
    assert items[0]["behavior"] == "expense"
    assert items[1]["behavior"] == "neutral"
    assert all(item["user_id"] == application.state.current_user_id for item in items)


@pytest.mark.anyio
async def test_post_category_creates_custom_option_and_get_lists_it(tmp_path):
    application = create_app(tmp_path / "create-category.db")

    async with application.router.lifespan_context(application):
        created_response = await request(
            application,
            "POST",
            "/api/categories",
            json={"name": " 旅行 "},
        )
        listed_response = await get(application, "/api/categories")

    assert created_response.status_code == 201
    created = created_response.json()
    UUID(created["id"])
    assert created["name"] == "旅行"
    assert created["is_system"] is False
    assert created["user_id"] == application.state.current_user_id
    assert listed_response.json()["items"] == [created]


@pytest.mark.anyio
async def test_post_category_rejects_duplicate_active_name(tmp_path):
    application = create_app(tmp_path / "duplicate-category.db")

    async with application.router.lifespan_context(application):
        first = await request(
            application,
            "POST",
            "/api/categories",
            json={"name": "Travel"},
        )
        duplicate = await request(
            application,
            "POST",
            "/api/categories",
            json={"name": "travel"},
        )

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "code": "category_name_conflict",
        "message": "当前用户已有同名有效类别",
    }


@pytest.mark.anyio
async def test_post_record_type_creates_custom_type_and_rejects_conflicts(tmp_path):
    application = create_app(tmp_path / "create-record-type.db")

    async with application.router.lifespan_context(application):
        created_response = await request(
            application,
            "POST",
            "/api/record-types",
            json={
                "code": "gift-income",
                "name": " 礼金 ",
                "behavior": "income",
            },
        )
        duplicate_code = await request(
            application,
            "POST",
            "/api/record-types",
            json={"code": "gift-income", "name": "奖金", "behavior": "income"},
        )
        duplicate_name = await request(
            application,
            "POST",
            "/api/record-types",
            json={"code": "bonus", "name": "礼金", "behavior": "income"},
        )
        listed_response = await get(application, "/api/record-types")

    assert created_response.status_code == 201
    created = created_response.json()
    UUID(created["id"])
    assert created["code"] == "gift-income"
    assert created["name"] == "礼金"
    assert created["behavior"] == "income"
    assert created["is_system"] is False
    assert duplicate_code.status_code == 409
    assert duplicate_code.json()["code"] == "record_type_code_conflict"
    assert duplicate_name.status_code == 409
    assert duplicate_name.json()["code"] == "record_type_name_conflict"
    assert listed_response.json()["items"] == [created]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("path", "payload"),
    (
        ("/api/categories", {"name": ""}),
        ("/api/record-types", {"code": "Gift", "name": "礼金", "behavior": "income"}),
        ("/api/record-types", {"code": "gift", "name": "礼金", "behavior": "deposit"}),
        ("/api/record-types", {"code": "gift", "name": "", "behavior": "income"}),
    ),
)
async def test_option_create_maps_invalid_request_to_unified_422(tmp_path, path, payload):
    application = create_app(tmp_path / "invalid-option.db")

    async with application.router.lifespan_context(application):
        response = await request(application, "POST", path, json=payload)

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "request_validation_failed"
    assert body["message"] == "请求字段不合法"
    assert body["details"]


@pytest.mark.anyio
async def test_patch_category_updates_custom_name_and_trims_whitespace(tmp_path):
    application = create_app(tmp_path / "update-category.db")

    async with application.router.lifespan_context(application):
        created = await request(
            application,
            "POST",
            "/api/categories",
            json={"name": "旧名称"},
        )
        updated = await request(
            application,
            "PATCH",
            f"/api/categories/{created.json()['id']}",
            json={"name": " 新名称 "},
        )
        listed = await get(application, "/api/categories")

    assert created.status_code == 201
    assert updated.status_code == 200
    assert updated.json()["name"] == "新名称"
    assert updated.json()["is_system"] is False
    assert listed.json()["items"] == [updated.json()]


@pytest.mark.anyio
async def test_patch_category_rejects_duplicate_system_and_foreign_options(tmp_path):
    database_path = tmp_path / "invalid-category-update.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_options(database_path, application.state.current_user_id)
        duplicate = await request(
            application,
            "PATCH",
            "/api/categories/category-custom",
            json={"name": "餐饮"},
        )
        system = await request(
            application,
            "PATCH",
            "/api/categories/category-system",
            json={"name": "新系统类别"},
        )
        foreign = await request(
            application,
            "PATCH",
            "/api/categories/category-other",
            json={"name": "越权类别"},
        )

    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "category_name_conflict"
    assert system.status_code == 409
    assert system.json()["code"] == "system_option_immutable"
    assert foreign.status_code == 404
    assert foreign.json()["code"] == "category_not_found"


@pytest.mark.anyio
async def test_delete_category_archives_option_and_keeps_historical_record(tmp_path):
    database_path = tmp_path / "archive-category.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_options(database_path, application.state.current_user_id)
        book = await request(application, "POST", "/api/books", json={"name": "历史"})
        book_id = book.json()["id"]
        with connect_database(database_path) as connection:
            connection.execute(
                "INSERT INTO accounts (id, book_id, name, kind) VALUES (?, ?, ?, ?)",
                ("archive-category-account", book_id, "现金", "asset"),
            )
            connection.execute(
                """
                INSERT INTO records
                    (id, book_id, type_id, category_id, account_id, amount_cents, occurred_on)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "archive-category-record",
                    book_id,
                    "type-expense",
                    "category-custom",
                    "archive-category-account",
                    100,
                    "2026-09-15",
                ),
            )
        deleted = await request(
            application,
            "DELETE",
            "/api/categories/category-custom",
        )
        listed = await get(application, "/api/categories")

    assert deleted.status_code == 204
    assert "category-custom" not in {item["id"] for item in listed.json()["items"]}
    with connect_database(database_path) as connection:
        archived = connection.execute(
            "SELECT archived_at FROM categories WHERE id = ?",
            ("category-custom",),
        ).fetchone()["archived_at"]
        record_count = connection.execute(
            "SELECT COUNT(*) AS count FROM records WHERE id = ?",
            ("archive-category-record",),
        ).fetchone()["count"]
    assert archived is not None
    assert record_count == 1


@pytest.mark.anyio
async def test_patch_record_type_updates_name_and_preserves_code_and_behavior(tmp_path):
    application = create_app(tmp_path / "update-record-type.db")

    async with application.router.lifespan_context(application):
        created = await request(
            application,
            "POST",
            "/api/record-types",
            json={"code": "gift-income", "name": "礼金", "behavior": "income"},
        )
        updated = await request(
            application,
            "PATCH",
            f"/api/record-types/{created.json()['id']}",
            json={"name": "奖金"},
        )
        listed = await get(application, "/api/record-types")

    assert updated.status_code == 200
    assert updated.json()["name"] == "奖金"
    assert updated.json()["code"] == "gift-income"
    assert updated.json()["behavior"] == "income"
    assert listed.json()["items"] == [updated.json()]


@pytest.mark.anyio
async def test_patch_record_type_rejects_system_and_foreign_options(tmp_path):
    database_path = tmp_path / "invalid-record-type-update.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_options(database_path, application.state.current_user_id)
        system = await request(
            application,
            "PATCH",
            "/api/record-types/type-expense",
            json={"name": "新系统类型"},
        )
        foreign = await request(
            application,
            "PATCH",
            "/api/record-types/type-other",
            json={"name": "越权类型"},
        )

    assert system.status_code == 409
    assert system.json()["code"] == "system_option_immutable"
    assert foreign.status_code == 404
    assert foreign.json()["code"] == "record_type_not_found"


@pytest.mark.anyio
async def test_delete_record_type_archives_option_and_keeps_historical_record(tmp_path):
    database_path = tmp_path / "archive-record-type.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_options(database_path, application.state.current_user_id)
        book = await request(application, "POST", "/api/books", json={"name": "历史"})
        book_id = book.json()["id"]
        with connect_database(database_path) as connection:
            connection.execute(
                "INSERT INTO accounts (id, book_id, name, kind) VALUES (?, ?, ?, ?)",
                ("archive-type-account", book_id, "现金", "asset"),
            )
            connection.execute(
                """
                INSERT INTO records
                    (id, book_id, type_id, category_id, account_id, amount_cents, occurred_on)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "archive-type-record",
                    book_id,
                    "type-custom",
                    "category-system",
                    "archive-type-account",
                    100,
                    "2026-09-15",
                ),
            )
        deleted = await request(
            application,
            "DELETE",
            "/api/record-types/type-custom",
        )
        listed = await get(application, "/api/record-types")

    assert deleted.status_code == 204
    assert "type-custom" not in {item["id"] for item in listed.json()["items"]}
    with connect_database(database_path) as connection:
        archived = connection.execute(
            "SELECT archived_at FROM record_types WHERE id = ?",
            ("type-custom",),
        ).fetchone()["archived_at"]
        record_count = connection.execute(
            "SELECT COUNT(*) AS count FROM records WHERE id = ?",
            ("archive-type-record",),
        ).fetchone()["count"]
    assert archived is not None
    assert record_count == 1

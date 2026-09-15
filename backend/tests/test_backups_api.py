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


def seed_export_data(database_path, user_id):
    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            ("foreign-user", "foreign@example.com", "他人用户"),
        )
        connection.execute(
            "INSERT INTO books (id, user_id, name, group_name) VALUES (?, ?, ?, ?)",
            ("export-book", user_id, "导出账本", "个人"),
        )
        connection.execute(
            "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
            ("foreign-book", "foreign-user", "他人账本"),
        )
        connection.execute(
            "INSERT INTO accounts (id, book_id, name, kind, initial_cents) VALUES (?, ?, ?, ?, ?)",
            ("export-account", "export-book", "现金", "asset", 10000),
        )
        connection.execute(
            "INSERT INTO categories (id, user_id, name, is_system, archived_at) VALUES (?, ?, ?, ?, ?)",
            ("export-category", user_id, "日常", 1, None),
        )
        connection.execute(
            """
            INSERT INTO record_types (id, user_id, code, name, behavior, is_system, archived_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("export-type", user_id, "expense", "支出", "expense", 1, None),
        )
        connection.execute(
            """
            INSERT INTO records
                (id, book_id, type_id, category_id, account_id, amount_cents, occurred_on, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "export-record",
                "export-book",
                "export-type",
                "export-category",
                "export-account",
                1234,
                "2026-09-15",
                "午餐",
            ),
        )


def import_payload():
    return {
        "format": "jizhangben-server-backup",
        "version": 1,
        "exported_at": "2026-09-15T00:00:00+00:00",
        "books": [{"id": "legacy-book", "name": "迁移账本", "group_name": "个人"}],
        "accounts": [
            {
                "id": "legacy-account",
                "book_id": "legacy-book",
                "name": "银行卡",
                "kind": "asset",
                "initial_cents": 100000,
            }
        ],
        "categories": [
            {"id": "legacy-category", "name": "住房", "is_system": False, "archived_at": None}
        ],
        "record_types": [
            {
                "id": "legacy-deposit-type",
                "code": "deposit",
                "name": "押金",
                "behavior": "deposit",
                "is_system": True,
                "archived_at": None,
            }
        ],
        "records": [
            {
                "id": "legacy-return",
                "book_id": "legacy-book",
                "type_id": "legacy-deposit-type",
                "category_id": "legacy-category",
                "account_id": "legacy-account",
                "to_account_id": None,
                "amount_cents": 70000,
                "occurred_on": "2026-09-15",
                "note": "退回押金",
                "deposit_direction": "returned_to_me",
                "deposit_target": "房东",
                "deposit_link_id": "legacy-original",
                "deposit_final": True,
            },
            {
                "id": "legacy-original",
                "book_id": "legacy-book",
                "type_id": "legacy-deposit-type",
                "category_id": "legacy-category",
                "account_id": "legacy-account",
                "to_account_id": None,
                "amount_cents": 100000,
                "occurred_on": "2026-09-01",
                "note": "支付押金",
                "deposit_direction": "pay",
                "deposit_target": "房东",
                "deposit_link_id": None,
                "deposit_final": False,
            },
        ],
    }


@pytest.mark.anyio
async def test_export_contains_only_current_user_data(tmp_path):
    database_path = tmp_path / "export.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_export_data(database_path, application.state.current_user_id)
        response = await request(application, "GET", "/api/backups/export")

    assert response.status_code == 200
    body = response.json()
    assert body["format"] == "jizhangben-server-backup"
    assert body["version"] == 1
    assert body["exported_at"]
    assert [item["id"] for item in body["books"]] == ["export-book"]
    assert [item["id"] for item in body["accounts"]] == ["export-account"]
    assert [item["id"] for item in body["categories"]] == ["export-category"]
    assert [item["id"] for item in body["record_types"]] == ["export-type"]
    assert [item["id"] for item in body["records"]] == ["export-record"]
    assert "user_id" not in body["books"][0]
    assert body["categories"][0]["is_system"] is True
    assert body["records"][0]["amount_cents"] == 1234


@pytest.mark.anyio
async def test_import_replaces_data_and_remaps_deposit_links(tmp_path):
    database_path = tmp_path / "import.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        old = await request(application, "POST", "/api/books", json={"name": "旧账本"})
        response = await request(application, "POST", "/api/backups/import", json=import_payload())
        listed = await request(application, "GET", "/api/books")

    assert old.status_code == 201
    assert response.status_code == 200
    body = response.json()
    assert body["imported"] == {
        "books": 1,
        "accounts": 1,
        "categories": 1,
        "record_types": 1,
        "records": 2,
    }
    assert body["id_map"]["books"]["legacy-book"] != "legacy-book"
    assert body["id_map"]["records"]["legacy-original"] != "legacy-original"
    assert listed.json()["items"][0]["name"] == "迁移账本"
    assert listed.json()["items"][0]["id"] == body["id_map"]["books"]["legacy-book"]

    with connect_database(database_path) as connection:
        records = connection.execute(
            "SELECT id, deposit_link_id FROM records ORDER BY occurred_on"
        ).fetchall()
        old_count = connection.execute(
            "SELECT COUNT(*) AS count FROM books WHERE name = ?", ("旧账本",)
        ).fetchone()["count"]
    assert tuple(records[0]) == (
        body["id_map"]["records"]["legacy-original"],
        None,
    )
    assert tuple(records[1]) == (
        body["id_map"]["records"]["legacy-return"],
        body["id_map"]["records"]["legacy-original"],
    )
    assert old_count == 0


@pytest.mark.anyio
async def test_invalid_import_is_rejected_before_replacing_current_data(tmp_path):
    database_path = tmp_path / "invalid-import.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        created = await request(application, "POST", "/api/books", json={"name": "原账本"})
        invalid = import_payload()
        invalid["accounts"][0]["book_id"] = "missing-book"
        response = await request(application, "POST", "/api/backups/import", json=invalid)
        listed = await request(application, "GET", "/api/books")

    assert created.status_code == 201
    assert response.status_code == 422
    assert response.json() == {
        "code": "backup_invalid",
        "message": "账户引用了不存在的账本",
    }
    assert [item["name"] for item in listed.json()["items"]] == ["原账本"]


@pytest.mark.anyio
async def test_import_rejects_unsupported_version_with_unified_422(tmp_path):
    application = create_app(tmp_path / "unsupported-import.db")
    async with application.router.lifespan_context(application):
        invalid = import_payload()
        invalid["version"] = 2
        response = await request(application, "POST", "/api/backups/import", json=invalid)

    assert response.status_code == 422
    assert response.json() == {
        "code": "backup_invalid",
        "message": "备份版本不受支持",
    }

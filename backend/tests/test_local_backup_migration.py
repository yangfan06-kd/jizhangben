import copy
import json

import pytest
from httpx2 import ASGITransport, AsyncClient

from backend.app.main import create_app
from backend.app.services.local_backup_migration import (
    LocalBackupMigrationError,
    convert_local_backup,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def request(application, method, path, **kwargs):
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.request(method, path, **kwargs)


def local_backup():
    storage = {
        "jizhangben_books": json.dumps([
            {"id": 10, "name": "脱敏日常账", "category": "个人"}
        ]),
        "jizhangben_accounts_10": json.dumps([
            {"id": 1, "name": "演示现金", "kind": "资金", "initialCents": 200000},
            {"id": 2, "name": "演示信用卡", "kind": "负债", "initialCents": 0},
        ]),
        "jizhangben_records_10": json.dumps([
            {"id": 1, "type": "支出", "category": "餐饮", "amountCents": 1200,
             "date": "2026-09-15", "note": "脱敏午餐", "account": 1},
            {"id": 11, "type": "押金", "category": "居住", "amountCents": 100000,
             "date": "2026-09-01", "note": "脱敏押金", "account": 1, "depositDir": "付",
             "depositTarget": "房东", "depositFinal": False},
            {"id": 12, "type": "押金", "category": "居住", "amountCents": 70000,
             "date": "2026-09-15", "note": "脱敏退回", "account": 1, "depositDir": "退回",
             "depositTarget": "房东", "depositLinkId": 11, "depositFinal": True},
            {"id": 13, "type": "转账", "category": "其他", "amountCents": 5000,
             "date": "2026-09-15", "note": "脱敏转账", "account": 1, "toAccount": 2},
        ]),
        "jizhangben_custom_types": json.dumps([
            {"name": "兼职收入", "side": "income"}
        ]),
        "jizhangben_custom_categories": json.dumps(["宠物"]),
        "jizhangben_schema_version": "2",
    }
    return {
        "format": "jizhangben-backup",
        "version": 2,
        "exportedAt": "2026-09-15T00:00:00.000Z",
        "storage": storage,
    }


def test_convert_local_backup_builds_scoped_ids_and_preserves_links():
    payload = convert_local_backup(local_backup())

    assert payload["format"] == "jizhangben-server-backup"
    assert payload["version"] == 1
    assert len(payload["books"]) == 1
    assert len(payload["accounts"]) == 2
    assert len(payload["categories"]) == 9
    assert len(payload["record_types"]) == 10
    assert len(payload["records"]) == 4

    original = next(record for record in payload["records"] if record["id"].endswith(":11"))
    returned = next(record for record in payload["records"] if record["id"].endswith(":12"))
    transfer = next(record for record in payload["records"] if record["id"].endswith(":13"))
    assert returned["deposit_link_id"] == original["id"]
    assert transfer["account_id"] != transfer["to_account_id"]
    assert transfer["account_id"].startswith("account:10:")
    assert returned["deposit_direction"] == "returned_to_me"


def test_convert_local_backup_supports_legacy_flat_storage():
    legacy = {
        "jizhangben_records": json.dumps([]),
        "jizhangben_accounts": json.dumps([]),
    }
    payload = convert_local_backup(legacy)

    assert payload["books"] == [{
        "id": "book:legacy-book",
        "name": "我的账本",
        "group_name": "个人",
    }]
    assert len(payload["accounts"]) == 7
    assert payload["records"] == []


def test_convert_local_backup_rejects_unknown_record_type():
    backup = local_backup()
    records = json.loads(backup["storage"]["jizhangben_records_10"])
    records[0]["type"] = "未知类型"
    backup["storage"]["jizhangben_records_10"] = json.dumps(records)

    with pytest.raises(LocalBackupMigrationError, match="未定义的记账类型"):
        convert_local_backup(backup)


@pytest.mark.anyio
async def test_preview_local_backup_returns_reconciliation_without_writing(tmp_path):
    database_path = tmp_path / "preview.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        response = await request(application, "POST", "/api/backups/preview-local", json=local_backup())
        books = await request(application, "GET", "/api/books")

    assert response.status_code == 200
    body = response.json()
    assert body["counts"] == {
        "books": 1,
        "accounts": 2,
        "categories": 9,
        "record_types": 10,
        "records": 4,
    }
    assert body["books"] == [{
        "id": "book:10",
        "name": "脱敏日常账",
        "group_name": "个人",
        "accounts": 2,
        "records": 4,
        "income_cents": 0,
        "expense_cents": 31200,
        "net_worth_cents": 168800,
    }]
    assert body["totals"] == {
        "income_cents": 0,
        "expense_cents": 31200,
        "net_worth_cents": 168800,
    }
    assert books.status_code == 200
    assert books.json()["items"] == []


@pytest.mark.anyio
async def test_import_local_backup_converts_only_when_explicitly_called(tmp_path):
    database_path = tmp_path / "import-local.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        response = await request(application, "POST", "/api/backups/import-local", json=local_backup())
        books = await request(application, "GET", "/api/books")

    assert response.status_code == 200
    assert response.json()["imported"]["records"] == 4
    assert len(books.json()["items"]) == 1
    assert books.json()["items"][0]["name"] == "脱敏日常账"


@pytest.mark.anyio
async def test_migration_payload_imports_and_reconciles_counts_and_totals(tmp_path):
    database_path = tmp_path / "migration.db"
    application = create_app(database_path)
    payload = convert_local_backup(local_backup())

    async with application.router.lifespan_context(application):
        response = await request(application, "POST", "/api/backups/import", json=payload)
        books = await request(application, "GET", "/api/books")
        book_id = books.json()["items"][0]["id"]
        accounts = await request(application, "GET", f"/api/books/{book_id}/accounts")
        records = await request(application, "GET", f"/api/books/{book_id}/records")
        overview = await request(application, "GET", "/api/overview")

    assert response.status_code == 200
    body = response.json()
    assert body["imported"] == {
        "books": 1,
        "accounts": 2,
        "categories": 9,
        "record_types": 10,
        "records": 4,
    }
    assert body["id_map"]["books"]["book:10"] == book_id
    assert body["id_map"]["accounts"]["account:10:1"] != "account:10:1"
    assert accounts.status_code == 200
    assert len(accounts.json()["items"]) == 2
    assert records.status_code == 200
    assert len(records.json()["items"]) == 4
    imported_return = next(item for item in records.json()["items"] if item["note"] == "脱敏退回")
    assert imported_return["deposit_link_id"] == body["id_map"]["records"]["record:10:11"]
    assert overview.status_code == 200
    item = overview.json()["items"][0]
    assert item["income_cents"] == 0
    assert item["expense_cents"] == 31200
    assert item["net_worth_cents"] == 168800
    assert overview.json()["totals"]["net_worth_cents"] == 168800


@pytest.mark.anyio
async def test_invalid_migration_payload_keeps_existing_server_data(tmp_path):
    database_path = tmp_path / "migration-rollback.db"
    application = create_app(database_path)
    payload = convert_local_backup(local_backup())
    invalid = copy.deepcopy(payload)
    invalid["accounts"][0]["book_id"] = "missing-book"

    async with application.router.lifespan_context(application):
        created = await request(application, "POST", "/api/books", json={"name": "原有服务端账本"})
        response = await request(application, "POST", "/api/backups/import", json=invalid)
        books = await request(application, "GET", "/api/books")

    assert created.status_code == 201
    assert response.status_code == 422
    assert response.json()["code"] == "backup_invalid"
    assert [item["name"] for item in books.json()["items"]] == ["原有服务端账本"]

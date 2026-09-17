import asyncio
import sqlite3

import pytest
from httpx2 import ASGITransport, AsyncClient

from backend.app.main import create_app


@pytest.mark.anyio
async def test_register_sets_session_and_scopes_resources_to_new_user(tmp_path):
    application = create_app(tmp_path / "auth-register.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            registered = await client.post(
                "/api/auth/register",
                json={
                    "email": "learner@example.com",
                    "password": "correct-horse-battery",
                    "display_name": "学习者",
                },
            )
            assert registered.status_code == 201
            body = registered.json()
            assert body["email"] == "learner@example.com"
            assert "password" not in body
            assert "jizhangben_session" in registered.cookies

            me = await client.get("/api/auth/me")
            assert me.status_code == 200
            assert me.json() == body

            books = await client.get("/api/books")
            assert books.status_code == 200
            assert books.json() == {"items": []}

            categories = await client.get("/api/categories")
            record_types = await client.get("/api/record-types")
            assert len(categories.json()["items"]) == 8
            assert all(item["is_system"] for item in categories.json()["items"])
            assert len(record_types.json()["items"]) == 9
            assert all(item["is_system"] for item in record_types.json()["items"])

    with sqlite3.connect(application.state.database_path) as connection:
        password_hash = connection.execute(
            "SELECT password_hash FROM users WHERE email = ?",
            ("learner@example.com",),
        ).fetchone()[0]
    assert password_hash.startswith("pbkdf2_sha256$")
    assert "correct-horse-battery" not in password_hash


@pytest.mark.anyio
async def test_login_logout_and_invalid_credentials(tmp_path):
    application = create_app(tmp_path / "auth-login.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            await client.post(
                "/api/auth/register",
                json={
                    "email": "login@example.com",
                    "password": "correct-horse-battery",
                    "display_name": "登录者",
                },
            )
            await client.post("/api/auth/logout")

            invalid = await client.post(
                "/api/auth/login",
                json={"email": "login@example.com", "password": "wrong-password"},
            )
            assert invalid.status_code == 401
            assert invalid.json()["code"] == "invalid_credentials"

            logged_in = await client.post(
                "/api/auth/login",
                json={"email": "LOGIN@example.com", "password": "correct-horse-battery"},
            )
            assert logged_in.status_code == 200
            assert logged_in.json()["display_name"] == "登录者"

            logged_out = await client.post("/api/auth/logout")
            assert logged_out.status_code == 204
            assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.anyio
async def test_https_session_cookie_can_be_configured_for_capacitor_origin(tmp_path, monkeypatch):
    monkeypatch.setenv("JIZHANGBEN_SESSION_SAMESITE", "none")
    monkeypatch.setenv("JIZHANGBEN_SESSION_SECURE", "1")
    application = create_app(tmp_path / "auth-https-cookie.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="https://testserver") as client:
            registered = await client.post(
                "/api/auth/register",
                json={
                    "email": "https@example.com",
                    "password": "correct-horse-battery",
                    "display_name": "HTTPS 用户",
                },
            )

    cookie = registered.headers["set-cookie"].lower()
    assert "samesite=none" in cookie
    assert "secure" in cookie


@pytest.mark.anyio
async def test_invalid_session_cookie_cannot_use_development_fallback(tmp_path):
    application = create_app(tmp_path / "auth-invalid-session.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            client.cookies.set("jizhangben_session", "invalid-token")
            response = await client.get("/api/books")
            assert response.status_code == 401
            assert response.json()["code"] == "authentication_required"


@pytest.mark.anyio
async def test_development_fallback_can_be_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("JIZHANGBEN_ALLOW_DEV_FALLBACK", "0")
    application = create_app(tmp_path / "auth-required.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/api/books")
            assert response.status_code == 401
            assert response.json()["code"] == "authentication_required"


@pytest.mark.anyio
async def test_business_endpoints_require_login_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("JIZHANGBEN_ALLOW_DEV_FALLBACK", raising=False)
    application = create_app(tmp_path / "auth-default-required.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            responses = await asyncio.gather(
                client.get("/api/books"),
                client.get("/api/categories"),
                client.get("/api/record-types"),
                client.get("/api/overview"),
                client.get("/api/backups/export"),
            )

    assert [response.status_code for response in responses] == [401] * 5
    assert all(response.json()["code"] == "authentication_required" for response in responses)


@pytest.mark.anyio
async def test_two_authenticated_clients_share_data_but_other_user_cannot_read_it(tmp_path):
    application = create_app(tmp_path / "auth-cross-device.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with (
            AsyncClient(transport=transport, base_url="http://testserver") as phone,
            AsyncClient(transport=transport, base_url="http://testserver") as desktop,
            AsyncClient(transport=transport, base_url="http://testserver") as other,
        ):
            credentials = {
                "email": "cross-device@example.com",
                "password": "correct-horse-battery",
                "display_name": "跨设备用户",
            }
            registered = await phone.post("/api/auth/register", json=credentials)
            assert registered.status_code == 201

            book = await phone.post(
                "/api/books",
                json={"name": "跨设备账本", "group_name": "个人"},
            )
            assert book.status_code == 201
            book_id = book.json()["id"]
            account = await phone.post(
                f"/api/books/{book_id}/accounts",
                json={"name": "银行卡", "kind": "asset", "initial_cents": 100000},
            )
            category = await phone.post("/api/categories", json={"name": "午餐类别"})
            record_type = await phone.post(
                "/api/record-types",
                json={"code": "lunch", "name": "午餐", "behavior": "expense"},
            )
            assert account.status_code == 201
            assert category.status_code == 201
            assert record_type.status_code == 201
            created_record = await phone.post(
                f"/api/books/{book_id}/records",
                json={
                    "type_id": record_type.json()["id"],
                    "category_id": category.json()["id"],
                    "account_id": account.json()["id"],
                    "amount_cents": 1234,
                    "occurred_on": "2026-09-16",
                    "note": "跨设备午餐",
                },
            )
            assert created_record.status_code == 201

            logged_in = await desktop.post(
                "/api/auth/login",
                json={"email": credentials["email"], "password": credentials["password"]},
            )
            assert logged_in.status_code == 200
            desktop_books = await desktop.get("/api/books")
            desktop_accounts = await desktop.get(f"/api/books/{book_id}/accounts")
            desktop_records = await desktop.get(f"/api/books/{book_id}/records")
            desktop_overview = await desktop.get("/api/overview")

            other_credentials = {
                "email": "cross-device-other@example.com",
                "password": "correct-horse-battery",
                "display_name": "另一位用户",
            }
            other_registered = await other.post("/api/auth/register", json=other_credentials)
            assert other_registered.status_code == 201
            other_books = await other.get("/api/books")
            other_accounts = await other.get(f"/api/books/{book_id}/accounts")

    assert len(desktop_books.json()["items"]) == 1
    assert desktop_books.json()["items"][0]["id"] == book_id
    assert desktop_books.json()["items"][0]["name"] == "跨设备账本"
    assert desktop_books.json()["items"][0]["group_name"] == "个人"
    assert len(desktop_accounts.json()["items"]) == 8
    saved_account = next(item for item in desktop_accounts.json()["items"] if item["id"] == account.json()["id"])
    assert saved_account["book_id"] == book_id
    assert saved_account["initial_cents"] == 100000
    assert desktop_records.json()["items"][0]["id"] == created_record.json()["id"]
    assert desktop_records.json()["items"][0]["note"] == "跨设备午餐"
    assert desktop_overview.json()["totals"] == {
        "income_cents": 0,
        "expense_cents": 1234,
        "net_worth_cents": 98766,
    }
    assert other_books.json() == {"items": []}
    assert other_accounts.status_code == 404
    assert other_accounts.json()["code"] == "book_not_found"


@pytest.mark.anyio
async def test_expired_session_is_rejected_and_removed(tmp_path):
    application = create_app(tmp_path / "auth-expired.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            registered = await client.post(
                "/api/auth/register",
                json={
                    "email": "expired@example.com",
                    "password": "correct-horse-battery",
                    "display_name": "过期会话",
                },
            )
            assert registered.status_code == 201
            token = registered.cookies.get("jizhangben_session")
            assert token

            with sqlite3.connect(application.state.database_path) as connection:
                connection.execute("UPDATE sessions SET expires_at = 0")

            response = await client.get("/api/books")
            assert response.status_code == 401
            assert response.json()["code"] == "authentication_required"

            with sqlite3.connect(application.state.database_path) as connection:
                assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


@pytest.mark.anyio
async def test_register_rejects_duplicate_email_without_creating_second_user(tmp_path):
    application = create_app(tmp_path / "auth-duplicate.db")
    transport = ASGITransport(app=application)

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            payload = {
                "email": "duplicate@example.com",
                "password": "correct-horse-battery",
                "display_name": "第一位",
            }
            assert (await client.post("/api/auth/register", json=payload)).status_code == 201
            await client.post("/api/auth/logout")
            duplicate = await client.post(
                "/api/auth/register",
                json={**payload, "display_name": "第二位"},
            )
            assert duplicate.status_code == 409
            assert duplicate.json()["code"] == "email_exists"

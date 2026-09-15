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

import sqlite3

import pytest
from httpx2 import ASGITransport, AsyncClient

from backend.app.main import create_app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_health_creates_and_queries_temporary_database(tmp_path):
    database_path = tmp_path / "health-test.db"
    application = create_app(database_path)

    transport = ASGITransport(app=application)
    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "ok",
        "schema_version": 5,
    }
    assert database_path.exists()

    with sqlite3.connect(database_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert {
        "schema_migrations",
        "users",
        "books",
        "accounts",
        "categories",
        "record_types",
        "records",
        "sessions",
    } <= tables

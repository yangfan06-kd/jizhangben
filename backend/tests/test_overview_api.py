from datetime import date, timedelta

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


def seed_overview_data(database_path, user_id):
    today = date.today()
    current_month_start = today.replace(day=1)
    previous_month_end = current_month_start - timedelta(days=1)
    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO books (id, user_id, name, group_name) VALUES (?, ?, ?, ?)",
            ("overview-book", user_id, "总览账本", "个人"),
        )
        connection.executemany(
            """
            INSERT INTO accounts (id, book_id, name, kind, initial_cents)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                ("overview-asset", "overview-book", "银行卡", "asset", 10000),
                ("overview-liability", "overview-book", "信用卡", "liability", 5000),
            ),
        )
        connection.execute(
            "INSERT INTO categories (id, user_id, name, is_system) VALUES (?, ?, ?, ?)",
            ("overview-category", user_id, "日常", 1),
        )
        connection.executemany(
            """
            INSERT INTO record_types (id, user_id, code, name, behavior, is_system)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                ("overview-income", user_id, "income", "收入", "income", 1),
                ("overview-expense", user_id, "expense", "支出", "expense", 1),
                ("overview-reversal", user_id, "reversal", "退款", "expense_reversal", 1),
                ("overview-transfer", user_id, "transfer", "转账", "transfer", 1),
                ("overview-deposit", user_id, "deposit", "押金", "deposit", 1),
            ),
        )
        connection.execute(
            """
            INSERT INTO records
                (id, book_id, type_id, category_id, account_id, amount_cents, occurred_on, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "overview-invalid-transfer",
                "overview-book",
                "overview-transfer",
                "overview-category",
                "overview-asset",
                999,
                str(today),
                "旧数据缺少转入账户",
            ),
        )
        connection.executemany(
            """
            INSERT INTO records (
                id, book_id, type_id, category_id, account_id, to_account_id,
                amount_cents, occurred_on, note, deposit_direction,
                deposit_target, deposit_link_id, deposit_final
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                (
                    "overview-income-record", "overview-book", "overview-income", "overview-category",
                    "overview-asset", None, 2000, str(today - timedelta(days=10)), "工资", None, None, None, 0,
                ),
                (
                    "overview-expense-record", "overview-book", "overview-expense", "overview-category",
                    "overview-asset", None, 3000, str(today - timedelta(days=9)), "日常", None, None, None, 0,
                ),
                (
                    "overview-transfer-record", "overview-book", "overview-transfer", "overview-category",
                    "overview-asset", "overview-liability", 1000, str(today - timedelta(days=8)), "还款", None, None, None, 0,
                ),
                (
                    "overview-deposit-original", "overview-book", "overview-deposit", "overview-category",
                    "overview-asset", None, 10000, str(today - timedelta(days=7)), "房东押金", "pay", "房东", None, 0,
                ),
                (
                    "overview-deposit-return", "overview-book", "overview-deposit", "overview-category",
                    "overview-asset", None, 7000, str(today - timedelta(days=6)), "退回押金", "returned_to_me", "房东", "overview-deposit-original", 1,
                ),
                (
                    "overview-reversal-record", "overview-book", "overview-reversal", "overview-category",
                    "overview-asset", None, 500, str(today - timedelta(days=5)), "退款", None, None, None, 0,
                ),
                (
                    "overview-old-expense", "overview-book", "overview-expense", "overview-category",
                    "overview-asset", None, 400, str(previous_month_end), "上月支出", None, None, None, 0,
                ),
            ),
        )


@pytest.mark.anyio
async def test_overview_matches_account_and_period_rules(tmp_path):
    database_path = tmp_path / "overview.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_overview_data(database_path, application.state.current_user_id)
        response = await request(application, "GET", "/api/overview")

    assert response.status_code == 200
    body = response.json()
    today = date.today()
    assert body["period_from"] == today.replace(day=1).isoformat()
    assert body["period_to"] == today.isoformat()
    assert body["totals"] == {
        "income_cents": 2000,
        "expense_cents": 5500,
        "net_worth_cents": 1100,
    }
    book = body["items"][0]
    assert book["income_cents"] == 2000
    assert book["expense_cents"] == 5500
    assert book["net_worth_cents"] == 1100
    assert book["accounts"] == [
        {
            "id": "overview-asset",
            "book_id": "overview-book",
            "name": "银行卡",
            "kind": "asset",
            "initial_cents": 10000,
            "balance_cents": 5100,
        },
        {
            "id": "overview-liability",
            "book_id": "overview-book",
            "name": "信用卡",
            "kind": "liability",
            "initial_cents": 5000,
            "balance_cents": 4000,
        },
    ]


@pytest.mark.anyio
async def test_overview_supports_period_filters_and_hides_foreign_book(tmp_path):
    database_path = tmp_path / "overview-filter.db"
    application = create_app(database_path)

    async with application.router.lifespan_context(application):
        seed_overview_data(database_path, application.state.current_user_id)
        with connect_database(database_path) as connection:
            connection.execute(
                "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
                ("overview-other-user", "overview-other@example.com", "其他用户"),
            )
            connection.execute(
                "INSERT INTO books (id, user_id, name) VALUES (?, ?, ?)",
                ("overview-other-book", "overview-other-user", "他人账本"),
            )
        today = date.today()
        response = await request(
            application,
            "GET",
            f"/api/overview?from={today.isoformat()}&to={today.isoformat()}",
        )

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["items"]] == ["overview-book"]
    assert body["totals"] == {
        "income_cents": 0,
        "expense_cents": 0,
        "net_worth_cents": 1100,
    }


@pytest.mark.anyio
async def test_overview_rejects_invalid_period(tmp_path):
    application = create_app(tmp_path / "overview-invalid-period.db")
    async with application.router.lifespan_context(application):
        response = await request(
            application,
            "GET",
            "/api/overview?from=2026-09-20&to=2026-09-01",
        )

    assert response.status_code == 422
    assert response.json() == {
        "code": "invalid_date_range",
        "message": "开始日期不能晚于结束日期",
    }

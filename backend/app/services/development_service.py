from pathlib import Path

from ..database import connect_database


DEVELOPMENT_USER_ID = "00000000-0000-0000-0000-000000000001"
DEVELOPMENT_USER_EMAIL = "local@jizhangben.invalid"
DEVELOPMENT_USER_DISPLAY_NAME = "本地开发用户"


def ensure_development_user(database_path: str | Path) -> dict[str, object]:
    """幂等建立阶段 3 使用的本地开发用户。"""
    with connect_database(database_path) as connection:
        user = connection.execute(
            "SELECT * FROM users WHERE id = ? OR email = ? ORDER BY id = ? DESC",
            (DEVELOPMENT_USER_ID, DEVELOPMENT_USER_EMAIL, DEVELOPMENT_USER_ID),
        ).fetchone()
        if user is None:
            connection.execute(
                "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
                (
                    DEVELOPMENT_USER_ID,
                    DEVELOPMENT_USER_EMAIL,
                    DEVELOPMENT_USER_DISPLAY_NAME,
                ),
            )
            user = connection.execute(
                "SELECT * FROM users WHERE id = ?",
                (DEVELOPMENT_USER_ID,),
            ).fetchone()

    return dict(user)

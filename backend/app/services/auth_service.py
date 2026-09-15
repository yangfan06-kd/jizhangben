"""登录用户、密码哈希和 Cookie 会话的最小服务层。"""

import base64
import hashlib
import hmac
import secrets
import sqlite3
import time
import uuid
from pathlib import Path

from .errors import BusinessValidationError
from ..database import connect_database


PASSWORD_ALGORITHM = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 310_000
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60


def _normalize_email(email: str) -> str:
    value = email.strip().lower()
    if "@" not in value or value.startswith("@") or value.endswith("@"):
        raise BusinessValidationError("email_invalid", "请输入有效的邮箱地址")
    return value


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    encode = lambda value: base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")
    return f"{PASSWORD_ALGORITHM}${PASSWORD_ITERATIONS}${encode(salt)}${encode(digest)}"


def _verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, iterations, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != PASSWORD_ALGORITHM:
            return False
        padding = lambda value: value + "=" * (-len(value) % 4)
        salt = base64.urlsafe_b64decode(padding(salt_text))
        expected = base64.urlsafe_b64decode(padding(digest_text))
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations),
        )
    except (TypeError, ValueError, UnicodeError):
        return False
    return hmac.compare_digest(actual, expected)


def _public_user(user: sqlite3.Row | dict[str, object]) -> dict[str, object]:
    return {
        "id": str(user["id"]),
        "email": str(user["email"]),
        "display_name": str(user["display_name"]),
    }


def register_user(
    database_path: str | Path,
    email: str,
    password: str,
    display_name: str,
) -> dict[str, object]:
    normalized_email = _normalize_email(email)
    if not password or len(password) < 8:
        raise BusinessValidationError("password_too_short", "密码至少需要 8 个字符")
    name = display_name.strip()
    if not name:
        raise BusinessValidationError("display_name_required", "请输入显示名称")
    user_id = str(uuid.uuid4())
    password_hash = _password_hash(password)
    try:
        with connect_database(database_path) as connection:
            connection.execute(
                "INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)",
                (user_id, normalized_email, name, password_hash),
            )
            user = connection.execute(
                "SELECT id, email, display_name FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
    except sqlite3.IntegrityError as error:
        if "users.email" in str(error).lower() or "unique" in str(error).lower():
            raise BusinessValidationError("email_exists", "这个邮箱已经注册") from error
        raise
    return _public_user(user)


def authenticate_user(
    database_path: str | Path,
    email: str,
    password: str,
) -> dict[str, object]:
    normalized_email = _normalize_email(email)
    with connect_database(database_path) as connection:
        user = connection.execute(
            "SELECT id, email, display_name, password_hash FROM users WHERE email = ? COLLATE NOCASE",
            (normalized_email,),
        ).fetchone()
    if user is None or not _verify_password(password, user["password_hash"]):
        raise BusinessValidationError("invalid_credentials", "邮箱或密码不正确")
    return _public_user(user)


def create_session(database_path: str | Path, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = int(time.time()) + SESSION_TTL_SECONDS
    with connect_database(database_path) as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        connection.execute(
            "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), user_id, token_hash, expires_at),
        )
    return token


def user_for_session(database_path: str | Path, token: str | None) -> dict[str, object] | None:
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = int(time.time())
    with connect_database(database_path) as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        user = connection.execute(
            """
            SELECT users.id, users.email, users.display_name
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()
    return _public_user(user) if user else None


def revoke_session(database_path: str | Path, token: str | None) -> None:
    if not token:
        return
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with connect_database(database_path) as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

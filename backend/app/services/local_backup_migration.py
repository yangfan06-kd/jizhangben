"""把网页 localStorage 备份转换成服务端备份契约。

这个模块只处理离线数据转换，不读取或写入真实数据库。转换后的 payload
交给现有 backup_service.import_backup()，由服务端负责事务、UUID 和关系校验。
"""

from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone
from typing import Any, Mapping


LOCAL_BACKUP_FORMAT = "jizhangben-backup"
SERVER_BACKUP_FORMAT = "jizhangben-server-backup"
SERVER_BACKUP_VERSION = 1

BUILTIN_CATEGORIES = ["餐饮", "交通", "购物", "娱乐", "居住", "医疗", "教育", "其他"]
BUILTIN_TYPES = [
    ("支出", "expense", "expense"),
    ("收入", "income", "income"),
    ("转账", "transfer", "transfer"),
    ("余额", "balance", "neutral"),
    ("借贷", "loan", "neutral"),
    ("代付", "pay_for_other", "outflow_neutral"),
    ("报销", "reimbursement", "expense_reversal"),
    ("退款", "refund", "expense_reversal"),
    ("押金", "deposit", "deposit"),
]

DEFAULT_ACCOUNTS = [
    (1, "现金", "asset"),
    (2, "银行卡", "asset"),
    (3, "支付宝", "asset"),
    (4, "微信", "asset"),
    (5, "信用卡", "liability"),
    (6, "花呗", "liability"),
    (7, "京东白条", "liability"),
]

DEPOSIT_DIRECTIONS = {
    "收": "receive",
    "退": "return_to_other",
    "付": "pay",
    "退回": "returned_to_me",
}


class LocalBackupMigrationError(ValueError):
    """本地备份无法安全转换时抛出的可读错误。"""


def _error(message: str) -> None:
    raise LocalBackupMigrationError(message)


def _parse_json(storage: Mapping[str, Any], key: str, default: Any) -> Any:
    raw = storage.get(key)
    if raw is None:
        return default
    if not isinstance(raw, str):
        _error(f"本地备份键 {key} 不是 JSON 字符串")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LocalBackupMigrationError(f"本地备份键 {key} 的 JSON 无法解析") from exc


def _storage_from_backup(backup: Mapping[str, Any]) -> Mapping[str, Any]:
    if backup.get("format") == LOCAL_BACKUP_FORMAT:
        version = backup.get("version")
        if not isinstance(version, int) or version < 1:
            _error("本地备份版本无效")
        storage = backup.get("storage")
        if not isinstance(storage, Mapping):
            _error("本地备份缺少 storage 对象")
        return storage
    if not isinstance(backup, Mapping) or not all(
        isinstance(key, str) and key.startswith("jizhangben_") for key in backup
    ):
        _error("不是支持的 localStorage 备份")
    return backup


def _source_id(prefix: str, value: Any) -> str:
    if isinstance(value, bool) or value is None:
        _error(f"{prefix} ID 无效")
    text = str(value).strip()
    if not text:
        _error(f"{prefix} ID 为空")
    return f"{prefix}:{text}"


def _as_list(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        _error(f"本地备份的{label}必须是对象数组")
    return value


def _cents(
    item: Mapping[str, Any],
    cents_key: str,
    amount_key: str,
    label: str,
    minimum: int = 1,
) -> int:
    raw = item.get(cents_key)
    if raw is None:
        raw = item.get(amount_key)
        if isinstance(raw, bool):
            _error(f"{label}金额无效")
        try:
            number = float(raw)
        except (TypeError, ValueError):
            _error(f"{label}金额无效")
        if not math.isfinite(number):
            _error(f"{label}金额无效")
        result = math.floor(number * 100 + 0.5)
    else:
        if isinstance(raw, bool):
            _error(f"{label}分金额无效")
        try:
            number = float(raw)
        except (TypeError, ValueError):
            _error(f"{label}分金额无效")
        if not math.isfinite(number) or number != math.floor(number):
            _error(f"{label}分金额必须是整数")
        result = int(number)
    if result < minimum:
        _error(f"{label}金额必须大于 0" if minimum > 0 else f"{label}金额不能为负")
    return result


def _name(item: Mapping[str, Any], key: str, label: str, max_length: int = 100) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_length:
        _error(f"{label}{key}无效")
    return value.strip()


def _date_value(value: Any, label: str) -> str:
    if not isinstance(value, str):
        _error(f"{label}日期无效")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise LocalBackupMigrationError(f"{label}日期无效") from exc


def _book_records(storage: Mapping[str, Any], book_id: Any, legacy: bool) -> list[dict[str, Any]]:
    key = "jizhangben_records" if legacy else f"jizhangben_records_{book_id}"
    value = _parse_json(storage, key, [])
    return _as_list(value, "账目")


def _book_accounts(storage: Mapping[str, Any], book_id: Any, legacy: bool) -> list[dict[str, Any]]:
    key = "jizhangben_accounts" if legacy else f"jizhangben_accounts_{book_id}"
    value = _parse_json(storage, key, None)
    if value is None or value == []:
        return [
            {"id": account_id, "name": name, "kind": "资金" if kind == "asset" else "负债", "initial": 0}
            for account_id, name, kind in DEFAULT_ACCOUNTS
        ]
    return _as_list(value, "账户")


def _local_books(storage: Mapping[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    value = _parse_json(storage, "jizhangben_books", None)
    if value is not None:
        books = _as_list(value, "账本")
        if not books:
            _error("本地备份至少需要一个账本")
        return books, False

    # 兼容 v1 的单账本扁平键。
    if "jizhangben_records" in storage or "jizhangben_accounts" in storage:
        return [{"id": "legacy-book", "name": "我的账本", "category": "个人"}], True
    _error("本地备份缺少账本")


def convert_local_backup(backup: Mapping[str, Any]) -> dict[str, Any]:
    """把 localStorage 备份转换为服务端 v1 备份 payload。"""
    storage = _storage_from_backup(backup)
    books, legacy = _local_books(storage)

    book_sources: dict[str, dict[str, Any]] = {}
    server_books: list[dict[str, Any]] = []
    for book in books:
        source = str(book.get("id")).strip()
        if not source or source in book_sources:
            _error("本地备份的账本 ID 重复或为空")
        book_sources[source] = book
        server_books.append({
            "id": _source_id("book", source),
            "name": _name(book, "name", "账本"),
            "group_name": str(book.get("category") or "未分类").strip()[:100],
        })

    custom_types = _parse_json(storage, "jizhangben_custom_types", [])
    custom_categories = _parse_json(storage, "jizhangben_custom_categories", [])
    if not isinstance(custom_types, list) or not isinstance(custom_categories, list):
        _error("自定义选项必须是数组")

    category_names = list(BUILTIN_CATEGORIES)
    for category in custom_categories:
        if not isinstance(category, str) or not category.strip():
            _error("自定义类别无效")
        category = category.strip()
        if category.casefold() in {name.casefold() for name in category_names}:
            _error("自定义类别与已有类别重名")
        category_names.append(category)
    category_ids = {
        name: _source_id("category", name) for name in category_names
    }
    server_categories = [
        {"id": category_ids[name], "name": name, "is_system": index < len(BUILTIN_CATEGORIES), "archived_at": None}
        for index, name in enumerate(category_names)
    ]

    type_names = [item[0] for item in BUILTIN_TYPES]
    server_types: list[dict[str, Any]] = [
        {"id": _source_id("type", code), "code": code, "name": name, "behavior": behavior, "is_system": True, "archived_at": None}
        for name, code, behavior in BUILTIN_TYPES
    ]
    type_ids = {name: item["id"] for name, item in zip(type_names, server_types)}
    for index, item in enumerate(custom_types):
        if isinstance(item, str):
            name = item.strip()
            side = "neutral"
        elif isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            side = item.get("side", "neutral")
        else:
            _error("自定义记账类型无效")
        if not name or name.casefold() in {existing.casefold() for existing in type_names}:
            _error("自定义记账类型为空或重名")
        if side not in {"income", "expense", "neutral"}:
            _error("自定义记账类型的收支方向无效")
        behavior = side
        code = f"custom_type_{index + 1}"
        source_id = _source_id("type", code)
        type_names.append(name)
        type_ids[name] = source_id
        server_types.append({
            "id": source_id,
            "code": code,
            "name": name,
            "behavior": behavior,
            "is_system": False,
            "archived_at": None,
        })

    server_accounts: list[dict[str, Any]] = []
    account_ids: dict[tuple[str, str], str] = {}
    account_names: dict[tuple[str, str], str] = {}
    records_by_book: dict[str, list[dict[str, Any]]] = {}
    record_ids: dict[tuple[str, str], str] = {}

    for book in books:
        local_book_id = str(book.get("id")).strip()
        server_book_id = _source_id("book", local_book_id)
        accounts = _book_accounts(storage, book.get("id"), legacy)
        for account in accounts:
            old_id = str(account.get("id")).strip()
            if not old_id or (local_book_id, old_id) in account_ids:
                _error("本地备份的账户 ID 重复或为空")
            kind = account.get("kind")
            if kind not in {"资金", "负债"}:
                _error("账户类型无效")
            source_id = _source_id(f"account:{local_book_id}", old_id)
            account_ids[(local_book_id, old_id)] = source_id
            account_name = _name(account, "name", "账户")
            account_names[(local_book_id, old_id)] = account_name
            initial_cents = (
                _cents(account, "initialCents", "initial", "账户", minimum=0)
                if account.get("initialCents") is not None or account.get("initial") not in (None, "")
                else 0
            )
            server_accounts.append({
                "id": source_id,
                "book_id": server_book_id,
                "name": account_name,
                "kind": "asset" if kind == "资金" else "liability",
                "initial_cents": initial_cents,
            })

        local_records = _book_records(storage, book.get("id"), legacy)
        records_by_book[local_book_id] = local_records
        for record in local_records:
            old_id = str(record.get("id")).strip()
            if not old_id or (local_book_id, old_id) in record_ids:
                _error("本地备份的账目 ID 重复或为空")
            record_ids[(local_book_id, old_id)] = _source_id(f"record:{local_book_id}", old_id)

    server_records: list[dict[str, Any]] = []
    for book in books:
        local_book_id = str(book.get("id")).strip()
        server_book_id = _source_id("book", local_book_id)
        for record in records_by_book[local_book_id]:
            record_type = str(record.get("type") or "").strip()
            category = str(record.get("category") or "其他").strip()
            if record_type not in type_ids:
                _error(f"账目引用了未定义的记账类型：{record_type}")
            if category not in category_ids:
                _error(f"账目引用了未定义的类别：{category}")
            account = record.get("account")
            to_account = record.get("toAccount")
            account_id = account_ids.get((local_book_id, str(account))) if account not in (None, "") else None
            to_account_id = account_ids.get((local_book_id, str(to_account))) if to_account not in (None, "") else None
            if account not in (None, "") and account_id is None:
                _error("账目引用了不存在的账户")
            if to_account not in (None, "") and to_account_id is None:
                _error("账目引用了不存在的转入账户")
            direction = record.get("depositDir")
            deposit_direction = DEPOSIT_DIRECTIONS.get(direction) if direction else None
            if direction and deposit_direction is None:
                _error("押金方向无效")
            link = record.get("depositLinkId")
            deposit_link_id = record_ids.get((local_book_id, str(link))) if link not in (None, "") else None
            if link not in (None, "") and deposit_link_id is None:
                _error("押金关联了不存在的账目")
            server_records.append({
                "id": record_ids[(local_book_id, str(record.get("id")))],
                "book_id": server_book_id,
                "type_id": type_ids[record_type],
                "category_id": category_ids[category],
                "account_id": account_id,
                "to_account_id": to_account_id,
                "amount_cents": _cents(record, "amountCents", "amount", "账目"),
                "occurred_on": _date_value(record.get("date"), "账目"),
                "note": str(record.get("note") or "")[:1000],
                "deposit_direction": deposit_direction,
                "deposit_target": (str(record.get("depositTarget") or "").strip() or None),
                "deposit_link_id": deposit_link_id,
                "deposit_final": bool(record.get("depositFinal")),
            })

    return {
        "format": SERVER_BACKUP_FORMAT,
        "version": SERVER_BACKUP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "books": server_books,
        "accounts": server_accounts,
        "categories": server_categories,
        "record_types": server_types,
        "records": server_records,
    }

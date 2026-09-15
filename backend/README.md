# 本地后端运行说明

以下命令在项目根目录用 PowerShell 运行。

## 首次安装

```powershell
python -m venv backend/.venv
& "backend/.venv/Scripts/python.exe" -m pip install -r backend/requirements.txt
```

虚拟环境只属于这个项目，不会把 FastAPI 安装到系统 Python。
接口测试直接使用 Starlette 当前推荐的 `httpx2.AsyncClient`，并显式运行 FastAPI 生命周期，避免新项目继续依赖已弃用的旧测试客户端实现。

## 运行测试

```powershell
& "backend/.venv/Scripts/python.exe" -m pytest backend/tests
```

测试使用临时 SQLite 数据库，结束后自动删除，不接触 `backend/data/jizhangben.db`。

## 启动开发服务

```powershell
& "backend/.venv/Scripts/python.exe" -m uvicorn backend.app.main:app --reload
```

启动后可以访问：

- 健康检查：`http://127.0.0.1:8000/api/health`
- 接口文档：`http://127.0.0.1:8000/docs`

默认开发数据库保存在 `backend/data/jizhangben.db`，该文件已经被 `.gitignore` 排除。

当前数据库 schema 版本为 `4`，包含：

- `schema_migrations`：记录已经成功应用的数据库版本。
- `users`：保存用户的公开资料；认证密码将在后续独立设计。
- `books`：保存用户拥有的账本，通过外键与用户关联。
- `accounts`：保存账本内的资金或负债账户，本金统一使用整数分。
- `categories`：保存内置和自定义类别，归档后仍可供历史账目引用。
- `record_types`：保存稳定类型代码、显示名称和收支行为，归档不改变历史含义。
- `records`：保存账目金额、日期、账户流向、类别、类型和押金对应关系。

应用每次启动都会检查待执行迁移。已经记录的版本不会重复运行；某个迁移失败时，本次事务不会提交。

阶段 3 暂时使用一个固定的本地开发用户。应用启动时会幂等检查并创建该用户，再把用户 ID 交给统一的请求依赖。这个依赖是未来登录系统的替换点，路由和服务层不会把开发用户 ID 写死在各处。

`app/services/record_service.py` 负责创建账目前的跨表校验。它会确认类别和类型属于账本所有者、账户属于当前账本，并检查转账与押金对应关系。校验和写入在同一个数据库事务内完成，业务错误提供稳定的 `code`，供后续 API 返回给网页和手机端。

## 当前业务接口

`GET /api/books` 查询当前开发用户的账本，列表统一放在 `items` 字段中。

`POST /api/books` 新建账本，例如：

```json
{
  "name": "日常账本",
  "group_name": "个人"
}
```

创建成功返回 `201`。同一用户可以建立同名账本；此时仍然创建成功，并在 `warnings` 中返回 `duplicate_book_name` 提示。

`PATCH /api/books/{book_id}` 使用名称和分组完整修改账本；与另一账本同名时仍会修改成功，并在 `warnings` 中返回 `duplicate_book_name`。`DELETE /api/books/{book_id}` 成功返回空响应 `204`，数据库会级联删除该账本内的账户和账目；类别和记账类型属于用户，不会随账本删除。

`GET /api/books/{book_id}/accounts` 查询该账本的账户，列表统一放在 `items` 字段中。`POST /api/books/{book_id}/accounts` 新建资金或负债账户：

```json
{
  "name": "银行卡",
  "kind": "asset",
  "initial_cents": 12345
}
```

`kind` 只能是 `asset`（资金）或 `liability`（负债），`initial_cents` 为非负整数分，省略时为 `0`。账本不存在或不属于当前用户时返回 `404`。

`PATCH /api/books/{book_id}/accounts/{account_id}` 使用相同的名称、类型和本金字段修改账户；`DELETE /api/books/{book_id}/accounts/{account_id}` 删除账户并返回 204。历史账目保留，账户引用会自动变为未指定账户。

`GET /api/categories` 和 `GET /api/record-types` 分别返回当前用户可用于新建账目的类别和记账类型。两者都只返回未归档选项，列表统一放在 `items` 字段中。记账类型的每项还会返回稳定 `code` 与 `behavior`，客户端应使用它们判断业务规则，而不是依赖显示名称。

`POST /api/categories` 可以创建自定义类别：

```json
{"name": "旅行"}
```

`POST /api/record-types` 可以创建自定义收入、支出或中性类型：

```json
{"code": "gift-income", "name": "礼金", "behavior": "income"}
```

代码必须以小写字母开头，只能使用小写字母、数字、`-` 和 `_`。类别有效名称、类型有效名称和类型代码都不能在同一用户范围内重复；冲突返回 `409`。这两条创建接口始终写入自定义项，不能创建或伪造系统内置项。

`PATCH /api/categories/{category_id}` 可以修改自定义有效类别名称；`PATCH /api/record-types/{type_id}` 只修改自定义记账类型的显示名称，稳定 `code` 和 `behavior` 保持不变。`DELETE` 对应路径执行归档并返回 204，不会物理删除历史引用；系统内置项、其他用户的选项和已经归档的选项不能修改或重复归档。

`POST /api/books/{book_id}/records` 创建账目。请求金额必须使用整数分，日期使用 `YYYY-MM-DD`：

```json
{
  "type_id": "类型 ID",
  "category_id": "类别 ID",
  "account_id": "账户 ID",
  "amount_cents": 1234,
  "occurred_on": "2026-09-14",
  "note": "午餐"
}
```

创建成功返回 `201`。资源不存在或不属于账本返回 `404`，业务字段冲突返回 `409`，请求格式错误返回 `422`；错误体统一包含 `code` 和 `message`。

`GET /api/books/{book_id}/records` 查询账本账目，支持以下可选参数：

- `from`、`to`：包含边界的日期范围，例如 `2026-09-01`。
- `account_id`：转出或转入账户 ID。
- `category_id`：类别 ID。
- `q`：搜索备注、类别名称或类型名称。

结果按日期从新到旧返回；每项除原始账目字段外，还会包含类型、类别和账户的显示名称。开始日期晚于结束日期会返回 `422` 和 `invalid_date_range`。

`DELETE /api/books/{book_id}/records/{record_id}` 删除当前用户账本内的一条账目，成功返回空响应 `204`。若账目不存在返回 `404`；原押金已经被退回结算记录关联时返回 `409` 和 `deposit_record_in_use`，需要先处理关联的退回记录。

`PUT /api/books/{book_id}/records/{record_id}` 使用与创建账目相同的请求结构完整替换账目，并重新执行账户、类型、类别和押金校验。成功返回更新后的账目；校验失败时原账目保持不变。已被退回记录引用的原押金返回 `deposit_record_in_use`，已关联原押金的退回记录返回 `deposit_settlement_locked`，两者都不能修改。

`GET /api/overview` 返回当前开发用户所有账本的账户余额、指定期间收入、支出和净资产。默认期间是本月第一天到今天，也可以用 `from` 和 `to` 参数指定包含边界的日期范围。余额和净资产使用整数分；转账不计入收支，押金只有最终少退差额计入对应方向。

`GET /api/backups/export` 导出当前开发用户的服务端备份，格式为 `jizhangben-server-backup`、版本 `1`，包含账本、账户、类别、记账类型和账目，不包含认证凭据或其他用户数据。`POST /api/backups/import` 接收同样的 JSON 结构，先校验所有 ID 和跨表关系，再替换当前开发用户的数据；响应中的 `id_map` 记录每个旧 ID 到新 UUID 的映射，转账和押金关联会按映射恢复。任何校验失败返回 422，原数据不会被删除。

`app/services/local_backup_migration.py` 提供离线转换器 `convert_local_backup()`，把网页导出的 `jizhangben-backup`（或旧版扁平 localStorage 对象）转换成服务端备份 payload。它会为本地数字 ID 加上账本作用域，补齐默认账户和系统选项，并转换押金方向；转换器不接触数据库，实际写入仍由上面的事务式导入接口完成。

`POST /api/backups/preview` 只校验服务端备份并返回账本、账户、账目数量和收入、支出、净资产摘要，不写入数据库。`POST /api/backups/preview-local` 接收网页备份，先调用上述转换器，再返回同样的摘要；转换失败统一返回 422，适合网页迁移向导在确认前展示对账结果。

`POST /api/backups/import-local` 只在用户确认后接收网页备份，调用同一转换器并交给事务式导入服务；成功返回 `id_map`，失败时原服务端数据保持不变。

当前本地开发用户不是真正的登录认证，接口只用于本地开发与自动化测试，不能直接暴露到公网。

网页目前把新建账本、新建账户和新建账目优先写入这些 API；普通账目、转账和押金都提交服务端类型、类别、账户 UUID 及押金关联字段。账目保存期间网页会阻止重复提交，成功后重新读取当前账本明细。已有对象的修改与删除仍在前端本地流程中，服务端写入失败时页面会恢复本地快照并提示用户。

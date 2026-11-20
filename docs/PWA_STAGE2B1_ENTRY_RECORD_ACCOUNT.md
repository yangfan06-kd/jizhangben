# 苹果离线网页版：阶段 2B1 启动、记账和账户接入

日期：2026-11-11。状态：本批已完成；阶段 2 整体仍在进行。未部署、未安装手机、未推送 GitHub。

## 交付范围

新增独立的存储接入预览：`output/pwa-storage-preview/`，共 48 个明确允许的文件，本机入口为 `http://127.0.0.1:4176/ledger-preview/`。原普通原型仍单独输出至 `output/pwa-dist/`，两个入口的端口不同，不能视为共享账本。

这一预览只开放启动读取、记一笔、记录编辑/删除和账户新增/修改/删除等本批已接入流程。基金、退休金补记、账本切换/管理、类别管理、预算和导入暂不开放写入；这些功能在原安卓应用中保持不变。预览不适合存放唯一正式账本，尚不能断网冷启动。

## 改动位置

- `pwa/app-storage.js`：PWA 专用事务控制器。用已提交快照进行同步读取，变更暂存于事务，数据库提交完成后才更新已提交快照；失败恢复内存，保留表单。数据库读取或校验失败时阻断启动，不走 localStorage 空账本回退。
- `js/app.js`：仅在 PWA 控制器存在时委托它准备存储，再进入既有密码入口和程序启动。
- `js/record-form.js` / `js/account-form.js`：在原有校验之后委托 PWA 保存/删除；安卓与普通原型没有加载该控制器，继续执行原分支。
- `pwa/build.cjs` / `pwa/public-files.json` / `pwa/preview-server.cjs`：增加显式选择的存储预览构建和独立端口。两个新存储脚本在 app.js 前加载，不复制实验页、测试夹具或真实备份。
- `pwa/preview.css`：数据库准备期间遮挡未初始化界面，保存期间阻止重复操作；失败状态使用中文。
- `tests/pwa-storage-browser.js` / `tests/prepare-pwa-browser.cjs`：实际页面自动检测及合成夹具准备，不进入应用产物。

原存储适配文件及安卓原生存储实现未被替换。共享的三个 JS 文件只增加 PWA 委托分支，与本批前的源码去除新增分支后比对一致，保留了原有未提交业务修改。修改前副本位于 `backups/pwa-stage2b-before-20261110/`；本批从 11 月 10 日接续至 11 日。

## 当前保证与处理方式

1. 先打开数据库、校验和迁移，再加载账本。密码解锁后的首次加载也必须进入同一事务入口。
2. 记录、账户名称、本金及余额校准记录在同一事务完成后才显示成功、记住选择和清空表单。
3. 保存失败时数据库不增加版本号；原记录和账户状态恢复，金额、备注、类别、账户选择等输入保留。金额键盘重新展开以便重试。
4. 数据版本冲突拒绝旧窗口覆盖，保留旧窗口输入；不擅自刷新。重新打开前可保留草稿；本批未提供自动合并或强制覆盖。
5. 已明确保存为空的账户列表在刷新后仍为空；缺少账户键的首次初始化才写入当前默认账户，避免以后靠默认模板反复推断。
6. 原 localStorage 账本副本不回写、不删除，设备密码、隐私开关和表单偏好继续独立管理。未知历史键会阻断迁移并保留原副本，不静默丢弃。
7. 尚未接入的周期补记不执行，计划金额和处理日期保持原值；不能把这个接入预览当作功能齐全的正式记账本。

## 实际验证

| 检查 | 本轮结果 |
| --- | --- |
| Edge 157.0.4341.46 | 18 项实际页面检查通过，运行异常 0，意外网络请求 0 |
| Windows Playwright WebKit 27.2 | 同一组 18 项通过，运行异常 0，意外网络请求 0 |
| 既有 Node 回归 | 240 项通过，失败/跳过均为 0 |
| 独立构建检查 | 2 项通过，涵盖普通/接入预览产物隔离、脚本顺序、路径和文件边界等 |
| 安卓验证 | 离线网页同步、Capacitor copy 及 Gradle assembleDebug 离线构建通过；未安装手机 |
| 原有改动保护 | 去除新增委托分支后，三个共享 JS 与修改前副本一致；正式 2.08 APK 哈希未变 |

页面检查覆盖：旧数据及类别保留、首次初始化、密码解锁、数据库不可用/旧副本损坏/未知键、拒绝事务外写入、保存及刷新恢复、失败重试、快速重复保存、原流水编辑失败保留及原编号保留、账户失败保留、余额/本金联合回滚、删除失败重试、实际双页面冲突、暂停未开放补记和净资产隐私隐藏。

故障通过真实 IndexedDB 事务中途 abort 注入，没有真的填满硬盘。余额和本金均通过应用自己的数字键盘输入。本轮发现并修正了失败后键盘不便重试、已删除全部账户刷新后被默认列表重新展示的问题；双页面测试遵循现有草稿恢复提示。

证据在 `output/playwright/pwa-stage2b/`：edge-browser.json、webkit-browser.json、summary.json、regression.log、build-tests.log、android-copy.log、android-build.log、source-preservation.json 及合成数据截图。Windows WebKit 通过不等于真实 iPhone 验收；iOS 键盘、安全区、文件保存及系统回收仍需后续检查。

## 本机运行与复现

```powershell
npm run pwa:build:storage
npm run pwa:preview:storage
```

另开终端，在项目根目录准备并运行页面检查（需要 Playwright CLI 及对应测试浏览器）：

```powershell
node tests/prepare-pwa-browser.cjs
npx --yes --package @playwright/cli playwright-cli -s=pwa-storage-check open about:blank --browser msedge
npx --yes --package @playwright/cli playwright-cli -s=pwa-storage-check run-code --filename output/playwright/pwa-stage2b/load-fixture.js
npx --yes --package @playwright/cli playwright-cli -s=pwa-storage-check run-code --filename tests/pwa-storage-browser.js
npx --yes --package @playwright/cli playwright-cli -s=pwa-storage-check close
```

WebKit 使用独立会话并指定 `--browser webkit`；本机已将其测试浏览器放在 `G:\project\browser-tools\pwa-browsers`，启动前设置 PLAYWRIGHT_BROWSERS_PATH 为该目录。所有页面检查使用隔离上下文和仓库合成夹具，不需要手机。

## 下一批

阶段 2B2 接入基金投资/定投及退休金固收：流水、投入成本、账户和已处理日期必须同事务提交，失败不推进日期，重复打开不重复补记。随后继续账本、类别、预算和导入的事务接入，全部通过后再替换普通原型。阶段 3 的实际备份文件保存和恢复、阶段 4 的离线缓存和更新尚未开始。

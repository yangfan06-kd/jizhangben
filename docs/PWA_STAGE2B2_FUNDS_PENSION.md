# 苹果离线网页版：阶段 2B2 基金与退休金事务接入

日期：2026-11-11。状态：本批完成，阶段 2 整体继续进行。没有安装手机、发布站点或推送 GitHub。所有浏览器检查均使用隔离上下文及合成数据，不读取真实家人账本。

## 本批交付

存储接入预览现已开放基金投资、定投、追加投入、部分/全部赎回、投入更正/撤销、暂停/恢复、基金删除，以及退休金设置、清除和打开应用后的到期补记。流水、专属账户、本金、计划与处理日期放在同一次 IndexedDB 事务中提交；提交失败一起恢复，输入保留，不提前显示成功。

预览产物仍为 `output/pwa-storage-preview/`，共 49 个允许文件；普通原型仍为 46 个文件。它们均未具备 Service Worker 和离线冷启动能力，不能存放唯一正式账本。

## 改动位置

- `pwa/fund-storage.js`：新增基金和退休金的事务入口。保存成功后才更新详情；自动补记遇到编辑表单时等待，离开编辑页或完成记账后再执行。保存忙碌期间合并补记请求，失败提示使用中文。
- `pwa/app-storage.js`：事务失败恢复基金界面状态与运行日期标记；启动等待补记完成，解锁仍走同一入口；开放已接入页面，其余未接入写入继续阻止。
- `js/investment-plans.js`：提取不直接保存的计算函数供安卓和 PWA 共用，并增加仅在 PWA 控制器存在时使用的异步委托。定投日历、金额和最终结算规则保持原有定义。
- `js/fixed-income.js`：分开补记计算与提交；PWA 联合提交。原安卓分支也修正了保存失败后内存日期游标可能前进的问题，改为批量提交并恢复失败前状态。
- `pwa/build.cjs`、`pwa/public-files.json`：显式加入独立基金事务模块；安卓和普通原型不加载 PWA 存储模块。
- `tests/pwa-funds-browser.js`：新增实际页面、真实数据库及故障注入检查；`tests/pwa-storage-browser.js` 更新到基金与退休金已开放的预期。`tests/fixed-income.test.cjs` 补充原存储分支失败重试检查。

修改前副本与哈希位于 `backups/pwa-stage2b2-before-20261111/`。本批不批量迁移或重建用户类别、图标、排序、隐藏项；旧 localStorage 原副本继续保留。正式 2.08 发布 APK 未替换。

## 记账规则与失败处理

1. 投入及部分取出仍为资金转移，不计入收支；全部赎回时才按既有规则结算差额。一次性投入允许零金额，零元全部取出允许记录实际亏损。
2. 更正原投入保留原流水编号，本金和最终结算同步调整；撤销自动投入后保留其处理日期，避免打开应用又补回。
3. 交易日继续使用原有 2025/2026 休市表；未知年份暂停，不擅自认定为交易日。没有新增市场数据请求。
4. 退休金仍在打开应用后按原定日期补记，月底不足 31 天时使用该月最后一天；暂停期间不补造收入。修改设置不改写历史收入。
5. 实际事务失败时流水、金额、计划游标及运行标记共同恢复，后续重试不会重复记账。数据库版本冲突拒绝旧窗口覆盖，保留表单。
6. 处于记账、账户、退休金或基金编辑页时暂缓后台补记，避免重绘覆盖填写内容。WebKit 离开页面后可能暂时保留隐藏输入框焦点，现只将可见输入框视为正在编辑。

## 验证结果与边界

| 检查 | 结果 |
| --- | --- |
| Edge 157.0.4341.46 | 基金/退休金 21 项及既有存储页面 18 项通过 |
| Windows Playwright WebKit 27.2 | 同组 21 项及 18 项通过 |
| Node 业务回归 | 241 项通过，无失败或跳过 |
| 独立构建检查 | 2 项通过，包含产物隔离和脚本顺序 |
| 安卓 | 离线网页同步、Capacitor copy、Gradle 离线 assembleDebug 通过，未装机 |
| 文件保护 | 基线中不属于累计接入改动的 240 个文件哈希一致；原交易日表及正式 2.08 APK 哈希未变 |

安卓构建包内的基金和退休金脚本与当前源码哈希一致，且不含 PWA 专用数据库与事务脚本。

浏览器检查的运行异常和意外 API/第三方网络请求均为零。覆盖零元投资、历史定投确认与取消、提交失败重试、不残留孤立账户、设置修改、追加、赎回、已结清投入更正、撤销去重、暂停恢复、删除、退休金清除、月底、未知日历年份、实际双页面冲突、忙碌队列和编辑期等待。

故障通过真实 IndexedDB 事务在写入/删除请求成功后主动中止注入；没有实际填满硬盘。系统存储回收、应用被系统杀死的任意时点、iPhone Safari 原生文件操作与实际安全区/键盘尚未验收。Windows WebKit 通过不能视为真 iPhone 通过，也不能承诺本机网站数据永久保存。

证据目录：`output/playwright/pwa-stage2b2/`。其中浏览器原始结果为 edge/webkit 的 funds/core 文本与提取 JSON，Node/构建/安卓日志和源文件保护报告一并保留；测试文件与证据均不进入网页发布产物。

## 复现与下一步

按 `pwa/README.md` 构建并启动 4176 本机预览后，运行 `node tests/prepare-pwa-browser.cjs`。使用 Playwright CLI 创建 Edge 或 WebKit 会话，先加载 `output/playwright/pwa-stage2b/load-fixture.js`，再分别执行 `tests/pwa-funds-browser.js` 和 `tests/pwa-storage-browser.js`。WebKit 测试浏览器路径为 `G:\project\browser-tools\pwa-browsers`。例：

```powershell
npx --offline --yes --package @playwright/cli playwright-cli -s=pwa-check open about:blank --browser msedge
npx --offline --yes --package @playwright/cli playwright-cli -s=pwa-check run-code --filename output/playwright/pwa-stage2b/load-fixture.js
npx --offline --yes --package @playwright/cli playwright-cli -s=pwa-check run-code --filename tests/pwa-funds-browser.js
npx --offline --yes --package @playwright/cli playwright-cli -s=pwa-check run-code --filename tests/pwa-storage-browser.js
npx --offline --yes --package @playwright/cli playwright-cli -s=pwa-check close
```

下一批为 2B3：账本、类别、预算和导入的事务接入；这些流程未接入前继续禁止在预览中写入。后续还需备份文件操作、离线缓存与安全更新、部署预览和借用 iPhone 的真实验收。

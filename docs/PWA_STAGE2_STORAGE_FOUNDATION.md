# 苹果离线网页版：阶段 2A 存储底座实验

日期：2026-11-10。状态：**2A 已完成，阶段 2 整体尚未完成；2B 业务接入待实施。**

后续进展（2026-11-11）：[阶段 2B1](PWA_STAGE2B1_ENTRY_RECORD_ACCOUNT.md) 已完成启动、记账和账户的独立预览接入；其余 2B 项目仍待实施。本页保留阶段 2A 当时的验证范围。

## 本轮交付与范围

- `pwa/ledger-database.js`：原生 IndexedDB 存储模块，包含事务批量提交/整本替换、版本冲突检查、旧网页数据迁移、连接异常处理及持久存储状态查询。
- `pwa/storage-lab/`：本机独立实验页与 20 项浏览器检查。只操作本轮随机命名的合成数据库，未读取手机或正式账本。
- `package.json` 新增 `pwa:storage-lab`，运行后打开 `http://127.0.0.1:4175/` 并点击“开始存储检测”。
- 发布边界测试新增实验文件排除检查。存储模块和实验页均未加入现有 PWA 发布允许列表，当前网页原型继续沿用阶段 1。

安卓业务源码、原生 SQLite、当前网页的 appStorage 及用户数据没有切换或改写。这一批不代表完整 PWA 已具备可靠存储和离线能力。

## 存储约定

一个数据库包含 `ledger` 与 `metadata` 两个对象存储。账本值保留原有 jizhangben_ 键和原字符串，不更改金额、类别或流水；设备密码、草稿等独立偏好不混入。

- `open()`：打开并读回验证元数据；不支持、打开失败、升级被占用、连接异常时返回中文错误，不回退成空账本。
- `read()`：在同一只读事务里取得数据、版本号和初始化状态，返回独立快照。
- `commit(expectedRevision, changes, { replace })`：同一读写事务检查版本并提交全部键及新版本号。其他连接先保存时，本次拒绝覆盖，调用方应保留输入。成功仅在事务 complete 时兑现；单次请求 success 不算成功。
- `migrateLegacy(storage, validate)`：完整读取原副本、要求显式业务校验器、再次核对原副本、原子提交数据和迁移标记、读回比对。原副本不删除、不改写；已初始化数据库不再反复导入旧副本。
- `persistenceStatus()`：读取实际授予状态；只有显式 request 时才申请。实际未授予、接口缺失或出错都不会显示已保护。

申请较严格的事务 durability 是浏览器提示，不能承诺断电绝不丢失。IndexedDB 仍属于网站数据，持久存储不能替代独立备份。

模块只做命名空间、字符串值和数据库结构检查；迁移的业务内容校验由调用方显式提供。实验中用已知合成样例进行完整比对，下一批须接入现有业务校验与兼容规则，不能用宽松的“能解析 JSON”检查代替。

## 本轮实际验证

| 项目 | 结果 |
| --- | --- |
| Edge 157.0.4341.42 | 20 项通过，JavaScript 运行异常 0 |
| Playwright WebKit 27.2（Windows 版本，构建 2391） | 同一组 20 项通过，JavaScript 运行异常 0 |
| 合成 v1.60 / v1.64 数据迁移 | 原值字符串逐项一致；旧副本、类别顺序、图标和隐藏项保留；再次打开不重复迁移 |
| 写入/替换失败 | 在真实 IDB 请求成功事件后主动 abort，确认整批与整本清除操作都回滚，版本号不增加 |
| 模拟配额不足 | 注入 QuotaExceededError；原数据和版本保留，错误为中文，随后重试可成功；未真的填满硬盘 |
| 并发 | 两个独立 IDB 连接同时保存只有一个成功，另一方报版本冲突；同时迁移只初始化一次 |
| 打开和校验失败 | 不支持、访问被禁、旧副本读取失败、业务校验拒绝、元数据丢失、升级阻挡等均停止，不初始化假空账本 |
| 重开与刷新 | Edge 实验数据库在完整关闭浏览器进程、同一独立测试配置重新启动后回读一致；WebKit 页面刷新后回读一致 |
| 持久存储状态 | 当前两个测试环境均未授予；未擅自触发实际申请。模拟已授予/未授予/缺失/异常状态均如实返回 |
| 既有回归 | npm test 240 项通过；npm run pwa:test 2 项通过 |

证据目录：`output/playwright/pwa-stage2/`，包括 edge-final.json、webkit-final.json、reopen-result.txt、regression.log、源码保留检查与截图。浏览器工具位于 `G:\project\browser-tools\pwa-browsers`；未加入应用依赖或发布文件。

这不是 iPhone Safari 真机验收。真实磁盘写满、断电/系统杀进程、iOS 网站数据回收尚未验证；WebKit 本轮只验证存储底座，没有把旧版整应用测试结果移算为新版 PWA 验收。

## 已梳理的 2B 接入顺序

当前业务大量采用同步读写。不能把 appStorage.set 改成 Promise 后就让原调用者照常显示成功；也不采用后台悄悄排队写入的方式掩盖未完成的保存。

| 顺序 | 当前入口 | 接入要求 |
| --- | --- | --- |
| 1 | js/app.js 启动、js/device-security.js 解锁 | 数据库准备、迁移和业务校验完成后才加载账本及补记；失败显示阻断状态，禁止默认初始化写入 |
| 2 | js/storage-adapter.js / js/storage.js / js/migrations.js | 提供同步内存读取视图和显式异步事务边界；只在提交成功后更新已提交快照，初始化迁移也需原子保存 |
| 3 | js/record-form.js / js/account-form.js | 新增、编辑、删除、余额调整等等待事务完成；表单、草稿、记账选择及内存变更在失败时保留或恢复；防重复点击 |
| 4 | js/investment-plans.js / js/fixed-income.js | 流水、账户、基金成本及处理日期一起提交；失败不推进补记状态，不重复记账 |
| 5 | js/book-form.js | 账本列表、当前账本及关联存储项合并提交；账本删除失败不留下半删除状态 |
| 6 | js/category-system.js / js/custom-options.js / js/budget.js | 类别、图标、排序、隐藏项及需同步的旧流水同一事务；收入旧流水规则沿用原逻辑，不重建用户配置 |
| 7 | js/backup.js / js/external-import.js | 导入全部数据成功后才更新界面；取消或失败不替换旧账本；实际文件导出由阶段 3 继续完善 |
| 8 | 多窗口和回归 | 数据版本变化提示重新读取；旧内存不能覆盖新提交；保留当前输入，不擅自刷新。逐模块故障注入和安卓回归通过后才切换原型 |

迁移前还要处理未知/历史运行键与设备偏好的边界。无法识别的数据应停止并保留副本，不能静默丢弃。旧版 localStorage 写入窗口不能与迁移流程同时使用；IndexedDB 版本冲突保护不能代替跨两套存储的锁。

阶段 2B 必须另行验证真实表单失败保留、自动补记、导入及多窗口界面行为。本轮只是数据库层两个连接的并发检查，未宣称这些业务入口已经异步化。

## 依据

- [IndexedDB 事务完成与回滚](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)
- [持久存储申请及实际返回状态](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [数据库升级被阻挡事件](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event)

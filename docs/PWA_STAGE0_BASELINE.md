# 苹果离线网页版：阶段 0 基线与验证记录

日期：2026-11-10。阶段 0 已完成；PWA 功能尚未实施。

## 已保护的当前状态

- 工作目录：`G:\project\jizhangben-publish`。
- 分支：`implementation/ledger-improvements`；本地 HEAD 为 `7ab8492e938ef77d442f26e31ebc15f84519cec9`（2.07 发布提交）。当前工程和本地 APK 已是 2.08／109，不能从 HEAD 重新取文件覆盖本地工作。
- 本轮开始前的已修改文件、未跟踪文件、二进制差异和暂存差异已保存；没有提交、重置或清理工作目录。
- 独立保护目录：`backups/pwa-stage0-20261110/`。包含 248 个文件的原样副本、逐文件 SHA-256 清单、Git 状态/差异及额外的 2.08 APK。没有读取或修改手机真实账本。
- 逐文件复核：源文件及副本均与清单一致，缺失 0、哈希不一致 0。路径检查没有包含 backups/output/node_modules、签名密钥、数据库或 .env。此目录只是本机保护副本，不能发布到网站。

安卓包：`releases/记账本-个人离线版-v2.08.apk`，4,366,484 字节。

```text
包名：com.jizhangben.app
版本：2.08 / 109
APK SHA-256：f9f43ddb154ec6ee3be41b0893b39d82163342e8951300736711a8b5ff34b0d6
签名证书 SHA-256：7aa28ed39d199a58e790332c97196c1691e7b653663dde5daa3191d266dcf786
```

apksigner 验证通过；证书为 Android Debug。这里只记录已有包身份，不变更签名或打包方式。APK 内 36 个 JS/CSS 文件与当前源码逐一比对一致；未把这项检查说成完整 UI 或真机验收。

## 运行入口与改造边界

| 入口 | 当前情况 | 后续实施约束 |
| --- | --- | --- |
| `index.html` | 35 个顺序加载的 JS、1 个 CSS、SVG 图标 | 保留顺序；PWA 离线配置先于业务启动加载 |
| `js/api-client.js` / `js/app.js` | HTTP/HTTPS 下可默认使用 `/api`，随后走登录路径 | PWA 显式设离线模式，不能依赖电脑或服务器接口 |
| `mobile/sync-web.cjs` | 重建 mobile/www，注入安卓配置，整目录复制 js/css | 新建独立 PWA 构建，不清理或复用安卓输出目录 |
| `js/storage-adapter.js` | 原生 JizhangbenStorage 同步提交；浏览器回退 localStorage | 保留安卓 SQLite 路径；异步数据库要连同业务提交确认改造 |
| `js/storage.js` / `js/migrations.js` | 多处同步写入、加载及默认数据迁移 | 读取失败不能当作首次空账本；迁移失败保留原副本 |
| `js/backup.js` | 原生 saveBackup；网页使用 Blob 下载并立即报导出成功 | 网页发起下载不证明文件保存，需重新设计状态和恢复验收 |
| `js/investment-plans.js` / `js/fixed-income.js` | 启动、切换账本及解锁等路径处理到期补记 | 存储就绪后再处理；检验多键原子提交、失败回滚和去重 |
| `js/record-draft.js` / `js/device-security.js` | 草稿、上次选择、设备密码、隐私开关另用 localStorage | 独立列入兼容检查；不误作账本数据或账本加密 |
| `js/record-keyboard.js` | 已有 visualViewport 键盘避让逻辑 | 复用后做小屏与软键盘检查，iPhone 实际行为待借机验证 |

专项业务规则、收入支出统计、类别编号/名称/排序/隐藏项、隐私显示、返回行为均沿用现有逻辑。阶段 0 未改动以上运行文件。

## 发布文件边界

独立产物目录定为 `output/pwa-dist/`；预览和检查记录放在其他 output 子目录。不得把项目根目录设为网站根目录。

机器可读清单见 [PWA_PUBLIC_FILES_STAGE0.json](PWA_PUBLIC_FILES_STAGE0.json)：当前明确列出 38 个源文件；未来新增配置、安装清单、图标和缓存脚本需逐项声明。除明确允许的内容外全部拒绝。阶段 1 再实现构建时的路径、缺失资源、意外文件和网络请求检查；本轮没有生成或部署站点。

该清单只是公开程序资源的范围，不允许公开用户导出 JSON、APK、密钥、数据库、测试夹具、学习资料、截图或基线副本。原 index.html 也不能未经离线配置处理就直接发布。

## 可复用测试夹具与当前结果

| 合成夹具 | 用途 | 当前覆盖入口 |
| --- | --- | --- |
| `tests/fixtures/upgrade-v1.60-synthetic.json` | 旧版账本、类别等迁移及保留 | migrations、storage-adapter 测试 |
| `tests/fixtures/upgrade-v1.64-synthetic.json` | 低版本升级、自定义设置保留 | migrations、storage-adapter 测试 |
| `tests/fixtures/linked-records.cjs` | 押金、借贷等关联流水与统计 | records、render-and-draft 测试 |
| `tests/fixtures/home-records.cjs` | 首页/明细样例与渲染 | records、render-and-draft 测试 |

本轮重新执行 `npm test`：**240 项通过，失败 0、跳过 0**。这是现有 Node 业务回归，尚不覆盖未来的 IndexedDB、Service Worker 或 iPhone 页面行为。测试使用合成数据，不使用家人的真实导出文件。

本机证据：`output/pwa-stage0-20261110/tests.log`、`verification.json`、`apk-resource-verification.json`；完整源文件摘要在保护目录的 `manifest.json`。

## 后续测试优先级

| 优先级 | 风险 | 通过条件 |
| --- | --- | --- |
| P0 | 存储未就绪或读取失败后初始化空账本 | 故障时停止写入、保留原库；不生成假空账本 |
| P0 | 异步提交失败却显示成功、多键只写一半 | 保存成功后才更新成功状态；失败保留输入及原数据 |
| P0 | 旧数据迁移、导入、多窗口或周期补记覆盖记录 | 可回滚、可读回核对、不重复补记、不用旧内存覆盖新内容 |
| P0 | 备份假成功或无法恢复 | 实际文件可重新选取恢复，逐项比对账目及自定义设置 |
| P1 | HTTPS 意外走登录、请求外部接口 | 离线运行配置先加载；网络检查无意外 API 请求 |
| P1 | 缓存混合版本、更新时丢草稿或迁址后空账本 | 完整版本切换，事务期间不强刷；固定来源及明确迁移方案 |
| P1 | 键盘遮挡、安全区、小屏大字、桌面入口差异 | Windows 自动检查通过，并在借用 iPhone 后逐项复验 |

## 测试条件与下一阶段

用户没有 iOS/macOS 设备。开发期间由我们完成 Windows 业务回归、浏览器自动化、失败注入和可运行时的 WebKit 模拟，并记录实际执行的浏览器及版本。没有跑过的项目明确标记待验证。

借机验收留到产品原型及数据保护功能完成后：Safari 添加桌面、真实中文键盘、文件保存/恢复、断网冷启动、更新保留，以及浏览器/桌面入口的数据行为。Windows 或 Playwright WebKit 通过都不等于这些项目已通过。

下一项为阶段 1：独立 PWA 构建与桌面入口原型。暂不修改安卓安装、推送 GitHub 或部署公开地址；原型阶段不存放用户唯一正式账本。

# 记账本网页原型

2026-11-17：用户已授权开放[固定测试入口](https://jizhangben-ios-test.awakehornbill.chatgpt.site/)，无需登录 ChatGPT。匿名 HTTPS 58 项检查、Edge / Windows WebKit 各 5 项线上离线烟测通过，见 [入口与访问结果](../docs/PWA_SITES_TEST_ENTRY.md)。[iPhone 验收清单](../docs/PWA_IPHONE_ACCEPTANCE.md)仍待真实设备执行，目前只使用虚构账目测试。

测试部署副本与 ZIP 已准备，见 [部署说明与验证记录](../docs/PWA_TEST_DEPLOYMENT.md)。`npm run pwa:prepare:test` 生成固定副本，PowerShell 7 执行 `./pwa/package-test.ps1` 压缩并逐项核对；仅发布其中的程序资源，不上传项目或审阅材料。Sites 适配层使用同一批 53 个原文件；2026-11-17 根据用户选择改为公开测试。

本目录提供两种独立构建：普通原型（阶段 1，仍无离线缓存）以及离线存储预览（阶段 4）。后者已用于独立测试站，联网完成资源核对后可进行断网测试，尚未通过真实 iPhone 验收。

普通原型仍使用原浏览器存储；存储接入预览使用 IndexedDB，已接入启动、记账、账户、基金、退休金、账本、类别、预算和 JSON/CSV 导入。最新进度见 [2B3 记录](../docs/PWA_STAGE2B3_MANAGEMENT_IMPORT.md)，基金与退休金检查见 [2B2 记录](../docs/PWA_STAGE2B2_FUNDS_PENSION.md)，启动与记账检查见 [2B1 记录](../docs/PWA_STAGE2B1_ENTRY_RECORD_ACCOUNT.md)，底座实验见 [2A 记录](../docs/PWA_STAGE2_STORAGE_FOUNDATION.md)。

阶段 3 已加入备份准备、文件操作状态、可忽略提醒以及 JSON 恢复预览，证据和实际/模拟检查边界见 [备份阶段记录](../docs/PWA_STAGE3_BACKUP_RESTORE.md)。下载、分享与文件保存核对分别记录，不以浏览器发起操作代替落盘确认。

## 本机运行

在项目根目录执行：

```powershell
npm run pwa:build
npm run pwa:preview
```

打开 `http://127.0.0.1:4173/ledger-preview/`。预览服务只监听本机，并只提供 `output/pwa-dist/` 中的文件。这个地址不是可以发给家人的公共链接。

存储接入预览单独运行 `npm run pwa:build:storage`、`npm run pwa:preview:storage`，入口为 `http://127.0.0.1:4176/ledger-preview/`，产物为 output/pwa-storage-preview。两个来源的数据独立，均只用于合成样例。

```powershell
npm run pwa:test
npm test
```

第一条检查发布边界、缺失资源、路径和图标尺寸等；第二条运行既有业务回归。浏览器检查另见 [阶段记录](../docs/PWA_STAGE1_BUILD.md)。

独立存储实验：执行 `npm run pwa:storage-lab`，打开 `http://127.0.0.1:4175/`，点击“开始存储检测”。实验使用随机命名的合成数据库，不向网页发布产物复制测试文件。

## 文件与运行边界

- `build.cjs` 使用阶段 0 明确列出的 38 个源文件，以及 `public-files.json` 声明的额外资源。只复制这些文件，不递归复制源码目录。
- 普通原型生成 46 个文件，离线存储预览生成 53 个；构建清单含资源摘要。index.html 只在产物中注入资源，原页面保持不变。
- 离线运行配置在业务脚本之前加载，关闭后端 API 路径；此处“离线运行配置”仅表示本机业务模式，不代表当前能断网启动。
- 安装清单和图标路径均相对于站点目录，支持根路径或部署子路径。正式域名及 Web App 身份要在试用前稳定下来。
- 桌面 PNG 图标由现有 `favicon.svg` 栅格化得到，未替换用户类别图标或安卓资源。
- 缺失或未允许的引用会使构建失败，保留上一次完整产物；只替换标记为本构建器生成的专用目录。
- 构建不会导入真实账本、改动数据文件或更新安卓签名；绝不把项目根目录发布出去。

## 当前限制

普通原型仍使用 localStorage；离线预览已将本地管理与记账流程接入 IndexedDB，服务端迁移及不再使用的旧本金入口不开放。只有页面显示“程序资源已核对，可离线使用”后才算该浏览器完成离线准备。新版本等待明确操作，不自动刷新；缓存只含程序资源。Windows 检查不替代 iPhone 的系统分享、“保存到文件”、桌面入口和系统回收验收。阶段 4 证据见 [离线与更新记录](../docs/PWA_STAGE4_OFFLINE_UPDATE.md)。

元信息与安装流程参考：[Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference)、[Apple 桌面网页配置](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)、[Apple 添加到主屏幕说明](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26)。安全区参考 [WebKit 说明](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)，真实设备行为仍需后续核验。

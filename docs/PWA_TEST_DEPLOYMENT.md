# iPhone 验收：测试部署包与托管要求

初次准备：2026-11-14；状态更新：2026-11-17。本记录描述本机部署副本和 ZIP 准备结果。独立站已按用户选择公开，匿名 HTTPS 全量核验、Edge / Windows WebKit 各 5 项线上离线烟测通过，详见 [实际部署与访问结果](PWA_SITES_TEST_ENTRY.md)。未推送 GitHub，真实 iPhone 验收仍待完成。此项是阶段 5B 前置准备，不是正式上线完成。

## 本轮交付

- `pwa/prepare-test-package.cjs`：从独立离线构建提取严格允许的 53 个文件，同时核对构建摘要与 SW 内的完整性清单。额外文件、缺失、链接、摘要不符均拒绝。旧固定副本不被覆盖；新构建产生另一个版本目录。
- `pwa/package-test.ps1`：只把 `site` 中的资源压成 ZIP，逐项读取 ZIP 核对路径、数量、长度和 SHA-256，不压入审阅文件、真实备份、测试夹具、截图或项目根目录。
- `pwa/test-package-server.cjs`：只读取已核对的部署副本，在 `127.0.0.1:4177/ledger-preview/` 模拟静态托管响应。该地址只有本机可访问。
- `pwa/hosting/nginx-test.conf.example`：独立静态站点参考模板，未安装服务器、未启用配置；不意味着需要购买服务器。若选择免费静态托管，需达到相同的资源响应要求，并先核验该平台的实际响应。
- `tests/pwa-test-package.test.cjs`、`tests/pwa-deployment-browser.js`：部署边界、快照保留、HTTP 响应和真实 SW 离线烟测。

本次构建 ID：`26134fa8d487097c550cba269da75f7a46704a5ed8447e1f7926f8943eb29639`，与阶段 5A 验收版本相同。固定产物目录为 `output/pwa-test-packages/<完整构建ID>/`：

```text
site/                       仅这 53 个程序资源用于站点
site.zip                    解压后直接为同一批 53 个文件
site.zip.sha256              ZIP 摘要，本机交付核对使用
review.json                 逐文件摘要、Git 提交及工作区非干净状态
nginx-test.conf.example      托管配置参考，不进入站点
部署前必读.txt              本机审阅说明
```

Git 提交仅是来源线索，当前工作区包含尚未提交的改动，不能只按旧提交重建并声称是本次验收版本。以本次逐文件摘要和构建 ID 为准。`review.json` 不包含真实账目；它不代替数字签名或可信来源认证。

## 重建与本机复核

在项目根目录使用 PowerShell 7：

```powershell
npm run pwa:test:package
npm run pwa:test
./pwa/package-test.ps1
```

单独准备目录可用 `npm run pwa:prepare:test`。重复执行保留相同构建的固定副本；若发现已有副本或审阅清单不一致，停止而不覆盖。只允许使用新的完整构建目录发布。

本机启动示例（将完整构建 ID 替换为准备命令的实际输出）：

```powershell
node pwa/test-package-server.cjs output/pwa-test-packages/26134fa8d487097c550cba269da75f7a46704a5ed8447e1f7926f8943eb29639/site
```

ZIP 只是静态网站部署文件，不是 APK，不能直接在 iPhone 安装。最终是通过固定 HTTPS 网址进入 Safari，再按设备的实际菜单添加主屏幕入口。

## 托管响应要求

| 项目 | 必须达到的行为 |
| --- | --- |
| 来源 | 独立测试来源，仅用合成账本；真实试用前另行确定长期正式来源。测试来源不能共用其他应用的存储 |
| 地址 | HTTPS；固定域名与目录，不能把每次生成的新预览域名当作长期入口。子目录必须以 `/` 结尾，SW 限在该目录 |
| 路由 | 入口和所有清单资源直接返回 200。不存在的 JS、JSON、接口和其他路径返回真正 404，不回退到首页。不要把 `install.html` 等资源自动重定向到无后缀地址；SW 下载采用拒绝跳转策略 |
| 类型 | HTML、JS、CSS、SVG、PNG、JSON 使用正确 MIME；安装清单为 `application/manifest+json`。开启 `X-Content-Type-Options: nosniff` |
| 资源 | 保持字节内容不变，不注入追踪/登录脚本、HTML 压缩或改写。传输压缩可用，但解码后的资源摘要必须一致 |
| 缓存 | 本轮统一 `Cache-Control: no-store, no-transform`，离线资源由程序 SW 校验后显式保存。禁止 CDN 规则把此设置覆盖成旧资源长期缓存 |
| 数据 | 不发送 `Clear-Site-Data`，不执行清库或类别初始化脚本。升级只替换程序文件；不把任何账本备份部署到站点 |
| 其他头 | `X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow`；禁止索引不等于访问控制 |

Nginx 的 `add_header ... always` 可让错误响应也携带规定响应头，`try_files ... =404` 可明确缺失资源行为；参考 [响应头文档](https://nginx.org/en/docs/http/ngx_http_headers_module.html)及 [try_files 文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)。模板默认仅本机 8080，HTTPS 需由选定平台/代理提供，并先运行该环境的配置校验；本轮未运行真实 Nginx。

通用静态包不绑定具体托管商，不能直接声称任意平台上传即通过。正式选择时再核验免费额度、国内手机移动网络可访问性、HTTPS、路径跳转、响应头和版本切换行为，不引入自动发布任务。

## 已完成的验证与边界

| 检查 | 结果 |
| --- | --- |
| 包与托管契约自动检查 | 3 组通过：白名单及旧副本保留；篡改/额外文件/缺失/链接/伪造摘要拒绝；53 个资源逐个 HTTP、MIME、摘要及响应头核验，未知资源 404、写请求 405 |
| 现有构建检查 | 4 项重新执行通过 |
| Edge 157.0.4341.46 | 固定副本真实 SW、作用域和缓存边界、断网重开、断网记账后重开、无异常/第三方请求，共 5 项通过 |
| Windows WebKit 27.2 | 同组 5 项通过 |
| ZIP | 逐项解压读取 53 个资源核对摘要，根目录没有额外文件 |
| 安卓与业务 | 本轮未改共享 JS、原页面、原 CSS 或原生工程；35 个脚本与阶段 4 副本一致，正式 2.08 APK 摘要不变 |

证据：`output/playwright/pwa-deployment/`。首次烟测曾把 `amount` 的元误按分比较，后改为读取既有 `amountCents`，复测通过；未为此修改业务代码。

本轮没有重复整套 242 项业务测试，阶段 5A 已通过；本轮执行的是新增部署检查、构建检查和部署副本浏览器烟测。没有验证公网 TLS/CDN、真实服务器配置、真实 iPhone、安全区、系统键盘、“保存到文件”或主屏幕入口。Windows WebKit 不能代替 iPhone Safari。

## 部署、更新与回退顺序

1. 先确定固定 HTTPS 测试入口、托管平台和仅测试的发布范围。发布内容必须为此 ZIP 的 53 个资源；审阅材料和项目目录不上传。公网可访问时也只放合成账本，不宣传为正式版。
2. 完整上传新版本后整体切换站点目录/平台版本，避免逐文件覆盖正在服务的旧站。保留上一份完整产物，不开启自动更新或强制刷新。
3. 在真实测试入口逐资源核对状态、无跳转、MIME、解码后 SHA-256、响应头与 SW 作用域；通过移动网络重新测试。若页面显示未准备完成，不开始离线验收。
4. 用 [iPhone 清单](PWA_IPHONE_ACCEPTANCE.md)完成阶段 5B，先演示数据和备份/恢复，再谈小范围试用。测试来源与将来正式来源不同，数据不会自动转移，必须通过经核对的备份导入；不能称换网址会自动保留。
5. 出现部署故障先停止扩散；在同一来源切回上一个完整程序副本，仍由既有更新机制处理，不清浏览器数据。程序回退不等于数据回退；若未来数据格式有不兼容变更，须先明确迁移和恢复方案，不能盲目降级。当前本轮数据格式未变。

下一步为选定固定 HTTPS 测试来源并部署这个具体产物；部署后先做公网响应复核，阶段 5B 全部仍标记待测。

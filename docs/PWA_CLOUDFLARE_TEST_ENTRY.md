# Cloudflare 免费测试入口

更新日期：2026-11-19。用户在本窗口授权改用其他测试来源，并明确要求免费。
此记录包含线上核验与首批 iPhone 照片证据，不代表整套真机验收通过。

2026-11-18 已发布输入框缩放修复，用户随后确认输入恢复正常；见 `PWA_IPHONE_INPUT_ZOOM.md`。
随后按用户要求与发布确认，去掉顶部预览说明栏，该轮构建为
`7e627aac10feb628c69528435c4dd6eeec43b45b69d01cbce64411cf9e107ebb`。
最新包的 58 项 HTTPS、Edge 5 项线上离线及显示检查通过；手机确认顶栏消失待测。
具体改动、旧版本保留及证据见 `PWA_IPHONE_PREVIEW_NOTE.md`。

当前实际线上构建为 `e8dcc93c85cdfee07106858f6f05c34f72562b0709a76328e40412f64a1667cd`，
离线状态和更新入口已移到「设置 → 应用与更新」。用户已确认发布该布局；2026-11-19 从固定网址
核对 58 项 HTTPS、Edge 5 项线上离线及位置检查通过，本轮未再发布。
第二台 iPhone 15 Pro Max、iOS 18.7.2 出现 Safari Wi-Fi 超时，用户确认同机移动数据能打开；
同一 Wi-Fi 的另一设备对照暂不可做，具体原因待查。随后用户确认“15”在两种网络全关闭后正常使用，
离线新增后关闭重开，记录和金额保持不变；按该机本次入口记录通过，入口类型未注明，重启/双入口/备份待测。
见 `PWA_IPHONE_UPDATE_SETTINGS.md`、`PWA_IPHONE_NETWORK_20261119.md`。

## 固定入口与身份

- 固定生产网址：`https://jizhangben-iphone-test-2026.pages.dev/`。
- Cloudflare Pages 项目：`jizhangben-iphone-test-2026`。
- Account ID：`7576e33ba817620126cffb672326f2e2`，从登录后的控制台原样读取。
- 上一轮已记录部署别名：`0cdba9ba`，完整 ID：`0cdba9ba-0b8c-4e75-b570-973345a4b169`。
  版本网址：`https://0cdba9ba.jizhangben-iphone-test-2026.pages.dev/`。旧部署 `59e7a521`、`49a2ebf4` 保留。
- 最新线上构建 e8dcc93c… 已通过原字节核对，本轮未读取最新部署 ID；不得把上一轮 ID 当作最新布局版本。
- 手机使用固定生产网址，不使用每次部署变化的版本网址。
- 免费方案，未升级、未购买域名、未添加付费存储或数据库。
- 原 Sites 与 Netlify 项目保留，后续更新复用此 Pages 项目，不继续任意新建入口。

用户自行注册并验证邮箱。自动操作完成创建唯一项目；用户手工确认 Windows 文件夹上传，
控制台显示 54/54 文件成功；随后本窗口点击 Deploy site，控制台返回 Success 并显示生产部署成功。
没有取得或持久保存用户密码、验证码、API token。

## 来源与发布边界

首轮程序快照构建为 `26134fa8d487097c550cba269da75f7a46704a5ed8447e1f7926f8943eb29639`。
11 月 18 日在可复现该快照的隔离源码副本中仅更新 PWA CSS，生成上文新构建；
所有共享业务脚本及存储适配字节保持不变，仍为 53 个程序资源。

额外的 `_worker.js` 为托管适配文件，来自既有 Sites 源码仓库 `dist/server/index.js`，
只返回内嵌的 53 个原始资源，提供 MIME、安全响应头、真实 404 和写请求拒绝。
不连接数据库、外部接口或上传用户账目。它不会出现在 Service Worker 的 53 资源缓存中。
使用 Pages advanced mode 是为保留 `.html` 路径，避免默认去后缀跳转和 SPA 首页回退。

本机准备脚本：`G:\project\output\jizhangben-cloudflare-test\prepare.mjs`。
上传目录：同目录的 `site`；审阅报告与部署身份 JSON 留在父目录，没有上传。
本地 123 项契约核对通过；未修改共享业务 JS/CSS、账本格式、类别、账户或 Android 工程。

以上准备脚本与目录为首轮旧包；11 月 18 日的新上传目录为
`G:\project\output\jizhangben-cloudflare-input-zoom\site`，同样 54 个上传文件及 123 项契约检查通过。
初版与修复版的本机副本均保留，没有反向覆盖原托管源码仓库的旧快照。
随后精简顶栏的最新上传目录为 `G:\project\output\jizhangben-cloudflare-hide-preview-note\site`，
仍为 54 文件、123 项契约核对通过，只在 PWA CSS 增加隐藏预览说明栏的规则。

## 已完成的线上检查

| 检查 | 实际结果 |
| --- | --- |
| Cloudflare 控制台 | 发布成功，Production，54/54 文件上传完成 |
| 无凭据 HTTPS | 58 项全部通过：53 程序资源原字节、MIME、安全头；根入口；4 个未知路径真实 404 |
| 页面完整性 | HTML 与原快照逐字节一致，没有 Netlify 注释或 HUD 注入；`.html` 直接 200，无跳转 |
| Edge 157.0.4341.60 | 5 项线上离线烟测通过，使用独立上下文和合成夹具 |
| Edge 393×852 截图 | 显示“程序资源已核对，可离线使用”，底部导航没有平台徽标遮挡；这是 Windows 截图 |
| Windows WebKit | 本轮未完成：当前 CLI 所需 WebKit 2391 未安装，没有为此下载或记为通过 |
| 首台 iPhone 16 Pro | 01—03 已有证据：Safari 首页、添加主屏幕后独立窗口及两入口资源准备完成；首次主屏幕黑屏恢复后稳定性仍待观察；账目、文件、断网和更新待测 |
| 第二台 iPhone 15 Pro Max | 用户确认两种网络均关闭后可正常使用；离线新增后重开记录与金额不变；备份已在“文件”确认保存。仅本次入口，恢复/重启/双入口待测 |

Edge 五项为：真实 SW 准备；根路径作用域与 53 文件缓存边界；断网重开原合成账本不变；
断网新增 3 元虚构记录后重开仍保留；没有观察到页面运行异常或第三方请求。
检查结束后隔离上下文和测试浏览器均已关闭，没有修改真实浏览器账本。

发布刚结束时首次单资源请求有一次网络失败；随后根入口与 index.html 返回 200，完整重试
58 项通过。保留首次失败报告，不把它改成通过。当前电脑检查仍走本机 VPN/代理出口，
不能替代手机 Wi-Fi/5G 直连验收。

## 证据

`G:\project\output\jizhangben-cloudflare-test\`：

- `review.json`：本地包与资源摘要，保存的是本地准备状态，不作为实时部署状态。
- `deployment.json`：固定项目、生产网址、本次部署别名及核验摘要。
- `https-check-1794915411428.json`：首次单资源网络失败。
- `https-check-1794915443523.json`：58 项真实 HTTPS 全量通过。

`G:\project\jizhangben-publish\output\playwright\pwa-cloudflare\`：

- `edge-smoke.json`：实际五项结果的结构化记录。
- `build-browser-runner.cjs` / `run-smoke.js`：仅将已有烟测脚本和合成夹具指向当前来源。
- `.playwright-cli/page-2026-11-17T11-39-38-557Z.png`：393×852 Windows Edge 页面截图。

未重新执行整套财务业务测试。没有测试手机安装、系统键盘、保存到“文件”、恢复或 A/B 更新。
原入口和 Netlify 的手机问题见 `PWA_NETLIFY_TEST_ENTRY.md`；历史结果不能套用到新来源。

## 下一步

用户提供的 2026-11-17 19:46 真机照片已确认 Safari 中文首页和资源准备完成，标记清单 01
通过、03 的 Safari 部分通过。照片仍有 Safari 工具栏，未证明已安装或断网成功；VPN 状态
不能从照片判定。照片文件路径记录在 `PWA_IPHONE_ACCEPTANCE.md`。

2026-11-18 用户已添加到主屏幕，初次点击黑屏，等待/重开后回复“打开了”。先保留启动问题，
尚不能判定网络、系统启动或页面运行哪一环节导致。未修改程序、未重新部署、未清理任何手机数据。
本机复查根入口、runtime-config.js、pwa-app-storage.js、service-worker.js 均 200、无跳转且与快照
原字节一致；manifest.webmanifest 本次请求出现 fetch failed，不能据此认定手机黑屏原因。

随后用户提供 18:40 截图，主屏幕入口无 Safari 地址栏、中文首页及底部导航完整、资源准备完成。
02—03 的本次安装和资源准备检查通过，仍保留首次黑屏问题并观察复现；照片路径见验收清单。
输入缩放已获用户确认解决。下一批先在主屏幕入口保持联网，通过原有显式更新按钮切换至
去掉顶栏的新版本并确认显示；再继续“苹果体验账本”和本金 100 元的“体验钱包”（04），本条尚未确认完成。
随后继续虚构账目验收；尚不安排断网，待后续按 15—16 单独执行。
手机直连仍可能受网络影响；免费套餐不保证持续可用。Pages Functions 免费额度受每日
Workers 请求上限约束，不启用收费套餐来处理超额。参见 Cloudflare 官方：

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/functions/advanced-mode/
- https://developers.cloudflare.com/pages/functions/pricing/

新来源与原站、Netlify、Android 不会自动共享数据。若已有需要保留的数据，通过已核对的
JSON 备份迁移，保留原件；不清理网站数据，不自动初始化覆盖旧类别或账户。
更新验收仍须在此同一来源准备 A/B 完整版本，换托管不能充当版本升级验收。

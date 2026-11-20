# Netlify 备用测试入口与当前阻塞

记录日期：2026-11-17。仅记录本窗口实际操作及设备反馈，不代表真机验收通过。

## 授权与入口

原 Sites 站点保留，用户在本窗口明确选择方案 2：允许选择无需 VPN 的新测试入口。
这条新授权调整了交接文档中只能使用旧测试来源的约束，不授权继续任意换站或换域名。

- 旧入口：`https://jizhangben-ios-test.awakehornbill.chatgpt.site/`，保留。
- 新候选固定入口：`https://fascinating-fenglisu-7a1995.netlify.app/`。
- Netlify 项目名：`fascinating-fenglisu-7a1995`，后续复用同一项目。
- Netlify Site ID：`a7cec0b4-b769-4e7a-ba6b-847e00c295c6`，从公开响应的 `data-netlify-site-id` 原样读取。
- 当前账户层级：公开 HTML 标识 `data-account-tier="free"`。
- 用户自行注册并在电脑上传准备好的 `site` 文件夹，随后自行开放访问。没有提供托管账号凭据。

## 实际设备与旧入口结果

用户报告设备：iPhone 16 Pro，iOS 26.6.1（用户口述，未取得系统关于本机截图）。

旧入口在手机 5G、Wi-Fi 和 Safari 无痕窗口均出现 Cloudflare 拦截页；截图可见
Ray ID `a5bd5579fe812ec9`。用户随后确认：同一 Wi-Fi 下能打开页面的电脑启用了 VPN。
因此电脑成功不能当作普通直连网络可访问的证据，也不能据此断言所有 iPhone 都必须使用 VPN。
具体命中的安全规则未查明，现有 Sites 工具无安全事件查询或防火墙规则修改能力。

第 01 项在旧入口的上述手机网络下失败；02—21 未通过，不能当作真机安装或离线验收完成。
新候选入口的手机直连也未通过：用户反馈“仍被拦截或打不开”，随后提供 17:16 的 Safari
截图，状态栏为 5G，错误为“Safari 浏览器打不开该页面，因为无法与服务器建立安全的连接”。
这是新入口的 HTTPS 连接失败表现，不能与旧站的 Cloudflare 拦截页混为一谈；新入口 Wi-Fi
对照及同设备正常 HTTPS 网站对照尚待测试。该截图不是记账本业务页面报错。

后续用户报告手机已能打开，并提供 19:15 的 Safari 首页截图：地址栏为上述 Netlify 来源，
状态栏显示 Wi-Fi，首页及中文主要入口可见。因此补记“新入口在这次 Wi-Fi 测试中页面打开成功”；
不能把早先 5G 失败改为通过，也不能推断所有移动网络或长期访问已稳定。
截图中的“离线准备未完成”仍存在，阶段 03 未通过；“Powered by Netlify”徽标遮住底部导航，
属于实际手机界面问题，安装、记账、备份恢复及更新测试尚未通过。

本机随后在当前 VPN/代理网络下开启证书校验，TLS 1.2 和 TLS 1.3 握手均成功，证书域名
包含 `*.netlify.app`，有效期为 2026-02-16 至 2027-03-19。该结果不能代替手机线路检测。
本机 DNS 返回 `198.18.0.115`，显示当前解析受本机网络环境影响，不能据此认定手机实际
解析地址，也不能把本机 family=6 探测成功当作手机 IPv6 链路验收通过。未关闭证书校验。

## 发布资源来源

沿用旧站同一批已核对的 53 个程序文件，构建 ID：
`26134fa8d487097c550cba269da75f7a46704a5ed8447e1f7926f8943eb29639`。

- 独立准备脚本：`G:\project\output\jizhangben-netlify-test\prepare.cjs`。
- 部署目录：上述输出目录下的 `<完整构建 ID>\site`。
- 附加 `_headers` 和 `404.html` 仅用于托管，不加入离线缓存的程序清单。
- `netlify.toml` 位于该构建输出根目录，不在手工上传的 `site` 内，因此不能假定其中设置已应用。
- 未修改主工程共享业务 JS/CSS，未上传账本、备份或整个项目。

## 当前 HTTPS 检查

首次匿名请求 `index.html` 返回 401；用户开放后已变为 200。
随后执行 58 项匿名请求，复核结果如下：

- 53 个程序资源和根入口均为 200，4 个未知路径为真实 404，没有路径跳转。
- 51 个非 HTML 程序文件逐字节摘要一致。
- `index.html`、`install.html` 及根入口内容被平台加入 Netlify 注释和
  `/.netlify/scripts/hud?variant=public` 脚本，故摘要不一致。
- 平台返回 `Cache-Control: no-store,no-transform`。它与原检查器要求的
  `no-store, no-transform` 只是可选空白差异，不能误称缓存策略不同。
- 首次检查中 CSS 请求有一次网络失败；随后重试和完整复核中 CSS 状态、摘要正常。
- 没有发现 `Clear-Site-Data` 响应头。

证据：`G:\project\output\jizhangben-netlify-test\` 下的
`https-first-check-20261117.json`、`https-public-check-1794906768134.json`、
`https-diagnostic-1794906876069.json`。

整体资源验收未通过。页面可打开与离线准备成功应分开记录；平台 HTML 注入破坏当前 SW 的
完整性核验，不能通过取消摘要校验、忽略 HTML 文件或清理账本来掩盖。

## 后续处理

Netlify 官方文档说明，新建 Free 项目默认开启 Powered by Netlify badge，边缘响应会注入脚本；
是否能关闭取决于套餐及设置。参见：
https://docs.netlify.com/manage/projects/powered-by-netlify-badge/

同日已通过现有登录浏览器实际查看这个项目的 General 设置，Site ID 与上文一致。
Powered by Netlify badge 区域明确显示：
“Upgrade your team’s plan to hide the badge on this project.”、
“The badge is shown on this project.”，仅提供“Upgrade to unlock”，没有免费关闭开关。
本次仅查看设置，没有升级、支付、改变访问范围或再次发布。
这确认了免费套餐的实际限制；升级是否同时消除平台 HTML 注释尚未验证，不能承诺付费即修复。

优先核对新入口的手机直连 HTTPS 问题，先做正常 HTTPS 网站及 Wi-Fi 对照；暂缓让用户
调整徽标设置。直连可用后，再核对现有项目
`Project configuration > General > Powered by Netlify badge` 的实际设置。
禁止自行升级付费。即使关闭标记，也必须重新核对两份 HTML 的完整字节，不能假定平台注释同时消失。
保留当前固定入口与全部现有数据；若本平台免费能力确实无法满足，说明证据后再与用户决定下一步。

新来源的数据不自动与旧站、Android、Safari/主屏幕其他容器共享；需要迁移时用已核对的 JSON 备份。
首轮继续只用虚构账目，先验证直连访问和离线准备，再进入安装、记账、文件备份及更新清单。

## 用户确认只使用免费方案

同日用户明确回复“不行，还是免费吧”。后续不升级 Netlify 或 Workers 套餐，不购买域名或收费资源。

已核对其他候选的实际限制：EdgeOne Makers 默认域名在中国大陆要求 3 小时有效预览链接；
阿里云 ESA Pages 的部分默认测试域名要求 60 分钟有效 token，均不选作长期固定入口。
Cloudflare Pages 作为下一个免费候选，使用可由控制台 Direct Upload 上传的 `_worker.js` 高级模式，
复用旧 Sites 仓库已存在的程序资源响应适配层，避免 Pages 默认 `.html` 跳转和首页回退。

本机候选目录：`G:\project\output\jizhangben-cloudflare-test\site`，准备脚本在其父目录
`prepare.mjs`。仅含原 53 个程序资源与一个 `_worker.js`，没有共享业务代码变更。
123 项本地契约检查通过，包括逐资源原字节、MIME、响应头、查询参数、真实 404、写请求拒绝、
HEAD 及非法路径。该结果不等于 Cloudflare 线上部署、离线缓存或 iPhone 直连已通过。

截至本条记录，尚未部署 Cloudflare，没有新网址。用户确认尚无 Cloudflare 账号，需要自行注册登录。
插件目录检索未找到可直接用于发布的 Cloudflare 插件。原 Sites 与 Netlify 项目均保留。
免费函数请求有每日额度限制；手机的 Wi-Fi、5G 可访问性仍待发布后实测，不能承诺不需要 VPN 就一定可用。

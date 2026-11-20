# iPhone 输入时自动放大：修复与复测

日期：2026-11-18；状态：用户已同意发布；同一来源发布成功，线上 58 项及 Edge 5 项检查通过；用户随后回复“可以了，没问题”，本次输入自动放大问题按用户反馈复测通过。

## 问题与范围

用户在主屏幕网页应用填写内容时反馈页面自动放大，影响连续输入。提供的图片为首页，
没有输入状态，不能仅凭图片确定放大比例或键盘布局。原线上快照的账本名称、账户名称、
备注输入框在浏览器中的实际字号均为 14px，与 iPhone 小字号表单聚焦放大的已知行为相符。
参考控件开发商的原始说明：
https://www.telerik.com/products/aspnet-ajax/documentation/knowledge-base/common-disable-autozoom-input-safari-iphone

只修改 `pwa/preview.css`：可输入的文本框、选择框及多行输入框统一使用
`max(16px, 1rem)`，覆盖原各页面的小字号。排除自定义金额框、文件与非文本控件。
保留 viewport 的手动缩放能力，未添加 `user-scalable=no` 或 `maximum-scale=1`。
没有修改共享 HTML/CSS/JS、数据库、数据格式或 Android 工程。

## 发布来源与数据保护

- 固定项目：`jizhangben-iphone-test-2026`；固定入口：`https://jizhangben-iphone-test-2026.pages.dev/`。
- 旧构建：`26134fa8d487097c550cba269da75f7a46704a5ed8447e1f7926f8943eb29639`。
- 新构建：`f464590f3166d8cbf18200db8a1bebdb9d3ef2f03055b9a50e619d2d5d64075b`。
- 生产部署 ID：`49a2ebf4-6aac-40a9-b97b-e017b0e38c6f`；控制台时间 `2026-11-18T10:50:35.253974Z`。
- 用户确认发布后，本窗口选择生产环境；54/54 文件上传完成后点击 Save and deploy，控制台返回 Success。
  文件夹对话框点击受工具目标窗口限制，期间检测到用户操作；随后确认上传完成才执行发布。
- 首先从当前源码在隔离副本重建，确认 53 文件与旧部署逐字节一致；再只替换该副本的 PWA CSS。
- 新旧产物仅 6 文件变化：PWA CSS、带版本与 SRI 的 index/install、runtime-config、build-info、SW。
  所有共享业务脚本及存储适配字节保持不变，避免夹带工作区其他未提交功能。
- 上传目录：`G:\project\output\jizhangben-cloudflare-input-zoom\site`，仅 53 程序文件加 `_worker.js`。
- 旧版本与原包保留。审阅报告、合成夹具和手机图片未放入上传目录。
- 沿用显式更新，不强制刷新、不清网站数据、不删除主屏幕图标、不初始化覆盖账户或类别。

## 本机检查

证据目录：`G:\project\jizhangben-publish\output\playwright\pwa-input-zoom\`。

| 检查 | 结果 |
| --- | --- |
| 已有构建检查 | 4 项通过 |
| Worker 包契约 | 123 项通过；54 个上传文件 |
| Edge 界面检查 | 10 组通过；包含 320/393 宽度、横屏及 24px 根字号，共 44 个页面布局观察无横向溢出 |
| Edge 独立离线烟测 | 5 项通过；合成账本断网重开、断网记账后保留、无第三方请求或运行异常 |
| 字号与 A/B 更新 | 6 项通过；79 个控件在 16/24px 根字号下达标；金额框原字号不变；准备更新不刷新；显式更新保留数据库原字符串及草稿；新版断网重开 |
| 实际 HTTPS | 58 项通过，完整原字节、类型、安全头及真实 404；无 Clear-Site-Data |
| 实际 Edge 线上离线烟测 | 5 项通过，独立合成账本；未测试真实 iPhone 输入缩放 |
| 真实 iPhone 输入缩放 | 用户更新后回复“可以了，没问题”，本次输入自动放大复测通过；横屏、大字体及其余键盘检查未逐项确认 |

`baseline-review.json`、`candidate-review.json` 记录来源哈希和变更范围；
`focus-update-result.txt`、`smoke-result.txt` 保存 CLI 实际结果；
`candidate-book-input.png` 为本机输入框截图。原有界面套件通过 CLI 运行，未增加镜像实现的单元测试。

线上证据：`G:\project\output\jizhangben-cloudflare-input-zoom\https-check-1794999083097.json`，
以及证据目录中的 `live-smoke-result.txt`。发布刚结束的首次核验中根路径仍返回旧摘要，
保留在 `https-check-1794999058956.json`；随后完整重试 58 项通过，不回填第一次的失败。

## 真机复测

1. 完成当前编辑，保持联网，在原主屏幕入口展开离线状态，检查更新，明确点击“保留草稿并更新”。
2. 分别输入账本名称、账户名称与备注，观察聚焦/输入/收起键盘是否突兀放大或需手动缩回。
3. 检查竖屏、横屏、中文键盘、滚动到保存按钮；现有体验账目及类别保持原样。
4. 记录 Safari 与主屏幕入口分别的结果。首次主屏幕黑屏问题仍独立保留，不因本次样式修复关闭。

这次用户尚未确认测试账户本金与余额，清单 04 不能记通过；清单 08 的输入缩放问题仍待修复版真机复测。

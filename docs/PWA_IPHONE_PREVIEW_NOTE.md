# iPhone 顶部预览说明栏精简

2026-11-18。用户要求去掉“离线预览 · 仅使用示例账本／桌面使用说明”整栏，并明确确认“发布这一版”。
本机修改与完整包检查通过；已发布至原入口，线上 58 项、Edge 5 项及显示状态检查通过，手机更新后效果待用户确认。

只在 `pwa/preview.css` 的 `.pwa-prototype-note` 增加 `display: none`，不占用空间，也不会进入
无障碍阅读内容。保留 DOM 节点供原离线模块插入相邻状态面板，避免删除节点导致模块启动失败。
下方“程序资源已核对，可离线使用”、检查更新及保留草稿更新按钮仍可用。
不修改共享页面、业务代码、账本、账户、类别、图标、顺序、隐藏设置或 Android 工程。

- 上一构建：`f464590f3166d8cbf18200db8a1bebdb9d3ef2f03055b9a50e619d2d5d64075b`。
- 本次构建：`7e627aac10feb628c69528435c4dd6eeec43b45b69d01cbce64411cf9e107ebb`。
- 本次生产部署：`0cdba9ba-0b8c-4e75-b570-973345a4b169`，控制台时间 `2026-11-18T10:58:59.255495Z`。
  54/54 文件上传完成后，本窗口点击 Save and deploy，控制台显示 Success；使用同一固定来源。
- 用上一版已冻结源码建立独立构建，只替换 PWA CSS；其余源文件原字节不变。
- 新旧产物仍只有 CSS 及版本/SRI/摘要相关的 6 文件变化；共 53 程序资源。
- 现有项目：`jizhangben-iphone-test-2026`，入口：`https://jizhangben-iphone-test-2026.pages.dev/`。
- 完整上传目录：`G:\project\output\jizhangben-cloudflare-hide-preview-note\site`，共 54 文件。
  旧包保留；审阅材料、截图与合成账本没有上传。
- 本机 Worker 123 项契约检查通过；Edge 5 项离线烟测通过；393×852 截图已查看，
  顶栏不显示且高度为 0，离线状态与检查更新按钮可见、无横向溢出，输入字号仍为 16px。
- 证据目录：`G:\project\jizhangben-publish\output\playwright\pwa-hide-preview-note\`，
  包含 `review.json`、`visible-result.txt`、`smoke-result.txt`、`home-without-preview-note.png`。
- 本次线上 58 项均通过，证据：`G:\project\output\jizhangben-cloudflare-hide-preview-note\https-check-1794999565086.json`。
  另有 `live-smoke-result.txt`（5 项）、`live-visible-result.txt` 和 `live-home-without-preview-note.png`；
  线上显示检查同样确认说明栏高度为 0，离线状态和更新检查可见，输入字号保持 16px。

用户同轮确认上一版输入自动放大问题“可以了，没问题”，已更新清单 08 为部分通过；
不能把该回复扩展为全部键盘、大字体、横屏、账目或断网验收通过。
本次发布后仍需用户在原桌面入口显式检查更新，确认顶栏消失、状态入口与输入正常。

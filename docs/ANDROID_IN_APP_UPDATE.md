# 安卓应用内更新提醒

记录日期：2026-11-20
适用版本：2.10（versionCode 111）起
一句话：App 在安卓壳里后台读取下载站的 `site/version.json`，发现比本机新的 `versionCode` 就提示更新；`mobile/release.ps1` 发布 APK 时按「刚复制进去的那个包」生成这份清单，保证「提示的新版本」和「能下载的安装包」始终是同一个。

## 一、功能行为

- **只在安卓原生壳里运行**：`index.html` 引入的 `js/update-check.js` 先检查 `window.JizhangbenUpdate` 原生桥；iPhone PWA、普通浏览器没有桥，不发任何请求，也不显示入口。
- **后台检查，不挡启动**：启动后异步检查一次，不阻塞启动和记账；打开时正好断网的话，网络恢复（`online` 事件）后会补一次。
- **已装版本取自系统**：原生桥 `getVersionInfo()` 返回的 `BuildInfo`（`versionCode`/`versionName`），而不是网页里的版本号，避免把网页缓存版本当成本机安装版本。
- **比较规则**：远端 `versionCode` **大于**本机才提示；相等或更小视为最新（也用于撤回误发的提醒）。
- **提醒频率**：同一 `versionCode` 只在首次发现时主动弹一次提示条，之后只保留「设置 → 检查更新」的红点；手动「检查更新」只更新状态，不再弹条。提醒状态存在 localStorage 独立键 `jzb.android.update.v1` 里，不写账本数据，也不进入备份/恢复。
- **提示条内容**：标题「发现新版本 v2.10」，正文取清单的 `notes`（为空时用默认文案「包含体验改进与问题修复，覆盖安装即可，账目和设置都会保留。」），按钮「去下载」和「稍后」。
- **下载入口**：调原生 `openExternalBrowser("https://jizhangben-download.pages.dev/")` 用系统浏览器打开下载页，失败时回退 `window.open`；**只提示，不自动下载、不自动安装**。
- **设置页**：显示当前版本、检查状态（尚未检查 / 正在检查… / 发现新版本 / 已是最新版本 / 暂时无法连接更新服务…）和下载入口；有新版时设置入口带红点。

## 二、涉及文件

发布侧（本仓库维护）：

| 文件 | 作用 |
| --- | --- |
| `mobile/release.ps1` | 发布主流程；新增 `-UpdateNotes`，用 aapt2 校验站点 APK，生成并校验 `version.json` |
| `mobile/site-version.ps1` | 只负责按参数写 `site/version.json`（UTF-8 无 BOM、末尾换行），可单独运行验证 |
| `site/version.json` | 发布时生成，不手改；随 `site/` 一起部署 |
| `site/_headers` | Cloudflare Pages 响应头：`/version.json` 允许跨域、`no-store` |
| `site/index.html` | 下载页，`release.ps1` 自动更新下载链接与版本标签 |

App 侧（由 App 实现负责，本文只描述契约）：`js/update-check.js`（检查与提示逻辑）、`js/app.js`（启动时调用）、`index.html`（提示条与设置入口）、`android/app/src/main/java/com/jizhangben/app/MainActivity.java`（原生桥 `getVersionInfo` / `openExternalBrowser`）。

## 三、version.json 格式

发布时由脚本生成，示例：

```json
{
    "versionCode": 111,
    "versionName": "2.10",
    "notes": "新增应用内更新提醒，修复若干问题。",
    "publishedAt": "2026-11-20T12:00:00Z",
    "apk": "download/jizhangben-v2.10.apk"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `versionCode` | 是 | 正整数，必须等于 `site/download/` 里 APK 的真实 `versionCode`；App 唯一的比较依据 |
| `versionName` | 是 | 形如 `2.10` 的字符串，显示用 |
| `notes` | 是 | 非空字符串，提示条文案；脚本会去掉首尾空白 |
| `publishedAt` | 否 | UTC ISO 8601 时间，排查「线上是不是旧清单」时用 |
| `apk` | 否 | 相对下载页的 APK 路径，人工核对用 |

App 会忽略未知字段；`versionCode` 非正整数会整份清单视为无效（不提醒）。

## 四、发布步骤

1. 确认 App 侧改动已合入（`js/update-check.js`、启动调用、提示条 DOM），并跑过测试：

   ```powershell
   npm test
   ```

2. 决定版本号和一句更新说明，执行发布（`versionCode` 由脚本自动 +1，不要手工改）：

   ```powershell
   cd G:\project\jizhangben-publish
   powershell -NoProfile -ExecutionPolicy Bypass -File .\mobile\release.ps1 -VersionName "2.10" -UpdateNotes "新增应用内更新提醒，修复若干问题。"
   ```

   > 版本号一定要加引号：PowerShell 会把不带引号的 `2.10` 当成数字 `2.1`。

3. 脚本按顺序做这些事：校验版本号严格递增 → 改 `build.gradle` → 同步网页并构建签名离线 APK → 清掉 `site/download/` 旧包并放入 `jizhangben-v2.10.apk` → 更新下载页链接/版本/体积 → 用 aapt2 读站点 APK 的真实版本并与脚本值比对，不一致直接中止 → 生成 `site/version.json` → `wrangler pages deploy site` → 再请求线上 `version.json` 做一次 best-effort 校验（网络失败只警告，版本号不一致会抛错）。

4. 只验证构建、不上线：加 `-SkipDeploy`（仍会让版本号 +1、构建并更新本地 `site/`，只是不部署）。

5. 部署后手工复核（可选）：

   ```powershell
   (Invoke-RestMethod "https://jizhangben-download.pages.dev/version.json?t=$(Get-Date -UFormat %s)") | ConvertTo-Json -Compress
   (Invoke-WebRequest -UseBasicParsing -Method Head "https://jizhangben-download.pages.dev/version.json").Headers
   ```

   响应头应包含 `Access-Control-Allow-Origin: *` 与 `Cache-Control: no-store`；`versionCode` 应等于新包的版本号。

6. 手机自测：先在自己手机上手动安装这一版，确认「设置 → 检查更新」显示当前版本；再发下一个版本时验证提示条出现、点「去下载」能打开下载页、覆盖安装后账目保留。

7. **老用户路径**：v2.09 及更早的安装包里没有更新检查代码，**不会收到任何提示**，需要手动覆盖安装一次本版；从这一版起，后续新版本才会收到应用内提醒。提醒只负责告知和打开下载页，安装始终由用户手动完成。

回滚注意：Android 不允许 `versionCode` 变小，`release.ps1` 也会拦住；真要回滚只能重新部署上一份 `site/` 快照，不能靠「改回旧版本号」。

## 五、故障回退

- 断网、请求超时（8 秒）、非 2xx、CORS 被拦截、JSON 解析失败、`versionCode` 非法：启动检查静默失败、不提醒；手动「检查更新」显示「暂时无法连接更新服务，稍后再试。」。**任何失败都不影响记账**。
- 远端 `versionCode` 不高于已装版本：视为已是最新，不提醒。
- 提醒状态写不进 localStorage：按未提醒处理，下次打开最多再提醒一次。
- 线上 `version.json` 与 APK 不一致：发布脚本用 aapt2 在部署前拦截；部署后线上校验不一致会抛错，提示站点清单陈旧。
- aapt2 找不到：脚本打警告并回退 `build.gradle` 的值继续发布（建议保留 `G:\project\android-tools\sdk\build-tools` 下的工具）。
- `site/_headers` 缺失或未生效：跨域 fetch 失败 → 只是不提醒，不会报错或闪退；本地 `http.server` 预览不应用 `_headers`，需用 `wrangler pages dev site` 或线上验证。

## 六、本地自检

不发布、不部署时，单独生成一份清单验证编码和字段：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mobile\site-version.ps1 `
  -VersionCode 111 -VersionName "2.10" -Notes "测试更新说明" `
  -ApkFile "download/jizhangben-v2.10.apk" -OutputPath "$env:TEMP\version.json"
Get-Content "$env:TEMP\version.json" -Raw | ConvertFrom-Json
Format-Hex "$env:TEMP\version.json" | Select-Object -First 1   # 第一字节应为 7B，不是 EF BB BF
```

校验现有 APK 的版本（发布脚本里的同一段逻辑）：

```powershell
& "G:\project\android-tools\sdk\build-tools\36.0.0\aapt2.exe" dump badging ".\releases\jizhangben-offline-v2.09-release.apk"
```

应读出 `versionCode='110' versionName='2.09'`。

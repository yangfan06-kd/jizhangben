# Android App 工作区

这里保存 Capacitor 的 App 配置和网页同步脚本。

## 当前状态

- `../capacitor.config.json` 已把 App 名称设为“记账本”，包名为 `com.jizhangben.app`。
- `sync-web.cjs` 只复制根目录的 `index.html`、`css/` 和 `js/` 到 `www/`，不会把 FastAPI、测试或本地数据库放进 App；同时注入 App 的 API 地址配置。
- `www/` 是生成目录，不直接编辑；修改网页后运行 `npm run app:sync`。
- Android 原生工程、JDK 21、Android SDK 和 ADB 已准备完成，工具与缓存统一放在 `G:\project\android-tools`。

## 个人离线使用

个人版不需要启动 Docker、不需要服务器或域名，也不需要一直连接 USB。安装 APK 后，账本、账户和账目保存在手机本地；没有可用后端时 App 会自动进入“本机离线模式”。不同手机的数据彼此独立，请在「备份」中导出 JSON 文件后再迁移到另一台设备。

生成并安装个人调试 APK：

```powershell
npm run app:build:offline
npm run app:install:offline
```

APK 文件仍位于 `android/app/build/outputs/apk/debug/app-debug.apk`。安装完成后可以拔掉 USB；USB 只用于把 APK 安装到手机，不是 App 日常使用条件。

## 后续命令

```powershell
. .\mobile\android-env.ps1
npm run app:sync
npx cap add android
npm run app:sync-capacitor
npm run app:build:debug
npm run app:install:debug
npx cap open android
```

联网调试版默认把 API 配置为 `http://localhost:8000/api`。安装脚本会自动执行 USB 端口转发，让手机的 8000 端口连接到电脑的 8000 端口；这只用于后端联调。个人离线版使用 `app:build:offline`，不会把联网调试作为运行前提。也可以在构建前设置 `$env:JIZHANGBEN_API_BASE_URL` 覆盖地址；正式联网环境应使用 HTTPS 地址。

正式包准备真实域名后，先设置 `$env:JIZHANGBEN_API_BASE_URL` 并运行 `npm run app:validate:release`。检查通过后再同步网页资源；检查器会拦截本机地址、示例域名、非 HTTPS 地址和不完整的 `/api` 路径，避免把调试配置带进发布包。

地址检查通过后可以运行 `npm run app:build:release` 生成未签名的发布 APK。当前工程没有签名密钥，因此该产物只用于检查发布构建是否完整；正式分发还要配置签名并生成 AAB。

本机工具放在 `G:\project\android-tools`。环境脚本会选择其中的 Java 21、Android SDK，并把 Android 用户缓存和 Gradle 缓存都放到 G 盘；每次打开新的 PowerShell 窗口后，先重新执行脚本。

以后网页代码有更新，直接运行 `npm run app:build:debug`，脚本会先同步网页资源，再生成新的 `android/app/build/outputs/apk/debug/app-debug.apk`。

连接手机前，在 Android 设置中打开开发者选项和 USB 调试，连接数据线后接受“允许 USB 调试”提示。确认 `adb devices` 出现一行状态为 `device` 后，运行 `npm run app:install:debug` 安装调试版；脚本会同时建立 `tcp:8000` USB 转发。如果没有设备，脚本会停止并说明需要处理的连接问题。

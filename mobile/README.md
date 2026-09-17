# Android App 工作区

这里保存 Capacitor 的 App 配置和网页同步脚本。

## 当前状态

- `../capacitor.config.json` 已把 App 名称设为“记账本”，包名为 `com.jizhangben.app`。
- `sync-web.cjs` 只复制根目录的 `index.html`、`css/` 和 `js/` 到 `www/`，不会把 FastAPI、测试或本地数据库放进 App。
- `www/` 是生成目录，不直接编辑；修改网页后运行 `npm run app:sync`。
- Android Studio、Android SDK 和 ADB 尚未安装，因此 `android/` 原生工程将在工具链准备好后创建。

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

`npx cap add android` 需要 Android Studio 和 SDK；在它们安装完成前不要把失败当成网页代码问题。

本机工具放在 `G:\project\android-tools`。环境脚本会选择其中的 Java 21、Android SDK，并把 Android 用户缓存和 Gradle 缓存都放到 G 盘；每次打开新的 PowerShell 窗口后，先重新执行脚本。

以后网页代码有更新，直接运行 `npm run app:build:debug`，脚本会先同步网页资源，再生成新的 `android/app/build/outputs/apk/debug/app-debug.apk`。

连接手机前，在 Android 设置中打开开发者选项和 USB 调试，连接数据线后接受“允许 USB 调试”提示。确认 `adb devices` 出现一行状态为 `device` 后，运行 `npm run app:install:debug` 安装调试版；如果没有设备，脚本会停止并说明需要处理的连接问题。

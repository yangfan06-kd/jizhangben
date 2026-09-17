# Android App 计划

## 目标

把现有记账网页做成可以安装到 Android 手机的 APK，同时保留现在的账本、押金结算、备份和登录能力。第一版先服务个人学习和手机使用，不把发布到应用商店作为当前阻塞条件。

## 技术路线

采用 Capacitor 给现有 HTML、CSS、JavaScript 增加 Android 原生外壳。

- 复用现有网页和前端测试，不重写成 React Native 或 Flutter。
- `mobile/www` 是给 App 打包的网页资源目录，由同步脚本从仓库根目录复制入口文件、样式和前端模块。
- `capacitor.config.json` 记录应用名称、Android 包名和网页目录。
- Android 原生项目会在 Android SDK 工具链准备好后创建，生成的 APK 只用于本地安装和验收。
- 电脑浏览器、手机浏览器和 APK 共用同一套前端业务代码；后端同步需要可从手机访问的 HTTPS 地址。

## 分阶段交付

### A. 网页资源打包基线（当前）

1. 已安装 Capacitor 核心依赖、CLI 和 Android 平台依赖。
2. 已建立 `mobile/www` 与可重复执行的同步脚本。
3. 已确认 `npx cap sync` 能识别网页目录。

### B. Android 工具链和第一个 APK

1. 已把 Android Studio、JDK 21、Android SDK 和 Gradle 缓存放在 `G:\project\android-tools`。
2. 已安装 Android API 36、Build Tools 35.0.0/36.0.0 和 Platform Tools；真实手机尚未连接。
3. 已执行 `npx cap add android`，创建 `android/` 原生工程，并成功生成调试 APK。
4. 待在真实手机上验收登录入口、记账、押金结算、筛选、总览和本地备份。

### C. 手机与电脑共享数据

1. 为 App 配置正式 HTTPS API 地址，不能把 `127.0.0.1` 或局域网地址写进发布包。
2. 验证 Android WebView 的 Cookie、CORS、会话过期和失败提示。
3. 用同一账号在电脑浏览器、手机浏览器和 APK 之间核对账本、账目和净资产。

### D. 可选发布准备

1. 添加应用图标、启动页、签名密钥和版本号管理。
2. 生成签名 APK/AAB，编写隐私说明和数据备份说明。
3. 再评估是否需要发布到 TapTap 或其他应用市场。

## 当前边界

- 当前仓库还没有 Android Studio、Android SDK 和 ADB，因此本次只建立可复现的网页打包基线，不能声称已经生成 APK。
- 在正式 HTTPS 后端可用前，App 可以先验证离线 localStorage 模式；登录同步和跨设备数据必须等 C 阶段完成。
- 不把邮箱验证码、找回密码等认证增强塞入 App 首版，继续遵循核心记账流程优先的计划。

## 学习重点

- `webDir`：Capacitor 从哪个目录复制网页资源。
- `sync`：网页代码如何进入原生工程。
- Android 包名、调试 APK、签名 APK/AAB 的区别。
- WebView 访问远程 API 时的 HTTPS、Cookie 和 CORS 边界。
- 如何用真实设备做跨端回归，而不是只看浏览器页面。

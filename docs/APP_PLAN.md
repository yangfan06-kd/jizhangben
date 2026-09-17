# Android App 计划

## 目标

把现有记账网页做成可以安装到 Android 手机的 APK，同时保留现在的账本、押金结算、备份和登录能力。第一版先服务个人学习和手机使用，不把发布到应用商店作为当前阻塞条件。

## 技术路线

采用 Capacitor 给现有 HTML、CSS、JavaScript 增加 Android 原生外壳。

- 复用现有网页和前端测试，不重写成 React Native 或 Flutter。
- `mobile/www` 是给 App 打包的网页资源目录，由同步脚本从仓库根目录复制入口文件、样式和前端模块。
- `capacitor.config.json` 记录应用名称、Android 包名和网页目录。
- Android 原生项目会在 Android SDK 工具链准备好后创建，生成的 APK 只用于本地安装和验收。
- 电脑浏览器、手机浏览器和 APK 共用同一套前端业务代码；服务端同步需要可从手机移动网络访问的 HTTPS 地址，成功读取的数据同时缓存到 App 本地 localStorage。
- 新账号首次注册或登录时，服务端会准备 8 个内置类别和 9 个内置记账类型；新建账本会准备 7 个默认账户，保证 App 首次记账时已有可用的服务端 UUID。

## 分阶段交付

### A. 网页资源打包基线（当前）

1. 已安装 Capacitor 核心依赖、CLI 和 Android 平台依赖。
2. 已建立 `mobile/www` 与可重复执行的同步脚本。
3. 已确认 `npx cap sync` 能识别网页目录。

### B. Android 工具链和第一个 APK

1. 已把 Android Studio、JDK 21、Android SDK 和 Gradle 缓存放在 `G:\project\android-tools`。
2. 已安装 Android API 36、Build Tools 35.0.0/36.0.0 和 Platform Tools，并通过 USB 调试连接真实 Android 手机。
3. 已执行 `npx cap add android`，创建 `android/` 原生工程，并成功生成调试 APK。
4. 已运行 `npm run app:install:debug` 并成功安装、启动调试 APK；登录、建账本、建账户、普通记账、押金结算、对象筛选、总览和服务端备份读取已通过真机验收。

### C. 手机与电脑共享数据

1. 当前调试包通过 USB 转发访问本机 API；手机到 Docker 的局域网健康接口和带会话账本读取已验证。手机浏览器已通过 `http://10.141.156.100:8000/` 完成局域网同源验收，APK 写入 45 元支出后两端统计已对账；发布前使用 `npm run app:validate:release` 检查正式 HTTPS API 地址，不能把 `127.0.0.1` 或局域网地址写进发布包。
2. 验证 Android WebView 的 Cookie、CORS、会话过期和失败提示。
3. 用同一账号在电脑浏览器、手机浏览器和 APK 之间核对账本、账目和净资产；已通过 APK 写入 45 元支出并在手机浏览器回读，登录后可使用“同步”按钮主动读取另一端的新数据。

HTTPS 配置要求：远程 API 给 Capacitor 的 `http://localhost` 页面使用时，将会话 Cookie 设置为 `SameSite=None; Secure`，并显式允许 `http://localhost` 的凭据跨域请求；局域网 HTTP 同源网页不需要这个跨来源配置。

正式入口可使用 `deploy/Caddyfile.example`：Caddy 终止 HTTPS 并反向代理到 FastAPI 8000 端口，应用容器不需要直接处理证书。域名和 80/443 公网入口准备好后，再用 HTTPS API 地址重新同步网页资源并构建 APK。

发布 API 地址预检：

```powershell
$env:JIZHANGBEN_API_BASE_URL = "https://你的真实域名/api"
npm run app:validate:release
```

检查器会拒绝 HTTP、localhost、回环地址、示例域名、缺少 `/api` 路径以及带查询参数或账号密码的地址。它只负责发布前的配置门槛，不会替代真实服务器健康检查。

### D. 可选发布准备

1. 添加应用图标、启动页、签名密钥和版本号管理。
2. 生成签名 APK/AAB，编写隐私说明和数据备份说明。
3. 再评估是否需要发布到 TapTap 或其他应用市场。

当前已提供 `npm run app:build:release`，它会先执行正式 API 地址预检，再同步网页资源并调用 Gradle 生成未签名发布 APK；签名和 AAB 仍属于后续发布准备。

## 当前边界

- Android Studio、Android SDK、ADB 和可复现构建脚本已准备完成；当前 APK 是调试包，只用于个人手机安装和功能验收。
- 在正式 HTTPS 后端可用前，App 可以先验证本地 localStorage 保存；正式 HTTPS 可访问后，服务端作为跨设备来源，成功快照会继续缓存到手机本地。移动网络暂时不可达时，App 会加载最近一次本地快照并显示“本机离线模式”，恢复网络后会给出提示，点击“联网登录”即可重新同步。
- 不把邮箱验证码、找回密码等认证增强塞入 App 首版，继续遵循核心记账流程优先的计划。

## 学习重点

- `webDir`：Capacitor 从哪个目录复制网页资源。
- `sync`：网页代码如何进入原生工程。
- Android 包名、调试 APK、签名 APK/AAB 的区别。
- WebView 访问远程 API 时的 HTTPS、Cookie 和 CORS 边界。
- 如何用真实设备做跨端回归，而不是只看浏览器页面。

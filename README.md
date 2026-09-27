# 记账本（jizhangben）

一款中文个人记账项目，提供可离线使用的 Android App，也可以在电脑浏览器中使用。项目从原有的 HTML、CSS 和 JavaScript 网页逐步发展，包含本地记账、数据备份、基金记录和可选的 FastAPI 服务端。

## 下载 Android 版

当前版本为 **1.60**，应用包名为 `com.jizhangben.app`。安装包使用项目现有签名，可以覆盖更新同一应用的旧版本：

[下载记账本-个人离线版-v1.60.apk](releases/记账本-个人离线版-v1.60.apk)

手机打开 APK 后按系统提示安装或更新。更新时不要先卸载旧 App，也不要清除 App 数据，否则本机账本可能被删除。建议更新前在“设置”里导出 JSON 备份。此 APK 使用调试签名，供个人和家人试用。

## 主要功能

- 多账本和账户管理，记录账户余额、负债和净资产。
- 支出、收入、转账、押金、借贷、代付、报销和退款等记录；押金本金与损益分开处理，并支持关联结算。
- 自定义主类型、大类和小类，可调整类别顺序并为小类选择彩色图标。
- 记录列表支持按日期、账户和类别筛选，也可以搜索备注。
- 按天、周、月和年查看收支，配有统计图和预算管理。
- 基金定投和单笔投资使用独立基金账户；记录追加、到期记账和赎回结算。
- 导出与导入本地 JSON 备份；支持整理外部记账 CSV 后导入。
- 内置金额键盘支持四则计算；切换记账主类型后可直接继续输入金额。

## 数据与离线使用

个人离线 App 无需注册、服务器、Docker、USB 或移动网络。账目保存在安装它的手机本地，备份文件可以用于换机迁移。另一台设备不会自动看到本机数据。

覆盖安装同一包名、同一签名且版本号更高的 APK，会保留 App 的本地存储。卸载 App 或清除 App 数据会移除本地账本，因此更新时直接打开新版 APK 进行安装。

## 在电脑上使用

无需配置环境，可以直接用浏览器打开 `index.html`。这种方式把数据存在当前浏览器的本地存储中。若要使用可选服务端登录和跨设备同步，请参考 [部署说明](docs/DEPLOYMENT.md)；服务端模式需要自行运行后端。

## 开发与构建

技术栈：HTML、CSS、原生 JavaScript、Capacitor、Node.js；可选后端为 FastAPI 和 SQLite。

安装前端依赖并运行自动检查：

```powershell
npm install
npm test
```

构建个人离线 Android APK 需要 Java 21、Android SDK 和 Android Build Tools：

```powershell
npm run app:build:offline
```

APK 会生成在 `android/app/build/outputs/apk/debug/app-debug.apk`。每次准备更新都需要增加 Android `versionCode`，并保留相同应用包名和签名证书，才能覆盖安装并保留应用数据。当前发布版本和签名摘要记录在 [Android 版本基线](docs/RELEASE_BASELINE.md)。

启动 Docker Compose 服务端：

```powershell
docker compose up --build -d
```

手机需要连接与电脑相同的 Wi-Fi 才能访问电脑局域网地址。服务端部署、持久化和公网 HTTPS 配置见 [部署说明](docs/DEPLOYMENT.md)。

## 项目结构

```text
index.html       页面结构与脚本入口
css/             页面样式和手机布局
js/              记账、计算、存储与界面模块
backend/         FastAPI 服务端和 SQLite 数据访问
tests/           前端自动检查
docs/            设计路线、学习记录和部署说明
mobile/          Capacitor 网页资源同步与 Android 构建脚本
android/         Android 原生工程
releases/        个人离线 APK
```

## 许可

本项目采用 [MIT License](LICENSE)。

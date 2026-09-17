# 部署基线

项目现在提供一个单容器部署方式：FastAPI 同时托管前端静态文件和 `/api` 接口，SQLite 数据库写入持久化目录。手机和电脑访问同一个地址时，登录 Cookie 与网页处于同源环境，不需要额外配置跨域。

## 用 Docker Compose 启动

在项目根目录运行：

```powershell
docker compose up --build -d
```

启动后访问：

- 网页：`http://电脑地址:8000/`
- 健康检查：`http://电脑地址:8000/api/health`
- 接口文档：`http://电脑地址:8000/docs`

打开网页后会先显示登录/注册入口。登录成功后才会读取并显示当前账号的账本；退出登录或会话失效时，页面会回到登录入口。直接双击仓库里的 `index.html` 仍是 localStorage 本地兼容模式。

注册时填写邮箱、显示名称、密码和确认密码。密码至少 8 个字符；注册成功会自动建立登录会话，当前版本没有接入短信或邮箱验证码。

同一账号在另一台设备新增账目后，回到当前页面点击登录栏的“同步”按钮即可重新读取服务端账本、账户、明细和总览；成功快照会写入当前设备的 localStorage，同步失败会保留当前页面数据。手机离线记账后会留下待同步保护标记；如果服务端已经有账本，恢复网络时会暂保留本机快照并提示先导出、预览和迁移，避免覆盖离线新数据。

Android App 启动时如果移动网络暂时不可达，会加载最近一次成功同步的本地快照并进入“本机离线模式”；系统网络恢复时会提示用户，点击“联网登录”可以重新认证和读取服务端。服务器返回明确的登录失效时仍会停留在登录入口，不会把认证错误当作断网。

手机和电脑连接同一个局域网时，把“电脑地址”替换成电脑的局域网 IPv4 地址，例如 `192.168.1.20`。如果 Windows 防火墙拦截 8000 端口，需要允许该端口的入站访问。

Android 调试包默认使用 `http://localhost:8000/api`，安装脚本会通过 USB 转发把手机的 8000 端口连接到电脑服务；这只适合开发验收。正式 App 应改为可从手机访问的 HTTPS 地址，并重新配置 API 地址与跨域策略。

正式 HTTPS 后端供 APK 使用时，建议在部署环境设置 `JIZHANGBEN_SESSION_SAMESITE=none` 和 `JIZHANGBEN_SESSION_SECURE=1`，并在 `JIZHANGBEN_CORS_ORIGINS` 中保留 App 的 `http://localhost` 来源。`SameSite=None` 必须配合 HTTPS 和 Secure Cookie 使用；局域网 HTTP 同源浏览器继续使用默认的 `lax` 和自动 Secure 判断。构建 APK 前设置 `$env:JIZHANGBEN_API_BASE_URL` 为 HTTPS API 地址，再重新打包。

正式 App 构建前先执行地址预检：

```powershell
$env:JIZHANGBEN_API_BASE_URL = "https://你的真实域名/api"
npm run app:validate:release
```

预检会拒绝 HTTP、localhost、回环地址、示例域名、缺少 `/api` 的路径，以及带查询参数或账号密码的 URL。调试构建不执行这道门槛，仍可使用 `http://localhost:8000/api` 和 USB 转发。

预检通过后可运行 `npm run app:build:release` 生成未签名发布 APK。当前工程没有签名密钥，产物只用于验证发布构建和网页资源注入；正式分发前还要配置签名并生成 AAB。

## 正式 HTTPS 入口模板

仓库中的 [`deploy/Caddyfile.example`](../deploy/Caddyfile.example) 是反向代理模板。它把公开的 HTTPS 请求转发到本机 FastAPI 的 8000 端口，Caddy 负责自动申请和续期证书；域名必须已经解析到部署服务器，并且 80、443 端口可以从公网访问。

1. 复制 [`deploy/.env.production.example`](../deploy/.env.production.example) 为部署机上的 `.env`，填写真实域名。
2. 确认 `JIZHANGBEN_BIND=127.0.0.1`，再启动应用：`docker compose --env-file .env up --build -d`。这样 8000 端口只对本机开放，公网请求统一经过 Caddy。
3. 在安装了 Caddy 的部署机上设置同名 `JIZHANGBEN_DOMAIN` 环境变量，并运行 `caddy run --config deploy/Caddyfile.example`。
4. 用 `https://你的域名/api/health` 检查健康接口，再把 `$env:JIZHANGBEN_API_BASE_URL` 设置为 `https://你的域名/api` 后重新构建 APK。

当前仓库只提供模板，不会在本地局域网环境自动申请证书；没有域名时继续使用 HTTP 局域网验收即可。

生产示例已通过 `docker compose --env-file deploy/.env.production.example config --quiet` 配置解析校验；这只证明 Compose 变量和端口映射格式正确，不会代替真实域名、证书和公网入口验收。

## 数据和安全默认值

- `jizhangben-data` 是 Docker 命名卷，数据库位于 `/data/jizhangben.db`，删除容器不会删除该卷。
- `JIZHANGBEN_ALLOW_DEV_FALLBACK` 固定为 `0`，没有登录 Cookie 的业务请求返回 401。
- 同源部署不需要设置 `JIZHANGBEN_CORS_ORIGINS`；如果以后把前端和后端分开部署，再用逗号分隔的完整来源配置它。
- 当前配置适合学习和局域网验收；正式公网使用前仍需 HTTPS、外部备份和恢复演练。

## 关闭和备份

```powershell
docker compose down
docker run --rm -v jizhangben_jizhangben-data:/data -v "${PWD}:/backup" alpine tar czf /backup/jizhangben-data.tgz -C /data .
```

卷名如果被项目目录名改变，以 `docker volume ls` 显示的实际名称为准。网页内的 JSON 备份仍应定期导出，作为数据库卷之外的第二份备份。

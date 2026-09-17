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

手机和电脑连接同一个局域网时，把“电脑地址”替换成电脑的局域网 IPv4 地址，例如 `192.168.1.20`。如果 Windows 防火墙拦截 8000 端口，需要允许该端口的入站访问。

Android 调试包默认使用 `http://localhost:8000/api`，安装脚本会通过 USB 转发把手机的 8000 端口连接到电脑服务；这只适合开发验收。正式 App 应改为可从手机访问的 HTTPS 地址，并重新配置 API 地址与跨域策略。

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

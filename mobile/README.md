# Android App 工作区

这里保存 Capacitor 的 App 配置和网页同步脚本。

## 当前状态

- `../capacitor.config.json` 已把 App 名称设为“记账本”，包名为 `com.jizhangben.app`。
- `sync-web.cjs` 只复制根目录的 `index.html`、`css/` 和 `js/` 到 `www/`，不会把 FastAPI、测试或本地数据库放进 App。
- `www/` 是生成目录，不直接编辑；修改网页后运行 `npm run app:sync`。
- Android Studio、Android SDK 和 ADB 尚未安装，因此 `android/` 原生工程将在工具链准备好后创建。

## 后续命令

```powershell
npm run app:sync
npx cap add android
npm run app:sync-capacitor
npx cap open android
```

`npx cap add android` 需要 Android Studio 和 SDK；在它们安装完成前不要把失败当成网页代码问题。

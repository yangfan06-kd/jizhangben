# Android 上架准备与渠道选择

记录日期：2026-11-17
适用产物：记账本（包名 `com.jizhangben.app`）
结论摘要：当前所有 `releases/*.apk` 均为 Debug 签名，任何商店都会拒收；上架前必须先完成正式签名、包名确认、明文流量整改三项。

## 一、现状诊断

| 项目 | 当前值 | 上架要求 | 状态 |
| --- | --- | --- | --- |
| 签名证书 | Android Debug 证书 | 自持 release keystore | ❌ 阻断 |
| 包名 | `com.jizhangben.app` | 未被目标商店占用，上架后永久不可改 | ⚠️ 待查 |
| 明文流量 | `androidScheme: http`，`cleartext: true` | 需 HTTPS，明文流量会被安全检测打回 | ❌ 阻断 |
| targetSdk | 36 | Google Play ≥35，国内主流 ≥33 | ✅ 合规 |
| minSdk | 24 | 无硬性要求 | ✅ |
| 隐私政策 | 无 | 必须有可公网访问的页面 | ❌ 缺失 |
| 软件著作权 | 无 | 国内商店必需 | ❌ 缺失 |
| 图标与截图 | 待补 | 各商店多尺寸 | ⚠️ 待补 |

另注：`android/app/build.gradle` 的 `buildTypes.release` 没有 `signingConfig`，因此 `npm run app:build:release` 产出的实际是未签名或 debug 签名的包。

## 二、第零步：生成正式签名 ✅ 已完成（2026-11-17）

### 执行记录

| 项目 | 结果 |
| --- | --- |
| 证书文件 | `android/keystore/jizhangben-release.jks`（4448 字节，PKCS12） |
| 别名 | `jizhangben` |
| 算法 | RSA 4096，有效期 10000 天（约至 2054 年） |
| 证书主体 | `CN=Fan Yang, OU=Personal, O=Independent Developer, L=Shenzhen, ST=Guangdong, C=CN` |
| 证书 SHA-256 | `7a847b2af238b7eded5ffc1c51ff6b68fb5a96e5477e274111680296c2304082` |
| 证书 SHA-1 | `a8fbc5f22177cf377fb92eb95bc68c1748aacef4` |
| 密码 | 见 `android/keystore.properties` |
| Gradle 配置 | `android/app/build.gradle` 已加入 `signingConfigs.release`；`keystore.properties` 缺失时自动回退，不阻断日常构建 |
| Git 忽略 | `android/.gitignore` 已加入 `*.jks`、`*.keystore`、`keystore.properties` |
| 构建验证 | `./gradlew assembleRelease` 成功，apksigner 确认签名主体已换为上述证书，v2 签名方案通过 |

**必须立刻执行（否则可能永久失效）：**

1. 把 `jizhangben-release.jks` 复制到两个不同物理位置（网盘 + U 盘/移动硬盘）
2. 密码 `android/keystore.properties` 里的 `storePassword` 单独抄一份，存在别的地方
3. 证书 SHA-256 指纹也一并记下（上架时商店要核对）

丢失证书 = 该应用永久无法更新，只能下架、换新包名重发，已有用户全部丢失。这是 Android 的机制，没有找回途径。

### 分发包构建入口（新增）

原有的 `mobile/build-offline.ps1` 委托给 `build-debug.ps1`，所以离线包一直是 debug 签名，无法分发。新增 `mobile/build-offline-release.ps1` 补上这条路径：设为离线模式 → 同步网页资源 → `assembleRelease` → 输出到 `releases/` 并打印 SHA-256。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mobile\build-offline-release.ps1
```

### 发一个新版本（一条命令）

`mobile/release.ps1` 把「改版本号 → 打包 → 换站点文件 → 改页面 → 部署」串成一步：

```powershell
cd G:\project\jizhangben-publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\mobile\release.ps1 -VersionName 2.10
```

它做五件事：

1. `versionCode` 自动 +1（2.09/110 → 2.10/111），`versionName` 改成你传入的值
2. 调用 `build-offline-release.ps1` 出一个新的签名离线包
3. 清掉 `site/download/` 里的旧 APK，放入新的 `jizhangben-v2.10.apk`
4. 改 `site/index.html` 的下载路径、下载文件名、版本号标签、体积标签
5. `wrangler pages deploy` 推到 Cloudflare Pages

不想立刻上线就加 `-SkipDeploy`，只到第 4 步。

**两个硬约束（脚本会拦住，但要知道为什么）：**

- 版本号必须**严格大于**当前值。Android 只认递增的 `versionCode`，同号或降级会直接拒绝安装，用户在手机上看到的只是「应用未安装」，没有任何解释
- 签名证书不能再换。换了就等于让所有已装用户必须卸载重装、丢数据。`android/keystore/jizhangben-release.jks` 必须长期保存

**已装用户怎么升级：** 打开同一个网址，重新下载，直接安装覆盖。因为包名、签名、递增的版本号三者都对得上，Android 允许原地升级，**localStorage 里的账目不会丢**。不需要卸载，也不需要导出导入。

这一点跟第一次换包（debug → 正式签名）完全不同：那一次签名变了，所以必须卸载重装；从那以后不会再有这种痛。

首个产物（在 `G:/project/jizhangben-publish` 构建）：

| 项目 | 值 |
| --- | --- |
| 文件 | `releases/jizhangben-offline-v2.09-release.apk` |
| 版本 | versionName 2.09 / versionCode 110 |
| 大小 | 3,374,478 字节（3.22 MB） |
| SHA-256 | `7F18B3556BA86D20690F507615359A8ECB56D9AA9C41AFDC6F5694002DBFA978` |
| 离线校验 | 包内 `runtime-config.js` 为 `OFFLINE_MODE = true`、`API_BASE_URL = null` |
| 签名校验 | `CN=Fan Yang, O=Independent Developer`，RSA 4096，v2 方案通过 |
| 源码校验 | 包内 `js/app.js` 与工作区文件哈希一致 |

注：脚本用 `npx cap copy android` 而不是 `npx cap sync`。`cap sync` 的插件更新步骤会先删除整个 `capacitor-cordova-android-plugins` 目录再重建，触发工作区的批量删除保护；`cap copy` 只刷新网页资源，插件集未变时完全够用。**新增或升级 Capacitor 插件后，仍需手动跑一次 `npx cap sync android`。**

### 迁移警告（换包前必读）

旧包是 Android Debug 证书，新包是上述证书。**签名不同，Android 会拒绝覆盖安装**，提示"应用未安装"或"签名不一致"。用户只能卸载重装，而卸载会清空 localStorage 里的全部账目。

现有用户（你、姐姐、母亲、同学）升级前必须按顺序：

1. 在 App 内导出完整备份（确认文件真的生成、体积正常）
2. 卸载旧版
3. 安装新版
4. 导入备份，逐项核对账目数量与总额

**如果导出功能不完整，先不要给任何人换包。** 宁可继续用 debug 包，也不要让家人的账目丢失。

### 3. 原始生成命令（如需重做，勿覆盖现有证书）

在 `G:/project/jizhangben-publish` 下用项目自带的 JDK 21 执行（不要用系统里的 JDK 8）：

```powershell
cd G:\project\jizhangben-publish\android
$jdk = (Get-ChildItem G:\project\android-tools\jdk21 -Directory | Select-Object -First 1).FullName
& "$jdk\bin\keytool.exe" -genkeypair -v `
  -keystore jizhangben-release.jks `
  -alias jizhangben `
  -keyalg RSA -keysize 4096 -validity 10000 `
  -storetype PKCS12
```

按提示输入：
- 密码：自定义，**至少 12 位，记在两处**
- 姓名/组织/城市：可填真实信息，会显示在证书里
- 确认：输入 `y`

### 2. 保管（最重要的一步）

**keystore 丢失 = 该应用永久无法更新，只能下架重发新包名。** 这不是夸张，是 Android 的机制。

需要做三件事：
1. `jizhangben-release.jks` 备份到至少两个不同物理位置（网盘 + U 盘）
2. 密码单独记录，不要只存在这台电脑
3. 把 `.jks` 和 `keystore.properties` 加入 `.gitignore`，**绝不能提交到 GitHub**

### 3. 配置 Gradle 签名

在 `android/keystore.properties` 新建（同样不进版本库）：

```properties
storeFile=../jizhangben-release.jks
storePassword=你的密码
keyAlias=jizhangben
keyPassword=你的密码
```

在 `android/app/build.gradle` 的 `android {` 之前插入：

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

在 `android {}` 内、`buildTypes` 之前插入：

```gradle
signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
}
```

在 `buildTypes.release` 内加一行：

```gradle
signingConfig signingConfigs.release
```

### 4. 验证签名

```powershell
& "$jdk\bin\keytool.exe" -printcert -jarfile android\app\build\outputs\apk\release\app-release.apk
```

应显示你的姓名与 RSA 4096，而不是 `CN=Android Debug`。

## 三、第一步：上架前必须决定的两件事（不可逆）

### 包名

`com.jizhangben.app` 一旦上架**永久不能修改**。上架前做两件事：
1. 在目标商店搜索该包名是否已被占用
2. 优先改成带个人标识的域名反写，如 `com.yangfan.ledger` 或 `cn.yangfan.jizhang`

改包名需同步修改：
- `capacitor.config.json` 的 `appId`
- `android/app/build.gradle` 的 `applicationId`
- `android/app/src/main/AndroidManifest.xml` 的 package 属性
- 改完后 `npx cap sync android`

**如果只是自用/小范围分发，可以不改；一旦要上架，务必先定。**

### 明文流量

`capacitor.config.json` 当前：

```json
"server": { "androidScheme": "http", "cleartext": true }
```

上架版应改为：

```json
"server": { "androidScheme": "https" }
```

注意影响范围（**不要直接改，会丢数据**）：

- Capacitor 的 `androidScheme` 决定 WebView 的 origin。`http` 时是 `http://localhost`，改为 `https` 后变成 `https://localhost`
- **localStorage 按 origin 隔离**。改 scheme 后，旧数据仍在 `http://localhost` 名下，但页面读的是 `https://localhost`，用户会看到"账目全没了"
- 数据实际没被删，但界面上不可见，等同于丢失（除非做迁移）

因此改 scheme 必须配套做一次迁移：新版首次启动时，检测旧 origin 数据是否存在，读出后写入新 origin，并保留旧数据作为回退。这需要一个 Android 原生层或 WebView 层的桥接代码，不是改一行配置能完成的。

**结论：分发阶段保持 `http` + `cleartext` 不动。** 它只影响商店的安全检测评分，不影响安装和使用。等到真要上架、且迁移代码写好并验证过之后，再改。

`docs/DEPLOYMENT.md` 已注明"正式 App 应改为可从手机访问的 HTTPS 地址"。所以在线版上架的前提是：后端部署到公网 + 域名 + HTTPS 证书（Caddy/Nginx + Let's Encrypt），同时完成上面的 origin 迁移。

## 四、第二步：渠道对比与选择

| 渠道 | 门槛 | 费用 | 周期 | 适合 |
| --- | --- | --- | --- | --- |
| 直接分发 APK | 正式签名即可 | 0 | 半天 | 家人朋友、作品集证明 |
| PWA 网页版 | 域名 + HTTPS | 0–50 元/年 | 1 天 | 最容易被外人访问 |
| 国内安卓商店 | 软著 + APP 备案 + 隐私政策 | 300–1000 元 | 1–3 个月 | 想要"上架应用商店"的完整履历 |
| Google Play | $25 + 网络环境 + 14 天封闭测试 | $25 一次性 | 1–2 个月 | 面向海外用户 |
| iOS App Store | $99/年 + macOS 构建环境 | $99/年 | 1–3 周审核 | 已有 iOS 测试版，但成本最高 |

### 国内安卓商店（华为/小米/OPPO/vivo/应用宝）

必需材料：
1. **软件著作权证书**：中国版权保护中心申请。个人申请免费，正常 30–60 工作日；加急 300–800 元，3–15 工作日
2. **APP 备案**：2023 年 9 月起强制。在省级通信管理局 ICP 备案系统提交，需已备案域名
3. **隐私政策**：可公网访问的独立页面，必须写明收集哪些数据、如何存储、如何删除
4. **实名认证**：个人身份证 + 人脸核验
5. **应用截图**：通常 3–5 张，各商店尺寸不同
6. **应用图标**：512×512 起
7. 部分商店对"记账/金融"类目可能要求额外资质说明，需在提交时如实描述为"个人记账工具，不涉及支付与理财"

### Google Play

- 开发者账号 $25 一次性（需支持境外支付的信用卡）
- **个人新账号政策**：必须先完成封闭测试，至少 20 名测试者连续参与 14 天，才能申请生产发布权限
- 提交格式为 AAB（`./gradlew bundleRelease`），不是 APK
- 需填写数据安全表单、内容分级问卷
- 需要能稳定访问 Google 服务的网络环境

### PWA（推荐先做）

项目已有 `jizhangben-pwa-test-site`。部署到 Vercel / Cloudflare Pages 即可获得 HTTPS 域名，用户在手机浏览器打开后"添加到主屏幕"，体验接近原生。

优点：零审核、零成本、当天上线、随时更新。
缺点：不能上架商店，iOS 上功能受限（通知、后台）。

## 五、落地页与在线分发（2026-11-17 完成，11-20 改造）

| 项目 | 值 |
| --- | --- |
| 页面目录 | `site/`（独立目录，不混在 `docs/` 里） |
| 页面文件 | `site/index.html`（约 16 KB，单文件，无 JS 依赖） |
| 图片 | `site/assets/s1-entry.jpg` … `s5-deposit.jpg`（共 5 张，合计 468 KB） |
| 安装包 | `site/download/jizhangben-v2.09.apk`（3.22 MB，与 `releases/` 同名文件哈希一致） |
| 视觉 | 延续宣传素材的米白 + 墨绿，与小红书图同一套语言 |

页面包含：首屏标题与下载按钮、五张手机截图、四项功能、做它的原因、安装三步、边界说明、页脚。

### 截图裁剪坐标（换图必读）

5 张原图都是 1080×1440 的小红书海报，手机四周有大片装饰留白，直接用会糊成一团。页面用 SVG `viewBox` 精确框住手机外框：

| 图 | 版式 | viewBox | 标签 |
| --- | --- | --- | --- |
| `s1-entry.jpg` | 单机 | `286 296 508 1096` | 记一笔 |
| `s2-report.jpg` | 单机 | `286 296 508 1096` | 报表 |
| `s3-accounts.jpg` | 双机（取左） | `68 336 434 936` | 多账户 |
| `s4-budget.jpg` | 双机（取右） | `578 336 434 936` | 预算 |
| `s5-deposit.jpg` | 双机（取左） | `68 336 434 936` | 押金记账 |

单机框 508×1096、双机框 434×936，宽高比同为 0.4635，所以 `.shot-img` 用 `aspect-ratio: 508 / 1096` 就能让五张卡片高度一致。

**换新图时必须重新测这组坐标**，不要沿用。测法是让浏览器读像素：扫描 y=800 这一行的深色段得到左右边框，再逐行统计深色像素占比（≥55% 宽度）得到上下边框。双机图会扫出 4 段深色（两台手机各两条边框），中间那段宽 5px 左右的杂点要按宽度过滤掉。

**双机图不要整张放**：两台手机缩到 246px 卡片里各只有 100px 宽，什么都看不清。只取其中一台——选规则是「哪台的界面信息更满」。`s5-deposit.jpg` 右机是空的基金页（显示"还没有基金账户"），所以取左机的押金表单。

### 卡片布局

- 全尺寸一律横排滑动，卡片固定 224px，`scroll-snap` 吸附
- 窄屏（<760px）隐藏滚动条；宽屏（≥760px）显示一条 5px 细滚动条，作为"还能往右滑"的提示
- 5 张卡片在 816px 内容区里始终超宽，所以第一张必须贴左、右侧自然截断。224px 是按"桌面露出第 4 张约 40%"定的，再宽就只剩一条边，像渲染错误

**不要用 `justify-content: center` 配超宽横滑**——内容溢出时左侧会被挤出视口且滚不到，表现为"第一张卡片神秘消失"。曾试过宽屏改 `flex-wrap: wrap` 排成 3 + 2 两行，视觉上把截图区撑得太长，已改回横滑。

### 配色与对比度（Impeccable 检测后调整）

用 `npx impeccable detect site/index.html` 扫描，原有 3 处 WCAG AA 不达标，已修：

| 变量 | 原值 | 现值 | paper 上对比度 |
| --- | --- | --- | --- |
| `--muted` | `#7b8a80` | `#5f6e65` | 3.33 → **4.93** |
| `--accent` | `#c8763f` | `#a85a2a` | 3.15 → **4.63** |

`--muted` 用于所有辅助文字（版本号、截图标签、区块说明），12.5px 小字达不到 4.5 会明显吃力，属于真问题。`--accent` 只用在首屏大标题的"钱去了哪里"，50px 大字按 WCAG 只需 3:1，原值其实达标，但 3.15 余量太小，加深后色相不变、观感更沉稳。

**`--paper: #f7f5ee` 保留。** Impeccable 会报 `cream-palette`（"AI 默认的暖白背景"），但这里的米白与 App 的 canvas `#F7F5F1`、小红书宣传图底色同源，是品牌延续而非反射性选择。CSS 内已注释说明，不要当成品味问题改掉。

其余 23 条 advisory 均为「落地页配色不在根目录 `DESIGN.md` 的调色板里」。那份 DESIGN.md 记录的是 App 本身（主色 `#24484F` 等），与落地页是两套视觉，属预期内，不处理。

### 为什么拆出 `site/`

原来页面放在 `docs/`，但 `docs/` 里还有 `INTERVIEW_NOTES.md`、`LEARNING_LOG.md` 这类私人笔记。把整个 `docs/` 目录发给静态托管，等于把笔记一起公开。所以页面单独放 `site/`，只发布这一个目录。

### 下载按钮不依赖 GitHub

按钮指向相对路径 `download/jizhangben-v2.09.apk`，安装包直接放在 `site/download/` 里。好处是页面部署到任何静态主机都能直接下载，不必等 GitHub Release 上传；坏处是仓库会多出 3.2 MB 的二进制文件。

换版本时改两处：替换 `site/download/` 下的 APK、改 `index.html` 里按钮的 `href` 和 `download` 文件名，以及顶部的版本号文字。

### 发布路径

**当前线上地址（Cloudflare Pages，推荐用于对外分享）：**

```
https://jizhangben-download.pages.dev/
```

- Pages 项目：`jizhangben-download`（2026-11-20 新建，与原 PWA 测试站 `jizhangben-iphone-test-2026` 分开，避免互相覆盖）
- 无 sharecode、无参数，链接短，被平台截断也能打开
- 本机已完成 `wrangler login`，以后更新只需一条命令：

```powershell
cd G:\project\jizhangben-publish
npx wrangler pages deploy site --project-name=jizhangben-download --branch=main --commit-dirty=true
```

**备选地址（WorkBuddy 内置托管）：** `https://jizhangben-download.app.workbuddy.host/?sharecode=2YKT62QWO5`

不方便对外分享：必须带 `?sharecode=`，参数被截断时访客看到的是「链接不完整」。适合自己手机测试。

**GitHub Pages：** 仓库 Settings → Pages 只能选 `/` 或 `/docs`，而页面已移出 `docs/`，入口会变成 `.../jizhangben/site/`，路径不干净，且 URL 含个人用户名，不采用。

### 注意事项

- **GitHub 上的 `releases/latest` 仍指向 v2.01 的 debug 包。** 只要页面用相对路径下载，这条就不影响访客；但如果哪天把按钮改回 GitHub 直链，务必先上传签名包
- 截图裁剪坐标见上方「截图裁剪坐标」表。五张图分单机、双机两种版式，坐标不通用；换图必须重测
- 微信内置浏览器会拦截 APK 下载，页面已提示"用浏览器打开"，这是国内分发的常态，不是 bug

## 六、推荐顺序

1. ~~**今天**：完成正式签名~~ ✅ **已完成 2026-11-17**。证书已生成，Gradle 已配置，构建验证通过。剩下的动作在用户侧：备份证书、按迁移警告换包。
2. **本周**：把 PWA 部署上线，拿到一个真实 HTTPS 地址。这是最容易被外人看到、也最像"产品"的形态。
3. ~~**本周**：做一个能给人看的落地页~~ ✅ **页面已完成 2026-11-17**（见第五节）。剩下的是上传签名包、改直链、开 Pages 三个动作，约 20 分钟。
4. **本月**：去中国版权保护中心提交软著申请（免费档即可，1–2 个月后拿到）。软著是所有国内商店的通用门票，越早办越好，且不占用精力。
4. **软著下来后**：办 APP 备案，然后上华为/小米。这一步是"完整上架履历"，对求职有加分，但不影响他现在找实习。
5. **暂缓**：Google Play（14 天 20 人测试的门槛对个人账号很高）与 iOS（$99/年 + 需要 Mac 环境），等有明确海外需求再考虑。

## 七、常见坑

- ~~用 debug 证书打包当正式版发~~：已于 2026-11-17 修复。但要注意 **v1.42 至 v2.01 的 GitHub 历史 release 仍是 debug 签名**，无法覆盖升级到新签名包
- **换签名后无法覆盖安装**：Android 拒绝签名不一致的升级。用户必须先导出备份 → 卸载 → 重装 → 导入。卸载会清空 localStorage
- **keystore 丢失**：应用永久无法更新。备份到两个物理位置
- **keystore 提交到 Git**：等于把应用控制权公开。已在 `android/.gitignore` 加规则，提交前用 `git status` 复核一次
- **改了包名没改 AndroidManifest**：构建报错或装出两个应用
- **改 `androidScheme` 导致数据"消失"**：origin 从 `http://localhost` 变为 `https://localhost`，localStorage 读不到旧数据。必须写迁移代码，不能只改配置
- **构建产物 API 地址指向 localhost**：`npm run app:sync` 默认生成 `http://localhost:8000/api`。给他人分发的包必须改用离线构建（`app:build:offline`）或公网 HTTPS 地址，否则对方装上连不上后端
- **版本号不一致**：GitHub release 标 `v2.01`，但 `android/app/build.gradle` 里是 `versionName "1.61"`。分发前统一版本号，否则用户无法判断装的是哪一版
- **国内商店要求"金融类资质"**：如实填写为工具类，不要写"理财""投资"字样，否则可能被要求金融牌照
- **隐私政策写成模板**：审核会打回。必须写明具体收集项（记账本若纯本地存储，应明确写"数据仅存于本机，不上传服务器"）

## 七、变更记录

| 日期 | 内容 |
| --- | --- |
| 2026-11-17 | 建立本文件：诊断当前 Debug 签名阻断上架，给出签名流程、包名与明文流量整改项、五渠道对比与推荐顺序 |

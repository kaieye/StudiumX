# StudiumX Landing Page

独立、纯静态的 StudiumX 营销落地页。**与本仓库内的应用代码零代码共享**
（见 `docs/web-app-plan.md` §2.3 与 §8 Phase 7）：本目录是一个普通 HTML 文件，
没有构建步骤、不使用任何前端框架、不引用任何应用源码（既不引用桌面端渲染层，
也不引用 Web 端源码），真正做到与 App 零耦合。

## 目录内容

```
landing/
├── index.html   # 独立静态营销页（plain HTML + inline CSS + 一段配置 <script>）
└── README.md    # 本文件
```

## 本地预览

无需任何构建，用任意静态服务器即可。例如：

```bash
cd landing
python3 -m http.server 8080
# 然后浏览器打开 http://localhost:8080
```

（用 `npx serve` 或 `php -S localhost:8080` 等任意静态服务器亦可。）

## Web 登录 URL 配置机制

落地页上的「登录 / 进入网页版」按钮会跳转到 **StudiumX Web 端的登录页**（`/login`，
微信 `snsapi_login` 扫码登录）。目标 URL 通过 `index.html` 顶部 `<script>` 中的常量配置：

```js
const WEB_LOGIN_URL = window.LANDING_CONFIG?.webLoginUrl || 'http://localhost:5174/login';
```

- **默认值** `http://localhost:5174/login`：指向本地 Vite 开发服务器（Web 端 dev server，
  默认端口 5174）。开发与联调时直接可用。
- **生产覆盖**：部署落地页时，在 `index.html` 的 `<script>` 之前注入一个全局配置即可，
  例如：

  ```html
  <script>window.LANDING_CONFIG = { webLoginUrl: 'https://app.studiumx.example/login' };</script>
  ```

  这样无需改动落地页源码即可把登录按钮指向线上 Web 地址。

按钮在页面加载时由 `document.getElementById('enterWebBtn').href = WEB_LOGIN_URL;` 设置为该 URL，
因此无论默认值还是覆盖值都会生效。

## 完整用户流程

```
落地页 (landing/index.html)
   │  点击「登录 / 进入网页版」
   ▼
Web /login  (微信 snsapi_login 扫码登录)        ← WEB_LOGIN_URL 指向这里
   │  扫码 + 授权
   ▼
Web 仪表盘 (dashboard)                           ← 登录后进入应用
```

即：**landing 登录按钮 -> Web `/login` 微信扫码 -> Web dashboard**，完成落地页到 Web 应用的全链路联通。

## 关于独立仓库 / 独立部署

按 `docs/web-app-plan.md` §2.3，landing 与 App 零代码共享，是「独立仓库、独立部署」的产物。
本实现只在 StudiumX 仓库根目录下提供一个可运行的 `landing/` 静态页交付物；
将其拆分到独立仓库 / 独立域名部署属于**部署层面的关注点，不在本实现范围内**——
只需在部署时按上面「生产覆盖」的方式设置 `webLoginUrl` 即可。

# ADR-0135：MCP OAuth PKCE 与安全 Token 生命周期 — Phase C 实现合同

- **状态：** 已实施（ADR-0132 Phase C implementation addendum；仅本 phase 范围；不表示 auto-connect / marketplace 已交付）
- **日期：** 2026-07-22
- **范围：** 经用户显式发起的 HTTP/SSE MCP authorization-code + PKCE、main-owned callback/deep-link、access/refresh token 的 secure storage、刷新/撤销与 session cleanup。
- **相关：** ADR-0128、ADR-0132、ADR-0133、ADR-0134、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`。

## 1. 决定与非目标

OAuth 只属于 MCP 的**连接与授权层**；它不会授予工具调用层权限。得到 token 后，MCP tool 仍走 `ToolRegistry → Dispatcher → effect lattice → approval → ToolOutcome`，不改变 settlement sole-writer、`expectedRevision` 或 fork 的 `toolsReplayed:false`。

本 phase 初始交付仅涵盖 user-configured `http` / `sse` server 的 authorization-code + PKCE。`stdio` 永不进入 OAuth flow。没有默认 auto-authorize、后台 token discovery、remote telemetry、renderer token/URL/code/state exposure、通用 shell 或 arbitrary callback execution。OAuth metadata discovery、external browser open、token exchange/refresh 仅能由 main process 在明确 authorize/refresh 生命周期中执行。

## 2. 配置、发现与发起

server 的 OAuth public configuration 仅包含 non-secret endpoint / client identity / requested scope / resource binding 信息；严格 schema 限定 http(s)，拒绝 userinfo 和 token-like query 参数。password/client-secret grant 不支持。authorize action 只接收 server id（和已有 workspace scope），主进程验证 server enabled、transport eligible、URL safe 后才开始。

主进程生成高熵 `state`、PKCE verifier/challenge 和短 TTL pending record；pending record 不持久化、不进入 IPC/Doctor/log/support bundle。打开 authorization URL 是用户点击后的单次动作；renderer 只得到 secret-free lifecycle state，不得到 URL、verifier、state、auth code 或 token。

## 3. Callback、token 与刷新

callback 仅接受固定 `studiumx://mcp-oauth/callback`，必须精确匹配 pending `state`、未过期且一次性消费。来自 macOS `open-url`、Windows/Linux argv 的 deep link 都先由 main-only router 校验；无匹配 state、重复 callback、error callback 或错误 redirect 一律 fail closed。

exchange 以 pending PKCE verifier 执行；access/refresh token 仅保存到 main-owned encrypted store（Electron safeStorage 适配器）。public projection 只暴露 `authorization_required` / `authorizing` / `authorized` / `authorization_failed` 等 secret-free state。token 绝不写入 canonical MCP config、env/header public DTO、renderer/preload、Doctor、support bundle、trace、artifact、timeline 或 logs。

接入 MCP transport 时 token 只在 main-side内存中构造 `Authorization: Bearer` header。连接遇到可识别的 authorization failure 时，可在 main-side执行单次受控 refresh；refresh 成功则 drop/rebuild **该 server** session，失败则清除不可用 token、显示 authorization-required/failed，并不自动打开浏览器。用户 revoke 会删除 token、pending state、并 drop 该 server session 与动态 snapshot；不影响其他 server。

## 4. IPC 与 UI

只新增固定窄 IPC：`teach:mcp-authorize-server`、`teach:mcp-revoke-authorization`。它们的 request 只可含 validated `serverId` / optional already-approved workspace binding；response 永不返回 authorization URL、code、state、PKCE verifier、access token、refresh token、endpoint headers 或路径。Settings 仅呈现 secret-free status、Authorize / Reauthorize / Revoke 的明确用户按钮；没有自动授权。

## 5. 安全不变量

- 不把 authorization success 当作 server trust、plugin verification、workspace capability 或 tool approval。
- 不信任 callback query 中除 allowed `code/state/error/error_description` 外的任何字段；error description 不进入 public surface。
- 不把 OAuth token 放进 `headersSecretRefs` 或 renderer save model。
- 不让 secret-bearing refresh/network errors改变 ToolOutcome/settlement 语义；仅 session lifecycle 消费稳定 error code。
- token/PKCE/callback modules不导入 ledger、outcome committer、renderer FS 或 remote telemetry。

## 6. 验收

至少覆盖 PKCE entropy/challenge、pending TTL/one-time state、strict callback routing、encrypted token storage / no plaintext persistence、secret-free public states、unsupported stdio refusal、explicit user action、revoke/session drop、refresh failure cleanup、IPC schema rejection、Settings projection、以及对 effect/settlement isolation 的静态 guard。真实 provider credentials 不进入 PR CI。

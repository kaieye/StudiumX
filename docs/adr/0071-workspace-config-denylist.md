# ADR-0071：Workspace/project 配置 denylist（baseUrl 等敏感 endpoint）

- **状态：** 已实施（ADOPTION S-04）
- **日期：** 2026-07-21
- **范围：** 不可信 workspace overlay 不得覆盖敏感 provider endpoint 字段；字段级 provenance 诚实；诊断可观测
- **相关：** [ADR-0025](0025-teaching-config-resolver-secret-free-layers.md)、[ADR-0033](0033-config-optimistic-concurrency.md)、[ADOPTION S-04](0121-improvements-adoption-closeout.md)、Codex D2 denylist 意图（historical `codex` review (see ADR-0121)）
- **证据路径：**
  - `src/main/teaching-config-denylist.ts`
  - `src/main/teaching-config-resolver.ts`
  - `tests/unit/teaching-config-resolver.unit.test.ts`

## 背景

ADR-0025 已建立 `default < user < workspace < session_override` 分层与字段级 `TeachingConfigFieldSource`，并对 secret 路径做 strip。差距是 **project/workspace denylist**：workspace 层仍可写入 `provider.providers[].baseUrl`，从而让仓库内配置把模型请求重定向到任意 endpoint（对齐 Codex `PROJECT_LOCAL_CONFIG_DENYLIST` **意图**，非 Rust 移植）。

产品地板要求 secret-free 普通 snapshot、无默认 remote telemetry；endpoint 重定向属于「未信任工作区不得接管网络目标」的安全边界，与 apiKey 剥离互补而非替代。

## 决定

### 1. 显式 denylist 表

导出 `WORKSPACE_CONFIG_DENYLIST_PATHS`（`teaching-config-denylist.ts`）：

| 模式 | 含义 |
| --- | --- |
| `provider.providers.*.baseUrl` | 不可信 workspace 不得设置/覆盖各 provider 的 API base URL |

匹配实现为 `provider.providers.<index>.baseUrl`（数字 index）。后续扩展（如 telemetry/notify 类键）仅在 TeachingLoop overlay **实际存在对应字段**时追加；当前 TeachingLoop 投影无独立 OTEL/notify 面。

### 2. 分层策略

| 层 | denylist 是否生效 | 说明 |
| --- | --- | --- |
| `default` | 否 | 内置 preset 可带官方 baseUrl |
| `user` | 否 | 本机用户设置可配置 endpoint |
| `workspace` | **是** | 忽略 denylist 字段；发 `workspace_denylist` 诊断；解析 **非致命** |
| `session_override` | 否 | **信任进程内会话覆盖**（UI/host 注入，非仓库文件）；文档化选择，非 silent 例外 |

Secret 路径仍由 `isTeachingConfigSecretPath` / `secret_stripped` 处理；denylist **不削弱** secret 剥离。

### 3. 解析行为与 provenance

- parse workspace `provider.providers[]` 时：若出现 `baseUrl` 键 → severity `error`、code `workspace_denylist`、path 如 `provider.providers.0.baseUrl`，且不把该 baseUrl 写入 overlay。
- apply 时：workspace 替换 providers 列表时，对 **同 id** 条目保留下层（user/default）`baseUrl`；**不**把 baseUrl 的 field source 标为 `workspace`。
- 其它 workspace 可写字段（name / models / endpointFormat / tools 等）行为不变。
- resolve 保持纯函数、确定性；无 I/O。

### 4. 诊断码

新增 `TeachingConfigDiagnosticCode = 'workspace_denylist'`（severity 优先 `error`，不中止整次 resolve）。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/teaching-config-resolver.unit.test.ts
```

## 不变量

- workspace 不得使 resolved `provider.providers[*].baseUrl` 取自 workspace 输入。
- 被拒绝字段不得声称 `source: 'workspace'`。
- user/default 仍可设置 baseUrl。
- secret strip 与 fingerprint secret-free 不变量保持（ADR-0025 / ADR-0033）。

## 明确不包含 / non-claims

- **不是**完整 settings JSON Schema 导出（Codex D3 / 另项）。
- **不是** Managed 校/团 overlay 的完整产品注入面（S-11 pure layer 见 [ADR-0086](0086-managed-config-overlay-layer.md)）；denylist 仍仅 workspace；不引入 CAS 管理面。
- **不是** Codex loader 全量 denylist 移植（无 `openai_base_url` / `otel` / `notify` / profiles 字面量 Rust 表）。
- **不**在 workspace 存储 API keys；**不**引入 YOLO / shell / 默认 remote telemetry。
- **不**改 session_override 为 untrusted 文件层；若未来出现「会话文件覆盖」须另开 ADR 扩展 denylist 层集合。

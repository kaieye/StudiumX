# ADR-0142：MCP 产品面收窄（Settings 仅 list/editor；marketplace UI 不落地）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-23（修订 2026-08-18）
- **范围：** 明确 StudiumX **当前 shipping** 的 MCP **渲染层产品面**，以及与 ADR-0140 foundation / ADR-0141 体验授权之间的关系。原「marketplace Settings UI 永久不交付 / 永久禁止」措辞已收窄为「当前 shipping 范围外的设计 non-claim，开放路径与前置条件见 §6」。硬安全（secret/settlement/effect/approval/无 YOLO）不变。
- **取代：** 无
- **被取代：** 无
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0135、ADR-0137、ADR-0140、ADR-0141、`AGENTS.md`、`SECURITY.md`、`src/shared/features.ts`
- **证据：** §4 实现锚点（`src/renderer/src/views/settings/sections/UserMcpServer*.tsx`、`src/shared/mcp/marketplace-*`、`src/main/mcp/marketplace-store.ts`、`src/main/mcp/host.ts`）

## 1. 背景

ADR-0141 曾将「marketplace / install→connect / 远程 catalog / Settings 全量 parity」写为**产品体验允许项**，与主流 MCP 客户端对齐。实现上：

1. **Main / shared foundation 已落地**（catalog types、`McpMarketplaceStore`、host IPC、feature id `mcp-marketplace` 元数据等，ADR-0140 / 0132 分阶段）。
2. **Renderer Settings 曾短暂挂载** orphan `UserMcpMarketplaceSection` 方案讨论与接线尝试，但产品选择**不**在设置页交付市场花活。
3. 2026-07-23 产品方向：MCP 设置保持 **list + status + add/edit + 可选 import + OAuth authorize**；**删除**未使用的 marketplace Settings UI，避免「半成品入口 + 文档超前」双漂移。

本 ADR 冻结**当前真相**，避免 AGENTS / SECURITY / 0141 继续暗示「Settings 必有 marketplace」。

## 2. 决策（shipping 产品面）

| 层 | 当前决策 |
| --- | --- |
| **Settings → MCP** | **仅**用户 server 列表 / 编辑 / 测试 / 刷新 / 可选 import / OAuth 授权状态与操作。无 marketplace 子页、无安装市场网格、无 catalog URL 编辑作为产品主路径。 |
| **ADR-0140 store / IPC** | **保留** main/shared foundation（本地 catalog document、install pin、revoke、emergency disable、host methods）。**不**要求 renderer 挂载对应 UI。 |
| **ADR-0141 体验授权** | **收窄为：** 允许在 foundation 与 host 侧继续演进 auto-connect / multi-source / OAuth / import；**不**把 marketplace UI、远程 catalog 默认产品页、McpSync 客户端当作已 shipping 或必交付项。若未来要 Settings 市场，须新 ADR 或修订本条并实现 UI + 测试。 |
| **Feature registry** | `mcp-marketplace` 保持 **元数据**（`under_development` 或 `experimental` 均可，但 **summary 必须写清：无 Settings UI**）。**禁止**把 feature stage 当成授权绕过 effect/approval。 |
| **硬安全（不变）** | Secret/token 不进 public DTO / Doctor / bundle；OAuth token main-only；MCP 非 teaching evidence；settlement sole-writer；MCP tools 仍进 effect lattice + approval；禁止 YOLO 标签。 |

## 3. 与既有 ADR 的关系

| 文档 | 关系 |
| --- | --- |
| ADR-0140 | foundation **仍有效**；其中「UI Settings 完整 marketplace 可后续 phase」保持；**当前 phase = 无 Settings UI**。 |
| ADR-0141 | **产品体验 parity 不再作为「已 shipping 的市场/全量 Settings」承诺**；硬安全段仍有效；auto-connect **host API** 仍可存在，Settings 是否暴露根开关以代码为准（当前 Zcode-like 路径可强制/迁移 enable，见实现，**非**本 ADR 强制 UI）。 |
| ADR-0137 | multi-source + `autoConnectNow` **实现契约**仍有效；默认 `autoConnect: false` 等字段语义仍以 0137 + config schema 为准。 |
| ADR-0127 / 0128 | v1 list/editor / secret-free public / effect 路径 **仍是 Settings 真相**。 |
| 更早「禁止 marketplace」条文 | 已被 0132/0140/0141 体系取代为 **staged foundation**；本 ADR 再明确：**foundation ≠ Settings 产品页**。 |

## 4. 实现锚点（2026-07-23）

```text
# Settings 产品面（有）
src/renderer/src/views/settings/sections/UserMcpSettingsSection.tsx
src/renderer/src/views/settings/sections/UserMcpServerList.tsx
src/renderer/src/views/settings/sections/UserMcpServerEditor.tsx
src/renderer/src/views/settings/sections/user-mcp-settings-model.ts

# Marketplace UI（无 — 已移除）
# （曾存在 UserMcpMarketplaceSection.tsx；勿再假定 Settings 挂载）

# Foundation（有）
src/shared/mcp/marketplace-types.ts
src/shared/mcp/marketplace-catalog.ts
src/main/mcp/marketplace-store.ts
src/main/mcp/host.ts  (marketplace* methods)
```

## 5. 非目标

- 本 ADR **不**删除 main marketplace store / IPC（避免无替代的半截拆除）。
- **不**引入默认远程 phone-home catalog。
- **不**改变 secret / settlement / effect 红线。

## 6. Settings marketplace UI：从「永久禁止」改为「设计 non-claim + 开放路径」（2026-08-18 修订）

> **修订动机：** `docs/redline-audit.md` §3 #5/#6 与 `docs/redline-checklist.md` B0142 指出，原文「marketplace 无 Settings UI / 当前不交付」在实务中被读为「永久禁止 / 不可立项」，与 ADR-0141 已放宽的 marketplace / 远程 catalog 体验政策自相矛盾，成为「工作被文档拦住」的主要来源。本修订**不**授权立即上线 Settings 市场，也**不**改变任何硬安全不变量；仅把「永久禁止」收窄为「设计 non-claim + 明确开放路径」，使产品体验优化可在满足前置条件时立项。

| 维度 | 修订后语义 |
| --- | --- |
| 性质 | **设计 non-claim（当前不交付）**，非永久禁止 |
| 开放路径 | 修订本 ADR §6 并新增/更新实现切片 ADR + 交付 Settings marketplace UI + 测试即可开放 |
| 前置条件（须同时满足） | (a) 用户可禁用/撤销/紧急关闭 marketplace（与 ADR-0141 §2.2 一致）；(b) 远程 catalog URL 为用户/官方可配置源，非默认 phone-home telemetry；(c) 信任/撤销/紧急禁用 lifecycle 保留（ADR-0139/0140）；(d) 签名/哈希为 fail-soft 推荐，高风险可执行下载须明确提示；(e) install→connect 仍受 effect lattice + approval，无 YOLO |
| 仍禁止（硬安全不变量） | secret/token 进 public DTO/Doctor/bundle；MCP 作 settlement authority；YOLO/always-approve；默认 phone-home telemetry |

**对文档的即时同步：** `AGENTS.md` §3 红线 3「不要再挂 marketplace 设置页」与 `SECURITY.md`「Settings marketplace UI out of shipping surface」应读为「**当前不交付**（设计 non-claim）」而非「永久禁止」；当 Settings marketplace 实现切片经独立 ADR 落地时，须同步更新本节与上述文档。

## 7. 一句话

**MCP 产品设置页 = 用户可配置 server 列表与编辑；marketplace foundation 可保留；Settings 市场 UI 当前不交付（设计 non-claim，非永久禁止），满足前置条件后可经独立 ADR 开放；硬安全不变量保持不变。**

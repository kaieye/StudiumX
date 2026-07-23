# ADR-0142：MCP 产品面收窄（Settings 仅 list/editor；marketplace UI 不落地）

- **状态：** 已采纳（产品面事实记录；**收窄** ADR-0141 中 marketplace / Settings 全量 parity 的 shipping 期望，不推翻 A–H foundation 与硬安全）
- **日期：** 2026-07-23
- **范围：** 明确 StudiumX **当前 shipping** 的 MCP **渲染层产品面**，以及与 ADR-0140 foundation / ADR-0141 体验授权之间的关系。
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0135、ADR-0137、ADR-0140、ADR-0141、`AGENTS.md`、`SECURITY.md`、`src/shared/features.ts`

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

## 6. 一句话

**MCP 产品设置页 = 用户可配置 server 列表与编辑；marketplace 仅 main/shared foundation，Settings 不挂市场 UI。**

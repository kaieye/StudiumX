# ADR-0140：MCP Marketplace 本地目录 foundation（Phase H）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施 foundation；**产品开放面由 [ADR-0141](0141-mcp-product-experience-parity-policy.md) 扩展**（允许远程 catalog、install→connect、marketplace UI；本文件仍描述本地 store 数据面）
- **日期：** 2026-07-23
- **范围：** 本地 marketplace catalog 与 install/revoke/emergency-disable 数据面；feature registry 登记 `mcp-marketplace`（`under_development`）；纯函数校验 / pin / preview；userData 持久化。
- **取代：** 无
- **被取代：** 部分被 [ADR-0141](0141-mcp-product-experience-parity-policy.md)/[ADR-0142](0142-mcp-product-surface-settings-only.md)（产品开放面 / Settings 产品面）
- **相关：** ADR-0127、ADR-0128、ADR-0132 §2.6 / Phase H、ADR-0133–0136、ADR-0073、`SECURITY.md`、`src/shared/features.ts`。
- **证据：** `src/shared/mcp/marketplace-types.ts`、`src/shared/mcp/marketplace-catalog.ts`、`src/main/mcp/marketplace-store.ts`、`src/shared/features.ts`（`mcp-marketplace` 登记）；测试 `tests/unit/mcp-marketplace.unit.test.ts`、`tests/unit/features.unit.test.ts`。
- **产品面（2026-07-23）：** Settings **不**挂载 marketplace UI；见 [ADR-0142](0142-mcp-product-surface-settings-only.md)。本 ADR 仍描述 **main/shared foundation** 契约。

## 1. 决定与非目标

Phase H foundation 只落地**本地** marketplace 数据合同：

1. 用户（或测试）注入的 **local catalog** 条目（publisher、version、hash/signature 字段、permissions preview）；
2. **install pin** 记录（版本固定、不自动升级）；
3. **revoke list** 与 **emergency disable all**；
4. Feature registry 允许 `mcp-marketplace` 作为元数据 stage（`under_development`），**不是** effect / approval / settlement 旁路。

本 phase **明确不交付**：

1. ~~禁止远程 marketplace~~ → ADR-0141 **允许**用户/官方配置的远程 catalog（可关）；phone-home **产品 telemetry** 仍默认关；
2. ~~禁止安装后 auto-connect~~ → ADR-0141 **允许** install→connect；
3. 安装即授予 tool approval / effect 降级 / workspace-root；
4. 签名验证实现细节之外的远程 trust root 分发；
5. UI Settings 完整 marketplace 浏览（可后续；本 phase 以 store + pure helpers 为主）；
6. Plugin manifest 执行、jiti/code-mode、任意下载执行。

可选 `fetchCatalog?: () => Promise<...>` 仅作为**注入缝**，默认**永不调用**。

## 2. Trust 分层（与 ADR-0132 对齐）

| 层 | 含义 | 本 phase |
| --- | --- | --- |
| Discover / catalog entry | 本地条目可见 | 是 |
| Install pin | 记录已安装版本 + 期望 hash | 是（不写 server config 强制连接） |
| Trust grant record | 用户对“允许使用该条目作为配置来源”的本地记录 | 类型 + store 字段；**不**等于 tool approval |
| Connect | 建立 transport session | **允许** install 流程可选自动连接（ADR-0141）；亦可稍后手动连接 |
| Tool approval | effect lattice + interactive gate | **否** |

分层状态仍可观测：install / connect / approve。**体验上**允许 install 合并 connect（ADR-0141）；**approve（tools/call）** 仍不因 install 自动授予。

## 3. 数据形状（shared）

见 `src/shared/mcp/marketplace-types.ts`：

- `McpMarketplaceCatalogEntryV1`：`entryId`、`publisher`、`displayName`、`version`、`packageHash`（sha256 等）、可选 `signature`、`permissionsPreview`（effect/network/fs 摘要，无 secret）、`transportHint`、`sourceKind: 'local'`
- `McpMarketplaceInstallRecordV1`：`entryId`、`pinnedVersion`、`pinnedHash`、`installedAt`、`trustGrant`（optional 时间戳/actor 标签，无 secret）
- `McpMarketplaceRevokeRecordV1`：`entryId` 或 `packageHash`、`revokedAt`、`reasonCode`
- Durable document `McpMarketplaceStoreDocumentV1`：`schemaVersion: 1`、`catalog[]`、`installs[]`、`revocations[]`、`emergencyDisabled: boolean`

## 4. Pure helpers

`src/shared/mcp/marketplace-catalog.ts`：

- `validateMarketplaceCatalogEntry` — fail-closed 字段与 id 规则
- `pinMarketplaceVersion` — 从 entry 生成 install pin 草稿
- `isMarketplaceEntryRevoked` — 对照 revoke list
- `buildMarketplaceInstallPreview` — 无 secret 的 effect/network/fs 摘要字符串结构

## 5. Main store

`src/main/mcp/marketplace-store.ts`：

- 路径：`userData/mcp/marketplace.v1.json`（+ `.bak` via durable replace）
- 方法：`listCatalog`、`getEntry`、`recordInstall`、`uninstall`、`revoke`、`isRevoked`、`emergencyDisableAll`
- `recordInstall` **不**调用 session manager、**不**写 OAuth token、**不**改 `UserMcpConfigV1` root enabled
- Cleanup hook 接口：`McpMarketplaceCleanupHooks`（`onUninstall` / `onRevoke` / `onEmergencyDisable`）供 session/token 所有者后续接线；本 phase 默认可空实现

## 6. Feature registry

- 从 `FORBIDDEN_FEATURE_IDS` **移除** `mcp_marketplace`（snake 旧禁令 id）
- 新增 `FEATURES` 条目：`id: 'mcp-marketplace'`，`stage: 'under_development'`
- summary 明确：install / trust / connect / tool approval 分离；无默认远程 catalog
- `DANGEROUS_FEATURE_FLAG_KEYS` 与 yolo / always_approve 等**保持** forbidden

## 7. 失败与隐私

- 非法 catalog / hash 不匹配 → fail-closed，不写 install
- revoke / emergency disable → 新 install 拒绝；既有 install 标记不可用
- 无网络 I/O；无默认 telemetry
- store JSON 不得含 OAuth token、env secret、authorization header

## 8. 测试

- `tests/unit/mcp-marketplace.unit.test.ts`：validate、pin、revoke、preview、store round-trip、install 不连 session、emergency disable
- `tests/unit/features.unit.test.ts`：允许 `mcp-marketplace` 注册；仍拒绝 shell/yolo 等

## 9. 明确不包含

远程 catalog CDN、签名根轮换 UI、auto-update、plugin 代码执行、marketplace 作为 ToolOutcome / Evidence 来源。

# ADR-0073：教学 FeatureRegistry（薄元数据 + stage 生命周期）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-05）
- **日期：** 2026-07-21
- **范围：** 纯共享 `src/shared/features.ts` 教学产品功能元数据表与 stage 门控；**不是**第二套授权/能力系统
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md)、[ADR-0046](0046-teaching-footprint-ladder.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADR-0055](0055-busy-input-queue-and-replay-contracts.md)、[ADOPTION S-05](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/features.ts`
  - `tests/unit/features.unit.test.ts`

## 背景

产品需要一份**可枚举、可 doctor、可 JSON 友好**的教学功能清单与生命周期（UnderDevelopment → Experimental → Stable → Deprecated → Removed），以便文档、诊断与保守的 product-on 判断。  
Codex 侧有 FeatureRegistry / Stage 意图；StudiumX 必须把它收成**教学薄层**，且不得借机引入 shell / code_mode / MCP marketplace / YOLO / effect bypass。

已有 [ADR-0022] CapabilityCatalog 是 **readiness 投影**；[ADR-0046] Footprint Ladder 是 **能力扩张顺序**。二者都不适合充当「产品 feature id + stage 元数据」表。

## 决定

### 1. 薄纯函数 registry

`src/shared/features.ts`（冻结路径）导出：

| 符号 | 作用 |
| --- | --- |
| `FeatureStage` | `under_development` \| `experimental` \| `stable` \| `deprecated` \| `removed`（snake_case） |
| `FeatureDefinition` | `id` / `stage` / `title` / optional `summary` / `since` / `replacedBy` / `footprintHint` |
| `FEATURES` | 静态小表（约 6–12 条真实教学产品面功能） |
| `listFeatures` / `getFeature` / `featureCount` | 只读查询 |
| `isStageEnabled` / `isFeatureEnabled` | 纯 stage 门控 |
| `assertNoBypassKeys` | 拒绝危险 flag 键（`yolo`、`shell`、`code_mode`、`tools_replayed`、`bypass_settlement` 等） |
| `FORBIDDEN_FEATURE_IDS` | 表内禁止注册的 id 集合（测试守卫） |

### 2. 默认 enablement

| Stage | 默认产品 on？ | 说明 |
| --- | --- | --- |
| `stable` | **是** | 已诚实标为稳定的产品路径 |
| `experimental` | 否 | 仅 `allowExperimental: true` |
| `under_development` | 否 | 仅 `allowUnderDevelopment: true`；永不默认 product-on |
| `deprecated` / `removed` | **否** | 任意 opts 仍 false |
| 未知 id | 否 | fail-closed |

`isFeatureEnabled` **不**授予工具、写策略、网络或 settlement 权限；只回答「该 metadata id 在当前 stage 策略下是否视为启用」。

### 3. 与 Catalog / Ladder 的边界

| 系统 | 职责 | 本 ADR |
| --- | --- | --- |
| FeatureRegistry（本文件） | 产品功能元数据 + stage | **本切片** |
| TeachingCapabilityCatalog（ADR-0022） | 只读 readiness 投影 | **不替换** |
| Footprint Ladder（ADR-0046） | 能力扩张顺序 1→5 | `footprintHint` 仅文档提示，**不强制** |
| TOOL_CONTRACT / effect / settlement | 执行与写入权威 | **仍唯一权威** |

### 4. 种子功能（诚实 stage）

稳定路径示例：`consent-gated-learner-memory`、`temporary-chat`、`teaching-capability-catalog`、`support-bundle-redacted-export`、`local-observability-crash-marker`、`workspace-config-denylist`、`agent-session-facade`、`lexical-memory-search`。  
实验：`post-turn-review-candidates`。开发中：`headless-teaching-agent-protocol`、`managed-config-overlay`。  
**禁止**将 shell / code_mode / mcp_marketplace / yolo / remote_telemetry 等注册为 feature id。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/features.unit.test.ts
```

本切片**不要求** UI settings 面或 doctor 强制接线；可选将来由 doctor 读 `featureCount()` / `listFeatures()`。

## 不变量

- Features 是元数据；执行仍走 TOOL_CONTRACT、effect lattice、CapabilityCatalog、settlement sole-writer（`expectedRevision`、`toolsReplayed: false`）。
- 不得用 feature flag 旁路 effect / settlement / toolsReplayed / 审批。
- 不得引入默认 shell、code_mode、MCP marketplace、远程 telemetry、YOLO / always-approve 产品功能。

## 不包含 / non-claims

- **不是** 第二套授权或 capability 目录替换。
- **不是** Footprint Ladder 替代或强制 ladder 执行器。
- **不是** 本切片的 UI 功能开关面板 / remote config flag 服务。
- **不是** shell / code_mode / MCP marketplace / remote telemetry 的产品化入口。
- **不** 修改 settlement / coordinator / ledger 写入路径。

# ADR-0126：Codex 式平台能力分层（Platform Capability Profiles）与 consumer 迁移

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-22
- **范围：** 平台能力分层模型 + 已审查 consumer 迁移；outcome/audit 在 Windows 保持 unavailable（诚实边界）。**不承担 shell 产品面**（见 ADR-0152/0153）；**默认写模型**由 [ADR-0131](0131-pathname-default-durable-io.md) supersede。
- **取代：** 无
- **被取代：** 部分被 [ADR-0131](0131-pathname-default-durable-io.md)（默认写模型）与 [ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md)/[ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md)（shell 产品面）supersede；本文件历史 dual-profile 结项与 inventory **保留**，不重写。
- **相关：** [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md)、[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)、[ADR-0052](0052-provider-error-and-recovery-taxonomy.md)、[ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0131](0131-pathname-default-durable-io.md)、[ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md)、[ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md)、`SECURITY.md`、`AGENTS.md`
- **证据：** `src/shared/platform-capability.ts`、`src/main/platform/platform-capability-registry.ts`、`src/main/ai/tools/windows-direct-path-memory-catalog.ts`、`src/main/ai/tools/windows-direct-path-workspace-write.ts`、`tests/unit/platform-capability-registry.unit.test.ts`、`tests/unit/teaching-memory-catalog-windows-direct-path.unit.test.ts`、`tests/unit/teaching-ipc-gateway.unit.test.ts`；完整 consumer inventory 见 `docs/adr/evidence/ADR-0126.md`。

## 背景

Windows 上 descriptor-relative catalog 把聊天热路径 fail-closed；产品要求改为 **Codex 式分层**：不同平台显式命名不同合同，热路径可降级，教学权威写路径仍 fail-closed，且**禁止**把较弱 profile 伪装成 POSIX CAS / strict。同一句用户消息不能同时踩「教学权威 fail-closed」与「平台能力缺失」，否则体感是「百分百不能聊天」。

## 决定

### 1. 引入统一的 Platform Capability Profile 模型

在 main 进程暴露只读、稳定、**无本地路径/无 errno 细节**的能力描述：

```ts
type PlatformIoProfileId =
  | 'posix_descriptor_strict'      // openat / no-follow / temp+publish 类
  | 'windows_direct_path_non_cas'  // root-constrained pathname；已用于 P8
  | 'unavailable'                  // 本 host 无安全可用 profile

type ConsumerCapabilityClass =
  | 'chat_hot_path_read'           // 发消息前 list/inject；可降级为空
  | 'durable_authority_write'      // memory CRUD、outcome publish 等；不可静默假成功
  | 'durable_authority_read'       // 权威读（设置页 catalog、migration preflight）
  | 'workspace_tool_write'         // write_workspace_file（已分层）
  | 'projection_rebuild'           // 可重建投影；可 defer

type ConsumerPlatformCapability = {
  consumer: string
  class: ConsumerCapabilityClass
  profile: PlatformIoProfileId
  available: boolean
  code?: 'ok' | 'degraded_empty' | 'write_unavailable' | 'containment_unavailable'
       | 'unsupported_platform' | 'native_unavailable'
  messageKey?: string   // doctor / support 用短说明 key，走 i18n
}
```

**规则：**

1. 每个 consumer 单独声明自己在当前 host 上的 `profile` 与 `class`；共享原语存在 ≠ 所有 writer 自动可用（延续 ADR-0004 partial migration）。
2. `chat_hot_path_read`：profile 不可用时必须 **degrade**（空列表 / 跳过工具注册），**禁止**把 `unsupported_platform` 抛到 turn 顶层。
3. `durable_authority_write`：profile 不可用时 **fail-closed**（稳定 error code），**禁止** pathname 假成功，也**禁止**在无 profile 时仍展示「已保存」。
4. 命名诚实：`windows_direct_path_non_cas` 永远不得改名为 `strict` / `cas` / `descriptor-equivalent`。
5. Windows strict（HANDLE-relative + publish-point identity CAS）仍按 ADR-0035 为 **unsupported / no-go**，除非未来独立新 ADR 提供审计证据；本 ADR **不**重开 strict 工作线。

### 2. Memory 在 Windows 上的合同（较弱语义，已批准）

- **读（list / recall inject / settings 只读列表）：** 允许 `windows_direct_path_non_cas` 下列目录与读 JSON；仍拒绝 workspace 外路径、symlink-as-directory 穿越（沿用 `resolveWorkspacePathTarget` / 等价 containment，**不得**弱于 P8 已用检查）。
- **写（create/update/delete memory record）：** 允许同一 profile 的 create/overwrite，但结果码与 P8 对齐：`possibly_published` / `target_changed` 等**不可自动 retry/rollback**；UI 必须显示「Windows 有限持久化（非 descriptor）」。
- **migration preflight / destructive C-6：** 仍 defer（ADR-0038）；Windows 较弱 profile **不**自动授权 destructive migration。
- **不得**声称与 POSIX memory 相同的 crash/power-loss / TOCTOU 边界。

### 3. 实施状态（分 phase 结项）

| Phase | 状态 |
| --- | --- |
| 0 Design gate 冻结 | **完成**（本文 + README + SECURITY non-claim） |
| 1 Registry + chat 热路径合同化 | **完成**（`platform-capability-registry.ts`、`loadTeachingMemoryCatalogForTurn`） |
| 2A/2B Memory win32 读/写 | **完成**（`windows-direct-path-memory-catalog.ts`；catalog `ioProfile` dispatch） |
| 2C/2D Tools/consent + UI/i18n | **完成**（`memory-tools.ts` `writeAvailable` 门控；Settings 徽章诚实展示） |
| 3 其余 consumer 清点分类 | **完成**（registry consumers + inventory；未审查 writer 保持既有 durable-file 合同） |
| 4 Provider UX 收口 | **完成**（`provider-recovery` `reasonCode: platform_capability`；平台 vs 空流分轴） |
| 5 Docs / doctor close-out | **完成**（SECURITY.md；doctor `platformCapabilities`） |

Chat 路径不得再让 `NativeContainedDurableReplaceUnavailableError` 逃出 turn（runtime catch + registry gate）。

## 不变量

1. `durable_authority_write` 永不 degrade-to-success；`chat_hot_path_read` 永不 fail-closed-to-turn-failure。
2. Windows direct-path 永不命名为 strict/CAS/descriptor-equivalent；Windows strict no-go（ADR-0035）不被重开。
3. 不改变 TeachingTurnCoordinator settlement sole-writer；不引入 YOLO / danger-full-access / 默认 shell。
4. 未审查 writer 不自动挂新 profile（ADR-0004 partial migration 纪律）。
5. 本 ADR 只迁移「平台能力分层 + consumer 接线」，不改 teaching settlement authority；shell/sandbox 产品面另见 ADR-0152/0153，默认写模型见 ADR-0131。

## 后果

- Windows 上连续聊天不再因 descriptor-relative catalog 直接失败；记忆在 Phase 2 后可在 Windows list/write，doctor 显示 `windows_direct_path_non_cas`。
- macOS/Linux memory 行为与 descriptor 合同**无回归**。
- 平台能力降级与模型/网络错误文案分离，禁止把 descriptor 英文异常直接抛给用户。

## 验证

- `pnpm exec vitest run --project unit tests/unit/platform-capability-registry.unit.test.ts tests/unit/teaching-conversation-runtime.unit.test.ts tests/unit/teaching-memory-catalog-windows-direct-path.unit.test.ts tests/unit/teaching-ipc-gateway.unit.test.ts tests/unit/provider-recovery.unit.test.ts tests/unit/operation-feedback.unit.test.ts`
- `pnpm run check:security`、`pnpm run check:provider-errors`、`pnpm run check:tool-contract`、`pnpm typecheck`
- 完整 consumer inventory 与验收命令证据：`docs/adr/evidence/ADR-0126.md`

## 非目标

- 不提供 Docker 级 OS isolation。
- 不提供 Windows publish-point file-ID CAS。
- 不迁移全部 C-4 writer 到新 registry（仅清单内 consumer）。
- 不授权 C-6 destructive migration。
- 不改变 TeachingTurnCoordinator settlement sole-writer。
- 不引入默认远程 telemetry；不引入 YOLO / danger-full-access / 默认 shell。

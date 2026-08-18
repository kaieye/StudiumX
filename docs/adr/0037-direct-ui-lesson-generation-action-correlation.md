# ADR-0037：Direct-UI lesson generation 用户动作关联（首个切片）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** direct-UI `generateLesson` / `generateLessonStream` 首个切片：caller `actionId`、private receipt 与 provider-boundary 前的 durable `accepted`/`provider_started`。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md)、[ADR-0036](0036-mission-update-action-receipt-correlation.md)
- **证据：** `src/main/direct-lesson-action.ts`、`src/main/teaching-workspace.ts`（direct path only）、`src/main/teaching-ipc-commands.ts`、`tests/unit/direct-lesson-action-receipt.unit.test.ts`、`tests/unit/direct-lesson-action-coordinator.unit.test.ts`、`tests/unit/teaching-ipc-generate-lesson-action.unit.test.ts`

## 背景

Direct-UI「生成课程」跨 renderer、IPC、provider、artifact、index、lifecycle、history 与 registry。此前没有 caller `actionId` 或 private receipt，lost response / reload 后用户只能再次点击；系统无法区分 exact retry 与新动作，可能重复进入 provider 或重复副作用。

## 决定

### 1. actionId 生命周期

1. renderer 在用户确认生成后、首次 IPC 前生成 **RFC 4122 UUID v4** `actionId`（opaque、non-secret）。
2. **新用户确认的 submit**（含相同 prompt 的再次点击）必须产生 **新** actionId。
3. 同一 UI 实例在 **lost IPC response** 或 **stream transport 断开后的显式重试** 时复用内存中的 pending `actionId`；**不**把 prompt/messages 写入 `sessionStorage` / local storage。
4. **renderer reload** 后仅可从 `sessionStorage` 恢复 `{ workspaceId, actionId, operation }` pending marker，并调用 **action-status**；不得自动 resubmit、不得附着旧 `streamId`。
5. main **不**生成或替换 caller actionId；拒绝非 UUID v4、跨 workspace、跨 operation、tombstone/expired 或 requestTag 不一致的重用。
6. 同一 `{ workspaceId, operation, actionId }` 在 main 进程内串行；并发 caller 等待同一 disposition 或读取 receipt。

### 2. Request binding（无 durable raw prompt）

1. Privacy owner **批准** private receipt 内 **仅 main-only、不可导出、不可日志化** 的 keyed request tag：`HMAC-SHA-256(installKey, canonicalAcceptedInput)`。
2. install key 存放于 app-data（与 registry 同级），不入 workspace export、不入日志。
3. tag 只做 constant-time equality；**不是**跨 action 内容 dedupe key；不同 actionId 即使 prompt 相同也是独立动作。
4. payload mismatch → `conflict: request_mismatch`；receipt corrupt/missing 无法证明 → `conflict: receipt_corrupt` 或 `indeterminate: receipt_unavailable`；外部 canonical 变更无法与 receipt 引用唯一匹配 → `conflict: external_mutation` 或 `indeterminate: projection_unprovable`。

### 3. API / receipt / trace 边界

1. Direct generate / stream 与 status 共用 stable disposition 集合：`succeeded` | `reused` | `rejected` | `conflict` | `indeterminate` | status 的 `in_progress`。
2. Private receipt 路径：`<workspaceRoot>/.studiumx/private/direct-lesson-actions/v1/<actionId>.json`（main 构造；0700/0600；非 export 默认范围）。
3. Receipt **不是** canonical / projection / journal / audit authority；不得进入 user-visible artifact、analytics 或 generic error text。
4. **本切片不**将 direct-UI `lesson_generated` 纳入 ADR-0005 trace 覆盖；不写 trace 到 lifecycle 或回传 renderer。后续若扩展必须另更 ADR-0005。
5. 完整结果保留建议 **30 天** 后降级 tombstone；tombstone 保留至 workspace 删除；过期 ID 永远 `conflict: expired`，永不作为新 action 接受。本切片实现 tombstone schema 与 expired 检查；后台 retention worker 可后续补齐。

### 4. Provider authority / cost

1. Receipt 必须在 **provider boundary 之前** durable 为 `accepted`，进入 provider 前再 durable 为 `provider_started`。
2. 一旦 durable `provider_started`（或之后的非 terminal phase），**同一 actionId 不得再次进入 provider**，即使 plan 未知。
3. Provider outcome 无法证明 → `indeterminate: provider_outcome_unknown`；**禁止**自动重跑。
4. 仅 `accepted` 且能证明未到 `provider_started` 的 recovery 可再次标记 start 后进入 provider。

### 5. Crash / recovery（首个切片）

| 观察 | 行为 | provider |
| --- | --- | --- |
| 无 receipt，合法 payload | 创建 `accepted` 后继续 | 首次可 |
| requestTag / workspace / operation 不一致 | `conflict` | 否 |
| `accepted` only | 可继续并 durable `provider_started` | 可 |
| `provider_started` 且未 completed | `indeterminate: provider_outcome_unknown` | **否** |
| `completed` 且 index 引用可验证 | 从 canonical index 重建 → `reused` | 否 |
| completed 引用丢失/外部修改 | `conflict` / `indeterminate` | 否 |
| tombstone / expired | `conflict: expired` | 否 |

本切片 **不**实现完整 index/lifecycle/history/registry 逐相补写 recovery，也 **不**保留 publication journal 至 receipt cleanup 的完整 hand-off worker。Publisher 接受 **caller-reserved `publicationTransactionId`** 以便 receipt 记录 intent；无法证明的 publication/projection 状态 fail closed。诊断仅固定事件名 + disposition/code，**不**拼接 actionId、path、prompt、content hash 或 provider request ID。

## 明确排除

- agent `generate_lesson` / `generateAndPersistLesson` 不走 direct action protocol；agent 不得复用 renderer actionId。
- mission、lesson style、generic writer、C-4 通用 durable 语义扩张、C-5H、artifact journal 全局 recovery、legacy backfill/repair、content-hash dedupe。

## 后果

1. Direct IPC 要求 `actionId`；旧 payload 在 parser 层拒绝（`invalid_request`）。
2. 同 actionId exact retry 在可证明 completed 时返回 `reused`；in-progress 仅 status；unknown 为 `indeterminate`。
3. 不同 actionId 永不按内容 dedupe。
4. C-5I 从开放 todo 移除；更深层 projection recovery / retention worker / multi-platform ops evidence 若需要，必须新 workflow，不得把本切片解释为全局 exactly-once。

## 验证入口

```sh
pnpm exec vitest run --project unit \
  tests/unit/direct-lesson-action-receipt.unit.test.ts \
  tests/unit/direct-lesson-action-coordinator.unit.test.ts \
  tests/unit/teaching-ipc-generate-lesson-action.unit.test.ts
```

相关 production 入口：`src/main/direct-lesson-action.ts`、`src/main/teaching-workspace.ts`（direct path only）、`src/main/teaching-ipc-commands.ts`、`src/preload/index.ts`、`src/renderer/src/app-shell/appStore.ts`。

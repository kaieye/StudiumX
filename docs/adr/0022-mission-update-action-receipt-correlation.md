# ADR-0022：mission_update 的 actionId / private receipt 关联（mission-first）

- **状态：** 已实施（限定 mission submit 首个切片）
- **范围：** C-5H mission-first
- **关联：** [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0005](0005-main-owned-trace-correlation-and-safe-logs.md)、[ADR-0007](0007-persisted-user-history-redaction.md)

## 背景

用户点击“更新 mission”后，IPC 响应可能丢失，renderer 可能 reload，或 `MISSION.md` 已发布而 lifecycle / registry 尚未完成。既有 `UpdateMissionPayload` 只有 `{ workspaceId, prompt }`，无法区分：

- 对**同一次**用户提交的结果重取；
- 用户再次提交相同或相似 prompt 的新动作。

ADR-0004 的 durable publish 与 ADR-0005 的 trace 都不是 caller action identity、receipt 或 exact retry 协议。需要一个 mission-only、fail-closed 的 action/receipt 切片。

## 决定

### 1. actionId

- 批准 renderer 在用户**明确 submit** 时生成 opaque、non-secret UUID `actionId`。
- 仅在 lost-response / 同进程 reload 的重试窗口内复用（sessionStorage，1 小时，且 prompt 必须逐字相同）；新 submit、payload 变化、conflict / indeterminate 后必须新建 actionId。
- `actionId` 只出现在 IPC payload 与 main workspace-private receipt；不得进入 lifecycle JSONL、日志、analytics、user-visible artifact 文件名以外的元数据。

### 2. 公共结果词表

`updateMission` 的稳定结果为：

| disposition | 含义 | 写入 |
| --- | --- | --- |
| `completed` | 本 action 的 mission / lifecycle / registry 均已确认，receipt `final` | 本 action 首次完成时的写入 |
| `reused` | 已存在匹配的 final receipt；返回 fresh state | **不**再写 mission / lifecycle / registry / receipt |
| `conflict` | request binding 或 ownership 不匹配 | 不写 |
| `indeterminate` | receipt 缺失/损坏/未知版本、binding key 不可用、或非-final 状态无法安全证明下一步 | 不写（不为修复而补写） |

无效 IPC、未知 workspace、非法 actionId 仍在 parser / service 边界 reject，且不创建 receipt。

### 3. 冲突与 fail-closed（无 CAS UI）

同 actionId 遇到下列情况一律 fail-closed，**不**提供 expected-revision / CAS UI（v1）：

- payload / request binding 变化 → `conflict`
- receipt missing / corrupt / unknown version / workspace 或 kind 不匹配 → `indeterminate` 或 `conflict`
- non-final receipt（含 crash 后 `prepared` / `mission_published` / `event_appended`）→ `indeterminate`，**不自动续跑** side effects
- 明确 I/O 错误在 participant 写入路径上仍抛出/返回 non-success；不得因文件存在或同 prompt 报成功

### 4. private receipt

- **路径：** workspace 内 `.studiumx/mission-actions/<actionId>.json`
- **权限 / 写入：** schema-versioned JSON，`replaceDurably` + mode `0600`
- **schema v1 允许字段：** `schemaVersion`、`kind=mission_update`、`workspaceId`、`actionId`、`traceId`、`eventId`、`phase`、`requestTag`、`createdAt`、`updatedAt`
- **禁止字段：** raw prompt、rendered mission、CSS、content hash、provider/request ID、secret、绝对路径、stack、error text
- **phase：** `prepared` → `mission_published` → `event_appended` → `final`；每阶段只在对应 participant 完成后推进
- **authority：** receipt 只是 recovery aid，不是 mission / lifecycle / registry 的事实来源
- **序列化：** main 内 per-workspace queue；多 Electron instance / 外部 writer 不做跨进程锁，冲突时 fail closed
- **retention：** 本切片不自动 cleanup；仅允许未来删除已 final 且过 retention 的私有 receipt，删除失败不得影响 canonical 数据
- **legacy：** 无 receipt 的历史 mission 一律 uncorrelatable，不能被认领为 `reused`

### 5. trace 边界

- main 在首次接受 action 时生成 `traceId`（UUID），并在获批扩展下写入 `mission_updated.traceId`
- trace 仅作 diagnostic correlation；不能作为 receipt key、dedupe key 或 action identity
- 日志使用固定安全词表 tag `mission-action` + 可选 normalized `traceId`；默认不记录 actionId、prompt、receipt body、requestTag、路径

### 6. request binding（方案选择）

在设计门 A/B/C 中采用 **B 的最小化变体**：

- 不在 receipt 中存 raw prompt 或 content hash
- main 使用 app-private binding key（`appData/mission-action-binding.v1.key`，workspace 外）计算 HMAC-SHA256 `requestTag`
- 输入为 `mission_update || workspaceId || actionId || prompt` 的分隔拼接；tag 不可逆，workspace export 不带走 key
- 同 actionId + 不同 prompt → requestTag 不匹配 → `conflict`
- **不**用 requestTag 证明 `MISSION.md` bytes 的外部编辑归属；canonical Markdown 仍无 revision，故 non-final crash 窗口仍为 `indeterminate`，不做自动 exact recovery

这比纯 A 多了 payload-mismatch 检测，但明确不承诺 crash-window 自动续跑或 CAS。

### 7. lifecycle 与既有 prompt 历史

- 新的 `mission_updated` 事件继续带既有 raw `prompt` 字段（当前实现，非本 ADR 新增数据处理）
- 不得把 actionId / receipt / phase / requestTag 写入 JSONL
- 不借机做 lifecycle prompt redaction 或历史回填（见 ADR-0007 范围限制）

## 已实施范围

仅 `teach:update-mission` → `TeachingWorkspaceService.updateMission()`：

```text
private receipt → MISSION.md → workspace lifecycle JSONL → global workspace registry → result
```

代码入口：

- `src/shared/teaching-types/workspace.ts`（payload / result）
- `src/main/teaching-ipc-commands.ts`（严格 parser）
- `src/main/teaching-workspace/mission-action-receipt.ts`（receipt + binding）
- `src/main/teaching-workspace.ts`（state machine）
- `src/renderer/src/app-shell/appStore.ts`（actionId 生命周期与 disposition UI）

验证入口：

```sh
pnpm exec vitest run --project unit \
  tests/unit/teaching-workspace-mission-action.unit.test.ts \
  tests/unit/teaching-workspace-mission-durable.unit.test.ts
```

## 明确不包含

- `lesson_style_applied`、CSS scaffold/repair、generic workspace writer、agent mutations
- C-5I lesson generation correlation / provider retry
- CAS UI、expected revision protocol、跨文件 transaction / rollback
- 跨进程 exclusive ownership、全局 receipt registry、云同步
- legacy lifecycle backfill / repair / prompt redaction
- host-native power-loss / multi-instance closure 声明（本切片以 unit/fault-injection 证明 fail-closed 语义）

## 后果

1. renderer 与 main 的 mission IPC 从“返回 `TeachingAppState`”变为返回 `MissionMutationResult`；调用方必须按 disposition 处理。
2. 同 actionId 的 final retry 可安全重取结果；不同 actionId 永不按内容 dedupe。
3. 无法证明的状态对用户显示 conflict / indeterminate，并要求**新的**显式提交，而不是盲重放。
4. ADR-0005 的 mission coverage 在本切片内扩展到 `mission_updated.traceId`，但仍不是 action identity。

# ADR-0024：Memory 只读迁移 dry-run 切片与 destructive migration 延期

- **状态：**已采纳（2026-07-20）
- **范围：**C-6 阶段 2（main-only readonly dry-run intent/receipt preview）结项；明确 **不** 批准 destructive/controlled migration 实现。
- **相关：**[ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md)（分区 + aggregate preflight）

## 决定

### 1. 采纳 main-only readonly dry-run 作为 C-6 当前唯一可实现切片

在 [ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md) 的 scope 分区与 aggregate-only readonly preflight 之上，main 进程可提供短期、aggregate-only 的 legacy migration **dry-run intent/receipt preview**：

- 入口：`TeachingMemoryStore.previewLegacyMigrationDryRun` / `completeLegacyMigrationDryRun`（main façade only）
- 协调器：`TeachingMemoryLegacyMigrationDryRun`（`src/main/teaching-memory-catalog/migration-dry-run.ts`）
- 每次 intent 与 receipt 均重新执行 trusted-scope validation + readonly discovery（`diagnosticsSnapshot({ access?, createRoot: false })`）
- 请求 fail-closed：仅可选的 main-trusted `access: { workspaceRoot?, projectRoot? }`；`path` / `root` / `target` / `checksum` 及任何未知字段均 `not_authorized`，且不进入 discovery
- Intent 为进程内短期状态（默认 TTL 60s）；过期或未知 intentId → `expired`
- 公开结果仅含稳定 disposition（`preview_only` | `not_ready` | `not_authorized` | `blocked` | `expired` | `busy`）、access class 聚合、`authorizationClass: 'readonly_preview_only'`，以及既有 aggregate preflight 计数；`destructiveAuthorized` 与 `memoryMutated` 恒为 `false`
- 不创建缺失 Memory root；不 copy、不 hold、不 publish、不 delete；不新增 renderer path input、迁移 UI 或新 diagnostics IPC command

### 2. Readonly dry-run / preflight 不构成 destructive 授权

下列任何一项都 **不是** destructive migration 的 consent、identity、reservation、retry key 或 recovery authority：

- `migrationReady`、aggregate preflight 计数
- dry-run `intentId` / receipt preview
- Settings 刷新、startup、background、analytics 或历史 confirmation
- renderer 提供的 path/root/target/checksum

`authorizeDestructiveMigration()` 故意抛出；本切片不提供任何 copy/hold/publish/delete 入口。

### 3. Destructive / controlled migration 延期，当前不可分派为实现

destructive/controlled migration（含 hold、publish+confirmation、delete pilot、rollout/legacy EOL）保持 **未批准、未实现**。在以下全部由独立 ADR + owner 批准并附 matching evidence 之前，**不得**将真实 copy/delete 分派为实现任务：

1. main-only trusted identity/scope authorization 与一次性、显式、可取消的 confirmation binding；
2. 目标平台 descriptor-relative no-follow copy、exclusive destination create、durable publish、descriptor-bound delete、directory sync；不支持则 fail closed，无 unrestricted path I/O fallback；
3. non-overwrite duplicate policy、private hold/backup ownership/retention/cleanup/legal hold、partial-delete 人工恢复责任；
4. 多文件 phase contract 与仅记录可证明 phase 的 private receipt（不得声称跨文件 atomicity）；
5. data-minimal audit/diagnostics、host-native/fuzz 安全矩阵与 operations runbook。

在此之前，产品行为仍是：scoped 新写入 + flat/scoped tolerant read + aggregate preflight + 本 ADR 的 main-only readonly dry-run。

## 已落地范围与验证入口

```sh
pnpm run build:contained-durable-replace
pnpm exec vitest run --project unit \
  tests/unit/teaching-memory-migration-dry-run.unit.test.ts \
  tests/unit/teaching-memory-catalog.unit.test.ts \
  tests/unit/teaching-memory-recall.unit.test.ts \
  tests/unit/teaching-ipc-gateway.unit.test.ts
pnpm run typecheck
```

定向 dry-run + catalog 单元：**29 passed**；相关 recall/IPC 基线：**22 passed / 1 skipped**；typecheck 通过。测试证明：canonical Memory bytes/mtime/layout 不变、缺失 root 不创建、path 输入 fail-closed、access 作用域聚合、intent 过期、duplicate/recovery blocker、以及输出不含 root/id/content/locator。

## 明确不包含

- 真实 copy、checksum-verify-as-migration-step、hold、scoped publish、legacy delete
- 迁移按钮、candidate 列表、renderer 特权 path 参数、新 public IPC command
- startup / background / settings 自动迁移或 auto-resume
- 将 dry-run intent 当作 consent binding 或 exact-retry identity
- C-5H / C-5I 范围

## 后果

1. `docs/local-data-todo.md` 不再将 C-6 列为可分派的开放实现工作流；destructive migration 仅可作为未来独立 gated proposal，须先满足本 ADR 第 3 节前提。
2. 已结项 C-6 plan 删除；readonly dry-run 与 destructive 延期前提仅以本 ADR 与 [ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md) 为准。
3. [ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md) 的分区与 preflight 边界不变；本 ADR 仅叠加 dry-run 切片并冻结 destructive 延期。

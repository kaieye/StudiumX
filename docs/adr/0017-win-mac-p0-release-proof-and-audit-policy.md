# ADR-0017：Win/Mac P0 发布证明与 clean-checkout audit 政策

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 以可复制 clean-checkout 审计与真实 Electron 纵向证据关闭 P0 教学领域模块（ADR-0008…0016）的发布；平台/能力 skip 显式建模。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)、[ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)
- **证据：** `scripts/release-audit-contract.mjs`、`scripts/release-audit.mjs`、`node scripts/check-learning-outcome-committer.mjs`、`node scripts/check-teaching-learning-loop.mjs`、`tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts`、`tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts`；发布证明快照与 Win32 预算明细见 `docs/adr/evidence/ADR-0017.md`

## 决定

P0 教学领域模块（ADR-0008 至 ADR-0016）已实施后，**发布完成**必须以可复制的 clean-checkout 审计与真实 Electron 纵向证据关闭，而不是以开发机脏工作区的 exit-0、草稿 handoff 或“跳过当绿”为凭。

目标产品环境是 **Windows 与 macOS**。审计与 gate 对平台缺失能力必须显式建模：

1. **任意非零退出、未解释 skip、脏 detached/source checkout、输出写回源工作区** → 审计失败。
2. **已识别的平台/能力 skip** 可分类为 known，且在 Win/Mac 上**单独不足以**否定发布绿：
   - 行级标记匹配 `knownPlatformSkip`（POSIX / descriptor-relative / FIFO / workspace-write 可选 FS 拒绝文案等）；或
   - 精确命中 `platformReleaseSkipBudget` 中该平台、该命令的 vitest 聚合预算。预算漂移 fail-closed。
3. **Linux** 聚合预算保持为空：除非行级 known 标记，否则任何 `Tests N skipped` 聚合在 Linux CI 仍为红。不得把 Windows 预算继承到 Linux。
4. **darwin** 聚合预算在 Mac 独立 inventory 封存前保持为空；Mac 要么零聚合 skip，要么按 Windows 同样方式写入精确预算。

权威实现：`scripts/release-audit-contract.mjs`、`scripts/release-audit.mjs`。入口：

```powershell
node scripts/release-audit.mjs
# 或保留机外证据：
node scripts/release-audit.mjs --output D:\release-evidence\p0-clean-checkout-audit.json
```

机内输出路径允许本地检查，但 `outputInsideSourceWorktree: true` 永非 clean-pass。CI 证据写在 runner 临时目录并上传 manifest + artifacts。

## 已实施范围与验证入口

### Runtime gates（替代失效静态正则）

下列命令是 **Vitest runtime scenario gate**（JSON reporter + 精确 testName），不是源码正则 greening：

```powershell
node scripts/check-learning-outcome-committer.mjs
node scripts/check-learning-outcome-recovery.mjs
node scripts/check-learning-record-read-repair.mjs
node scripts/check-teaching-learning-loop.mjs
```

覆盖证据门控发布与幂等、authority-first reconcile/read-repair、ordered publish 崩溃恢复、以及 teaching-loop 静态合同（含 longitudinal / crash-recovery e2e 与 audit argv）。

### Electron Golden

- `tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts`：真实 evidence → preload/IPC commit → canonical/catalog → 重启幂等。
- `tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts`：`after_stage_flush` 与 `before_catalog_reconcile` 故障注入 + 进程重启修复。
- 发布审计以 `--project=electron-e2e --repeat-each=3` 执行上述套件及 presentation a11y Golden。

### Windows 证明快照（2026-07-20）

| 项 | 值 |
|----|----|
| 发布证明 commit | `a797f07a65ed7a598bb96d1666e496fcf0275f67` |
| Host | Windows, Node v24.13.0, pnpm 11.9.0 |
| Manifest | 机外 `p0-clean-checkout-audit.json`，`passed: true`，24/24 命令 exit 0 |
| Manifest SHA-256 | `e1802af6d0b80a53a982fb3309adc2ea93773ec1bee5b9c02cbb5be56dcd75e4` |
| Tip re-audit | `7aa205fa2337d8290038274046f4f97118b635db` 亦 `passed: true` |

### Win32 聚合预算（精确；漂移即失败）

| 命令 | tests skipped | files skipped | 原因类 |
|------|--------------:|--------------:|--------|
| `pnpm run test:unit` | 69 | 3 | POSIX descriptor Memory/catalog、native macOS/Linux publish、FIFO、FS case-fold 等能力门 |
| `pnpm run test:integration` | 1 | 0 | `trace-propagation` 需 descriptor-relative Memory |

行级能力 skip 示例（不计入聚合预算，靠 `knownPlatformSkip`）：workspace-write/security 中 symlink 创建 `EPERM`、FIFO `mkfifo` 不可用。产品在目标对象**可创建**时仍 fail-closed 拒绝；skip 仅记录**创建前置**不可用。

更新预算时必须：能力门真实存在、测试机制为 `runIf`/`skipIf`/capability probe，且不得为掩盖产品回归而抬高数字。权威数字以 `scripts/release-audit-contract.mjs` 的 `platformReleaseSkipBudget` 为准。

## 不变量

- 未解释 skip、bare `skip`/`TODO`、预算漂移、非零退出 → 不得声称发布绿。
- known / budgeted skip 必须可路由到目标平台或能力模型；不得静默删除测试或用 bare skip 冲绿。
- clean-checkout 审计必须在干净源工作区启动，并在 detached worktree 执行命令；证据优先写在源树外。
- P0 发布完成声明仅覆盖 **Win/Mac 产品目标**；不从 Windows 证明单独导出 Linux 产品船。

## 不包含

- 完整 C-4P6 / C-4P9 writer migration 或 Windows strict descriptor/HANDLE-relative durable publish（见 ADR-0004、ADR-0035）。
- Mac 聚合预算的独立封存（`darwin` 预算仍空，直至 Mac inventory）。
- P1 coordinator / blocking CI 扩展 / P2 规模化项。

## 残余风险（接受边界）

1. Windows 上 POSIX-only 套件与 FIFO/symlink 创建能力缺口按设计跳过；Mac 应继续跑其 native 套件。
2. Windows directory fsync soft edge（durable rename 可能无 directory fsync）是已知耐久性降级，不是 gate 失败。
3. 机外证据包需运营侧保留或按上列命令重生；Git 不承载大型 audit artifacts。

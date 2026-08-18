# ADR-0039：Codex Rust 教学化借鉴结项与信号触发 P2 边界

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 结项原 codex-rust 教学化借鉴 plan 中仍具长期效力的产品/架构边界；P2-6（MCP）/P2-7（Helper Isolation）为默认不排期的信号触发项。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)…[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)、[ADR-0017](0017-win-mac-p0-release-proof-and-audit-policy.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)…[ADR-0028](0028-teaching-audit-correlation-safe-metadata.md)、[ADR-0029](0029-learning-branch-projection.md)…[ADR-0034](0034-redacted-support-bundle.md)
- **证据：** 各已实施领域的权威 ADR 与其门禁/验收入口（见「相关」与正文表格）；`tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts`、`tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts`、`tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts`

## 决定

### 1. 产品主线：教学闭环，而非通用 coding agent

StudiumX 借鉴 `ref_project/codex-rust-v0.144.4` 的目标是：**在可发布标准下证明教学闭环可恢复、可审计，且对学习者安全**。不得将借鉴工作扩张为通用 coding agent、通用多 Agent 编排平台，或默认以 shell / 任意工具面驱动的开发助手。

### 2. 已关闭借鉴范围不得重开为 backlog

下列范围已实施并分别以对应 ADR 为权威记录；后续只允许窄接入、design gate 修订或**新建 ADR**，不得借 M5–M10 生产接线或其它工作重开为“未完成 backlog”：

| 范围 | ADR | 说明 |
| --- | --- | --- |
| P0 教学领域模块 | [0008](0008-learning-session-ledger-as-canonical-teaching-process.md)–[0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md) | Session / Evidence / Outcome / Planner / Context / Presentation / Events / Assessment |
| P0 Win/Mac 发布证明 | [0017](0017-win-mac-p0-release-proof-and-audit-policy.md) | clean-checkout audit、runtime gates、真实 Electron Golden |
| 本地数据相关边界 | [0001](0001-rebuildable-sqlite-projection.md)–[0007](0007-persisted-user-history-redaction.md)、[0018](0018-recordless-learning-outcome-marker-only-settlement-authority.md)–[0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md)、[0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)、[0038](0038-memory-readonly-migration-dry-run-and-destructive-deferral.md) | 投影/备份/publish/trace/memory/redaction 与后续 evidence / close-out |
| P1 运行时与教学运营 | [0021](0021-agent-run-state-machine-separate-from-session.md)–[0028](0028-teaching-audit-correlation-safe-metadata.md) | Run 状态机、Config、Capability、ToolDispatcher、CourseDefinition、Doctor/Inspector、Audit correlation、Coordinator host / blocking CI |
| P2 只读投影 / 调度 / 导出 | [0029](0029-learning-branch-projection.md)–[0034](0034-redacted-support-bundle.md) | Branch projection、Resume picker、Tech inspector、Parallel read tools、Config CAS、Support bundle |

已合入实现的 feature / merge 历史以 Git 为准；门禁与验收入口以各 ADR 的「已实施范围与验证入口」为准。IPC/renderer 生产接线若尚未完成，归属 `todolist.md` 中 M5–M10 里程碑，**不得**重开已关闭领域规格。

### 3. 默认禁止的扩张（除非独立 ADR 批准）

在没有独立 design gate + 新 ADR + 匹配证据之前，不得引入：

- MCP 服务端/客户端通用面（见第 4 节 P2-6 例外条件）
- 任意 shell 执行或不可信代码执行路径（见第 4 节 P2-7 例外条件）
- 第二 LLM provider 作为教学主路径
- 通用多 Agent / child-agent 扩张
- 以 SQLite 为 teaching 真相源
- 云同步 teaching canonical data
- 新 runtime（替换或并行于现有 main/Electron 边界）

### 4. 剩余信号触发项：P2-6 与 P2-7（默认不排期）

#### P2-6：MCP（仅在存在真实教学 Adapter 时）

- **状态：**触发式候选；**默认不排期、不可分派为实现**。
- **触发前提（须全部满足，并经独立 ADR 批准）：**
  1. 存在真实、可验收的教学 Adapter 场景（不是“可能有用”的通用 MCP）；
  2. 已有威胁模型与数据最小化边界；
  3. Adapter 仅返回既有 typed outcomes / 既有 effect 分类结果，不得成为 grounding、IPC 或 settlement 的旁路。
- **无真实 Adapter 与威胁模型则永不实施。**

#### P2-7：Helper Isolation（仅执行不可信代码时）

- **状态：**触发式候选；**默认不排期、不可分派为实现**。
- **触发前提：**产品明确需要执行不可信学习代码，且必须用独立 helper process 隔离。
- **边界：**普通 Lesson、ResourceGrounding、只读工具与既有 workspace write **不经过** helper process。无不可信代码执行需求则不实施。

### 5. 发布审计仍可用的 Electron Golden（参考入口）

P0 发布证明的权威政策见 [ADR-0017](0017-win-mac-p0-release-proof-and-audit-policy.md)。下列命令仍可作为真实 Electron Golden 的参考入口（发布审计以 clean-checkout 与 release-audit 合同为准）：

```powershell
pnpm exec playwright test tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts --project=electron-e2e --repeat-each=3
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e --repeat-each=3
```

## 明确不包含

- 不批准现在实现 P2-6 MCP 或 P2-7 Helper Isolation
- 不把 M5–M10 生产 IPC/UI 闭环未完成解释为 P0/P1/已实施 P2 领域规格未完成
- 不授权重开已关闭的 local-data 或 teaching 领域 ADR 范围

## 后果

1. 原教学化借鉴 plan 删除；长期有效决定仅以本 ADR 与相关 ADR 为准。
2. `todolist.md` 中的 P1/P2 crosswalk 与里程碑依赖以 ADR 索引与本 ADR 为权威，不再依赖 `docs/plans/`。
3. P2-6 / P2-7 若未来立项，必须新建 ADR，并附真实场景、威胁模型与匹配证据；不得把本结项解释为已授权实施。
4. 后续产品工作优先完成 `todolist.md` 的 M5–M10 生产闭环，而不是扩张工具面或 agent 通用能力。

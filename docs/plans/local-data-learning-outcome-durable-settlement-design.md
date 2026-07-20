# C-4P6 Learning outcome durable settlement：设计门与风险边界

> **状态：未关闭。** C-4P6-S1 已提供严格有序发布和受控恢复的受限基础；S2–S194 是定向的 **tests-only historical evidence**。它们不能被解释为完整 durable settlement、跨文件事务、Windows power-loss 证明，或 P6 close-out。

## 1. 目的、范围与已知基础

本文件是后续 C-4P6 工作的设计与风险门（design/risk document），而非提交或测试的逐条台账。领域 authority 和 outcome 语义由 [ADR-0011](../adr/0011-evidence-gated-learning-outcome-settlement.md) 定义；共享 durable publish 原语、consumer migration 边界和历史证据索引由 [ADR-0004](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 定义。

已实施的 S1 基础（`7292bf4`、`e02a086`）仅包括：

- LearningOutcomeCommitter 的严格有序 canonical publish、operation 幂等和受控 `reconcile()` 基础；
- immutable Learning record、`outcome.json`、`session.json` projection 与 settlement marker 的有限恢复关系；
- 不可安全证明的路径、内容、identity 或写入状态进入既有 `conflict/review_required` 或 `reconciliation_required` 语义，而非猜测性覆盖。

本文件**不**授权扩大 writer、改变 schema / canonical path、增加删除或 rollback 行为、改变 IPC/API，或将 catalog 当作 canonical authority。

### Canonical authority 与幂等边界

| 情形 | authority（高到低） | 不得据此宣告成功或执行覆盖 |
|---|---|---|
| 会写 immutable Learning record 的 outcome | immutable Learning record → `outcome.json` / completed `session.json` projection → settlement marker | catalog、stage、marker 单独存在、UI 乐观状态 |
| 不会写 record 的 outcome | 有效 settlement marker 是 operation settlement / idempotency authority | catalog、缺少 record 的 projection、manifest 单独状态 |

有效 record 只能驱动受控 projection repair，不能被较低层 projection、catalog 或 marker 反向覆盖。identity 冲突、损坏、越界路径或无法确认的 I/O 结果必须 fail closed；不得重新 evaluate、生成新的 operation identity，或把未知状态报告为成功。

## 2. 历史 tests-only evidence（压缩说明）

S2–S194 的逐项提交、命令和断言不再在本设计文档重复罗列；保留的权威历史索引见 [ADR-0004 的 C-4P6 证据记录](../adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。这些切片大多只改定向测试，没有扩展 production/API/schema/path/order 语义。

| 代表性类别 | 覆盖的历史样本 | 可得出的有限结论 | **不能**得出的结论 |
|---|---|---|---|
| 发布与重启窗口 | `after_stage_flush`、`after_record_publish`、`after_outcome_publish`、`after_settlement_marker`、`before_catalog_reconcile`，以及 marker final-rename `EIO` | 特定注入点下会保持/修复/拒绝特定状态 | 未列举窗口、manifest publish、真实断电或所有文件系统的恢复已证明 |
| 已 settlement 文件完整性 | marker / record / outcome / manifest 的 malformed JSON、schema/identity 不匹配、directory、non-file symlink、无效内容 | poison residual 走 `review_required` / conflict，且不静默重写 authority bytes | 完整 authority/conflict matrix 或自动修复策略已闭合 |
| outcome / marker 输入验证 | outcome kind、assessment、hash、record/operation/session identity、marker 规范化等残差 | 定向不合法输入不会晋升为成功 outcome | 全部 schema 兼容性、未来字段或迁移行为已验证 |
| durable-I/O 残差 | stage / record / outcome / marker 的 open、write、sync、close、rename/link、directory-sync 等局部故障 | 被注入的故障点不应被成功结果掩盖 | manifest publisher 的 capability policy 或所有 I/O 组合已验证 |
| commit 前 session ledger 完整性 | S149–S194 的 manifest / durable event 读取、identity、时间窗、序列、path type、unknown key 等残差 | 在写入前检测到的 ledger 异常 fail closed，避免启动 canonical publish | ledger 迁移、修复、全量并发或 operation 运行验证已完成 |

因此，历史证据的共同价值是：**特定危险残差已有 fail-closed 回归保护**。它不是设计接受标准的替代物；后续实现必须按下列门重新定义覆盖范围、故障结果和验证层级。

## 3. 仍开放的设计门 A：manifest durable-I/O capability 与失败语义

`session.json` 是 outcome settlement 的 projection，但它仍是影响 recovery 与用户可见状态的关键 durable 文件。不得从 outcome / marker 的现有行为推导 manifest 已具备相同 guarantee。实施或批准下一步前，必须形成并评审以下 contract。

### A1. Capability contract

1. **固定边界：**manifest publisher 必须从已验证的 session directory capability 开始；不得在 publish 后重新按不受约束的 pathname 解析父目录，也不得存在 capability 失败后的宽松 pathname fallback。
2. **文件类型与 containment：**在读取、stage、replace、recovery 和 cleanup 各阶段确认 regular-file / directory / symlink 语义、session-id 与目录 identity、canonical path containment；未知或不安全的 entry 一律 fail closed。
3. **显式 ownership：**明确谁打开、谁关闭 file/parent-directory capability，以及每个 handle 的 close 失败如何影响返回结果；不得依赖 GC、进程退出或“最终 bytes 可读”掩盖失败。
4. **无隐式 downgrade：**任何 capability downgrade 必须是平台特定、最小的、具名 error-code allowlist，并记录 warning/diagnostic。非 allowlist errno、unknown `Error`、permission、open/write/sync/close 失败必须 fatal；不得继续后续 canonical write。

### A2. I/O phase matrix 与结果语义

manifest publisher 必须把下列阶段分别纳入 fault matrix，而不是只测最终 rename：

| 阶段 | 最低要求 | 失败后的语义门 |
|---|---|---|
| 读取 / `lstat` / validation | 确认 source manifest 可读、合法且在 capability 内 | 未写入前：`conflict/review_required` 或明确的 non-retryable 输入结果；不 evaluate、不 publish |
| stage `open(wx)` → write → file `fsync` → close | 临时文件私有、完整写入、关闭可观察 | 失败不能继续 publish；保留足以审查的状态，不把 cleanup 失败吞成成功 |
| final publish（rename/replace） | 明确 overwrite 规则、发布后可见性与已发布/未知状态 | rename 后任一 durability error 都不得报告 settled；进入可辨识的 reconciliation/review 路径 |
| parent directory open → `fsync` → close | manifest entry 的目录持久性按平台 profile 明确 | 只允许已批准 capability downgrade；其余失败阻止后续 marker / success |
| post-publish cleanup | 仅清理由本 operation 安全识别的临时 artifact | cleanup failure 必须可诊断；不得删除 canonical authority 或假装完全成功 |

对每个阶段必须预先指定：是否可能已经发布、返回的 public result、是否允许重试、`reconcile()` 可做的唯一动作，以及 diagnostics 中不含敏感内容的 operation/session correlation。没有这张矩阵时，`open`、`write`、file `fsync`、file `close`、rename、directory `open` / `fsync` / `close` 的任何补测都不能当作 manifest durable closure。

## 4. 仍开放的设计门 B：recovery 与 crash 边界

当前 ordered publish 是可恢复的多个 durable point，不是共同提交。未来设计必须把完整状态机写成可执行的 crash matrix：

```text
validate → stage flush → immutable record publish → outcome publish
         → manifest publish → settlement marker publish → catalog reconcile
```

每个箭头之前、之后及每个 durability failure 都要定义 restart `reconcile()` 结果。至少应满足：

- **stage only：**stage 不是 authority；不得 promote incomplete projection 或重评估同一 operation。
- **record published：**已验证 immutable record 是最高 authority；只可修复缺失且与它一致的 projection，冲突则 `review_required`。
- **outcome / manifest published but marker absent：**不得以 projection 单独宣告 settled；必须有明确 pending/reconciliation 或 review 的判定，尤其不能把未验证的 manifest 当 marker。
- **marker published：**只有 record（如要求）、outcome、manifest 和 marker 全部符合 authority / identity 约束时才可返回 settled；catalog lag 仅是可修复 projection 问题。
- **任何读取、验证或 I/O 结果未知：**不得做盲目 rewrite、rollback、delete、evaluate 或生成新的 ID；保留审查证据并返回既有受控失败语义。

验证必须覆盖正常 commit 与 restart/reconcile 两条路径，且在每个节点注入 file 与 parent-directory failure。单元 fake、跨进程 restart、集成 IPC、以及真实文件系统的 crash/restart 测试各自回答不同问题；任何一层都不能替代其他层。

## 5. 仍开放的设计门 C：跨文件 transaction、rollback 与 delete

P6 当前模型不提供跨文件 atomicity：record、outcome、manifest、marker 和 catalog 不会共同提交。顺序和 recovery 只降低不一致风险，**不**授权以下行为：

- post-rename rollback、以旧 projection 覆盖已发布 record，或将“无法确定是否持久”的错误转换为成功；
- 因 retry、reconcile 或 cleanup 删除 canonical record / outcome / manifest / marker；
- 对 canonical data 实施 general delete、retention、compaction 或 migration rewrite；
- 在没有独立协议的情况下把多个文件锁或多个 rename 视为 transaction。

若产品需要这些能力，必须先有单独批准的 transaction / lifecycle design，至少定义 intent/commit 记录或等价 protocol、participant authority、crash recovery、idempotent compensation、并发与锁语义、backup/restore、审计和 deletion/tombstone retention。该工作不能作为“补齐 P6 测试”的隐含副作用进入。

## 6. 仍开放的设计门 D：migration、API 与 operations validation

### D1. Migration 与 reader compatibility

在任意 schema、marker、manifest、record metadata、路径或 mode 变更前，需批准 migration plan，明确：

- 新旧 reader/writer 的兼容矩阵、升级与降级行为、未知字段策略，以及不支持版本的 fail-closed 结果；
- canonical path / record identity / hash / `0600` mode / symlink policy 的稳定性；
- 是否允许自动 repair 或 rewrite（默认不允许），以及 backup、dry-run、恢复和停止条件；
- migration 前后 `reconcile()`、IPC result 和 catalog projection 的可观测结果。

### D2. API 与 sole-writer boundary

main-process controlled committer 仍是正式 record 的 sole writer。任何 API/IPC 变化必须保持 stable operation identity、明确 retry contract，并区分：未写入失败、可能已发布而需 reconcile、冲突/人工审查、以及确定成功。renderer、Lesson、catalog、planner、UI 或外部 caller 不得以新参数、重试或“修复”路径绕过证据门和 authority。

### D3. 运行与发布验证

未来批准范围需指定 owner、runbook 和可审计 acceptance evidence，至少包括：fresh install / upgrade、已有 partial settlement、损坏 residual、磁盘满与 permission failure、应用异常退出与 restart、backup/restore、并发 operation、IPC caller 重试、catalog rebuild，以及无敏感原文的诊断与告警。定向 unit/integration 通过、提交存在或静态 checker 匹配均不足以构成 operations validation。

## 7. 仍开放的设计门 E：Windows native fsync 与 power-loss

Windows profile 必须独立证明或明确限制；不得用 POSIX 目录 `fsync` 假设替代它。尤其需要确认：

1. file `fsync`、close、rename/replace 在受支持 Windows 文件系统上的实际错误与共享/杀毒/锁竞争行为；
2. Node 无法对目录 handle `fsync` 时，哪一种降级被允许、适用条件和操作员可见 warning；该降级**不等于**已证明 rename 的 parent-directory durability；
3. manifest、record、outcome、marker 的每个 publish 边界在 native Windows 的 restart 和真实 power-loss / reboot fault test 中会留下何种可恢复状态；
4. 只有测试的 Windows 版本、文件系统、Node/Electron runtime 与 storage profile 被记录，且结果符合第 4 节状态机，才能声明该 profile 的 durability support。

在这些验证前，Windows native fsync / power-loss 是开放风险，不能被 mock 注入、Linux/macOS 测试或“文件最终存在”关闭。

## 8. 后续批准的最小输入与不关闭声明

下一切片必须先明确：目标 platform profile、manifest capability contract、完整 fault/crash matrix、允许的 public result / retry 语义、是否涉及 schema/API/lifecycle、测试层级和 operations owner。然后才可修改代码、ADR 或 todo。

本文件记录的是未解决的设计门和风险；历史 S2–S194 evidence 仅提供回归背景。**C-4P6 仍保持待办，本文不构成 close-out。**

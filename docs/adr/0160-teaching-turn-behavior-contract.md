# ADR-0160：教学行为合同（Turn Shape 检查、Kernel 版本化与 Mastery Policy 治理）

- **状态：** Proposed（设计草案,未实施 — 2026-07-26）
- **日期：** 2026-07-26
- **范围：** teaching_turn 模式下对模型输出的确定性后置 Turn Shape 检查与软纠偏；`teach/SKILL.md` 内核版本化与本地教学回归命令；evaluator 掌握判据（Mastery Policy）的 ADR 化治理。**不**引入任何输出阻断、durable 写者或 CI 真实 API key 消耗。
- **关联：** [teaching-chain-evaluation-and-optimization.md](../teaching-chain-evaluation-and-optimization.md)（§3.2 G7、§4 O5）；[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)；[ADR-0012](0012-deterministic-next-teaching-step-planner.md)；[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)；[ADR-0044](0044-teaching-prompt-cache-contract.md)；[ADR-0077](0077-teaching-turn-review-candidates.md)；[ADR-0093](0093-teaching-doctor-multi-collector-facts.md)（本地诊断落点）；[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)（kernel fail-closed / 反 shadow）；[ADR-0157](0157-learning-outcome-strength-and-consolidation.md)；`AGENTS.md` 产品地板（PR 默认 CI 不烧真实 API key）

## 1. 问题

仓库里"学习事实"的治理密度是世界级的,"教学行为"的治理密度接近于零（评估文档 G7）：kernel 的 ADR 只治理**加载完整性**（verify、fail-closed、反 shadow）,不治理**教学内容**;"多少证据足以 `established`"这一教学核心策略藏在 evaluator 实现细节里,无 ADR;模型是否遵循"每轮只教一个点、必须 Elicit"无任何检验。kernel 一改,教学风格全变,没有 golden/回归能发现——教学法文本质量不低,但没有机制保证它发生。

## 2. 决策

### 2.1 Turn Shape 检查：确定性后置检查,纯函数

teaching_turn 模式下,对模型最终输出做轻量结构检查,输出 typed `TurnShapeReport { violations[], fingerprint }`：

| 规则 | 检查内容 |
| --- | --- |
| exactly-one-elicit | 是否以**恰一个**面向学习者的 Elicit（提问/小任务）收尾 |
| length-budget | 单轮长度预算（字符/段落上限,预算值实施时定值） |
| single-topic | 是否一次抛出多主题（标题/列表密度启发式） |

检查是纯函数、零 LLM、零 I/O;规则本身进 kernel 合同测试并带**豁免语义**（如学习者明确要求长讲解、对比多例的场景）,防启发式僵化误伤（评估文档 §7 风险表）。

### 2.2 违规不阻断：复用 iteration recovery 软纠偏

- 违规**不阻断、不改写**模型输出;复用既有 recovery 模式注入一条纠偏指令再给一轮机会,与 `generate_lesson` 的 iterationLimitRecovery **同构**;纠偏至多一次,仍违规则放行。
- 每次违规/纠偏记入**本地诊断**（doctor facts collector 挂接,ADR-0093;聚合指标进 ADR-0162 的 Elicit 率）,不写 ledger、不产生 Evidence。

### 2.3 Mastery Policy ADR 化

"什么算 `established`、strength 如何升级（ADR-0157）、各题型权重、GradingCandidate 加权上限（ADR-0158）"统一为一份**版本化 Mastery Policy**：判据变更 = 修订 ADR + `evaluatorVersion` 递增 + 迁移说明,利用 evaluator/committer 已有的版本追溯钩子。判据从此不再是 evaluator 实现的私有细节。

### 2.4 Kernel 版本化与本地教学回归

- `teach/SKILL.md` 增加**版本号 + changelog**;verify/fail-closed/反 shadow 加载语义不变（ADR-0151）。
- 建立**本地教学回归命令**：固定一组合成学习者脚本（答对/犹豫/误解/跑题）,跑完检查 Turn Shape 合规率与结算路径完整性,kernel/prompt 改动前后对比。**不进默认 CI、不烧真实 API key**（守仓库既有红线）;报告脱敏后可进 Doctor / support bundle。kernel 改动须过合同测试方可合入。

## 3. 非目标 / 红线

1. 检查与回归是**投影/诊断**：不写任何 durable 事实,settlement sole-writer 不变、不新增第二写者;TurnShapeReport 不是 Evidence、不是 outcome、不参与 evidence-gated 结算（ADR-0011/0018/0023）。
2. **不阻断**教学轮：只软纠偏,不因合规检查让学习者面对失败轮次;不引入输出重写器。
3. planner 纯函数与 kernel fail-closed/反 shadow 边界不变（ADR-0012/0151）;不把完整 kernel 正文迁入 stable prefix（ADR-0044）。
4. 本地优先：回归与诊断全部本地,无默认远程 telemetry;不触碰同意门控记忆;不引入 FTS / 向量库。
5. 不在本 ADR 内定值预算数字与启发式阈值——那属于实施切片与合同测试。
6. **本 ADR 为设计草案：检查器、版本化、回归命令均无实现代码,不宣称已实施。**

## 4. 验证入口（实施时兑现；当前无代码）

本 ADR 合入不改变任何生产行为。实施切片须至少落地：

- `TurnShapeReport` 纯函数单测：三规则的命中/豁免/边界;同输入同 fingerprint。
- recovery 单测：违规注入恰一次纠偏指令;二次违规放行且记诊断;与 iterationLimitRecovery 共享模式不回归。
- kernel 合同测试：改动 `teach/SKILL.md` 未更新版本号/changelog 时检查失败。
- 本地回归命令：合成脚本跑通并输出前后对比报告;默认 CI 中该命令不执行。

## 5. 一句话

**"怎么教"获得与"学习事实"同级的治理：teaching_turn 输出过确定性 Turn Shape 检查（恰一个 Elicit 收尾、长度预算、单主题启发式）,违规软纠偏不阻断并记本地诊断;kernel 版本化 + 本地教学回归（不进默认 CI、不烧 key）,掌握判据升格为版本化 Mastery Policy ADR。**

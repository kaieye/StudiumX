# ADR-0151：Teaching Kernel 与 Skill 编排权威边界

- **状态：** **已实施**（2026-07-27；Phase 0–6 closeout）
- **日期：** 2026-07-24；2026-07-27 完成修订
- **范围：** `teach` app-shipped Teaching Kernel、Teaching Authority Plane / Skill Capability Plane、host-owned registry、纯 planner、stage-scoped runtime、预算与评估边界
- **关联：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADR-0156](0156-skill-orchestration-conversation-continuity.md)、[ADR-0163](0163-teaching-capability-selection-and-plan-preview.md)

## 1. 决策：双平面

| 平面 | 职责 | 明确不负责 |
| --- | --- | --- |
| **Teaching Authority Plane** | `LearningSessionLedger`、typed Evidence、Outcome settlement、`NextTeachingStepPlanner`、budgeted Teaching Context、`TeachingTurnCoordinator` / host | 不把 skill 正文、planner plan、diagnostics 或 agent run 当 canonical teaching truth |
| **Skill Capability Plane** | Teaching Kernel 方法原则、workflow router、artifact producer/enhancer/verifier/packager 的能力提示与可解释阶段计划 | 不写 ledger、不提交 outcome、不伪造 Evidence、不执行工具、不成为第二 settlement writer |

所有跨平面事实必须是 host allow-list 投影。planner、continuity state、preview 与 diagnostics 都是可重建/可丢弃投影，不能反向成为教学权威。

## 2. `teach` 是预留 Teaching Kernel

- `teach` 是唯一 `kernel` role，始终由 app-shipped builtin roots 加载并经 `verifySkillPack` 验证。
- Kernel 加载不要求 personal install；personal 同 id 不得 shadow runtime kernel。
- 空 roots、缺失、损坏或空正文均永久 fail-closed；没有 `failClosed` 可选开关。
- teaching conversation、`teaching_turn` 与 `artifact_workflow` 缺少 Kernel 时返回用户可见 `Teaching Kernel unavailable`，provider 不执行。
- `/teach` 可保留为 UX 入口，但 `teach` 不占用户普通多选槽位。

## 3. Host registry 与纯 planner

`SkillOrchestrationPlanner.plan(...)` 是零 I/O 的确定性纯函数。输入为：

- selected skill IDs；
- mode、objective digest/context identity；
- host-owned role/stage/dependency/readiness；
- allow-listed authority echoes（next-step/resource/evidence-status/artifact type token）；
- prior continuity projection；
- soft `budgetConstrained` signal。

输出包含 stage、decision status、reason、diagnostics、authority echo 和 deterministic plan id。依赖在同 stage 中始终先于 dependent；cycle 使用确定性 fallback。Host registry 是信任权威，skill Markdown 治理块仅为文档；manifest schema v2 未在本 ADR 中获批。

Decision status：`active_now`、`scheduled_later`、`advisory_only`、`excluded`、`blocked`。Mode：`instant_help`、`teaching_turn`、`artifact_workflow`。

## 4. Stage-scoped runtime 与 prompt-cache

- 每轮仅加载 current-stage `active_now` skill bodies，加上必需 Kernel；later/advisory/blocked/excluded 和后续 stage 正文不进入 prompt。
- 当前阶段所需正文缺失时 fail-closed，不执行部分策略。
- 完整、经验证的 Teaching Kernel 位于 stable system prefix；只有当前阶段非 kernel 正文位于 dynamic turn-tail。
- Kernel stable body 预算 `18_000` 字符；dynamic skill bodies 总预算 `24_000` 字符、单体上限 `14_000`，确定性公平截断。
- 具体 prefix identity 与 cache invalidation 以修订后的 [ADR-0044](0044-teaching-prompt-cache-contract.md) 为准。

## 5. Continuity、gate 与预算

- 对话级 continuity 使用 [ADR-0156](0156-skill-orchestration-conversation-continuity.md) 的 bounded local projection；损坏/缺失 fail-soft，不能替代 ledger。
- stage gate 只消费 allow-listed canonical artifact type facts；verifier 成功、模型自述或取消不得制造完成 stage。
- `deriveSkillOrchestrationBudgetPressure` 只能从当前 provider context pressure、已选能力数和局部工作量推导 soft planner signal，只延后 enhancer/variant/packager；不得读取或推导累计 run token 配额。
- soft pressure 不改变 settlement、effect 或 approval；正常运行没有 `AgentRunBudget` 的累计 duration/provider/tool/token 终止配额，具体工具仍可各自执行超时和输出截断。

## 6. Evidence 与 settlement 红线

以下均不成立：

- generated quiz/rubric/lesson = learner Evidence；
- verifier success = learner mastery/outcome；
- tool/MCP success = teaching settlement；
- plan preview/current stage = canonical LearningSession state。

只有 canonical learner interaction 经 typed Evidence 边界、`expectedRevision` 和 `TeachingTurnCoordinator` / host sole-writer 路径才能到达 outcome settlement。Fork 继续保持 `toolsReplayed:false`。

## 7. Phase 0–6 closeout

| Phase | 结果 |
| --- | --- |
| 0 | 术语、双平面、trust lifecycle 与 ADR 已统一 |
| 1 | app-shipped reserved `teach`、验证加载、永久 fail-closed |
| 2 | host registry + deterministic pure planner |
| 3 | current-stage-only body load、Kernel stable prefix、dynamic stage tail、全局字符预算 |
| 4 | 由 ADR-0163 交付多选 chip、preset、preview 与严格 IPC |
| 5 | 15 个 builtin skill 治理头与模板 skill 职责收敛 |
| 6 | 本地 counts-only diagnostics、gate/prompt/teaching completeness 聚合、同意式 support-bundle export、无 phone-home |

Manifest schema v2 是明确的后续提案，不属于本 closeout；若实施必须另开 ADR，并保持 host registry 的 trust authority。

## 8. 实现与验证入口

- `src/main/skill-library/core-teaching-kernel.ts`
- `src/main/builtin-skill-orchestration-policy.ts`
- `src/main/skill-orchestration-{planner,host,state-store,diagnostics-store}.ts`
- `src/main/teaching-conversation-{runtime,prompt}.ts`
- `src/shared/teaching-types/skill-orchestration.ts`
- `tests/unit/core-teaching-kernel.unit.test.ts`
- `tests/unit/skill-orchestration-*.unit.test.ts`
- `tests/unit/teaching-{conversation-runtime,prompt-cache,skill-orchestration-prompt}.unit.test.ts`

```bash
pnpm run check:skill-library
pnpm run check:teaching-evidence
pnpm run check:blocking-ci
pnpm test:unit
```

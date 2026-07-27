# ADR-0156：Skill 编排跨轮续航——durable 会话编排状态与 priorState 规划输入

- **状态：** **已实施（核心）**（2026-07-26）：durable 状态存储、确定性 gate 判定、planner priorState 输入、runtime 接线、bridge 真实 artifact 事实;多选 chip / 计划预览 UI 仍属 [ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) Phase 4 residual
- **日期：** 2026-07-26
- **范围：** 解决 0151 Phase 3 后的核心缺口:**计划是单轮快照,而编排对象（教学、产物工作流）是多轮过程**——`scheduled_later` 永不兑现、stage 不跨轮、gate 不判定、authority bridge 喂占位事实使 producer/预算分支休眠。
- **关联：** [ADR-0151](0151-teaching-kernel-and-skill-orchestration.md);[ADR-0044](0044-teaching-prompt-cache-contract.md)(投影仍走 turn-tail);[ADR-0154](0154-spaced-review-scheduler-and-review-due-planner-action.md)(bridge review 事实同批接线)
- **实现落点：** `src/shared/teaching-types/skill-orchestration.ts`（`ConversationOrchestrationState`、`SkillOrchestrationPriorState`、stage `status`、plan `currentStageId`）;`src/main/skill-orchestration-planner.ts`（priorState 消费;**附带修复 artifact token 被 id 归一化小写化导致 accepts/produces 永不匹配的休眠 bug**）;`src/main/skill-orchestration-host.ts`（`evaluateSkillOrchestrationStageGates` / `advanceConversationOrchestrationState` / `priorStateFromConversationOrchestrationState`）;`src/main/skill-orchestration-state-store.ts`（`.agent-sessions/skill-orchestration/<conversationId>.json`,原子替换,严格 normalize,损坏→null）;`src/main/skill-orchestration-artifact-facts.ts`（registry scope → workspace 文件的只读 artifact 事实派生,受限 glob、深度/条目上限、拒绝 symlink）;`src/main/skill-orchestration-authority-bridge.ts`（真实 mission/resource/artifact/review 事实,替换占位 seed）;`src/main/teaching-conversation-runtime.ts`+`teaching-workspace.ts`（load→plan(priorState)→gate→advance→save,全程 fail-soft）;`src/main/teaching-conversation-prompt.ts`（turn-tail 投影 currentStage/status/consumes/produces/gates）;测试 `tests/unit/skill-orchestration-continuity.unit.test.ts`

## 1. 决策

### 1.1 planner 保持纯函数;「时间」作为输入进来

- `plan(...)` 新增**可选** `priorState`（allow-listed 投影:planId、planRevision、stageCursor、completedStageKinds、artifactFacts）。同 canonical 事实 + 同 priorState + 同选择 → 同 plan;planId 把 priorState 纳入身份输入。
- 续航语义(确定性规则):`artifact_authoring` 已完成 → enhancer/verifier 由 `scheduled_later` 变为 `active_now`;packager/variant 在「所需 artifact 全部可得 + authoring 已完成」时 `active_now`。**「稍后」从口头承诺变成机制。**
- **无 priorState 时 plan 逐字节不变**(stage `status` / `currentStageId` 只在续航时出现);malformed priorState 直接忽略(fail-soft 回单轮语义)。

### 1.2 gate 判定是确定性代码,不是模型自觉

`evaluateSkillOrchestrationStageGates`:仅从 allow-listed artifact 事实可导出的 gate 允许通过——`artifact-lead-writer`(stage produces ⊆ 工作区 artifact 事实)、`canonical-stable`(consumes ⊆ 事实);`verify-reports` 与一切不可导出的 gate 诚实地 `passed: false` + `checkedFact: not_derivable_from_artifact_facts_v1`。**永不推断 verifier 结果,永不把任何 gate 通过当 learner Evidence。**

### 1.3 durable 状态 = 可重建工作流投影

- 每会话一份 JSON(stage 游标 + gate 检查 + artifact token),**不复制 ledger/Evidence 事实,不是第二状态机**;删除/损坏仅降级为单轮规划;完成态单调(plan 形状不变时不回退);planId 变化 → planRevision 递增。
- 读写全 fail-soft:load 失败 → 无 priorState;save 失败永不影响教学轮。

### 1.4 真实事实替换占位 seed(bridge)

mission nextGoal 由 MISSION.md 有界读推导(available/absent);资源 readiness 由 RESOURCES.md 列表项计数推导;`availableArtifacts` 由 registry artifactScopes 与真实工作区文件匹配推导;due-review 计数见 ADR-0154。全部 fail-soft、有界、拒绝 symlink,**只有枚举/计数/token 进入 plan,正文永不进入**。

## 2. 非目标 / 红线

1. planner 纯函数、零 I/O、零 settlement 权威不变;编排状态永不成为结算输入;Evidence 不等式全套保持([ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) §4)。
2. prompt-cache 合同不变:全部新投影走 turn-tail,stable prefix 无一字节变化(ADR-0044)。
3. 不实施多选 chip、计划预览 UI、用户显式「推进阶段」命令(0151 Phase 4 residual;TeachingCommand 封闭 union 不在本 ADR 扩展)。
4. artifact 事实派生是只读扫描,有界(深度/条目/尺寸),不引入 watcher、索引库或 FTS。
5. 工具执行边界不变:`scheduled_later → active_now` 只改变 SKILL.md 正文装配,一切写入仍走 effect lattice 与三态审批。

## 3. 验证入口

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/skill-orchestration-continuity.unit.test.ts tests/unit/skill-orchestration-planner.unit.test.ts tests/unit/skill-orchestration-host.unit.test.ts tests/unit/teaching-skill-orchestration-prompt.unit.test.ts
```

## 4. 一句话

**编排获得了「时间」:上一轮的完成事实作为 allow-listed 输入回到纯 planner,gate 由代码判定、状态可重建可丢弃——多 skill 从「单轮拼接」变成「跨轮续航」,而权威边界一寸未动。**

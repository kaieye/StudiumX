# ADR-0164：统一正式教学链路与 Skill 准入 / 产品面

- **状态：** **已实施**（2026-07-27）
- **范围：** 正式教学 authority、Teaching Kernel cardinality、host-owned Skill admission、primary strategy / workflow-router cardinality，以及 Capability Library 产品面
- **关联：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0156](0156-skill-orchestration-conversation-continuity.md)、[ADR-0163](0163-teaching-capability-selection-and-plan-preview.md)
- **限定：** 本 ADR 限定 ADR-0163 §§1、3 的普通选择面语义；其中的 preview、严格 IPC、无障碍与不静默丢弃选择等保障继续有效。

## 1. 背景

将 catalog 中的所有 Skill 直接当作可自由组合的正式教学模块，会让教学策略、learner-state 判断、效果归因和用户预期分裂，并错误暗示“安装更多 Skill 就会教得更好”。现有 builtin capability pack、personal root、stage-then-swap、host registry、planner 和 preview 都应保留；需要收紧的是**正式教学准入与产品心智**，而不是删除 Skill 基础设施。

## 2. 决策：一条正式教学权威链路

所有正式 teaching turn 统一遵循同一条 authoritative lifecycle：

```text
User intent
  → canonical Mission / learner / Session facts
  → Ground → Diagnose → one authoritative next teaching action
  → Teach → Elicit observable learner performance
  → typed Evidence boundary → Evaluate / Adapt
  → TeachingTurnCoordinator / host settlement
  → Next Step / Review
```

Teaching Authority Plane 保持 Mission、learner facts、Session、NextTeachingStep、Evidence、Outcome 与 Review 的唯一权威。Skill Capability Plane 只能为阶段提供受治理的能力；它不能维护 canonical learner state、提交 Outcome、制造 learner Evidence、绕过 `expectedRevision`、成为 settlement writer，或取得工具/effect/approval 权限。

ADR-0008、ADR-0023、ADR-0044、ADR-0151 与 ADR-0156 的 ledger、sole-writer、prompt-cache、双平面和 continuity 投影边界不变。

## 3. Teaching Kernel：exactly one

`teach` 是唯一 kernel：app-shipped、经验证、由 host 注入、始终启用且不占普通选择槽位。personal 同 ID 不得 shadow；kernel 缺失或损坏 fail-closed。它提供教学原则，但**不是** Evidence、Outcome 或 settlement writer。

## 4. Host-owned admission 与角色基数

正式教学选择面必须消费 main/shared 公开的 host eligibility projection；renderer 不得复制 registry 或从 manifest、source、catalog 自行推断 teaching authority。planner 仍是最终、纯函数且 fail-closed 的准入裁判。

- 每一个 teaching stage 最多一个 `primary_teaching_strategy`；多个候选按已通过的产品硬边界与 mode 过滤后，依 authoritative next-step affinity、显式选择、host priority、stable skill ID 进行确定性裁决。被排除者必须保留稳定 reason 与 diagnostic。
- 每个 artifact workflow 最多一个 `workflow_router`；artifact producer 的每 stage / artifact scope lead-writer 规则保持不变。
- verifier 可保留多个 `parallel_readonly` 候选；enhancer、variant producer 与 packager 不因 primary-strategy 排他而被错误全局单选。
- personal/custom/unregistered Skill 默认没有正式 teaching-authority slot。它们最多在明确的高级说明面出现，且不得成为 Kernel、primary strategy 或 settlement writer。

这些字段由 host policy 持有；**本 ADR 不升级 `skill-pack.json` manifest schema**，Skill Markdown 也不能自我提权。

## 5. 产品面

StudiumX 是拥有统一教学内核与统一教学权威链路的个人 AI 教师，**不是**让用户拼装多个 AI 教学 Prompt 的开放 Skill 市场。

- 普通 teaching composer 以 host-owned intent presets 与可解释 plan preview 为主。
- raw capability / slash 是受 host eligibility 限制的高级入口；IPC 的 8 项上限仅是防御性输入 ceiling，不是推荐的教学组合模型。
- Resource 产品面命名为 Capability Library / 教学能力库或 Teaching Tools；当前实现是 bundled capability library 加 personal-file projection，不是远程第三方 marketplace。
- personal folder 保留，并明确“可管理个人文件”不等于“自动获正式教学 authority”。
- artifact workflow 可继续显示更细的 consumes / produces / gates pipeline；其完成永远不自动等于 learner outcome 完成。

## 6. 不变量与非目标

本决策不改变 effect lattice、三态 approval、工具预算、`expectedRevision`、`toolsReplayed:false`、stable-prefix 规则、无默认 remote telemetry / phone-home，或 TeachingTurnCoordinator/host 的 settlement sole-writer 身份。generated artifact、rubric、quiz、lesson 与 verifier report 不会因 admission 而提升为 learner Evidence。

本 ADR 不做：manifest schema v2、远程第三方 Skill marketplace、教学效果算法、第二 learner/mastery authority、TeachingTurnCoordinator / AgentRun / LearningSessionLedger 重写，或把 `teach` 合并成巨型 router。

## 7. 验收

- 普通教学选择面与 host planner 的 formal admission 一致；unknown ID 在 planner 中仍 fail-closed。
- Kernel exactly one 且不作为普通 chip；current-stage prompt 仍只加载 active bodies 与 Kernel。
- 同一输入、canonical facts 和 continuity projection 得到稳定 plan；每个 teaching stage 至多一个 active primary strategy。
- artifact lead-writer conflict 与多 verifier `parallel_readonly` 行为不回归。
- preview、diagnostics 和 continuity 仍是可重建投影，不成为 canonical teaching truth。

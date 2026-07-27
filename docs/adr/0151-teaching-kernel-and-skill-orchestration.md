# ADR-0151：Teaching Kernel 与 Skill 编排权威边界

- **状态：** **已实施**（2026-07-27）：Phase 0–3 完成；**Phase 4–5 已由 [ADR-0163](0163-teaching-capability-selection-and-plan-preview.md) 收尾**（多选 chip + 计划预览 + preset、skill 正文治理与三个模板化 skill 重写、本地 plan 诊断）。manifest schema v2（Phase B）仍延期，须另开 ADR。
- **日期：** 2026-07-24
- **范围：** 将 `teach` 固定为 app-shipped **Teaching Kernel** 标识；划分 **Teaching Authority Plane** 与 **Skill Capability Plane**；约定 `SkillOrchestrationPlanner` 为纯 `plan(...)`（Phase 2 已交付 planner + host registry；runtime wire residual）。**不**改 settlement sole-writer、ledger 权威、effect lattice 或 prompt-cache 合同全文。
- **关联：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)–[ADR-0013](0013-budgeted-provenance-aware-teaching-context.md)；[ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md)–[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)；[ADR-0044](0044-teaching-prompt-cache-contract.md)；[ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)；[ADR-0150](0150-skills-install-stage-then-swap.md)；`Agents.md` 产品地板
- **实现落点（Phase 2）：** `src/shared/teaching-types/skill-orchestration.ts`；`src/main/builtin-skill-orchestration-policy.ts`；`src/main/skill-orchestration-planner.ts`（纯 `plan(...)`）；`tests/unit/skill-orchestration-planner.unit.test.ts`。**不**写 settlement/Evidence；Phase 3 runtime wire 已交付（见 §3.1）。
- **实现落点（Phase 1）：** `src/main/skill-library/core-teaching-kernel.ts`；`SkillLibraryService.readCoreTeachingKernel` / 引用加载路径；`teaching-conversation-runtime` teaching 模式 kernel 缺席 fail-closed；`tests/unit/core-teaching-kernel.unit.test.ts`；`scripts/fixtures/skill-library.ts`；`scripts/check-skill-library.mjs`

## 1. 问题

1. 教学模式把 `'teach'` 并入 skill id 列表，但 `readInstalledSkillReferences` / `readInvokedSkillReferences` 仅从 **personal root 且 `installed === true`** 读正文 → 未安装时 **静默缺席** Teaching Kernel。
2. personal 同 id 包可覆盖 catalog 的 `installedPath`，存在用个人副本 **静默 shadow** 内置教学内核的风险。
3. 多 skill 产品化需要统一术语与权威边界，避免把 Markdown skill 误升为 settlement / Evidence 写者。

## 2. 决策：双平面

| 平面 | 职责 | 不负责 |
| --- | --- | --- |
| **Teaching Authority Plane** | `LearningSessionLedger`、typed Evidence、Outcome settlement、`NextTeachingStepPlanner`、budgeted Teaching Context、`TeachingTurnCoordinator` / host | 不把 skill 正文当 canonical 过程真相 |
| **Skill Capability Plane** | Teaching Kernel 原则、workflow router、artifact producer、enhancer、verifier、packager 等 **能力提示与工作流文案** | 不写 ledger、不提交 outcome、不伪造 Evidence、不执行工具、不另建 settlement writer |

### 2.1 `teach` = 预留 Teaching Kernel ID

- **`teach` 是 app-shipped Teaching Kernel 的预留核心 ID**，不是 settlement writer，不是 LearningSession 权威。
- 正式教学 turn **必须**从 **内置、经 `verifySkillPack` 校验的 builtin root** 加载 kernel 正文；**不要求** personal install。
- personal 可安装同 id 副本（库 UX / slash 安装路径），但 **教学 runtime 的 kernel 路径始终以 core/builtin 为准**，禁止 personal 静默覆盖 kernel 正文。
- `/teach` slash 仍可作为 UX 入口；kernel 加载 **独立于** personal root 拷贝。
- `teach` **不是**普通多选槽位上的“又一个可选 skill”；教学模式始终以 kernel 角色注入（多选 UI 属后续 Phase）。

### 2.2 SkillOrchestrationPlanner（Phase 2 已实施）

- **纯函数式 `plan(...)` 模块**：输入用户选择 + readiness + role + dependencies + stage + budget 边界；输出可解释的 `SkillOrchestrationPlan`。
- **禁止：** 写 LearningSessionLedger；创建/提交 outcome；把 verifier 结果升级为 learner Evidence；直接执行工具；绕过 Coordinator 或第二 settlement writer。
- **Host-owned registry 为信任权威**；skill 自声明 hints **不是** trust authority（Phase B manifest 细化属 residual）。

### 2.3 Skill 角色（Capability Plane）

| Role | 含义（摘要） |
| --- | --- |
| `kernel` | 唯一教学原则基底（仅 `teach`） |
| `teaching_strategy` | 教学策略增强 |
| `workflow_router` | 多阶段产物流水线路由（如 teaching-site） |
| `artifact_producer` | 产出工作区产物 |
| `cross_cutting_enhancer` | 横切增强 |
| `verifier` | 校验 / audit（非 learning Evidence） |
| `variant_producer` | 变体产物 |
| `packager` | 打包 / 发布 |

### 2.4 决策状态与运行模式

**Decision status：** `active_now` | `scheduled_later` | `advisory_only` | `excluded` | `blocked`

**Modes：** `instant_help` | `teaching_turn` | `artifact_workflow`

### 2.5 Prompt-cache 与 ADR-0044 residual

- **完整 Teaching Kernel 正文目前仍在 turn-tail（既有 skill-reference 槽）装配。**
- **禁止**在未修订 [ADR-0044](0044-teaching-prompt-cache-contract.md) 的前提下，把 **完整** kernel 正文迁入会话 **stable system prefix**。
- Phase 1 允许：从 app-shipped source 加载 kernel，并填入 **现有** turn-tail / skill-reference 槽。
- 可选后续：stable prefix **仅**可含 kernel **摘要/索引**，不得塞入全文（须另开或修订 0044）。

## 3. Phase 1 行为（已实施）

1. **`loadCoreTeachingKernelReference` / `SkillLibraryService.readCoreTeachingKernel`**：在 `builtInRoots` 上 resolve + `verifySkillPack`，返回 `InstalledSkillReference` 形状；**不**读 personal。
2. **引用加载：** 请求 id `teach` 时走 core 路径，忽略 personal `installedPath` 正文。
3. **Fail-closed：** builtin 缺失/损坏 → 抛结构化 `Error`（可见诊断），**不**返回空成功冒充已加载。
4. **教学 turn：** `teaching-conversation-runtime` 在教学模式下若最终 skill 引用中无 kernel，返回明确错误（二次门闩）。
5. 安装 / stage-then-swap（[ADR-0150](0150-skills-install-stage-then-swap.md)）不变；allowlist + verifier 仍是包信任门。

## 3.1 Phase 3 行为（已实施）

1. **`teaching-conversation-runtime`：** 在 mode/settings 已知后、`loadSkillReferences` 之前调用纯 `plan(...)`。
2. **Stage-scoped bodies：** 仅 `active_now` 决策（教学模式始终含 app-shipped `teach` kernel）进入全文注入与 `read_skill_resource` 引用集；`scheduled_later` / `excluded` / `blocked` / 非激活的 `advisory_only` **不**无条件拼接全文。
3. **ADR-0044 解释（不变全文进 prefix）：** stable system prefix 仍只含 skill **index**；Teaching Kernel **全文**保留在 turn-tail `<teach-skill-reference>`。"kernel in stable teaching prefix" 解释为：**kernel 原则可用性 / index 身份**在教学模式下保证加载，**不是**把完整 SKILL.md 迁入 system prefix。
4. **Turn-tail projection：** `<skill-orchestration-plan>` 仅含 planId、mode、kernel profile、decision status/reason、stage 摘要；无 secret、无 skill 正文。Router 文案明确：不执行未安装子 skill。
5. **Settlement：** planner **零** settlement 权威；Evidence / outcome 仍仅 Coordinator/host sole-writer。

实现落点：`teaching-conversation-runtime.ts`、`teaching-conversation-prompt.ts`；测试：`tests/unit/teaching-skill-orchestration-prompt.unit.test.ts`、`tests/unit/skill-orchestration-planner.unit.test.ts`（Evidence inequality）、`tests/unit/teaching-prompt-cache.unit.test.ts`。

## 4. 非目标 / 红线（对齐方案 §5.3 与 §13.1）

1. **不**改变 `LearningSessionLedger` 为 canonical 教学过程。
2. **不**改变 `TeachingTurnCoordinator` / host 为 settlement sole-writer；IPC 保留 `expectedRevision`；fork 保持 `toolsReplayed: false`。
3. Skill **不可**直接写 outcome 或伪造 Evidence；Lesson / rubric / verifier / MCP 输出 **不**自动视为 learning outcome。
4. 工具仍走 effect lattice、三态审批、`ToolOutcome`；**禁止**默认 shell、YOLO、always-approve、默认远程 telemetry。
5. Run budget 仍为硬预算。
6. **不**交付本 ADR 内的完整 multi-select UI、skill markdown 全量改写；Phase 2 已交付纯 planner + host registry（非 UI）。
7. **不**把完整 teach 正文迁入 stable prefix（见 §2.5）。

## 5. Residual（Phase 3–5）

### 5.0 Host alignment（2026-07-24 追加，仍属 Phase 3 收口）

- skill-orchestration-host.ts：artifact 选型在教学会话中解析为 rtifact_workflow（不再死锁 	eaching_turn）。
- listSkillCatalog + uildSkillOrchestrationReadinessFromCatalog：按 catalog installed 生成 readiness（fail-closed）；缺 catalog 时 builtin 仍可 stage，body load 硬失败。
- 可选 skillOrchestrationFacts：
extStepAction / vailableArtifacts / udgetConstrained（allow-listed）喂给纯 plan(...)；**无** settlement 写权。
- stage body：仅 ctive_now + kernel（含 kernel dvisory_only）；非 kernel dvisory_only 不再装全文。
- **Authority bridge（续）：** skill-orchestration-authority-bridge.ts 在教学 workspace chat 上 fail-soft 加载 loop snapshot 的 nextStep/resource/evidence 枚举；写入 plan.authorityEcho 与 turn-tail 投影；**不**写 settlement。
- **Slash multi-id：** leadingSkillIdSequence + mergeSelectedSkillIds 在 plan 前合并 explicit skillIds 与连续 leading slash（Phase 4 UI residual 仍在）。


## 6. 验证入口

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/core-teaching-kernel.unit.test.ts tests/unit/skill-pack-resolver.unit.test.ts tests/unit/skill-orchestration-planner.unit.test.ts
pnpm run check:skill-library
```

## 7. 一句话

**教学权威在 host 模块平面；`teach` 是 app-shipped、可校验的 Teaching Kernel，不是 settlement 写者；编排 planner 只 plan 不写；kernel 加载 fail-closed 且不被 personal 静默覆盖。**

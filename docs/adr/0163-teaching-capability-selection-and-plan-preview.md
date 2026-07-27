# ADR-0163：教学能力选择面与编排计划预览（0151 Phase 4–6 收尾）

- **状态：** **已实施**（2026-07-27）：只读 preview IPC + host-owned preset 目录 + 多选 chip 与计划预览 UI + 内置 skill 治理头 + 本地 plan 诊断。**不**改 settlement sole-writer、ledger 权威、planner 纯度、effect lattice 或 ADR-0044 stable prefix。
- **日期：** 2026-07-27
- **范围：** 把 [ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) 的 Phase 4（多选 UI + 计划解释）、Phase 5（skill 内容治理）、Phase 6（本地评估）从 residual 收尾为产品面。用户选择从「连续 leading slash」升级为**显式能力多选 + 可解释计划预览**；内置 skill 正文获得与 host registry 对齐的治理头；plan 诊断落为**本地、可脱敏**事实。
- **关联：** [ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)（Kernel / 编排权威边界）；[ADR-0156](0156-skill-orchestration-conversation-continuity.md)（跨轮续航状态）；[ADR-0044](0044-teaching-prompt-cache-contract.md)（prefix 不变）；[ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md)（只读 readiness）；[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)（sole-writer）；[ADR-0150](0150-skills-install-stage-then-swap.md)（安装信任门）；[ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0034](0034-redacted-support-bundle.md)（本地诊断与脱敏）
- **实现落点：** `src/shared/teaching-types/skill-orchestration.ts`（preview 请求/结果、preset、诊断投影类型）；`src/shared/skill-orchestration-presets.ts`（host-owned 意图 preset 目录）；`src/shared/teaching-types/system-api.ts` + `src/shared/teaching-ipc-contract.ts` + `src/main/teaching-ipc-commands.ts` + `src/main/teaching-ipc-gateway.ts` + `src/preload/index.ts`（只读 `previewSkillOrchestration`）；`src/main/skill-orchestration-preview.ts`（复用 host 装配的纯只读 preview）；`src/renderer/src/skills/SkillCapabilityPicker.tsx`（chip + preset + 计划预览）；`resources/builtin-skills/*/SKILL.md`（治理头 + 三个 skill 重写）；测试见 §6

## 1. 问题

[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) Phase 0–3 与 [ADR-0156](0156-skill-orchestration-conversation-continuity.md) 已经交付了确定性 planner、host-owned registry、stage-scoped prompt 装配与跨轮续航。但**编排对用户不可见、不可选、不可解释**：

1. **选择面缺失。** `skillIds` 只能由**连续 leading slash** 推导（`SkillSlashMenu.tsx` 的 `pick()` 直接**整体替换**输入值），产品上等于「一次只能选一个 skill」。planner 支持多选，UI 不支持。
2. **决策不可见。** planner 为每个 skill 产出 `active_now` / `scheduled_later` / `advisory_only` / `excluded` / `blocked` + reason，但这些只进 turn-tail prompt，**用户从未看到**。方案文档 §7.1「不得静默忽略」在产品面尚未兑现。
3. **心智负担。** 15 个内置 skill 的 role/stage/依赖是技术概念；普通学习者不应为了开始学习而理解它们。
4. **skill 正文与 registry 漂移。** `course-designer` / `learning-assessor` / `teaching-resource-generator` 的后 1/3 是**通用软件工程模板**（版本兼容性、依赖冲突、N+1 查询、部署上线），与教学职责无关；且没有任何内置 skill 在正文里声明自己的 role、产物范围与**非职责**，读者无法判断边界。
5. **改动无反馈。** plan 质量（stage 是否选对、用户是否频繁 override、skill 是否因冲突被排除）没有任何本地可观测事实。

## 2. 决策

### 2.1 用户选择 = 能力意图，不是 prompt 拼接

- composer 增加**显式能力多选面**（chip）。选择表达的是「本次任务可以使用这些能力」，**不是**「把这些 skill 全文同时注入并要求同轮全部执行」。
- **`teach` 永不占用多选槽位。** 教学模式下 kernel 以「教学内核已启用」的**不可移除**状态呈现（[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) §2.1）。
- **slash 入口保持向后兼容。** `/skill-id` 仍可用，并与 chip 选择经既有 `mergeSelectedSkillIds` 合并去重；两条路径产出同一份 `selectedSkillIds`。
- 选择上限沿用既有 IPC 校验（去重后 **≤ 8**），超限在 UI 侧先行阻止并解释，不静默截断。

### 2.2 只读 preview 命令：预览**永不**推进状态

新增 IPC `previewSkillOrchestration`。它复用与教学轮**完全相同**的 host 装配（`resolveHostSkillOrchestrationMode` → `buildSkillOrchestrationReadinessFromCatalog` → `buildSkillOrchestrationPlanInput` → 纯 `plan(...)`），因此**同 canonical 事实 + 同选择 → 预览与实际执行同一份 plan**。

**红线（本 ADR 的核心约束）：**

1. preview **只读** `ConversationOrchestrationState`，**绝不**调用 `advanceConversationOrchestrationState`，**绝不**写回状态文件。预览一个计划不得让 stage 游标前进——否则 UI 打开预览就会污染 [ADR-0156](0156-skill-orchestration-conversation-continuity.md) 的续航语义。
2. preview 不写 ledger、不创建/提交 outcome、不产生 Evidence、不执行任何工具、不加载 skill 正文。
3. preview 失败一律 fail-soft 降级为「无预览」，**永不**阻断或改变教学轮。
4. preview 不是第二个 planner：它不复制排序/冲突/预算逻辑，只调用同一个纯 `plan(...)`。

### 2.3 host-owned preset 目录

产品级意图 preset（教我掌握一个主题 / 测测我学会没有 / 生成一节课或练习 / 制作完整课程网站 / 审核课程产物 / 发布电子书）由**应用维护的 shared 常量**定义，映射到内置 skill id 集合。

- preset 是**选择便利**，不是权威：展开后仍然全量走 planner，planner 对依赖、冲突、readiness 与不适用情况保有**最终安全裁决**。
- preset **不可**由 personal / custom skill 自声明扩展（与 [ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) §2.2「host registry 为信任权威」一致）。
- preset 只引用**已注册的内置 skill id**；编译期完整性由 registry 校验兜底。

### 2.4 决策透明：每个选择都有可见结果与原因

- 计划预览按 **现在 / 稍后 / 参考 / 未启用 / 已阻止** 五档展示 planner 的 `decisions`，每条附 reason。**不得静默忽略任何一个用户选择。**
- **自动补齐的依赖必须显式标注**为「自动加入的前置能力」，而不是伪装成用户自己的选择。
- `blocked` 必须给出下一步（例如「先执行 Course Outline Design → Course Content Authoring」），而不是只报错（方案文档 §9.3）。
- 预览是**解释**，不是审批：它不引入新的用户可授予权限，一切写入仍走 effect lattice 与三态审批。

### 2.5 内置 skill 治理头（Phase 5）

每个内置 `SKILL.md` 在正文起始处携带一个**治理块**，声明：角色、输入、输出、产物范围、完成条件、**非职责**。

- **治理块是文档，不是信任权威。** host `builtin-skill-orchestration-policy.ts` 仍是唯一 authority；正文与 registry 冲突时**以 registry 为准**，正文视为文档缺陷修正，**不**因此授予任何权限（[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) §2.2）。
- 三个模板化 skill（`course-designer`、`learning-assessor`、`teaching-resource-generator`）删除与教学无关的通用软件模板段（技术栈、框架版本、依赖冲突、N+1 查询、部署上线），并按方案文档 §11 收窄职责：
  - `course-designer` → 兼容路由（无结构 → outline design；已有 outline 需讲义 → content authoring；仅问原则 → advisory）。
  - `learning-assessor` → 拆清 **Assessment Authoring / Elicitation Strategy / Evidence Interpretation Hint** 三职责，并写明红线：**rubric 不是 Evidence；模型生成的参考答案不是 learner response；无证据时只能说「未知 / 待验证」**。
  - `teaching-resource-generator` → 收窄为资源 producer；不自行判定 mastery；不与 `course-content-authoring` 同时写同一文件。
- **不**升级 `skill-pack.json` schema：治理信息写在 Markdown 正文，manifest 保持 strict v1。manifest schema v2（方案文档 §7.5 Phase B）**仍延期**，须另开 ADR。

### 2.6 本地 plan 诊断（Phase 6）

plan 诊断落为**本地、可脱敏、封闭 allow-list** 的事实：planId、mode、各 decision status 计数、diagnostic code 与 severity、stage kind 序列、preset id。

- **禁止**进入诊断：objective 正文、skill 正文、工作区文件内容、路径、secret、任何 learner Evidence。
- **无默认远程 telemetry / phone-home**（AGENTS.md §1 产品地板、红线 4）。
- 诊断**不是**结算输入，不回写 canonical 事实，丢失只损失可观测性。

## 3. 非目标 / 红线

1. **planner 保持纯函数**：零 I/O、零写入、零 settlement 权威；preview 不给它增加任何副作用能力。
2. **settlement sole-writer 不变**：`TeachingTurnCoordinator` / host 仍是 outcome 唯一写入路径；IPC 保留 `expectedRevision`；fork 保持 `toolsReplayed: false`。
3. **Evidence 不等式全套保持**（[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md) §4）：生成 Lesson / rubric / quiz、verifier 通过、MCP 或 tool 返回成功、**计划预览本身**，都不是 learner outcome。
4. **prompt-cache 合同不变**（[ADR-0044](0044-teaching-prompt-cache-contract.md)）：本 ADR 不新增任何 stable prefix 字节；preview 完全不参与 prompt 装配。
5. **不**扩展 `TeachingCommand` 封闭 union（教学 slash 命令目录不变）；能力选择走 chip，不走新的技术型 slash 命令。
6. **不**实施 manifest schema v2、不允许 custom skill 自声明编排 hint 提权。
7. 工具执行边界不变：chip 选择只改变 SKILL.md 正文装配，一切写入仍走 effect lattice 与三态审批。

## 4. 用户可见行为

```text
教学内核：Teach（始终启用）
已选能力：Learning Assessor · Teaching Resource Generator

现在：   Teach + Learning Assessor（诊断并提问）
稍后：   Teaching Resource Generator（根据薄弱点生成练习）
已阻止： Course Ebook Publishing — 缺少稳定的 CourseContent
         建议先执行：Course Outline Design → Course Content Authoring
```

普通用户可只用 preset 开始学习，无需理解 15 个 skill 的 role 与 stage；高级用户仍可手动多选，planner 保留最终安全裁决并解释原因。

## 5. 兼容性

- 既有 `/skill-id` 单选与连续 leading slash 行为**逐字节不变**；未做任何选择时，plan 与本 ADR 之前完全一致。
- 未打开预览时不产生任何额外 IPC 调用与文件读写。
- `previewSkillOrchestration` 是新增 capability，旧 renderer 不调用即不受影响。

## 6. 验证入口

```bash
pnpm typecheck
pnpm run check:security
pnpm run check:teaching-ipc-contract
pnpm run check:skill-library
pnpm run check:teaching-evidence
pnpm run check:blocking-ci
pnpm test:unit -- tests/unit/skill-orchestration-preview.unit.test.ts \
  tests/unit/skill-orchestration-presets.unit.test.ts \
  tests/unit/skill-orchestration-planner.unit.test.ts \
  tests/unit/skill-orchestration-continuity.unit.test.ts \
  tests/unit/skill-orchestration-host.unit.test.ts
```

关键回归断言：预览**不**写编排状态文件；preset 只引用已注册内置 id；每个 selected skill 都出现在 decisions 中；诊断投影不含 objective 正文。

## 7. 一句话

**用户选择从「连续斜杠」变成「能力多选 + 可解释计划」，skill 正文获得与 host registry 对齐的角色与非职责声明，plan 质量第一次有了本地可观测事实——而 planner 的纯度、settlement 的唯一写入权和 prompt-cache 合同一寸未动。**

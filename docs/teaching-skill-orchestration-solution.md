# StudiumX 教学链路与多 Skill 编排解决方案

> 状态：已实施 / Closeout（2026-07-27）  
> 日期：2026-07-24  
> 范围：StudiumX 内置教学 skill 的定位、教学闭环，以及用户选择多个 skill 时的编排方式  
> 说明：本文不是 ADR。涉及教学 authority、prompt-cache、skill manifest、IPC 或 settlement 的实现变更，以 [ADR-0044](adr/0044-teaching-prompt-cache-contract.md)、[ADR-0151](adr/0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0156](adr/0156-skill-orchestration-conversation-continuity.md) 与 [ADR-0163](adr/0163-teaching-capability-selection-and-plan-preview.md) 为准，并已链接到 [`docs/adr/README.md`](adr/README.md)。

---

## 1. 结论先行

StudiumX 不应该在“直接以 `teach` 作为整个教学系统”与“完全抛开 `teach` 另做一套链路”之间二选一。推荐采用**双层基底**：

1. **不可替换的领域基底**：由现有 `LearningSessionLedger`、typed Evidence、Outcome settlement、`NextTeachingStepPlanner`、Teaching Context、`TeachingTurnCoordinator` 等模块组成，负责状态、证据、预算、权限、恢复和最终写入权威。
2. **可演进的教学法基底**：以 [`resources/builtin-skills/teach`](../resources/builtin-skills/teach/SKILL.md) 为起点，提炼为 StudiumX 的 **Teaching Kernel（教学内核）**，负责教学原则、默认教学循环、反馈方式与教学产物规范。

因此，`teach` 的正确定位是：

> **`teach` 是教学法策略核和交互教师入口，不是教学状态机、证据系统或 outcome 写入者。**

对于多 skill，推荐结论是：

> **用户选择的是能力意图，不是要求系统把所有 skill 的全文同时拼进 prompt。**  
> 系统应先生成一个 typed、确定性、可解释的 `SkillOrchestrationPlan`，再按阶段只激活当前需要的 skill。

同时必须区分两类容易混淆的链路：

- **学习者教学闭环**：教、问、观察、适配、记录证据、结算结果；由 `teach` + 教学领域模块承载。
- **课程产物生产流水线**：大纲、内容、网页、交互、视觉、企业版、电子书；由 [`teaching-site`](../resources/builtin-skills/teaching-site/SKILL.md) 及其阶段 skill 承载。

二者可以协作，但不能互相替代。生成了一套精美课件，不等于学习者已经学会；设计了 rubric，也不等于产生了真实 Evidence。

---

## 2. StudiumX 的产品目标与设计原则

根据 [`MISSION.md`](../MISSION.md) 与现有 ADR，StudiumX 的核心不是“让模型多生成一些教学内容”，而是建立一个可信、可恢复、可解释的个人 AI 教师系统：

- 以用户工作区文件作为教学真相源；
- 围绕明确的 Mission、Course、Session 和 learner state 工作；
- 根据学习者实际表现调整下一步，而不是只按内容目录向前播放；
- 把“模型说完成了”与“系统有证据证明学习结果”严格分开；
- 所有工具调用继续经过 effect lattice、审批和 `ToolOutcome`；
- 保持本地优先，不依赖默认远程 telemetry；
- 保持 `TeachingTurnCoordinator` / host 的 settlement sole-writer 地位。

这意味着 skill 体系必须服务于教学领域模型，而不是反过来让教学领域模型服从若干 Markdown prompt。

---

## 3. 当前实现的关键事实

> **Closeout 注记：** 本节保留的是 2026-07-24 制定方案时的原始基线，用于解释为何需要后续路线图；其中关于 Kernel 生命周期、跨轮 continuity、全局正文预算、多选/预览 UI、治理元数据与本地评估的缺口，已由下文 Phase 0–6 实现取代。当前事实以 §18 的实现证据和对应 ADR 为准。

### 3.1 `teach` 已具备较好的教学法骨架

当前 [`teach/SKILL.md`](../resources/builtin-skills/teach/SKILL.md) 已包含适合作为 Teaching Kernel 起点的内容：

- Mission grounding；
- ZPD（最近发展区）与针对当前水平的适配；
- retrieval practice、spacing、interleaving 等学习原则；
- `Locate → Teach → Elicit → Adapt → Record` 的个性化教师循环；
- Lesson、reference、resources、assets、learning record 等文件产物约定；
- 强调依据学习者实际表现记录，而不是依据“覆盖了哪些内容”记录。

这些内容解决的是“教师应该如何教”的问题，但没有也不应该单独解决以下问题：

- 哪个 Session 是 canonical；
- Evidence 的 identity、类型和 provenance；
- outcome 是否允许提交；
- `expectedRevision`、幂等、崩溃恢复和并发；
- 工具 effect、审批和预算；
- fork 是否重放工具；
- 谁拥有 durable settlement 的最终写入权。

这些都已经属于 StudiumX 的领域架构，不能下放给一个可编辑的 skill 文档。

### 3.2 `teaching-site` 是“课程产品生产路由”，不是实时教师闭环

[`teaching-site/SKILL.md`](../resources/builtin-skills/teaching-site/SKILL.md) 已经定义了较完整的产物流水线：

```text
outline
  → content authoring
  → static SPA conversion
  → interactions
  → visual assets
  → corporate edition / ebook publishing
```

它还定义了 Stage 1、Stage 2、图片覆盖等 gate，以及 audit、verification、design-system 等横切能力。这是现有 skill 中最接近“workflow router”的一个，值得复用其以下思想：

- 有明确 stage；
- 有前置产物；
- 有 completion gate；
- 下游依赖上游稳定产物；
- verifier 与 producer 分离；
- 不宣称路由 skill 会自动动态加载全部子 skill。

但这条链路的主要目标是生产课程网站和发布物，不负责观察真实学习者表现，也不拥有 Evidence 或 outcome authority。

### 3.3 部分通用教学 skill 质量不足，不适合直接成为系统基底

以下三个 skill 的前半部分有合理方向，但整体仍较模板化：

- [`course-designer`](../resources/builtin-skills/course-designer/SKILL.md)
- [`learning-assessor`](../resources/builtin-skills/learning-assessor/SKILL.md)
- [`teaching-resource-generator`](../resources/builtin-skills/teaching-resource-generator/SKILL.md)

它们存在几个问题：

1. 与更专门的 `course-outline-design`、`course-content-authoring`、`teach` 产物规范存在职责重叠；
2. 缺少 typed 输入/输出、依赖、阶段、产物所有权和 completion gate；
3. `learning-assessor` 没有明确区分“生成题目/rubric”与“记录真实 learner Evidence”；
4. 文档后半出现技术栈、框架版本、依赖冲突、N+1 查询、部署上线等通用模板内容，与教学 skill 的实际职责不匹配。

结论不是立即删除，而是：**先降级为待治理的兼容入口，后续重写、合并或路由到更专门的 skill。**

### 3.4 当前 runtime 已有“数组形状”，但还没有真正的多 skill 产品能力

当前实现呈现出四个重要事实：

1. 教学会话 runtime 会把 `teach` 追加到请求的 skill ID 中；
2. [`SkillLibraryService`](../src/main/skill-library.ts) 只会读取 `installed === true` 的 skill；
3. 内置 skill 在 catalog 中出现不等于已安装到 personal root，因此 `teach` 可能被追加了 ID，却在未安装时静默没有加载；
4. IPC/runtime 可接收多个 skill ID，但当前 slash command 和 picker 主要只表达一个 leading skill。

因此目前存在一个明显语义缺口：

> 系统看起来把 `teach` 当作教学会话默认能力，但它的实际可用性仍依赖普通 skill 的安装生命周期。

此外，[`teaching-conversation-prompt.ts`](../src/main/teaching-conversation-prompt.ts) 当前主要把 `teach` 与其他 skill reference 放入 context packet。它尚未表达 role、stage、依赖、冲突、产物范围、完成条件或执行顺序，所以“多个 skill”当前更接近**有序 prompt 拼接**，而不是编排。

---

## 4. 内置 skill 的建议分层

下表是基于当前 15 个内置 skill 的建议定位。这里的“保留/重写/合并”是方案建议，不代表已经实施。

| Skill | 建议角色 | 主要用途 | 处理建议 |
| --- | --- | --- | --- |
| `teach` | **Kernel / 交互教师入口** | 教学原则、个性化循环、Lesson 与学习文件规范 | 提炼为 app-shipped Teaching Kernel；不承担 settlement |
| `course-designer` | 兼容入口 / Strategy | 泛化课程设计 | 重写或路由到 `course-outline-design`；移除无关技术模板 |
| `learning-assessor` | Teaching Strategy + Verifier | 出题、rubric、形成性评估设计 | 重写；明确“评估设计 ≠ Evidence ≠ outcome” |
| `teaching-resource-generator` | Artifact Producer | 课件、练习、案例、学习指南 | 收窄到资源产物；避免与 content authoring 重复 |
| `teaching-site` | **Workflow Router** | 课程网站全流程规划与 gate | 保留；只生成/解释计划，不假装自动激活所有子 skill |
| `course-outline-design` | Artifact Producer | 课程结构、受众、目标、单元与评估形态 | 保留为 Stage 1 权威 producer |
| `course-content-authoring` | Artifact Producer | 讲义、任务、quiz、素材需求 | 保留为 Stage 2 producer |
| `static-spa-conversion` | Artifact Producer | 内容到静态 SPA | 保留；writer 默认串行执行 |
| `static-spa-interactions` | Cross-cutting Enhancer | 进度、导航、主题、RWD、quiz UX | 保留；基础 SPA 存在后才可执行 |
| `teaching-site-design-system` | Cross-cutting Authority | 视觉规则、色彩、字体和组件风格 | 保留；作为视觉约束输入，不抢占产物 writer |
| `web-visual-assets` | Artifact Producer / Enhancer | 插图、截图、QR、地图等 | 保留；遵守工具 effect 和产物路径 |
| `web-content-audit` | Verifier | 内容和跨文件引用审计 | 保留；只产出诊断，不自动等同修复完成 |
| `web-visual-verification` | Verifier | 渲染、RWD、截图验证 | 保留；验证结果不属于 learner Evidence |
| `course-corporate-edition` | Variant Producer | 企业版、压缩版、定制版 | 保留；必须消费稳定的 canonical 课程产物 |
| `course-ebook-publishing` | Packager | PDF/DOCX 发布 | 保留；只能在内容/站点稳定后运行 |

### 4.1 角色的核心区别

建议将 role 固定为少数几类，而不是每个 skill 发明自己的概念：

- **Kernel**：提供全局教学原则，只有一个；
- **Teaching Strategy**：改变 Teach/Elicit/Adapt 的方法，但不能写 outcome；
- **Workflow Router**：选择 stage 和依赖，不负责替代下游实现；
- **Artifact Producer**：拥有某类工作区产物的生成或修改；
- **Cross-cutting Enhancer**：在已有产物上增加交互、视觉或其他能力；
- **Verifier**：检查 producer 的结果，输出诊断；
- **Variant Producer / Packager**：消费稳定产物，生成派生版本。

这个分类能避免最常见的错误：让 router、producer、verifier 和 settlement writer 在同一层争夺控制权。

---

## 5. 目标架构：Teaching Authority Plane 与 Skill Capability Plane

建议把系统明确拆成两个平面。

### 5.1 Teaching Authority Plane：教学权威平面

该平面延续现有 ADR，负责不可被 skill 覆盖的事实和写入：

- Mission / Course / canonical Session；
- LearningSessionLedger；
- typed Evidence 与 provenance；
- Teaching Context 与 Resource Grounding；
- outcome evaluator / committer；
- `NextTeachingStepPlanner`；
- `TeachingTurnCoordinator` / host；
- run budget、取消、幂等、`expectedRevision`、崩溃恢复；
- effect lattice、审批与 `ToolOutcome`。

### 5.2 Skill Capability Plane：能力平面

该平面负责告诉模型“这一阶段该采用什么方法、生成什么产物、如何验收”，但没有最终教学 authority：

- Teaching Kernel；
- 用户选择的策略 skill；
- 课程产物 producer；
- workflow router；
- verifier / enhancer / packager；
- skill readiness、依赖、冲突和预算。

### 5.3 两个平面的协作方式

```text
用户请求
  │
  ▼
意图与模式识别
  ├─ 即时答疑
  ├─ 正式教学 / 练习 / 评估
  └─ 课程产物制作 / 发布
  │
  ▼
Teaching Authority Plane 读取 canonical facts
  Mission + Course + Session + Evidence + Resources + Budget
  │
  ▼
Skill Orchestration Planner（纯规划，不写入）
  用户选择 + readiness + role + dependencies + current stage
  │
  ▼
SkillOrchestrationPlan
  │
  ▼
Teaching runtime 只加载“当前 stage”所需 skill
  │
  ▼
模型响应 / 工具执行 / 工作区产物
  │
  ▼
若发生真实学习交互：记录 typed Evidence
  │
  ▼
TeachingTurnCoordinator / host 结算 outcome，并规划下一教学步
```

最合适的 seam 是：

> **在 Teaching Context / loop facts 已组装之后、prompt 构建与当前阶段执行之前，引入一个纯 `plan(...)` 模块。**

它应是一个 deep module：对调用者只暴露很小的 interface，却在内部隐藏 eligibility、依赖展开、冲突消解、stage 排序、budget 和诊断逻辑。

它绝不能：

- 写 LearningSessionLedger；
- 创建或提交 outcome；
- 把 verifier 结果升级为 learner Evidence；
- 直接执行工具；
- 绕过 Coordinator 或另建第二个 settlement writer。

---

## 6. 推荐的教学闭环

### 6.1 三种运行模式

在进入 skill 编排前，先判断当前请求属于哪种模式：

1. **Instant Help（即时答疑）**  
   给出局部解释或提示，不默认创建正式 Session，不把一次回答伪装成完整教学结果。
2. **Teaching Turn（正式教学）**  
   有 Mission/Session、明确本轮目标、Elicit、Evidence、Adapt 和 settlement。
3. **Artifact Workflow（课程产物工作流）**  
   生成大纲、讲义、网页、视觉或电子书；默认不产生 learner outcome。

这一步非常关键。当前“课程设计”“生成课件”“教我这个概念”都可能加载学习相关 skill，但三者的 authority 和完成定义完全不同。

### 6.2 正式教学的建议步骤

```text
0. 识别模式，确认是否进入正式 Teaching Turn
1. Ground Mission：明确长期目标、当前课程和约束
2. Locate：读取 canonical Session、已有 Evidence、资源 readiness
3. 确定本轮最小且可观察的学习目标
4. 生成 SkillOrchestrationPlan
5. Teach：解释、示范、引导或提供最小必要材料
6. Elicit：要求学习者回忆、解释、操作、比较或完成任务
7. Record Evidence：记录真实、typed、带 provenance 的表现
8. Settle：由 evaluator/committer + Coordinator 结算结果
9. Plan Next Step：retry / continue / clarify / wait
10. 必要时生成 Lesson、reference 或练习等 durable artifact
```

必须保持以下不等式：

```text
生成 Lesson              ≠ 学习者已掌握
生成 quiz / rubric       ≠ 已产生 Evidence
模型评价“回答不错”       ≠ durable outcome
网页 verifier 通过        ≠ learner outcome
MCP / tool 返回成功       ≠ teaching evidence
```

只有经过现有 evidence-gated settlement 路径，学习结果才允许成为 durable teaching fact。

---

## 7. 多 Skill 编排模型

### 7.1 用户选择的语义

用户勾选多个 skill 时，选择应解释为：

> “我希望本次任务可以使用这些能力。”

而不是：

> “把这些 skill 的完整指令同时注入，并要求它们同一轮全部执行。”

系统必须对每个选择给出一种结果：

- **active now**：当前 stage 使用；
- **scheduled later**：依赖满足后使用；
- **advisory only**：只作为约束或方法参考；
- **excluded**：与当前目标不相关、冲突、未安装、未就绪或超预算；
- **blocked**：缺失必要依赖或前置产物，不能安全执行。

不得静默忽略。

### 7.2 `teach` 不应占用用户的普通多选槽位

推荐把 `teach` 变成：

- app-shipped；
- 教学模式下始终可用；
- 不可被普通卸载流程移除；
- `teach` ID 保留，不允许 personal skill 静默覆盖；
- UI 显示“教学内核已启用”，但不要求用户每次勾选。

`/teach` 仍可保留为显式进入交互教师模式的命令，但其 Teaching Kernel 不再依赖复制到 personal root 后才可加载。

如果短期不做 app-core 化，最低要求也应是：创建教学 workspace 或首次进入教学模式时显式 bootstrap，并把缺失状态展示给用户；不能继续静默缺席。

### 7.3 编排规则

建议采用以下确定性规则：

1. **Kernel 始终最先应用**，但只提供教学原则，不争夺产物 writer。
2. **Router 不与全部子 skill 同时执行**；它先产出 stage plan，再激活当前 stage。
3. 同一 artifact scope 在同一 stage 只能有一个 lead producer。
4. 多个只读分析或 verifier 可以 `parallel_readonly`。
5. 任何会写工作区的 producer 默认串行，继续经过 effect lattice 和审批。
6. verifier 必须位于 producer 之后，不能用 verifier 的通过结果替代 learner Evidence。
7. enhancer 必须在基础产物存在后执行。
8. variant / packager 必须消费稳定 canonical 产物，不能反向修改 canonical source。
9. 依赖缺失时，只能自动补齐预先声明、可解释、已安装且可信的内置依赖；否则 fail-closed。
10. 冲突消解顺序固定为：
    - 产品硬边界；
    - Teaching Authority Plane 的当前 next step；
    - 用户当前目标；
    - stage 与依赖；
    - host policy priority；
    - skill 自身建议。
11. 超过 context/run budget 时，优先推迟低优先级 enhancer 和 packager，而不是削弱 Evidence、settlement 或审批。
12. 同一输入与同一 canonical facts 应生成相同计划，便于测试、重试和解释。

### 7.4 推荐的 typed plan

以下是建议形状，不代表当前代码已经存在：

```ts
type SkillOrchestrationPlan = {
  schemaVersion: 1
  planId: string
  mode: 'instant_help' | 'teaching_turn' | 'artifact_workflow'
  objective: string
  contextIdentity: string
  kernel: {
    skillId: 'teach'
    profile: 'interactive' | 'artifact'
  }
  stages: Array<{
    id: string
    kind:
      | 'ground'
      | 'diagnose'
      | 'teach'
      | 'elicit'
      | 'artifact_authoring'
      | 'enhance'
      | 'verify'
      | 'package'
    execution: 'single' | 'sequential' | 'parallel_readonly'
    skillIds: string[]
    consumes: string[]
    produces: string[]
    completionGates: Array<{
      id: string
      description: string
    }>
  }>
  decisions: Array<{
    skillId: string
    status: 'active_now' | 'scheduled_later' | 'advisory_only' | 'excluded' | 'blocked'
    reason: string
  }>
  diagnostics: Array<{
    code: string
    severity: 'info' | 'warning' | 'blocking'
    message: string
  }>
}
```

`planId` 应由 allow-listed、稳定输入确定性计算，例如：

- selected skill IDs；
- installed/readiness 状态；
- teaching context identity；
- current next-step action；
- artifact stage facts；
- planner policy version。

不要把 secret、完整资源正文或不稳定时间戳放入 identity。

### 7.5 Skill 描述元数据

当前 [`skill-pack.json` schema`](../src/shared/teaching-types/skill.ts) 是 strict v1，只描述 ID、version、资源和读取 capability。不能在不升级 schema 的情况下直接塞入新字段。

建议分两步落地：

#### Phase A：先使用 host-owned registry

先为内置 skill 建立由应用维护的 orchestration policy，例如：

```ts
{
  skillId: 'course-content-authoring',
  role: 'artifact_producer',
  stages: ['artifact_authoring'],
  requires: ['course-outline-design'],
  accepts: ['CourseOutline'],
  produces: ['CourseContent'],
  artifactScopes: ['course-package/day*/content.md'],
  teachingImpact: 'artifact_only',
  priority: 50
}
```

host-owned registry 是 authority；skill 自身文档只提供建议。

#### Phase B：通过 ADR 升级 manifest

在 schema v2 中允许 skill 声明编排 hint，例如：

```json
{
  "orchestration": {
    "role": "artifact_producer",
    "stages": ["artifact_authoring"],
    "requires": ["course-outline-design"],
    "accepts": ["CourseOutline"],
    "produces": ["CourseContent"],
    "conflictsWith": [],
    "artifactScopes": ["course-package/day*/content.md"]
  }
}
```

但 personal/custom skill 的自声明不能自动成为 trust authority。host 必须验证、限制或降级这些 hint，尤其是 effect、artifact scope 和 teaching impact。skill manifest 永远无权声明自己可以绕过审批、写 outcome 或成为 settlement writer。

---

## 8. Prompt 与上下文装配策略

多 skill 最大的风险之一是 prompt 膨胀和指令冲突。推荐按 ADR-0044 的稳定前缀原则处理：

### 8.1 Stable prefix

只放相对稳定、低变化的内容：

- StudiumX 产品硬边界；
- Teaching Kernel 的稳定原则；
- 工具合同和不可越权规则；
- 通用输出纪律。

### 8.2 Dynamic turn-tail

每轮只放当前需要的动态内容：

- canonical teaching context 的 allow-listed 投影；
- `SkillOrchestrationPlan` 当前 stage；
- 当前 stage 的 lead skill；
- 必要的 verifier/enhancer 摘要；
- 当前 objective、budget 和 completion gate。

### 8.3 Skill 内容采用按需加载

不要一次注入 8 个 skill 的全文。建议：

1. 先加载短 summary / orchestration descriptor；
2. planner 选定当前 stage；
3. 只加载当前 stage 的 `SKILL.md`；
4. skill 附加 reference/template 继续通过受控资源读取按需加载；
5. stage 完成后释放其大段上下文，只保留 typed artifact identity 和诊断摘要。

这样既能降低 prompt 冲突，也能提高 cache 稳定性和 token 利用率。

---

## 9. 用户交互方案

### 9.1 从“单 slash 命令”升级为“能力选择 + 计划预览”

保留 `/skill-id` 作为快速入口，但 composer 应增加多选 chip：

```text
教学内核：Teach（始终启用）
已选能力：Learning Assessor · Teaching Resource Generator
```

提交前或提交后立即展示简短计划：

```text
本轮：Teach + Learning Assessor（诊断并提问）
稍后：Teaching Resource Generator（根据薄弱点生成练习）
未启用：Course Ebook Publishing（当前没有稳定课程产物）
```

这比直接显示“已加载 3 个 skill”更符合用户心智，因为它解释了每个 skill 什么时候发挥作用。

### 9.2 提供少量意图 preset

建议提供以下产品级 preset，而不是让普通用户理解全部技术角色：

- **教我掌握一个主题**：`teach`；需要评估时阶段性加入 `learning-assessor`；
- **测测我学会没有**：`teach` + `learning-assessor`，结果仍走 typed Evidence；
- **生成一节课/练习**：Teaching Kernel artifact profile + outline/content/resource producer；
- **制作完整课程网站**：`teaching-site` 路由后按 stage 激活子 skill；
- **审核课程产物**：content audit 与 visual verification；
- **发布企业版/电子书**：先检查稳定产物与 gate，再执行 packager。

高级用户仍可手动选择 skill，但 planner 对依赖、冲突和不适用情况拥有最终安全裁决，并必须解释原因。

### 9.3 对自动补齐依赖保持透明

示例：用户只选择 `course-ebook-publishing`，但没有完整 outline/content/site。

系统不应静默加载所有 skill，也不应直接生成薄壳 PDF。应显示：

```text
已阻止 Ebook Publishing：缺少稳定的 CourseContent 与站点完成标记。
建议先执行：Course Outline Design → Course Content Authoring。
是否将它们加入计划？
```

对于 `teaching-site` 已定义的 hard gate，继续沿用 fail-closed 原则。原方案曾建议为非安全性 gate 增加显式 override；closeout 最终**没有**引入该 authority 路径，诊断固定为 `not_supported`。未来若需要 override，必须先新增 ADR，定义可见工作区标记、audit、IPC 与不可越过的安全边界。

---

## 10. 推荐的默认组合

| 用户目标 | 当前 active | 后续可能 active | 完成定义 |
| --- | --- | --- | --- |
| “教我理解 X” | `teach` | `learning-assessor` | 学习者产生可观察表现并完成 evidence-gated settlement |
| “针对我的薄弱点出练习” | `teach` + `learning-assessor` | `teaching-resource-generator` | 先定位薄弱点，再生成对齐练习；生成练习本身不是 outcome |
| “从零设计一套课程” | Teaching Kernel artifact profile + `course-outline-design` | `course-content-authoring` | Stage 1 gate 后再进入内容阶段 |
| “把讲义做成教学网站” | `teaching-site` router | SPA → interactions → visuals → verifiers | 以文件 gate 和 verifier 为完成条件，不产生 learner outcome |
| “把课程发布成电子书” | `teaching-site` readiness check | `course-ebook-publishing` | canonical 内容稳定、图片 floor 通过、发布物验证完成 |
| “审核现有课程网站” | `web-content-audit` + `web-visual-verification` | 对应 producer 修复后再次验证 | verifier 诊断闭环，而非学习结果闭环 |

---

## 11. 对现有通用 Skill 的治理建议

### 11.1 `course-designer`

建议逐步变为兼容路由：

- 若用户只有主题/受众、没有结构，路由到 `course-outline-design`；
- 若用户已有 outline、需要讲义，路由到 `course-content-authoring`；
- 若用户只是询问教学设计原则，可以保留 advisory mode；
- 删除技术栈、框架依赖、N+1、部署监控等无关模板内容。

### 11.2 `learning-assessor`

建议拆清三个不同职责：

1. **Assessment Authoring**：生成题目、rubric、参考答案；
2. **Elicitation Strategy**：在教学 turn 中决定如何让学习者展示理解；
3. **Evidence Interpretation Hint**：向 evaluator 提供 rubric，但不直接写 Evidence 或 outcome。

尤其应加入明确红线：

- rubric 是评估工具，不是 Evidence；
- 模型生成的参考答案不是 learner response；
- 学习报告必须引用 canonical Session/Evidence；
- 没有证据时只能说“未知/待验证”，不能推断“已掌握”。

### 11.3 `teaching-resource-generator`

建议收窄为资源 producer，并明确输入/输出：

- 输入：LearningObjective、LearnerLevel、Misconception、CourseContent 等 typed facts；
- 输出：LessonAsset、ExerciseSet、CaseStudy、StudyGuide；
- 不自行决定 learner mastery；
- 不与 `course-content-authoring` 同时写同一文件；
- 若资源是根据薄弱点生成，必须保留所依据 Evidence 的 identity/provenance 引用，但不复制敏感正文。

---

## 12. 分阶段实施路线图

### Phase 0：架构决定与术语统一（已完成）

1. 新增 ADR：Teaching Kernel 与 Skill Orchestration authority；
2. 明确 `teach` 是否为 reserved app-core ID；
3. 固定 role、stage、artifact scope、gate、diagnostic 等术语；
4. 明确 custom skill 编排 hint 的 trust lifecycle；
5. 在 ADR README 建立链接。

**完成条件**：没有任何新模块与 sole-writer、Evidence、effect lattice 或 prompt-cache ADR 冲突。

### Phase 1：修复 `teach` 的生命周期语义（已完成）

1. 教学模式从 app-shipped、经过校验的 core source 加载 Teaching Kernel；
2. 不再要求用户先把 `teach` 安装到 personal root；
3. 缺失或损坏时 fail-closed，并给出可见诊断；
4. 保留 `/teach` 作为进入教学模式的 UX；
5. 增加 core skill 不能被 personal 同名包静默覆盖的测试。

**优先级：P0。** 在多 skill UI 之前先修复，否则编排建立在一个可能静默缺席的 kernel 上。

### Phase 2：host-owned registry 与纯 planner（已完成）

建议新增模块（命名仅供参考）：

- `src/shared/teaching-types/skill-orchestration.ts`
- `src/main/builtin-skill-orchestration-policy.ts`
- `src/main/skill-orchestration-planner.ts`

planner 的外部 interface 尽量保持为一个主要方法：

```ts
plan(input: SkillOrchestrationInput): SkillOrchestrationPlan
```

内部可以有多个私有 seam，但调用方不应了解拓扑排序、冲突矩阵和 budget 分配细节。

**完成条件**：同输入确定性输出；无 I/O；无写入；无工具执行；无 settlement authority。

### Phase 3：按 stage 装配 prompt（已完成）

1. planner 接在 context/loop facts 之后、prompt 构建之前；
2. stable prefix 保留 Teaching Kernel；
3. dynamic tail 只装配当前 stage；
4. 不再无条件拼接所有 selected skill 正文；
5. 记录可脱敏的本地 plan diagnostics，便于 Doctor/support bundle 检查，但不 phone-home。

### Phase 4：多选 UI 与计划解释（已完成）

1. slash command 保持向后兼容；
2. 增加多 skill chip；
3. 明确展示 active / later / excluded / blocked；
4. 展示自动补齐的依赖；
5. 提供 preset，减少普通用户的选择负担；
6. IPC 继续校验数量、ID、revision 与 payload。

### Phase 5：Skill 内容治理（已完成）

1. 重写 `course-designer`、`learning-assessor`、`teaching-resource-generator`；
2. 对重叠 skill 建立 alias/deprecation，而不是突然删除用户入口；
3. 给所有内置 skill 增加明确 role、输入、输出、artifact scope、gate 与非职责；
4. 让 `teaching-site` 的 stage/gate 模式成为 artifact workflow 的参考实现；
5. 通过 ADR 决定是否升级 manifest schema。

### Phase 6：本地评估与渐进优化（已完成）

只做本地、可同意、可脱敏的评估：

- planner 是否选择了正确 stage；
- override 支持状态；当前明确为 `not_supported`，不记录或推断不存在的频率；
- skill 是否因冲突被排除；
- prompt budget 使用；
- 产物 gate 通过率；
- 正式教学中 Elicit/Evidence/settlement 是否完整。

不得因此引入默认远程 telemetry。

---

## 13. 验收标准

### 13.1 架构不变量

- [ ] LearningSessionLedger 仍是 canonical 教学过程；
- [ ] `TeachingTurnCoordinator` / host 仍是 settlement sole-writer；
- [ ] skill 不可直接写 outcome 或伪造 Evidence；
- [ ] Lesson、rubric、verifier、MCP/tool output 不被自动视为 learning outcome；
- [ ] IPC 保留 `expectedRevision`；
- [ ] fork 保持 `toolsReplayed:false`；
- [ ] 所有工具继续经过 effect lattice、三态审批和 `ToolOutcome`；
- [ ] run budget 仍为硬预算；
- [ ] 无默认 shell、YOLO、always-approve 或自动远程 telemetry。

### 13.2 功能标准

- [ ] 每个正式教学 turn 都能确定性获得 Teaching Kernel，不能静默缺席；
- [ ] 用户选择多个 skill 时，每个 skill 都有可见决策结果与 reason；
- [ ] 同一 canonical facts + 同一选择生成相同 plan；
- [ ] 缺少依赖或前置产物时 fail-closed；
- [ ] producer、enhancer、verifier、packager 的阶段顺序可测试；
- [ ] 当前 stage 只加载必要 skill，未把所有 skill 全文塞入 prompt；
- [ ] router 不声称已动态执行未安装的子 skill；
- [ ] custom skill 不能通过自声明提升权限或 teaching authority。

### 13.3 教学质量标准

- [ ] 正式教学 turn 包含可观察的 Elicit，而不只是长篇讲解；
- [ ] next step 基于 Evidence 和 planner，而不是基于“内容已生成”；
- [ ] assessment 题目与当前 objective 对齐；
- [ ] 资源生成能引用 learner level / misconception，而不是通用模板；
- [ ] 无 Evidence 时系统能明确表达 unknown / review required；
- [ ] 课程产物模式不会制造虚假的 learner progress。

### 13.4 UX 标准

- [ ] 普通用户不需要理解 15 个 skill 才能开始学习；
- [ ] preset 能覆盖主要教学意图；
- [ ] 多选后能看到“现在做什么、以后做什么、为什么不做”；
- [ ] 自动补齐依赖必须透明；
- [ ] 阻断信息给出明确下一步，而不是只报错。

---

## 14. 测试建议

落地时至少覆盖：

1. **Planner unit tests**
   - role/stage 排序；
   - 依赖展开；
   - 冲突消解；
   - 同 artifact scope 双 writer；
   - read-only verifier 并行；
   - budget 降级；
   - 确定性 plan identity。
2. **Skill lifecycle tests**
   - `teach` 未安装到 personal root 仍可在教学模式加载；
   - core skill 损坏时显式失败；
   - personal 同名 skill 不能覆盖 reserved core。
3. **Prompt contract tests**
   - kernel 位于稳定前缀；
   - current plan 位于动态 tail；
   - 未选中/未激活 skill 正文不进入 prompt；
   - secret 和非 allow-listed 数据不进入 plan identity。
4. **Teaching evidence tests**
   - quiz authoring 不产生 Evidence；
   - verifier success 不产生 outcome；
   - 只有 canonical learner interaction 才能进入 settlement。
5. **IPC/UI tests**
   - 多选去重与数量上限；
   - active/later/excluded/blocked 展示；
   - revision mismatch；
   - retry/duplicate 的计划一致性。

根据仓库门禁，触达实现时至少考虑运行：

```bash
pnpm typecheck
pnpm run check:security
pnpm run check:tool-contract
pnpm run check:teaching-evidence
pnpm run check:teaching-ipc-contract
pnpm run check:blocking-ci
pnpm test:unit
```

涉及 prompt prefix/cache 形状时，还应执行 ADR-0044 对应检查；涉及架构 authority 时必须先更新 ADR。

---

## 15. 主要风险与缓解

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| 把 `teach` 做成巨型万能 router | prompt 越来越长，职责与 authority 混杂 | 提炼稳定 Kernel；workflow 由纯 planner 负责 |
| 多 skill 指令冲突 | 同时要求不同输出格式或修改同一文件 | role、stage、单 lead writer、冲突诊断 |
| 课程产物与学习结果混淆 | “课件完成”被记录为“学会” | 保持 artifact workflow 与 Evidence settlement 分离 |
| 自动编排不可解释 | 用户选择被静默忽略 | 每个 skill 输出 status + reason |
| custom skill 伪造权限 | manifest 宣称可写 outcome/跳过审批 | host-owned policy 为 authority；自声明只作 hint |
| gate 过严导致体验僵硬 | 用户无法做 demo 或快速试验 | 当前保持 fail-closed 并给出可恢复说明；不伪造 override。未来若引入，须用独立 ADR 固定 authority 与 audit marker |
| prompt/context 膨胀 | token 浪费、cache 失效、模型注意力稀释 | descriptor-first、stage-only、resource on demand |
| 新 planner 成为第二状态机 | 与 Coordinator、ledger 状态不一致 | planner 保持纯函数，只消费 canonical facts、返回 plan |

---

## 16. 最终建议

### 对问题一：教学链路以哪个 skill 为基底？

**以 `teach` 的教学法为基底，但不能以 `teach` Markdown 作为整个教学系统。**

推荐把 `teach` 提炼为 app-shipped Teaching Kernel，同时继续以现有 Teaching Authority Plane 作为真正的教学链路基底。`teaching-site` 则作为课程产物工作流的 router，不应升级为实时教学 authority。

### 对问题二：用户选择多个 skill 时如何编排？

**不要同时拼接和执行。**

先把用户选择转换成一个确定性 `SkillOrchestrationPlan`，按 Kernel → Strategy/Producer → Enhancer → Verifier → Packager 的 stage 执行；当前阶段只加载必要 skill；所有选择都给出 active、later、excluded 或 blocked 的可解释结果。

### 推荐的近期优先级

以下 1–6 已于 2026-07-27 完成；第 7 项未被静默扩 scope，而是明确延期到独立 ADR：

1. [x] **P0：修复 `teach` 可能因未安装而静默缺席的问题；**
2. [x] **P0：通过 ADR 固定 Teaching Kernel 与 Skill Orchestrator 的 authority 边界；**
3. [x] **P1：增加 host-owned skill taxonomy/registry 与纯 planner；**
4. [x] **P1：prompt 改为按 stage 装配，而非多 skill 全量拼接；**
5. [x] **P2：上线多选 chip、plan preview 和 preset；**
6. [x] **P2：重写三个模板化通用教学 skill；**
7. [ ] **P3：在独立 ADR 后评估 manifest schema v2（明确延期，不属于本 closeout）。**

这条路线可以最大程度复用 StudiumX 已有的 teaching foundation，同时把 skill 从“若干独立提示词”升级为“受领域权威约束、可组合、可解释的教学能力模块”。

---

## 17. 关键参考

### 产品与架构

- [`MISSION.md`](../MISSION.md)
- [ADR-0008：LearningSessionLedger as canonical teaching process](adr/0008-learning-session-ledger-as-canonical-teaching-process.md)
- [ADR-0009：Typed lesson interaction evidence](adr/0009-typed-lesson-interaction-evidence.md)
- [ADR-0010：Evidence-gated learning-record cutover](adr/0010-evidence-gated-learning-record-cutover.md)
- [ADR-0011：Evidence-gated learning outcome settlement](adr/0011-evidence-gated-learning-outcome-settlement.md)
- [ADR-0012：Deterministic next teaching step planner](adr/0012-deterministic-next-teaching-step-planner.md)
- [ADR-0013：Budgeted provenance-aware teaching context](adr/0013-budgeted-provenance-aware-teaching-context.md)
- [ADR-0022：Teaching capability catalog read-only readiness](adr/0022-teaching-capability-catalog-read-only-readiness.md)
- [ADR-0023：TeachingTurnCoordinator host and blocking CI](adr/0023-teaching-turn-coordinator-host-and-blocking-ci.md)
- [ADR-0044：Teaching prompt cache contract](adr/0044-teaching-prompt-cache-contract.md)
- [ADR-0046：Teaching footprint ladder](adr/0046-teaching-footprint-ladder.md)
- [ADR-0047：Agent runtime wire and turn orchestrator](adr/0047-agent-runtime-wire-and-turn-orchestrator.md)

### Skill 与 runtime

- [`teach/SKILL.md`](../resources/builtin-skills/teach/SKILL.md)
- [`teaching-site/SKILL.md`](../resources/builtin-skills/teaching-site/SKILL.md)
- [`course-outline-design/SKILL.md`](../resources/builtin-skills/course-outline-design/SKILL.md)
- [`course-designer/SKILL.md`](../resources/builtin-skills/course-designer/SKILL.md)
- [`learning-assessor/SKILL.md`](../resources/builtin-skills/learning-assessor/SKILL.md)
- [`teaching-resource-generator/SKILL.md`](../resources/builtin-skills/teaching-resource-generator/SKILL.md)
- [`skill-library.ts`](../src/main/skill-library.ts)
- [`skill.ts`](../src/shared/teaching-types/skill.ts)
- [`skill-command.ts`](../src/shared/skill-command.ts)
- [`SkillSlashMenu.tsx`](../src/renderer/src/skills/SkillSlashMenu.tsx)
- [`teaching-conversation-runtime.ts`](../src/main/teaching-conversation-runtime.ts)
- [`teaching-conversation-prompt.ts`](../src/main/teaching-conversation-prompt.ts)
- [`teaching-turn-coordinator.ts`](../src/main/teaching-turn-coordinator.ts)

---

## 18. 实施 Closeout（2026-07-27）

### 18.1 Phase 0–6 实现矩阵

| Phase | 状态 | 实现证据 |
| --- | --- | --- |
| 0：架构与术语 | **完成** | ADR-0151 固定双平面、Kernel、planner 与 authority 边界；ADR-0044 固定 prompt-cache 例外；ADR-0156 固定 continuity；ADR-0163 固定选择面、preview 与本地评估；均已进入 ADR 索引。 |
| 1：Kernel 生命周期 | **完成** | `core-teaching-kernel.ts` 只从 app-shipped builtin roots 加载并验证 reserved `teach`；personal 同名包不能 shadow；缺失、损坏、空 roots 永久 fail-closed，teaching/artifact runtime 均给出可见错误且不调用 provider。 |
| 2：registry 与 planner | **完成** | host-owned builtin policy、shared typed contract 与纯 planner 已落地；planner 无 I/O、无工具、无 settlement authority；依赖、冲突、stage、budget defer、cycle fallback 与 plan identity 有 unit regression。 |
| 3：stage prompt | **完成** | runtime 只加载 current-stage `active_now` 正文；经验证 Kernel 是 stable-prefix 唯一全文例外；非 kernel 正文只进 dynamic tail；Kernel/dynamic 全局字符预算分别为 18,000/24,000，单体上限 14,000，并使用确定性公平截断。 |
| 4：多选与解释 | **完成** | 两个 composer 路径均提供 capability chips、host-owned presets、plan preview、active/later/advisory/blocked/excluded 分组、依赖解释和无障碍 dialog/live-region；IPC 严格验证数量、ID、revision 与 duplicate stream。 |
| 5：内容治理 | **完成** | 15 个 builtin `SKILL.md` 均声明 role、stage、consumes、produces、artifact scope、dependency、completion gate 与 non-responsibilities；host policy 仍是信任权威。`course-designer`、`learning-assessor`、`teaching-resource-generator` 的职责边界已收敛。manifest schema v2 **明确延期**，须另立 ADR，不能由 Markdown 自声明提权。 |
| 6：本地评估 | **完成** | executable plan 在 gate 与正文验证后记录 bounded、strict-normalized、counts-only diagnostics；聚合覆盖 stage、冲突、prompt budget、gate 和 teaching completeness；support bundle 仅在显式同意且 section allow-list 命中时导出。无自动上传或默认远程 telemetry。当前无 canonical gate override，因此状态固定为 `not_supported`，不会伪造 override event/frequency。 |

### 18.2 §13.1 架构不变量验收

- [x] `LearningSessionLedger` 仍是 canonical 教学过程；orchestration state、preview 与 diagnostics 都是可重建/可丢弃投影。
- [x] `TeachingTurnCoordinator` / host 仍是 settlement sole-writer；planner、skill、preview、diagnostics 与 support export 均无 outcome commit 入口。
- [x] skill 不可直接写 outcome 或伪造 Evidence；题目/rubric authoring、verifier success、MCP/tool output 不自动成为 learner Evidence 或 learning outcome。
- [x] IPC 保留 `expectedRevision`；retry/duplicate 仍按 gateway/coordinator 契约处理。
- [x] fork 保持 `toolsReplayed:false`；本次实现未增加 tool-history replay 路径。
- [x] 所有工具仍经过 effect lattice、三态审批和 `ToolOutcome`；capability selection 只改变 prompt 能力，不授予工具权限。
- [x] `AgentRunBudget` 仍是硬多轴预算；orchestration 的 `budgetConstrained` 只是保守规划压力，不修改 checkpoint 或 fallback 语义。
- [x] 未增加默认 shell、YOLO/always-approve 标签、自动 memory、默认远程 telemetry 或 phone-home。

### 18.3 §13.2 功能验收

- [x] 正式 teaching/artifact turn 都确定性加载 verified Kernel；缺失时可见 fail-closed，不能退化为普通聊天。
- [x] 每个用户选择都有 status 与 reason；host-added dependency 与用户选择分开投影。
- [x] 同一 canonical input 生成相同 plan；dependency ordering、cycle fallback 与 plan identity 有确定性测试。
- [x] 未知 skill、缺失依赖、未通过 artifact gate 与缺失 current-stage body 均 fail-closed。
- [x] producer、enhancer、verifier、packager 的 stage/dependency 顺序可测试，跨轮 continuity 只在 gate 通过后推进。
- [x] prompt 只装配 Kernel 与 current-stage active bodies；later/advisory/blocked/excluded 不进入正文。
- [x] router 不声称动态执行未安装子 skill；planner 本身不执行工具或子工作流。
- [x] custom/Markdown metadata 只是 hint/documentation，不能提升权限、effect 或 teaching authority。

### 18.4 §13.3 教学质量验收

- [x] Kernel 与 orchestration plan 保留 Elicit 要求；Phase 6 记录 `elicitStagePresent` completeness，而不是把长篇讲解误报为完成。
- [x] next-step 只回显 canonical authority/planner action 与 evidence status，不从“内容已生成”推导 mastery。
- [x] assessment/resource builtin governance 要求 objective、learner level 或 misconception 对齐；rubric、答案与资源本身不构成 Evidence。
- [x] 无 Evidence 时 authority echo 保持 unknown/review-required 语义；skill 不能自行升级为 established outcome。
- [x] artifact workflow 与 learner teaching settlement 分离；课程产物完成不会制造 learner progress。

上述编排层验收不代表整个教学产品已完成对话 Evidence producer、Reader learner action、objective mastery graph 或 teaching-site canonical handoff；这些独立缺口继续由各自 ADR/路线图追踪，不能用本 closeout 虚假关闭。

### 18.5 §13.4 UX 验收

- [x] 默认入口与 intent preset 让普通用户无需理解全部 builtin skill。
- [x] preset 覆盖主要教学/产物意图，且用户可透明切换或清除。
- [x] preview 展示“现在、以后、只建议、阻断、排除”及原因。
- [x] 自动补齐依赖单独标识，不伪装成用户选择。
- [x] blocked/excluded reason 与 preview unavailable 都给出可恢复说明；选择器具备键盘、焦点恢复与 live-region 支持。

产品当前**没有** learner-facing canonical gate override，也没有显式的跨阶段“推进/取消” learner action；阶段推进由 canonical artifact facts + deterministic gate 驱动。这两个能力没有被诊断层伪造，若未来需要，必须单独设计 authority、audit 与 IPC 契约。

### 18.6 §14 测试与门禁映射

| 建议 | 当前覆盖 |
| --- | --- |
| Planner：排序、依赖、冲突、双 writer、budget、identity | `skill-orchestration-planner.unit.test.ts`、`skill-orchestration-host.unit.test.ts` |
| Kernel lifecycle：无需 personal install、损坏 fail-closed、reserved 不可覆盖 | `core-teaching-kernel.unit.test.ts`、`teaching-conversation-runtime.unit.test.ts`、skill-library checks |
| Prompt/cache：Kernel stable、plan/stage dynamic、未激活正文排除、预算/截断 | `teaching-prompt-cache.unit.test.ts`、`teaching-skill-orchestration-prompt.unit.test.ts` |
| Continuity/gates：跨轮推进、损坏 state、current-stage body | `skill-orchestration-continuity.unit.test.ts`、runtime/host tests |
| IPC/UI：去重/上限/revision/duplicate、preview 分组与 a11y | `teaching-ipc-commands.unit.test.ts`、`teaching-ipc-gateway.unit.test.ts`、`skill-capability-picker.unit.test.tsx` |
| Phase 6：strict diagnostics、aggregate-only support、consent gate | `skill-orchestration-preview.unit.test.ts`、`support-bundle.unit.test.ts` |
| Evidence separation | `check:teaching-evidence` 以及 lesson interaction、outcome evaluator、coordinator host unit tests |
| 产品红线 | `check:security`、`check:tool-contract`、`check:teaching-ipc-contract`、`check:blocking-ci`、`check:analytics` |

最终执行结果以本次变更的测试日志与交付摘要为准。

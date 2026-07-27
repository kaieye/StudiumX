# StudiumX 教学链路评估与优化

> **当前性提示（2026-07-27）：** 本文的 As-Is 快照早于当前 `main@d308289`。其后 [ADR-0154](adr/0154-spaced-review-scheduler-and-review-due-planner-action.md)～[ADR-0156](adr/0156-skill-orchestration-conversation-continuity.md) 与对应代码已经推进 fill 题结算、间隔复习内核、真实 authority facts 和多 skill 跨轮续航；因此下文“复习完全缺失”“纯单轮编排”“所有建议均未实施”等表述只代表旧基线。当前实现状态、剩余断点与路线图请以 [《教学链路与多 Skill 编排复评》](improvements/teaching-chain-multiskill-evaluation.md) 为准。

> 状态:评估与方案建议(非 ADR)
> 日期:2026-07-26
> 范围:教学主链路(教什么 → 怎么教 → 证据 → 结算 → 下一步 → 复习)的端到端评估;多 skill 教学编排的现状与升级方案;与自习室 / Pet 动机层的连接
> 方法:基于对以下材料的完整阅读——`docs/teaching-skill-orchestration-solution.md`、ADR-0008~0018/0022/0026/0044/0045/0046/0050/0073/0077/0094/0151 及 `docs/adr/README.md` 全索引、`todolist.md`、`AGENTS.md`、`teaching-system-tech-stack.md`、`docs/study-room-improvement-plan.md`、`docs/pet-next-stage-roadmap.md`,以及 37 个教学链路核心源码文件(`teaching-conversation-runtime/prompt`、skill 编排三件套、`next-teaching-step-planner`、`learning-outcome-evaluator/committer`、lesson 流水线、`teach/SKILL.md` 内核正文等)。附录 A 列出全部依据。
> 说明:本文提出的任何 authority、settlement、prompt-cache、manifest 变更,落地前均须按仓库惯例新增或修订 ADR。

---

## 1. 总体判断

### 1.1 一句话结论

**StudiumX 已经把绝大多数 AI 学习产品做不对的事情做对了——「不说谎的学习记录」;但当前链路是一套"强骨架、好教案、断神经"的系统:教学权威平面(ledger/Evidence/settlement/planner)坚固而诚实,教学法内容(kernel/prompt)质量不低,可是权威平面对每一轮实际教学的影响趋近于零,复习调度完全缺失,产品面闭环(M5–M10)尚未接通。多 skill 编排已从"全文拼接"进化到"确定性计划门控",但仍是单轮语义,没有跨轮续航。要成为"真正帮助用户学习"的产品,下一阶段的主战场不是继续加固权威平面,而是把它接进每一轮教学决策、每一天的复习安排里。**

### 1.2 分项评估

| 维度 | 评分 | 依据(现状一句话) |
| --- | --- | --- |
| 学习事实真实性 / 架构诚实性 | ★★★★★ | evidence-gated settlement、sole-writer、fail-closed、可追溯,0008→0018 全链已实施;业内罕见 |
| 教学法内容质量(kernel + prompt) | ★★★★☆ | `teach/SKILL.md` 有 storage/fluency strength、ZPD、retrieval/spacing/interleaving、五步教师循环;lesson prompt 有微教学短链路;但全靠模型自觉执行 |
| 教学决策智能(代码层) | ★★☆☆☆ | `NextTeachingStepPlanner` 约 60 行决策树、4 个动作,其中 2 个是"等/问清楚";唯一实质教学动作是 `contrast_and_retry` 与 `continue_next_session` |
| 证据与评估 | ★★☆☆☆ | "学会" = 客观题最新一轮全对 + artifact 完整;`fill` 题生成了却不结算;对话证据有存储无结算;无保持(retention)验证 |
| 记忆与复习调度 | ★☆☆☆☆ | flashcards 生成了没人消费;Pet 侧 `lesson-review-due` 只有"满 24 小时即到期"的固定规则,不读 ledger;无间隔复习算法 |
| 个性化与诊断 | ★★☆☆☆ | learner profile = ≤6 条同意门控的自由文本;无前测/placement、无掌握度模型;ZPD 判断整体委托给 LLM |
| 多 skill 编排 | ★★★☆☆ | 纯确定性 planner + host registry + 排他/依赖/解释(0151 Phase 0–3),质量高;但 stage 不跨轮、`scheduled_later` 永不自动执行、authority bridge 喂占位事实 |
| 闭环接通度(产品面) | ★★☆☆☆ | M5–M10 未交付;planner 决策用户看不到;chat 与 coordinator 双 turn 路径并存;compact/fork/steer 未接线 |
| 动机与留存 | ★★☆☆☆ | 自习室/Pet 设计完整但激励包(SR-2xx)未做;教学深链 SR-305 排在 P2;"三个月后还在学"无故事 |
| 教学效果可度量性 | ★☆☆☆☆ | usage ledger 与 LearningSession 正交;无掌握率/遗忘率/复习命中率等本地学习分析 |

### 1.3 五个最重要的行动(按优先级)

1. **先接通,再增强(O3)**:按既定顺序交付 M5 只读快照链路,同时修复 skill-orchestration authority bridge 的占位事实(`mission.nextGoal='unknown'`、`resources.readiness='unknown'`、永不提供 `availableArtifacts`),并把 planner 决策从"一行枚举 token"升级为下一轮 prompt 的一等公民。闭环不可见,后面一切增强都无从谈起。
2. **扩大"算数的证据"面并给掌握度分级(O1)**:先让 `fill` 题结算(sidecar 加 acceptedAnswers,仍是静态文法);再给 outcome 增加 strength 维度(provisional → consolidated),"学会"必须包含一次隔日成功检索,而不是当场全对。
3. **建立间隔复习调度器(O2)**:这是当前教学链路上缺失的最大教学法模块。没有对抗遗忘的调度,"真正帮助用户学习"的承诺在第 7 天就失效。纯投影、可重建、确定性,与现有架构完全同构。
4. **编排从"单轮计划"升级为"跨轮续航"(O6/§5)**:持久化 `SkillOrchestrationPlan` + stage cursor + gate 判定,让 `scheduled_later` 成为真的"稍后",让 artifact workflow 能跨多轮推进;同时交付 0151 Phase 4 的计划预览 UI。
5. **给教学法上治理(O5)**:教学行为合同(每轮恰一个 Elicit 等可检验规则)+ evaluator 掌握判据 ADR 化 + kernel 版本化与回归测试。目前"怎么教"完全活在不受治理的 markdown 与 evaluator 实现细节里,与仓库其他部分的治理密度严重不对称。

---

## 2. 当前链路重构(As-Is)

本节是对现状的忠实重构,作为后文评估的共同事实基础。若与代码有出入,以代码为准。

### 2.1 三层全景

```text
┌─────────────────────────────────────────────────────────────────┐
│  动机层(自习室 / Pet)                                          │
│  TimerSession · FocusContract · presence · streak/badges(未做) │
│  Pet Todo/Review 通知(候选)     ←—— 与教学层仅剩术语边界,无桥 │
├─────────────────────────────────────────────────────────────────┤
│  会话与能力层(每轮实际发生教学的地方)                          │
│  teaching-conversation-runtime → plan(...) → SKILL.md 装配       │
│  → runAgentLoop(LLM)→ generate_lesson → lesson HTML + sidecar  │
│  Teaching Kernel(teach)fail-closed;15 个 builtin skill        │
├─────────────────────────────────────────────────────────────────┤
│  教学权威平面(已实施,但对上层影响极小)                        │
│  LearningSessionLedger → typed Evidence → evaluator → committer  │
│  → outcome settlement → NextTeachingStepPlanner → loop resolver  │
│  M5–M10 生产读链未接通;chat 侧只回声 nextStepAction 等几个枚举 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 教学权威平面(已实施,质量很高)

- **canonical 过程**:`LearningSessionLedger`(ADR-0008)持有 Session 身份、事件幂等、恢复;一切 UI/catalog 是可重建投影。
- **证据**:`LessonInteractionRecorder`(ADR-0009)把学习者交互记录为 typed `LessonInteraction`(带 identity + provenance);多次 attempt 保持为独立事实。
- **结算**:`LearningOutcomeEvaluator`(ADR-0016)只信任 digest 绑定的 assessment sidecar,只结算 `quiz_answered`;`LearningOutcomeCommitter`(ADR-0010/0011/0018)是唯一 durable 写者,outcome 四分类:`established | misconception_corrected | needs_practice | not_evidenced`,后两者 recordless。
- **下一步**:`NextTeachingStepPlanner`(ADR-0012)纯决策树,动作 union 仅四个:`contrast_and_retry | continue_next_session | request_goal_clarification | wait_for_resources`。
- **上下文**:`TeachingContextAssembler` + `ResourceGrounder`(ADR-0013)预算化、带 provenance、缺失显式化。
- **呈现**:`TeachingTurnPresentation`(ADR-0014)四阶段 learner 投影(确认目标 → 完成检索练习 → 讲解并形成 Lesson → 保存学习记录),封闭 `TeachingCommandKind`(`continue | retry | show_source | end_session`)。

**关键事实**:这条链在领域层全部合入且有测试,但按 `todolist.md`,M5(生产只读快照 IPC)尚未开始提交,M7(coordinator 生产 bootstrap)未做——coordinator 目前只在 fixture 中创建。也就是说,**权威平面此刻主要在"记账",还没有在产品里"发言"。**

### 2.3 会话链路的实际执行流(一次教学轮次)

`teaching-conversation-runtime.runTeachingConversationTurn` 的确定性外壳依次做:settings/provider → turn context(mode、capabilityPolicy)→ 记忆加载与直接同意短路 → 工具装配(effect policy 门控,`generate_lesson`、`read_skill_resource`、memory 工具等)→ **skill 编排(§2.4,零 LLM)** → web_search 强制启发式(中文正则)→ 画像捕获计划 → prompt 组装(stable prefix + `<teaching-context-packet>` turn-tail)→ 课程生成轮次判定(正则)与预算抬升 → **`runAgentLoop`(LLM 自由段)** → `generate_lesson` 校验与"每轮一次"节流 → lesson 流水线(JSON → Zod → 模板渲染 HTML + assessment sidecar,三段修复重试)→ 记忆收尾 → durable 持久化。

**确定性/LLM 分界**:工具可用性、skill 激活、prompt 内容、预算、强制 toolChoice、brief 校验、记忆门控全是代码;LLM 拥有对话教学内容、澄清与生成时机、LessonBrief 与课程 JSON 全部内容(也就事实上决定了 mastery 判据的题目本身)。

**教学法活在三段 prompt 文本里**:`PERSONAL_TEACHER_POLICY_PROMPT`(微教学循环:连接已有认知 → 只讲一个关键点 → 贴近目标的例子 → 让用户做一次很小的回忆/判断/解释/应用;实时调节难度;"不要把看过、听懂、课程已生成当作掌握"),lesson system prompt("激活已有知识 → 一个关键解释 → 一个示例 → 亲自尝试 → 检索练习";"练习要检验误解或迁移,不要只考原句记忆"),以及 `teach/SKILL.md` 内核(storage vs fluency strength、desirable difficulty、ZPD、Locate→Teach→Elicit→Adapt→Record、glossary/reference/learning-record 产物约定)。**这些文本质量不低,但没有任何代码验证模型是否遵循。**

### 2.4 多 skill 编排的实际形态(0151 Phase 0–3 之后)

- **定义与加载**:15 个 builtin skill 都是磁盘 `SKILL.md` 包;`teach` 恒走 builtin root 的 `readCoreTeachingKernel`,verify 失败 fail-closed,personal 不能 shadow(ADR-0151 Phase 1,已修复"静默缺席"问题)。
- **host-owned registry**:`builtin-skill-orchestration-policy.ts` 为每个 skill 声明 `role / stages / requires / accepts / produces / artifactScopes / teachingImpact / priority`,编译期完整性断言。
- **纯 planner**:`skill-orchestration-planner.ts` 零 LLM、零 I/O:模式推断(`instant_help | teaching_turn | artifact_workflow`)→ kernel 决策(教学轮恒 `active_now`)→ readiness fail-closed → 依赖自动排期(`scheduled_later`)或 `blocked` → 角色分类与预算延后 → 同 artifactScope 双 writer 排他(priority 胜出,败者 `excluded` 且给 reason)→ 固定 stage 顺序 `ground→diagnose→teach→elicit→artifact_authoring→enhance→verify→package` → 确定性 `planId`。
- **装配**:仅 `active_now`(+ kernel)的 SKILL.md 全文进入 turn-tail;`<skill-orchestration-plan>` 投影 planId/mode/decisions/stages/diagnostics/authorityEcho;stable prefix 只有 skill index(守 ADR-0044)。
- **现状的三个"但是"**:
  1. **authority bridge 喂占位事实**:`loadSkillOrchestrationAuthorityFactsForWorkspace` 的 seed 是 `mission.nextGoal='unknown'`、`resources.readiness='unknown'`、`availableCount:0`,且从不提供 `availableArtifacts / budgetConstrained / preferArtifactProfile`——planner 中对应分支(producer 的 artifact 可用性判定、预算延后)在 chat 链路上实际休眠。
  2. **无跨轮续航**:`scheduled_later` 的 skill 本轮不注入,也没有任何机制在"依赖满足后"自动激活;stage 推进依赖用户下一轮重新触发 re-plan,计划本身不持久化。`consumes/produces/completionGates` 算了但不投影进 prompt。
  3. **Phase 4–5 residual**:多选 chip、计划预览 UI、三个模板化 skill(`course-designer` / `learning-assessor` / `teaching-resource-generator`)的重写都未做。`learning-assessor/SKILL.md` 后半仍是"版本兼容性 / N+1 查询 / 部署上线"等与教学无关的模板残留。

**一句话**:编排已经从"有序 prompt 拼接"进化为"确定性计划门控的拼接"——每个选择有可解释的去留,但**计划是一次性的,教学编排还没有"时间"这个维度。**

### 2.5 产品面:闭环尚未接通

- M5–M10 全部未交付:用户在生产 App 中看不到 canonical 掌握状态、planner 下一步、grounded source;renderer 仍可能以技术状态推断展示。
- 双 turn 编排路径并存:chat 用 `teaching-conversation-runtime`,`ai/teaching-turn-orchestrator`(build→loop→finalize→review hook)在 staged 代码中无人引用,消费者(coordinator)只在 fixture;`ai/teaching-session-runtime` 的 `compact/fork/steer` 显式未接线,`checkpoint` 无依赖时会伪造成功(与文件头"callers never confuse stubs with success"自述矛盾,是全链唯一"stub 冒充成功"点)。
- 自习室与教学是两个平行世界:北极星标准⑤("从自习室一键回到 Lesson/教学对话")与 SR-305 深链都排在 P2;Pet 与学习数据的实质联动(候选 B/C)全部未决。
- 复习:lesson 生成 `-flashcards.json`(≤20 张),但无任何调度消费;Pet 的 `lesson-review-due` 是"有卡片且满 24 小时即到期"的固定阈值投影,注释自陈 "does not consult the (currently unwired) learning-session ledger"。

---

## 3. 评估

### 3.1 值得刻意保持的七项优势

1. **证据不等式是产品的灵魂,别让任何优化稀释它。**"生成 Lesson ≠ 学会;quiz/rubric ≠ Evidence;模型自述 ≠ outcome;verifier 通过 ≠ learner outcome"这组不等式贯穿 ADR、prompt 与测试。市面上绝大多数 AI 学习产品的进度是"内容播放进度",StudiumX 的进度是"证据结算进度"——这是差异化的根。
2. **确定性、可解释、可测试的规划文化。** planner 纯函数、同输入同输出、每个 skill 决策带 status+reason、planId 可复算——这套纪律让后文所有升级(复习调度、掌握度模型)都有可靠的落点范式。
3. **Kernel fail-closed 与反 shadow(0151 Phase 1)。** 教学轮次要么有经校验的内核,要么显式失败——不会"看起来在教学,实际没有教学法"。
4. **文件即真相。** lesson/records/reference 都是可迁移、可打印的长期资产,学习成果不被锁在 app 里。这与"学习是长期事业"的产品定位互洽。
5. **Prompt 纪律。** stable prefix / turn-tail 二分(0044)、预算化 context(0013)、记忆消毒(0076/0081)、每轮一次 `generate_lesson` 节流、iteration recovery 强制收敛——这些护栏是"教学行为合同"(O5)可以直接复用的机制。
6. **教学法内容本身有真材实料。** `teach/SKILL.md` 的 fluency/storage strength 区分(即 Bjork 的记忆双强度模型)、desirable difficulty、retrieval-first 的四阶段 learner 投影(检索练习排在讲解之前)、"Never trust your parametric knowledge" 的资源观——方向都对。问题从来不是"教学法文本写错了",而是"没有机制保证它发生"。
7. **治理文化本身。** 编号已至 0153 的 ADR 体系、blocking 领域门禁、"缺失命令/测试即未证明"——这是把后文任何方案真正落地的元能力。

### 3.2 核心结构性问题(按对学习效果的伤害排序)

#### G1|证据鸿沟:结算认可的证据面远小于教学法要求的证据面

**现象**:prompt 层要求学习者"回忆、判断、解释、应用",kernel 要求 Elicit "recall, choose, explain, predict, or perform";但 evaluator 只结算 `quiz_answered` 且只认 `single|multi|truefalse`——`fill` 题在 lesson schema 里被鼓励生成,却被 `unsupported_quiz_type` 一律忽略;`learner_response_recorded` / `conversation_evidence_recorded` 有完整录入与身份校验,却被 `unsupported_evidence` 全弃(**对话证据有存储、无结算路径**)。

**学习科学视角**:按 ICAP 框架,Interactive/Constructive(解释、生成、应用)活动的学习效果显著高于 Active/Passive(选择、重读);检索练习效应(testing effect)最强的形式是自由回忆与解释,而非再认。当前结算面把掌握判定压缩到了认知层次最低、最容易蒙对的"再认"层(single/truefalse 蒙对概率 25%–50%),而系统真正引导学习者做的高价值行为(解释、操作)反而对掌握状态零贡献。

**后果**:模型被激励去"多出客观题"而非"多要解释";学习者最有价值的努力不被系统看见;`established` 的含金量与产品叙事("有证据证明学习结果")不匹配。

#### G2|"学会"的定义过窄且一次性:无保持验证,无强度概念

**现象**:mastery = 该课客观题**最新一轮全对** + artifact 未篡改。当场全对即 `established`,写入 record,此后系统永远相信它。

**学习科学视角**:这恰好落进 kernel 自己警告的陷阱——fluency strength 造成的掌握幻觉。当场表现(performance)≠ 学习(learning);无间隔的成功检索对 storage strength 贡献很小;遗忘曲线意味着第 1 天的 `established` 到第 7 天很可能已不成立。successive relearning 的研究共识是:掌握需要**跨间隔的多次成功检索**。

**后果**:learning record 会系统性高估掌握;`NextTeachingStepPlanner` 基于虚高的 outcome 推 `continue_next_session`,课程越推越快、地基越走越空;学习者 30 天后回看"已掌握"清单会与自身感受冲突,损害对系统诚实性的信任——而诚实恰是本产品最大的资产。

#### G3|复习调度完全缺失:链路终点是 record,不是 retention

**现象**:整条链路到"写入 learning record"就结束了。flashcards 生成无消费;`lesson-review-due` 是 24 小时固定阈值、不读 ledger、无间隔算法;planner 动作里有 `contrast_and_retry`(即时纠错)却没有任何"到期复习"概念;spacing 只存在于 kernel 的原则文本里。

**后果**:这是"真正帮助用户学习"最大的一块缺失。没有复习调度,产品本质上是"高质量一次性课程生成器 + 诚实的记账系统";用户第 2–7 天打开 app 没有任何"今天该做什么"的教学理由,动机层(自习室/Pet)也没有教学内容可供其承载。**留存的教学法基础与产品基础在同一处塌陷。**

#### G4|权威平面对每轮教学的实际影响趋近于零(神经断了)

**现象**(三处断点):
1. M5 读链未接通——planner 决策、掌握状态、grounded source 用户不可见;
2. chat 链路上 authority bridge 喂占位事实(§2.4),对话中的 plan 只能回声 `nextStepAction=…` 等几个枚举 token,**教学历史证据并未真正参与下一轮教学内容的生成**;
3. 双 turn 路径并存:承载 review-hook 与 finalize 语义的 `teaching-turn-orchestrator`/coordinator 不在生产 chat 路径上。

**后果**:系统"知道"的(evidence、outcome、next step)与系统"说"的(每轮 LLM 输出)之间没有强连接。花大力气建立的诚实事实,既没有到达用户的眼睛(M5),也几乎没有到达模型的输入(bridge)。这也是为什么整条链路"看起来智能含量低"——不是 planner 太简单,而是 planner 的输出根本没进入教学行为。

#### G5|无学习者掌握度模型与诊断:ZPD 全靠模型脑补

**现象**:learner profile = ≤6 条同意门控的自由文本;水平证据 = learning-records 自由 markdown + ledger 里的 quiz 事件,但**没有任何结构把它们聚合成"学习者当前会什么/不会什么"**;stage 枚举里有 `diagnose`,却没有任何 skill/流程真正执行前测;CourseDefinition 只有固定有序 Session 槽位,无目标(objective)概念,掌握无从映射。

**后果**:kernel 说"用 learning-records 计算 ZPD",实际是让 LLM 在每轮 context 预算内即兴判断;跨 Session 的难度校准、跳课/补课、"已建立的能力不再从零讲解"都缺乏事实依据;个性化停留在语气与例子层面,够不到"教学内容的选择"层面。

#### G6|编排缺"时间"维度:计划是单轮的,教学与产物工作流都是多轮的

**现象**:§2.4 的三个"但是"。计划不持久化、stage 不续航、gate 不判定、`scheduled_later` 是一个永不兑现的承诺;`consumes/produces/completionGates` 计算了却不投影。对 artifact workflow(teaching-site 六阶段)意味着用户要靠自己在多轮之间"记得"推进;对 teaching turn 意味着 `learning-assessor` 这类 strategy skill 无法真正在"诊断轮 → 教学轮 → 评估轮"之间形成节奏。

**后果**:多 skill 的产品承诺(用户选择能力意图,系统分阶段兑现)只兑现了前半句。方案文档自己的判语在 Phase 3 之后依然成立:"'多个 skill'当前更接近有序 prompt 拼接,而不是编排"——现在多了排他与解释,但没有质变为"跨轮的教学编排"。

#### G7|教学法本体不受治理:kernel 内容、evaluator 阈值、turn 行为都在 ADR 视野之外

**现象**:ADR 治理了 kernel 的**加载完整性**(verify、fail-closed、反 shadow),不治理其**教学内容**;"多少证据足以 `established`"这一教学核心策略藏在 evaluator 实现里,无 ADR;模型是否遵循"每轮只教一个点、必须 Elicit"无任何检验;`learning-assessor` 等三个 skill 的模板残留(N+1 查询、部署上线)至今在产品内可激活。教学质量唯一的改进回路(0077 review candidates)刻意停在"人批候选投影",未闭环。

**后果**:仓库里"学习事实"的治理密度是世界级的,"教学行为"的治理密度接近于零。kernel 一改,教学风格全变,没有任何 golden/回归能发现;这与项目"可信、可解释"的自我定位不对称。

#### G8|动机层与教学层平行:仪式感有了,教学理由没有

**现象**:自习室(presence、合同、计时)与 Pet(通知、对话)设计完整,但与教学的连接(SR-305 深链、Pet 的 Lesson Review/Learning Progress 通知源)全部在 P2/候选;激励包(streak/badges/D-day/cheer)未实施。"今天该学什么"没有统一入口——planner 下一步(教学)、今日 Todo(Pet)、ScheduleBlock(排程)三者互不知晓。

**后果**:动机层目前激励的是"专注时长",不是"学习行为"。而 G3 的缺失使动机层即便做完激励包,也没有教学内容可推——两层各自完整、合起来不成闭环。

#### G9|教学效果不可度量:改进没有反馈回路

**现象**:usage ledger 明确与 LearningSession 正交(token/工具观测);StudyAnalyticsPage 是专注分析;没有掌握率、复习命中率、遗忘率、time-to-mastery、Elicit 率等任何本地学习效果指标;0151 Phase 6 的本地评估(planner 正确率、override 率)也未开始。

**后果**:kernel/prompt/planner 的任何改动无法回答"教学效果变好了吗";产品迭代只能凭感觉。本地优先 ≠ 不度量——本地、可脱敏、用户可见的学习分析与红线完全兼容。

### 3.3 学习者旅程走查(用一个用户把问题串起来)

设用户 7 月 26 日说"我想系统学习 SQL"。

**第 1 天(体验良好)**:mission 澄清 → 生成第一课 → 讲义美观可打印 → 做完 4 道客观题全对 → (领域层)`established` + record。当前链路对"第一次学习"的支撑是好的——这也是所有环节里唯一完整的一段。

**第 3 天(开始漏水)**:用户打开 app。没有任何入口说"你上次学了 X,今天该复习 Y / 该学 Z"——planner 的 `continue_next_session` 决策存在于领域层,但 M5 未接通,用户看不见;Pet 或许弹一个"满 24 小时"的复习提醒,但它与掌握状态无关。用户若自己开口"继续",模型能从 context packet 里的记录大致接上——**闭环的连续性此刻完全依赖用户的主动性与模型的即兴发挥。**

**第 7 天(掌握幻觉显形)**:第 1 课的 `established` 从未被复验。若用户回来做第 3 课,涉及第 1 课概念时已遗忘,模型会看到错误答案并 `contrast_and_retry`——即时纠错是好的,但系统始终不知道"这是遗忘导致的",也不会因此调整任何后续安排;record 里第 1 课依旧"已掌握"。

**第 30 天(产品叙事失效)**:用户回看 learning-records:一列"established"。自测发现忘了大半。诚实记账系统输出了一份系统性高估的成绩单——不是因为记账不诚实,而是因为**掌握本身是时间的函数,而链路里没有时间**。自习室里 ta 的专注时长曲线很漂亮,但那是另一个世界的数据。

这个走查说明:各环节单独看都有道理,串起来看,**产品对"第 2 天以后的学习者"几乎没有教学供给**。这就是优化方案的靶心。

---

## 4. 优化方案(To-Be)

设计约束:所有方案严格保持现有不变量——settlement sole-writer、evidence-gated、`expectedRevision`、effect lattice 三态审批、本地优先无默认 telemetry、planner 纯函数、文件即真相、无 FTS/向量库。每项标注不变量兼容性与建议落点。目标状态一图:

```text
                     ┌──────────── 今日学习队列(O7)────────────┐
                     │  到期复习(O2) + planner 下一步 + 任务    │
                     └──────┬──────────────┬───────────────┬───┘
                      自习室 CTA        Pet 通知         教学对话入口
                            │              │                │
用户请求 ──→ 模式识别 ──→ SkillOrchestrationPlan(持久化,O6)
                            │
             掌握度投影(O4)+ authority 实事实(O3)进入 prompt
                            │
                LLM 教学轮(教学行为合同检查,O5)
                            │
        Evidence(扩面:fill / 解释性证据,O1)→ evaluator → committer
                            │
        outcome(+strength 分级,O1)→ RetentionProjection(O2)
                            │
        NextTeachingStepPlanner v2(+ review_due,O2)→ 回到队列
                            │
                本地学习效果分析(O8)——观察这一切
```

### O1|证据分级与结算面扩展:让"算数的学习行为"配得上教学法

**目标**:把结算证据面从"客观题再认"扩展到"回忆与解释",并把"学会"从一次性判定改为有强度、可衰减、需复验的状态。

**设计**(三步,可独立交付):

1. **`fill` 题进入结算(改动最小,先做)**。assessment sidecar schema 增加 `acceptedAnswers: string[]`(生成时由模型给出规范答案与常见等价写法,normalize 后精确匹配:trim、全半角、大小写、数字格式)。文法仍是"明确、静态、无歧义"(ADR-0016 兼容);匹配失败按 `needs_practice` 语义处理并把学习者原文保留为 Evidence。schema/evaluator/renderer(`quiz.js`)三处同步,digest 机制不变。
2. **outcome 增加 strength 维度**。`established` 细分为 `provisional`(当场全对)与 `consolidated`(在 ≥1 个间隔日之后的复验中再次成功)。实现上不改四分类 union 也可行:在 outcome payload 增加 `strength` 字段 + 复验事件,由 RetentionProjection(O2)派生当前状态;原始 record 保持 immutable(与 0029 "不改 outcome 历史"一致)。**planner v2 对 `provisional` 的推进应更保守**(允许 continue,但把该课目标自动排入复习队列)。
3. **解释性证据的受限结算路径(需新 ADR,谨慎设计)**。对话中的解释/应用(已有 `learner_response_recorded` 通道)引入 "model-assisted grading candidate":模型按 sidecar 内预置 rubric 产出结构化评分候选(引用学习者原文 + rubric 条目 + 判定),作为**辅助证据**参与结算,但单独不足以产生 `established`——只能:(a) 把 `needs_practice` 细化归因;(b) 为 `provisional` 提供加权;(c) 触发复习排期。红线:LLM 评分永远不是 sole 判据,committer 的确定性核心不变;评分候选带 provenance 且 learner 可见可申诉(呈现层用 `show_source` 语义)。

**不变量兼容性**:sole-writer 不变;0016 的静态文法通过 acceptedAnswers 扩展而非放宽;LLM 介入被限制在"候选证据解释"层,与 0077 "候选须人可见"的哲学同构。

**落点**:`shared/lesson-schema.ts`、assessment sidecar schema、`learning-outcome-evaluator.ts`、`assets/quiz.js`;新 ADR ×2(fill 结算与 strength;grading candidate)。

**验收**:fill 题结算率 100%;同一课"当场全对"不再直接产生终态记录语义;存在至少一条对话解释被作为辅助证据挂到 outcome 的端到端测试。

### O2|ReviewScheduler:间隔复习调度器(本方案中最重要的新模块)

**目标**:把 spacing 从 kernel 原则文本变成系统行为——每个学习目标在正确的时间回到学习者面前。

**设计**:

- **数据来源(全部已存在)**:settled outcomes(课/题粒度)、flashcards sidecar、quiz item 级 Evidence 历史。
- **形态**:`ReviewSchedulerProjection`——纯函数 + 可重建投影,**不是第二权威**。从 ledger 事件流派生每个 review item 的 `{itemId, lessonId, objectiveId?, lastVerifiedAt, successStreak, nextDueAt, intervalIndex}`;投影文件放 workspace(如 `learning-sessions/_projections/review-queue.json`),损坏即重算,与 catalog 同类。
- **算法**:先用确定性固定间隔梯度(如 1d → 3d → 7d → 21d → 60d;答错回退一级),零参数、可解释、可测试。FSRS 类自适应参数遵循仓库既有的"信号触发"模式:出现 ≥N 个可复现的"固定梯度显著失准"案例 + 新 ADR 后再升级(与 0050 对 FTS 的门槛机制同构)。
- **复习的执行与结算(关键:复用而非新建)**:复习 = 重新 elicit 同一 assessment 的 item(或 flashcards)。交互仍经 `LessonInteractionRecorder` 追加到**原 canonical Session**(0009 已支持"不同 attempt 保持为独立原始事实",天然适配);原 outcome record 不改写,当前掌握状态由 RetentionProjection 计算(`consolidated / provisional / decayed / lapsed`)。**不需要新的 settlement 写者。**
- **planner v2**:`NextTeachingStepPlanner` 动作 union 增加 `review_due`(修订 ADR-0012);优先级建议:integrity 异常 > `contrast_and_retry` > **到期复习(少量,3–5 item)** > `continue_next_session`——即"先还债再借新债",并天然实现 interleaving(复习旧课 + 学新课混排)。
- **表面**:今日队列(O7)、Pet Lesson Review 通知(替换现在的 24h 固定阈值,`lesson-review-due.ts` 改为消费投影)、lesson 尾部"下次复习时间"。

**不变量兼容性**:纯投影、可重建、确定性、本地;不写 ledger、不改 record;Pet 通知继续满足"可重建投影,不是真相来源"。

**验收**:同一 ledger 状态重算得到相同队列;答对间隔上升、答错回退有单测;M10 Golden 增加一条"第 1 天 established → 第 2 天出现 review_due → 复验成功 → consolidated"链。

### O3|接通闭环:让权威平面进入每一轮教学(顺序上最先)

**目标**:修复 G4 的三处断点,让"系统知道的"进入"用户看见的"与"模型读到的"。

**设计**:

1. **M5 按既定唯一调用链交付**(renderer → `readTeachingLoopSnapshot` → … → learner-safe result),顺序不变,这里不重复;M7/M8 跟进。本项唯一建议:把 M5 的验收从"能读到快照"提高到"**教学对话入口处可见下一步**"(哪怕先以最小卡片呈现 `nextStep.action + reason`)。
2. **authority bridge 实事实**(小改动、高杠杆,可先于 M5):`loadSkillOrchestrationAuthorityFactsForWorkspace` 停止使用占位 seed,改从 fact source 读取真实 mission/nextGoal/resource readiness;补齐 `availableArtifacts`(扫描 workspace 产物 catalog 的 allow-listed 标识)与 `budgetConstrained`,唤醒 planner 的休眠分支。
3. **planner 决策成为下一轮 prompt 一等公民**:turn-tail 的 `<skill-orchestration-plan>` / context packet 中,把 `nextStep` 从一行枚举扩为 allow-listed 结构投影:`action + reason + 本轮教学目标 + 支撑 evidence 的 identity(非正文)+(O2 后)到期复习摘要`,并在 kernel 装配指令中明确:"本轮教学必须服务于该 next step,除非用户显式改变目标"。这是把"确定性决策约束 LLM 自由发挥"的既有模式(强制 web_search、强制 generate_lesson)推广到教学决策本身。
4. **双 turn 路径收敛(方向性决策,建议出 ADR)**:明确 chat runtime 与 coordinator 的关系——推荐:正式 teaching turn(mode=teaching_turn 且有 canonical Session)逐步路由经 coordinator seam(获得 review-hook/finalize 语义),chat runtime 保留 instant_help 与 artifact_workflow;短期最低要求:修复 `checkpoint` 伪成功 stub,`compact/fork/steer` 保持显式 not-wired 错误。

**不变量兼容性**:全部是读侧与投影;prompt 变更走 turn-tail,不触碰 stable prefix(0044);bridge 仍 fail-soft。

**验收**:同一 workspace 下 bridge 输出与 loop snapshot 一致的事实;prompt 快照测试包含结构化 next step;用户端能看到"为什么是这一步"。

### O4|LearnerMasteryModel:目标粒度的掌握度投影 + diagnose 落地

**目标**:让"学习者当前会什么"成为系统事实,ZPD 从 LLM 脑补变成"事实 + LLM 判断"。

**设计**:

- **引入 LearningObjective**:CourseDefinition v2 允许每个 Session 声明 1–3 个 objective(稳定 id + 一句话可观察行为描述);lesson 生成时要求 quiz/flashcard item 绑定 objectiveId(写入 sidecar)。旧数据无 objective 时回退到 lesson 粒度——渐进,不做迁移强制。
- **MasteryProjection**:纯投影,按 objective 聚合 Evidence + outcomes + retention:`{objectiveId, state: not_started|in_progress|provisional|consolidated|decayed, evidenceRefs, lastVerifiedAt}`。与 O2 共享派生管线。
- **diagnose 阶段落地**:新的 placement 流程 = 生成"只有评估、没有讲解"的特殊 lesson(复用现有 lesson/sidecar/结算全链,零新权威):用户声明"我学过一些"或开新 course 时,planner/编排进入 `diagnose` stage → 5–8 题跨 objective 前测 → 结果作为普通 Evidence 结算 → MasteryProjection 立即有初值 → 后续 Session 顺序与难度据此校准(先由模型消费投影校准,后续再考虑确定性跳课规则)。
- **注入**:mastery 投影以预算化 allow-listed 摘要进 turn-tail(如"已 consolidated: a,b;decayed: c;未学: d,e"),与 learner profile(自由文本偏好)分工明确:**画像管"怎么教",掌握度管"教什么"**。

**不变量兼容性**:objective 是 CourseDefinition 的向后兼容扩展(schema v2,走 ADR);投影可重建;不触碰同意门控记忆(掌握度源于 Evidence,不是 memory,反而降低对画像记忆的依赖)。

**落点**:`course-definition-store.ts`(schema v2)、sidecar schema、新投影模块、`lesson-prompts.ts` 注入段。

**验收**:前测 → 投影初值 → 第一课难度引用投影的端到端用例;"已 consolidated 的 objective 不再从零讲解"成为 prompt 合同测试的一条。

### O5|教学行为合同:给"怎么教"配上与"学习事实"同级的治理

**目标**:让 kernel 的教学原则从"建议"变成"可检验的行为合同",让掌握判据进入 ADR 视野。

**设计**:

1. **Turn shape 检查(确定性后置检查 + iteration recovery 软纠偏)**。teaching_turn 模式下,对模型输出做轻量结构检查:(a) 是否以恰一个面向学习者的 Elicit(提问/任务)收尾;(b) 单轮长度预算;(c) 是否一次抛出多主题(标题/列表密度启发式)。违规不阻断,而是复用既有 recovery 模式:注入一条纠偏指令再给一轮机会(与 `generate_lesson` 的 iterationLimitRecovery 同构),并记入本地诊断。规则本身进 kernel 合同测试,避免启发式僵化误伤。
2. **Evaluator 判据 ADR 化**。把"什么算 established / strength 如何升级 / 各题型权重"写成一份版本化的 Mastery Policy ADR;evaluator 已有 evaluatorVersion 追溯钩子,判据变更 = 版本递增 + 迁移说明。
3. **Kernel 版本化与教学回归**。`teach/SKILL.md` 增加版本号与 changelog;建立本地教学回归命令(不进默认 CI、不烧 key,与仓库"PR 默认 CI 不烧真实 API key"红线一致):固定一组合成学习者脚本(答对/犹豫/误解/跑题),跑完检查 turn shape 合规率与结算路径完整性,kernel/prompt 改动前后对比。这是 0151 Phase 6 本地评估的具体化。
4. **Skill 内容治理执行**(0151 Phase 5,给出顺序):优先重写 `learning-assessor`(删除技术模板残留;按方案文档 §11.2 拆 Assessment Authoring / Elicitation Strategy / Evidence Interpretation Hint 三职责,红线写进 SKILL.md 正文);`course-designer` 降级为路由;`teaching-resource-generator` 收窄为 producer。

**不变量兼容性**:检查是投影/诊断,不写任何 durable 事实;纠偏走既有 recovery 机制;全部本地。

**验收**:kernel 改动必须过合同测试才能合入;教学回归报告可在 Doctor/support bundle 中查看(脱敏)。

### O6|编排 v2:跨轮续航(概要,详见 §5)

单轮确定性计划升级为"持久化计划 + stage cursor + gate 判定 + 计划预览 UI"。详细设计见 §5,此处不重复。

### O7|今日学习队列:三层世界的连接点(动机层的教学供给)

**目标**:用户打开 app 的第一眼永远有一个"今天学什么"的明确答案——这是留存最重要的单一设计,也是自习室/Pet 动机层缺失的教学内容供给。

**设计**:

- **纯聚合投影**(零新权威):`TodayQueue = 到期复习(O2, 3–5 项) + planner 下一步(O3) + 今日 Study task(既有 store)`,确定性排序(复习债 > 继续课程 > 自由任务),每项带 deep link。
- **三个表面消费同一队列**:教学对话入口卡片;自习室"一键开自习"的 FocusContract 默认值从"当前任务标题"升级为"队列首项"(SR-104 的自然延伸),并落地 SR-305 深链(建议从 P2 提到 P1——动机层没有教学供给时,激励包做完也只是激励专注时长);Pet 通知源(Lesson Review / Learning Progress)直接消费队列,替换 24h 阈值逻辑。
- **边界**:队列是投影,完成一项 = 各自领域的既有完成语义(复习=结算、任务=Study task 完成),队列自身无写权;"计时 ≠ 教学 Session"的术语边界不动。

**不变量兼容性**:与自习室方案的"深链 / 不写入"原则完全一致;Pet 通知继续是可重建投影。

**验收**:冷启动 30 秒内看到队列并能一键进入首项;队列项完成后跨三个表面一致消失。

### O8|本地学习效果分析:给教学迭代装上眼睛

**目标**:回答"教学效果变好了吗",为 kernel/planner/调度算法的迭代提供本地反馈回路。

**设计**:从 ledger + RetentionProjection 派生(全本地、可脱敏、用户可见):学习者侧——各 course 掌握进度(objective 粒度)、复习命中率(到期复习的首次答对率)、consolidated 转化率、遗忘回退率;系统侧(Doctor/诊断向)——每教学轮 Elicit 率(O5 检查的聚合)、每 Session Evidence 数、planner 动作分布、`established` 中 provisional 停留时长。呈现:StudyAnalyticsPage 增加"学习效果"页签(与专注分析并列);系统侧指标进 teaching doctor facts。**明确非目标**:不做远程 telemetry、不做全站对比、不给学习者展示焦虑性指标(如与他人比较)。

**验收**:kernel/调度改动后,能用同一份本地报告做前后对比;指标全部可由 ledger 重算。

---

## 5. 多 Skill 教学编排专题:从"单轮计划"到"跨轮教学编排"

### 5.1 诊断:0151 Phase 0–3 解决了什么,还剩什么

已解决(且解得很好):kernel 生命周期(fail-closed、反 shadow)、单轮内的确定性裁决(谁激活、谁排期、谁排除、为什么)、prompt 纪律(仅 active_now 注入、计划投影、budget)。

未解决的本质问题是:**编排的对象(教学、产物工作流)是多轮过程,而编排的载体(plan)是单轮快照。**由此派生四个具体缺口:

1. `scheduled_later` 无兑现机制——它是解释,不是调度;
2. stage 推进无状态——第 N+1 轮重新 plan 时不知道第 N 轮走到了哪、gate 过没过;
3. `consumes/produces/completionGates` 不投影、artifact 事实不供给(bridge 占位),producer/packager 相关分支休眠;
4. 用户看不到计划(Phase 4 UI residual),多选语义(active/later/excluded/blocked)只存在于 prompt 内部。

### 5.2 核心设计:durable OrchestrationState + 纯 planner 不变

保持 planner 纯函数的前提下引入"时间",标准做法是**把上一轮的编排状态作为下一轮 plan 的输入**:

```ts
// 每个 agent conversation 一份,随会话持久化(可重建的工作流投影,非权威)
type ConversationOrchestrationState = {
  schemaVersion: 1
  planId: string            // 最近一次 plan
  planRevision: number
  mode: SkillOrchestrationMode
  stageCursor: string       // 当前 stage id
  stageHistory: Array<{
    stageId: string
    status: 'completed' | 'active' | 'pending' | 'skipped'
    gateResults: Array<{ gateId: string, passed: boolean, checkedFact: string }>
  }>
  artifactFacts: string[]   // allow-listed 产物标识(供 availableArtifacts)
  userOverrides: Array<{ skillId: string, decision: 'force_include' | 'exclude', reason: 'user' }>
}
```

运行规则:

1. **plan 输入扩展**:`plan(input)` 增加可选 `priorState`;同 canonical facts + 同 priorState + 同选择 → 同 plan(确定性保持,planId 把 priorState 纳入 identity 输入)。
2. **gate 判定是确定性代码,不是模型自觉**:每个 completionGate 映射到可检查的 workspace 事实(产物文件存在且非空、verifier 报告存在且无 blocking 项、教学模式下则映射到结算事实——如 elicit stage 的 gate = "本 Session 出现 ≥1 条新 Evidence")。host 在每轮 plan 前评估 gate,写回 state;**gate 通过 → cursor 前移 → 上一轮 `scheduled_later` 的 skill 在新 plan 中自然变为 `active_now`**——"稍后"从承诺变成机制。
3. **写入路径**:state 随既有 conversation 持久化通道保存(与 conversation history 同级),损坏即从"重新 plan"冷启动;**它是工作流投影,不是第二状态机**——不复制 ledger 事实,只存 stage 游标与 gate 检查结果,任何与 canonical facts 冲突时以重算为准。
4. **供给侧补齐**(即 O3-2):bridge 提供真实 `availableArtifacts`/`budgetConstrained`,`consumes/produces/completionGates` 进入 turn-tail 投影(截断为标识符级)。

### 5.3 教学模式下的 skill 协同语义:stage 与 kernel 循环合一

当前存在两套词汇:编排 stage(`ground→diagnose→teach→elicit→…`)与 kernel 教师循环(`Locate→Teach→Elicit→Adapt→Record`)。建议显式建立映射并写进 kernel 与 registry,消除"编排说 stage、教学说 loop"的割裂:

| 编排 stage | kernel 循环 | strategy skill 的介入方式(typed,而非全文覆盖) |
| --- | --- | --- |
| ground | Locate(mission/障碍定位) | 无(kernel 独占) |
| diagnose | Locate(证据盘点/前测) | `learning-assessor` 提供 ElicitationPlan(题型/认知层次建议) |
| teach | Teach | `teaching-resource-generator` 按薄弱点供材(引用 Evidence identity) |
| elicit | Elicit + Adapt | `learning-assessor` 提供 rubric hint(仅供 evaluator 参考,非 Evidence) |
| (settle) | Record | **无 skill 可介入**(Authority Plane 独占) |

要点:strategy skill 对教学轮的贡献应逐步 typed 化(ElicitationPlan、rubric hint 这类小结构),而不是靠两份 markdown 全文在 prompt 里"和平共处"——这是把 host registry 的 `accepts/produces` 思想延伸到教学模式内部。短期最低要求:多 skill 全文并存时,装配层为每个 body 加一行 role 框定语("以下内容是本轮的 elicitation 策略参考,教学原则以 Teaching Kernel 为准"),降低指令冲突面。

### 5.4 模式识别的健壮性

当前 `inferMode` 主要由"选了哪些 skill"驱动,而三种模式的 authority 语义差异巨大(instant_help 不建 Session、artifact_workflow 不产生 learner outcome)。建议:(a) 无 skill 选择时的自然语言意图(现在由 `isLessonGenerationRequest` 等正则承担)集中为一个可测试的 intent 模块,正则命中作为强信号、其余保守回落 instant_help(**宁可少进 teaching_turn,不可把闲聊升格为教学轮**);(b) 模式对用户可见且一键可改("本轮按正式教学进行 → 改为快速答疑");(c) 中长期若引入 LLM 意图分类,只作 hint,最终裁决仍在确定性层(与 host-owned registry 的信任结构一致)。

### 5.5 Phase 4 UI 的落地形态(结合持久化后)

```text
┌ 教学内核:Teach(始终启用)· 模式:正式教学 ▾ ─────────────┐
│ 本轮   Learning Assessor        诊断并出前测(diagnose)     │
│ 稍后   Teaching Resource Gen.   依薄弱点生成练习(gate:前测已结算)│
│ 未启用 Course Ebook Publishing  缺少稳定课程产物(blocked)  │
│ ▸ 计划 sop1_9f3a…  · 阶段 2/5 · 上一阶段 gate:✓ 前测已产生证据 │
└──────────────────────────────────────────────────────────────┘
```

与单轮方案的差异在最后一行:**用户能看到"走到哪了、凭什么前进"**。gate 未过时,"稍后"项显示阻塞原因与建议动作(方案文档 §9.3 的 fail-closed 交互沿用)。

### 5.6 验收标准(在 0151 §13 之上追加)

- 同一会话内跨 3 轮的 artifact workflow(outline → content → site)无需用户手工"记得推进",每轮 plan 的 stageCursor 单调且可解释;
- `scheduled_later` 的 skill 在其 gate 满足后的下一轮自动 `active_now`,且有测试;
- 教学模式下 strategy skill 的介入以 typed 贡献呈现于计划投影;
- state 文件删除后系统降级为单轮语义而非报错;
- planner 保持纯函数、无 I/O,所有新输入(priorState、artifactFacts)由 host 组装。

---

## 6. 路线图建议

原则:不打断既有 M5→M10 主线(它正是 O3 的主体);教学法增强(O1/O2)与之并行——它们几乎全是投影与 schema 扩展,不与 M 线争抢同一批文件;编排 v2 排在闭环接通之后。

| 阶段 | 内容 | 对应 | 性质 |
| --- | --- | --- | --- |
| **A 接通**(当前) | M5 快照读链 → M7 coordinator bootstrap → M8 消费;bridge 实事实 + planner 决策进 prompt;checkpoint 伪成功修复 | O3 | 既定主线 + 3 个小改动 |
| **B 学习真的发生**(可与 A 并行启动) | fill 结算 + strength 分级(ADR);ReviewScheduler MVP(固定梯度)+ planner `review_due`(修订 0012);今日队列最小版(复习 + 下一步) | O1-1/2、O2、O7 最小版 | 新增,投影为主 |
| **C 编排 v2** | OrchestrationState 持久化 + gate 判定 + `scheduled_later` 兑现;Phase 4 多选 chip 与计划预览;stage↔kernel 循环映射 | O6/§5 | 0151 Phase 4 扩容 |
| **D 深化** | LearningObjective + MasteryProjection + diagnose 前测;教学行为合同 + kernel 版本化 + Mastery Policy ADR;解释性证据 grading candidate(ADR);skill 重写(0151 Phase 5);学习效果分析 | O4、O5、O1-3、O8 | 新增 |
| **E 动机闭环收口** | SR-305 深链(建议提前至 B/C 之间)+ 自习室合同默认值接队列;Pet 通知源接队列;激励包(SR-2xx)在教学供给就绪后再上 | O7 全量 | 既有 roadmap 重排 |

两条排序理由:(1) **O2 不应等 M10**——复习调度只读 ledger 投影,与 M 线无文件冲突,而它是"第 2 天起的教学供给",拖越久产品越只对第一天有用;(2) **激励包(streak/badges)应排在今日队列之后**——先有"今天该学什么",再激励"今天来了",顺序反了就是激励空转。

---

## 7. 风险与反模式(做的时候不要做什么)

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| LLM 评分渗入 settlement 核心 | O1-3 若实现走样,"模型说学会了"会借道 grading candidate 复活 | candidate 单独永不产生 `established`;确定性核心与 sole-writer 不动;新 ADR 明确权重上限与可申诉性 |
| 调度器长成第二权威 | review 队列开始"拥有"掌握状态,与 ledger 漂移 | 投影可重建是硬性验收;任何冲突以 ledger 重算为准;禁止队列文件成为结算输入 |
| OrchestrationState 变成第二状态机 | state 里复制 Session/Evidence 事实,与 coordinator 竞争 | state 只存 stage 游标 + gate 检查结果;planner 保持纯函数;冲突即重算 |
| 教学行为合同僵化 | turn shape 启发式误伤正当的长讲解/多例对比 | 软纠偏(recovery 注入)而非阻断;规则本身有测试与豁免语义;以 O8 指标观察误伤率 |
| 复习变成打卡负担 | 队列无上限、通知无节制,复刻 Pet 文档警句"从学习搭档变成任务告警器" | 每日复习 3–5 项硬上限;通知遵守既有安静模式;逾期不惩罚(无 streak 绑架) |
| 过度 gate 化伤害轻量场景 | instant_help 被强行拖入教学轮/前测 | 模式识别保守回落;前测仅在开新 course 或用户自述有基础时提议,可跳过 |
| prompt 膨胀回潮 | mastery 摘要、队列、计划投影一起塞 turn-tail | 全部走 allow-listed 预算化投影(0013 机制复用);标识符级,不带正文 |
| 提前上向量库/复杂画像 | 掌握度模型诱发"上 embedding"冲动 | objective 粒度的确定性聚合已够用;维持 0050 的信号触发门槛 |

---

## 8. 结语:一个判断标准

后续每个教学链路的设计决策,建议都过这一问:

> **它是否让"系统已经知道的学习事实",在正确的时间,改变了学习者看到的下一步?**

权威平面负责"知道得真",O1/O4 让它"知道得多",O2 负责"正确的时间",O3/O7 负责"到达学习者",O5/O8 负责"验证这一切在变好"。多 skill 编排(§5)则保证当能力变多时,这条主线不被稀释——skill 永远是教学循环里的角色,而不是十五份争夺注意力的说明书。

---

## 附录 A|本文依据的事实清单

- 方案与 ADR:`docs/teaching-skill-orchestration-solution.md`(2026-07-24 草案全文);ADR-0008/0009/0010/0011/0012/0013/0014/0015/0016/0018/0022/0026/0044/0045/0046/0050/0073/0077/0094/0151 全文;`docs/adr/README.md` 全索引(至 ADR-0153;含各条实施状态)。
- 产品与规划:`MISSION.md`、`CONTEXT.md`、`README.md`、`AGENTS.md`、`todolist.md`(M5–M10 状态、永久不变量、P1/P2 crosswalk)、`teaching-system-tech-stack.md`、`docs/study-room-improvement-plan.md`(北极星、SR-1xx/2xx/3xx)、`docs/pet-next-stage-roadmap.md`(候选 B/C、通知架构约束)。
- 源码(36 文件,关键结论出处):`teaching-conversation-runtime.ts`(执行流、kernel fail-closed、强制启发式、lesson 轮次预算)、`teaching-conversation-prompt.ts`(stable prefix / turn-tail、PERSONAL_TEACHER_POLICY_PROMPT、skill 装配语)、`builtin-skill-orchestration-policy.ts` / `skill-orchestration-planner.ts` / `skill-orchestration-host.ts` / `skill-orchestration-authority-bridge.ts`(编排现状与占位 seed)、`next-teaching-step-planner.ts`(四动作决策树)、`learning-outcome-evaluator.ts`(quiz-only 结算、fill 忽略、mastery 定义)、`learning-outcome-committer.ts`(sole-writer、有序发布)、`lesson-schema.ts` / `lesson-plan-production.ts` / `lesson-prompts.ts`(lesson 形态与生成规则)、`teaching-placement.ts`(sidecar 布局)、`teaching-personalization.ts`(≤6 条画像注入)、`ai/teaching-turn-orchestrator.ts` / `ai/teaching-session-runtime.ts`(双路径与 stub 现状)、`teaching-loop-resolver.ts`、`lesson-interaction-recorder.ts`、`course-definition-store.ts`、`renderer/src/views/pet/lesson-review-due.ts`(24h 阈值复习投影)。
- Skill 正文:`resources/builtin-skills/teach/SKILL.md`(内核全文)、`learning-assessor/SKILL.md`(模板残留证据)、`teaching-site/SKILL.md`。

以上事实描述如与最新代码不一致,以代码为准。本文建议的实施状态已经随 HEAD 演进；已完成、部分完成、Proposed 与仍未实施项的当前边界见 [《教学链路与多 Skill 编排复评》](improvements/teaching-chain-multiskill-evaluation.md)。任何尚未批准的架构变更仍须按仓库惯例先行 ADR。

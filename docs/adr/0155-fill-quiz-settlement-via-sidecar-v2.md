# ADR-0155：fill 题结算——assessment sidecar v2 与归一化答案 digest

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** **已实施**（2026-07-26）：schema、渲染、证据桥、evaluator、quiz.js 全链;HTML sidecar 变体的 fill 保持保守 unsupported（见 §2.4）
- **日期：** 2026-07-26
- **范围：** 让 `fill`（填空）题的学习者作答进入 evidence-gated settlement。此前 lesson schema 鼓励生成 fill 题,但 evaluator 一律 `unsupported_quiz_type` 忽略,且预览证据桥把 fill 提交记录成 `selectedOptionIds: ['submit']` 的永假证据——被鼓励的题型永远不算数。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0009](0009-typed-lesson-interaction-evidence.md);[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md);[ADR-0016](0016-trusted-assessment-artifacts-for-outcome-evaluation.md)（静态无歧义文法约束——本 ADR 以 digest 扩展而非放宽）
- **证据：** `src/shared/fill-answer.ts`（归一化 + 自包含同步 SHA-256 + `fill-<sha256>` 身份;函数刻意自包含以便 `String(fn)` 注入浏览器脚本,保证各表面逐位一致）;`src/shared/lesson-schema.ts`（fill 可选 `acceptedAnswers` ≤4,sanitize 按归一化去重）;`src/main/ai/lesson-renderer.ts`（sidecar **schemaVersion 2**:fill `answerIds` = 归一化答案 digest;lesson 卡片可选 `data-accepted` JSON 数组）;`src/shared/lesson-style-themes/contract.ts`（`quizAccepted`）;`src/shared/preview-markdown-bridge.ts`（fill 提交 → 归一化 → digest → `selectedOptionIds: ['fill-<sha256>']`,含 Enter 提交;不再产出 `['submit']` 垃圾证据）;`src/main/learning-outcome-evaluator.ts`(接受 sidecar v1/v2;v2 fill 按 digest 成员判定;非 digest 选择 → `malformed_answer_or_choice`);`assets/quiz.js`（接受 `data-accepted` 备选,归一化算法逐字不变）;测试 `tests/unit/fill-answer.unit.test.ts`、`tests/unit/learning-outcome-evaluator-fill.unit.test.ts`

## 1. 决策

### 1.1 单一归一化契约（冻结）

`trim → toLowerCase → 空白折叠 → 去除 。.,，！!？? 标点`——与既有 quiz.js 判分语义**逐字一致**（含「标点在折叠后剥除」的历史怪癖,一并冻结);三个消费面(quiz.js 判分、证据桥 digest、渲染器/evaluator sidecar digest)共用同一实现。

### 1.2 证据形状不变,身份用 digest

- 学习者 fill 作答的证据仍是 schemaVersion 1 的 `quiz_answered`,`selectedOptionIds` 携带**恰一个** `fill-<sha256(归一化输入)>`——满足既有 safe-id 文法,**学习者明文永不进入证据**（与 responseDigest 传统一致）。
- evaluator 判定 = digest ∈ sidecar `answerIds`(publisher 预置:主答案 + ≤4 个 acceptedAnswers,按归一化去重,≤6 条);客户端 `correct` 标志一如既往不被结算信任。

### 1.3 sidecar schemaVersion 2

- v2 与 v1 键集完全相同;唯一语义差异:fill 的 `answerIds` 允许为 digest 列表(v1 强制 null)。选择题绑定逐字节不变。
- evaluator 同时接受 v1/v2:旧 lesson 的 v1 sidecar 维持 fill `unsupported_quiz_type` 的保守姿态;v2 中非 digest 形状的 fill `answerIds` → 整份 artifact `unparseable`(fail-closed)。
- 渲染器对新 lesson 统一写 v2。

### 1.4 HTML sidecar 变体（明确不支持 fill 结算）

`-assessment.html` 变体的 fill 卡保持 `answerIds: null`(unsupported)——生产写路径是 JSON sidecar;正向文法仅放宽为允许 fill 卡携带可选 `data-accepted`(严格 JSON 字符串数组),以保证共享卡片渲染器的输出仍可整体解析。既有单测「HTML fill 不成为 mastery」逐字保留。

## 2. 非目标 / 红线

1. **不放宽 ADR-0016**:文法仍然明确、静态、无歧义;digest 是静态绑定的另一种拼写,不引入运行时判分自由度。模糊匹配、编辑距离、LLM 判分都不在本 ADR 授权内(后者见 [ADR-0158](0158-model-assisted-grading-candidate.md) Proposed)。
2. settlement sole-writer、幂等、digest 绑定、`expectedRevision` 全部不变;`['submit']` 之类历史垃圾证据被判 `malformed_answer_or_choice`(ignored),**永不**升级为 verified。
3. 归一化算法为冻结契约:任何修改都会使既有 sidecar digest 失配,必须走新 ADR + sidecar schema 递增。
4. 不改 lesson HTML 的答案明文暴露面(fill 答案本就以 `data-answer` 呈现于学习者文档;sidecar digest 化解决的是证据文法与身份,不是保密)。

## 3. 验证入口

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/fill-answer.unit.test.ts tests/unit/learning-outcome-evaluator-fill.unit.test.ts tests/unit/learning-outcome-evaluator.unit.test.ts
pnpm run check:learning-outcome-evaluator
```

## 4. 一句话

**填空题终于「算数」:一套冻结的归一化 + digest 身份贯穿判分、证据与结算;v1 保守语义原地保留,确定性核心与 sole-writer 一寸未动。**

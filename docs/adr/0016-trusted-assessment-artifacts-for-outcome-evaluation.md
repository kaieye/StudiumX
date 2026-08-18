# ADR-0016：以绑定且校验过的 assessment artifact 作为 OutcomeEvaluator 的唯一评分来源

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** `LearningOutcomeEvaluator` 只能从与 canonical Session / Lesson 绑定、由 publisher 产生且通过 digest 校验的 assessment sidecar 读取评分依据。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0014](0014-learner-safe-teaching-turn-presentation.md)、[ADR-0017](0017-win-mac-p0-release-proof-and-audit-policy.md)
- **证据：** `src/main/learning-outcome-evaluator.ts`、`tests/unit/learning-outcome-evaluator.unit.test.ts`；提交 `863d8ed`、`225ec0c`、`d449094`、`1408239`

## 决定

`LearningOutcomeEvaluator` 只能从与 canonical Session / Lesson 显式绑定、由 publisher 产生且已通过 digest 校验的 assessment sidecar 读取评分依据。它不得把任意 Lesson HTML、路径可达文件、模型自述、renderer 状态或“看起来像 quiz”的自由内容解释为可信 assessment。

加载 assessment 必须经过既有 safe-path / realpath 边界，拒绝 traversal、junction 或 symlink escape、错误文件类型和超限读取。解析器只接受明确、静态且无歧义的 assessment grammar；active content、quirks-mode 文档、嵌套或歧义 quiz、未知 schema、重复/错序 item identity、损坏内容或 binding/digest 不匹配均保守地产生 `not_evidenced` 或可诊断失败，绝不升级为 `established`。

Evaluator 只输出受限的 outcome evaluation input/result，不能直接写 Evidence、Outcome、Learning record、planner 或 UI projection。其候选判定须由 ADR-0011 的 committer 再行结算。

## 已实施范围与验证入口

- `863d8ed` 引入 evaluator 基础；`225ec0c` 加入 publisher-owned canonical assessment artifacts。
- `d449094` 收紧 assessment authority / path access；`1408239` 补充 corrected-outcome 分类。
- 现有自动化覆盖受信 artifact、binding / digest、path safety、静态 grammar、拒绝不可信内容和保守分类。

```powershell
pnpm run check:learning-outcome-evaluator
pnpm exec vitest run --project unit tests/unit/learning-outcome-evaluator.unit.test.ts
pnpm exec vitest run --project integration tests/integration/learning-outcome-evaluator.integration.test.ts
```

## 不变量

- 评分输入必须同时满足 Session / Lesson binding、publisher ownership 和 digest integrity；任一不满足即不可信。
- evaluator 不因缺失、损坏或不可信 assessment 自动补写事实，也不以 failure 作为掌握证据。
- 相同的受信输入按受限规则产生稳定分类；规则 / schema 变化必须可追溯。
- 评估与 durable effect 分离：只有 committer 可以将符合条件的结果结算为 canonical outcome / Learning record。

## 不包含

- 本 ADR 不授权 evaluator 直接写 Learning record、catalog 或 UI；这些 authority 见 ADR-0011、ADR-0012 和 ADR-0014。
- 本 ADR 不把 assessment sidecar 扩展为任意 HTML 执行器、通用内容抓取器或远程 RAG 入口。
- 本 ADR 不单独承担 P0 发布证明；全量 integration、Electron crash/restart Golden 与 clean-checkout audit 见 ADR-0017。

# ADR-0001：教学事实权威与 LearningSession Ledger

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** teaching-authority

## 背景

教学计划、学习证据和结果必须在重启、重试与多种 UI 投影之间保持一致。Agent run、SQLite、同步副本或模型自述都不具备足够的持久性与信任边界，不能决定学习者下一步学什么。

同时，等级、XP、偏好、规划快照和经同意的分析摘要需要同步；“文件是教学真相源”不能被误解为所有用户状态都禁止同步。

## 决定

- 工作区文件与 `LearningSessionLedger` 是 AI 教学决策事实的 canonical authority；Session identity、互动、Evidence 与教学进度由 ledger 追加并以稳定 operation identity 保持幂等。
- SQLite、catalog、renderer、Agent run、远端同步副本和旧 Lesson 视图只可作为可重建投影或传输层，不得反向改写 canonical 教学事实。
- 等级、XP、偏好、规划快照及经用户同意的分析摘要属于可同步用户状态；同步冲突不得修改 Evidence、Outcome 或下一步教学事实。
- Lesson 被生成、打开或阅读不等于学习结果；模型输出、自由文本和预期答案都不能自行成为 Evidence。
- 教学 review candidate 是非权威草稿，必须由人明确批准；不得 auto-apply，也不得静默写 learner profile、memory 或 Learning record。
- Course 与 Session 的稳定身份由工作区 durable 文件维护；文件布局与 ledger 的关系必须通过显式 adapter，而不是第二写入入口。

## 边界与后果

- 该决定只界定教学决策事实，不把所有本地文件都提升为领域权威。
- projection 失败可修复，不能使已提交的 canonical 事实回滚或被替换。
- memory、MCP、思维导图和 observability 都不是 Teaching Evidence 或 settlement authority。
- 改变教学事实源、同步可写范围或人工批准边界需要新的 ADR。

## 实施锚点

- [LearningSessionLedger](../../src/main/learning-session-ledger.ts)
- [Teaching authority 安全边界](../../SECURITY.md)
- [Teaching evidence 门禁](../../scripts/check-learning-session-ledger.mjs)

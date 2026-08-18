# ADR-0014：将教学运行事实投影为学习者安全的 TeachingTurnPresentation

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** 学习者界面消费从教学事实与受限诊断投影出的 `TeachingTurnPresentation`；封闭 `TeachingCommand` composer；reasoning 过程与结算隔离。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0011](0011-evidence-gated-learning-outcome-settlement.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0154](0154-spaced-review-scheduler-and-review-due-planner-action.md)
- **证据：** `tests/unit/teaching-turn-presentation.unit.test.ts`、`tests/unit/teaching-command.unit.test.ts`、`node scripts/check-teaching-turn-presentation.mjs`、`node scripts/check-teaching-presentation-redaction.mjs`；提交 `840d566`、`f71f211`、`0ce39c9`、`963d9b2`、`ef983f9`、`8cc956b`、`f6257cc`

## 决定

学习者界面消费 `TeachingTurnPresentation`，即从教学事实与受限诊断投影出的 learner-safe view model。教学进度仍不得直接把 Agent run、provider payload、内部 prompt、工具事件或 raw chain-of-thought 当作 teaching authority 或教学事实。

当 Agent 对话提供 reasoning 事件时，界面同时显示独立的“思考过程”行，并原样展示 provider 提供的 reasoning 标题和 detail，不截断、不脱敏、不做 allow-list 或路径/secret 过滤。过程记录可以包含模型用于完成本轮任务的推理、上下文、provider 内容、内部 prompt、工具参数、路径或凭据；该过程面板用于让学习者查看模型如何处理任务，但不构成教学证据、settlement authority 或学习结论。

投影使用确认目标、完成检索练习、讲解并形成 Lesson、保存学习记录等受限阶段，并保证同一时刻最多一个 `active` 或 `needs_you` 状态。保存态以 durable canonical/catalog reconciliation 为准，不以 spinner 或模型自述代替。技术诊断必须默认折叠、allowlist 并脱敏。


### P1-12：封闭 TeachingCommand

学习者 composer 仅暴露封闭 `TeachingCommandKind`（`continue` | `retry` | `show_source` | `end_session`）。命令执行类型为 `presentation_action` / `local_ui` / `session_control`，**永不**映射为任意 tool call、shell、diagnostics 或 effect-policy 旁路。`continue`/`retry` 受既有 presentation action 门控；不可用时 fail closed，不得发明 planner step。slash 发现与技能 slash 同形，但 `diagnosticMode` 不在此目录解锁技术/agent 控制。

### P0：canonical snapshot 与受控 `contrast_and_retry` / `review_due`

默认教学对话通过 closed `teach:get-teaching-presentation` 读取**当前 active workspace** 的 `TeachingPresentationSnapshot`，并通过 `teach:act-on-teaching-presentation` 提交 allow-listed 的 `contrast_and_retry` 或 `review_due` 动作。DTO 只包含 opaque operation ID、canonical session revision 与固定 learner copy；不含 path、raw evidence、evaluator reason、prompt、provider payload、secret、token、review item ID 或 planner diagnostics。它不是通用 operation 查询面，也不向 renderer 公开 ledger/committer 状态。

host 每次从既有 `LearningSessionLedger` scan + outcome settlement reconcile 的只读投影重建 snapshot，并复用已有限界 durable mission/resource-readiness adapter；`review_due` 额外由同一 scan 经 ADR-0154 的 `deriveReviewScheduleFromScan` 得到 count-only review fact，再交给既有 planner。不会假设资源已就绪，也不会把 `MISSION.md` / `RESOURCES.md` 正文、review item 或 due diagnostics 投影给 renderer。动作同时比较 opaque operation ID 和 `expectedRevision`；不匹配返回刷新后的 snapshot，且不追加 evidence、outcome 或 record。只有 host 接受该 closed action 后，默认 App 才启动对应的固定 teaching intent；学习者不能借卡片或 `/retry` 传入任意 prompt。该意图仍经过正常 teaching conversation / evidence / evaluator / `TeachingTurnCoordinator` settlement 路径，不能写 outcome 或绕过 sole-writer。

read channel 不接受 selector 或 diagnostic payload；action input 和两条 channel 的 output 都按 exact allow-list 校验。任何未知字段或 host 读取异常均在 main 侧 fail closed，绝不把路径、内部 reason 或其他诊断文字穿过 preload。

## 已实施范围与验证入口

`840d566` 引入 renderer projector，`0ce39c9` 合入主线；后续提交覆盖 Electron a11y 与 learner-safe diagnostics/redaction。`AgentConversationReader` 可接收教学 presentation，Electron 测试验证键盘、语义状态、克制公告与脱敏。

P0 将 shared snapshot adapter 接到 production `App.tsx` 的最近 assistant turn：错误答案 settlement 得到 `contrast_and_retry` 后，卡片在 `AgentConversationReader` 展示“对照后再试一次”；ledger evidence 经调度器得到 `review_due` 后，同一 Reader 展示“开始复习”。点击复用同一 host-validated route。刷新或重开不会依赖 renderer persistence，而是再次读取 canonical projection。

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-turn-presentation.unit.test.ts
node scripts/check-teaching-turn-presentation.mjs
node scripts/check-teaching-presentation-redaction.mjs
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e
pnpm run check:teaching-composer-a11y
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-command.unit.test.ts
pnpm exec vitest run --project unit tests/unit/teaching-turn-coordinator-host.unit.test.ts tests/unit/teaching-ipc-gateway.unit.test.ts
```

## 不变量

- 未回答的练习不能显示为 complete；错误回答不能显示为“已掌握”。
- 学习者动作、焦点和 `aria-live` 只反映受限教学状态，不能形成 token/chunk 公告风暴。
- source、错误和保存信息仅显示 allowlisted、可解释且已脱敏的字段。
- presentation 是 projection，不是 Evidence、Outcome、Learning record 或 canonical writer。
- TeachingCommand 目录封闭；composer 不得成为通用 agent/tool 控制面。
- P0 action 的 stale operation/revision 必须 fail closed 并用 host snapshot 刷新；不得产生第二次 settlement。
- `TeachingTurnCoordinator` / host 仍是 settlement sole-writer；renderer、模型和 skill 不得直写 outcome。
- `review_due` 只启动新的受控练习回合；它不直接确认、消费或写入 review outcome，且不能成为第二 review authority。

## 不包含

- 本 ADR 不把 `TeachingPresentationSnapshot` 变成通用 ledger 浏览器或任意 operation 查询 API。
- 本 ADR 不实现 ReviewView、TodayQueue 或 Pet；`review_due` 仅作为 Teaching Reader 的最窄 canonical 入口，`continue_next_session` 仍不是产品入口。
- 本 ADR 不把 `TeachingPresentationSnapshot` 的 closed IPC 变成 Agent 过程记录接口；reasoning 标题和 detail 仅在独立的 Agent 过程面板展示，且不获得教学 authority。

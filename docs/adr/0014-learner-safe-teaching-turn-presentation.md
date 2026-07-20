# ADR-0014：将教学运行事实投影为学习者安全的 TeachingTurnPresentation

- **状态：** 已实施（投影器、Reader 接口与定向 UI/Electron 自动化；P1-12 封闭 TeachingCommand 与 composer a11y residual 已合入；默认 App 编排接线未在此 ADR 中断言）
- **范围：** `TeachingTurnPresentation`、四阶段 learner projection、redaction、a11y 语义、保存态显示、封闭 `TeachingCommand` composer 目录
- **证据提交：** `840d566`、`f71f211`、`0ce39c9`、`963d9b2`、`ef983f9`；P1-12 feature `8cc956b` / merge `f6257cc`

## 决定

学习者界面消费 `TeachingTurnPresentation`，即从教学事实与受限诊断投影出的 learner-safe view model；界面不得直接把 Agent run、provider payload、内部 prompt、工具事件或 raw chain-of-thought 呈现为教学进度。

投影使用确认目标、完成检索练习、讲解并形成 Lesson、保存学习记录等受限阶段，并保证同一时刻最多一个 `active` 或 `needs_you` 状态。保存态以 durable canonical/catalog reconciliation 为准，不以 spinner 或模型自述代替。技术诊断必须默认折叠、allowlist 并脱敏。


### P1-12：封闭 TeachingCommand

学习者 composer 仅暴露封闭 `TeachingCommandKind`（`continue` | `retry` | `show_source` | `end_session`）。命令执行类型为 `presentation_action` / `local_ui` / `session_control`，**永不**映射为任意 tool call、shell、diagnostics 或 effect-policy 旁路。`continue`/`retry` 受既有 presentation action 门控；不可用时 fail closed，不得发明 planner step。slash 发现与技能 slash 同形，但 `diagnosticMode` 不在此目录解锁技术/agent 控制。

## 已实施范围与验证入口

`840d566` 引入 renderer projector，`0ce39c9` 合入主线；后续提交覆盖 Electron a11y 与 learner-safe diagnostics/redaction。`AgentConversationReader` 可接收教学 presentation，Electron 测试验证键盘、语义状态、克制公告与脱敏。

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-turn-presentation.unit.test.ts
node scripts/check-teaching-turn-presentation.mjs
node scripts/check-teaching-presentation-redaction.mjs
pnpm exec playwright test tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts --project=electron-e2e
pnpm run check:teaching-composer-a11y
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-command.unit.test.ts
```

## 不变量

- 未回答的练习不能显示为 complete；错误回答不能显示为“已掌握”。
- 学习者动作、焦点和 `aria-live` 只反映受限教学状态，不能形成 token/chunk 公告风暴。
- source、错误和保存信息仅显示 allowlisted、可解释且已脱敏的字段。
- presentation 是 projection，不是 Evidence、Outcome、Learning record 或 canonical writer。
- TeachingCommand 目录封闭；composer 不得成为通用 agent/tool 控制面。

## 不包含

- 本 ADR 不声称当前默认 `App` 已自动构建并传入全部 teaching presentation。
- 本 ADR 不把现有 Electron presentation/a11y harness 视为完整 evidence → IPC → canonical files → restart Golden E2E。
- 本 ADR 不授权展示 hidden prompt、provider payload、secret 或模型推理过程。

# ADR-0030：长 Session Resume Picker（ledger 只读候选）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 消费 `LearningSessionScanResult` 经纯函数 `buildSessionResumeCandidates` 产出的只读 resume 候选投影；调用方拥有 ledger.scan I/O。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0008](0008-learning-session-ledger-as-canonical-teaching-process.md)、[ADR-0031](0031-advanced-tech-inspector.md)
- **证据：** `src/shared/teaching-types/session-resume-picker.ts`、`src/main/session-resume-picker.ts`、`scripts/check-session-resume-picker.mjs`、`tests/unit/session-resume-picker.unit.test.ts`；提交 `669e3a2`、merge `cac87b0`

## 决定

长 Session 恢复入口消费 durable ledger 的 **scan 结果**，经纯函数 `buildSessionResumeCandidates(scan, query?)` 产出 `ResumePickerReport`：按 active+recent、completed、legacy/quarantined 等规则排序，并给出 `resumeEligibility` 与聚合 diagnostics。

默认 limit=20、最大 100。候选仅含身份与元数据（sessionId、course、lesson title、eventCount、timestamps、outcomeKind、eligibility），**不含** event payload / learner answers / assessment 正文。

可选 `listSessionResumeCandidates(ledger, query)` 仅薄封装 scan→build。

## 已实施范围与验证入口

- `src/shared/teaching-types/session-resume-picker.ts`
- `src/main/session-resume-picker.ts`
- `scripts/check-session-resume-picker.mjs`

```powershell
pnpm run check:session-resume-picker
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/session-resume-picker.unit.test.ts
```

## 不变量

- 纯投影优先；不修改 ledger。
- 候选不得携带 learner content 或 provider payload。
- 不改变 `TeachingTurnCoordinator.resume_session` 的 acceptance 语义权威。

## 不包含

- 不授权 renderer UI 或自动 resume。
- 不把 picker 排名写回 filesystem 真相源。

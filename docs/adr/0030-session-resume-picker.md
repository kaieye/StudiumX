# ADR-0030：长 Session Resume Picker（ledger 只读候选）

- **状态：** 已实施（P2-2；feature `669e3a2`；merge `cac87b0`）
- **范围：** 对 `LearningSessionScanResult` 的排名 resume 候选投影；调用方拥有 ledger.scan I/O
- **证据提交：** `669e3a2`、merge `cac87b0`

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

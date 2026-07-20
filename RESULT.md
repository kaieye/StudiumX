# P2-02 Session Resume Picker — RESULT

## Summary
Read-only projection that ranks durable `LearningSessionLedger.scan()` results into long-session resume candidates. Pure builder is the primary surface; optional thin ledger adapter scans then builds.

## Files
| Path | Role |
|------|------|
| `src/shared/teaching-types/session-resume-picker.ts` | Shared contracts: `ResumeCandidate`, `ResumePickerQuery`, `ResumePickerReport`, eligibility ladder, schemaVersion=1 |
| `src/main/session-resume-picker.ts` | `buildSessionResumeCandidates` (pure), `listSessionResumeCandidates` (adapter) |
| `src/shared/teaching-types.ts` | Barrel re-export |
| `tests/unit/session-resume-picker.unit.test.ts` | Unit coverage (ranking, filters, limits, redaction, adapter) |
| `scripts/check-session-resume-picker.mjs` | Static + unit gate |
| `package.json` | `check:session-resume-picker` script |

## Behavior
- **Ranking**: `ready` (active) + recent `updatedAt` first → `completed_read_only` (trusted outcome preferred) → `legacy_read_only` → `quarantined` → `corrupt`
- **Filters**: `courseId`, `statusFilter`, `queryText` (courseName / lessonTitle only — never event payloads / learner answers)
- **Limits**: default 20, hard max 100
- **Privacy**: candidates never include `events`, payloads, learner answers, assessment/provider fields
- **I/O**: builder is pure over `LearningSessionScanResult`; callers own scan

## Verify
```bash
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/session-resume-picker.unit.test.ts
node scripts/check-session-resume-picker.mjs
# or
pnpm run check:session-resume-picker
```

## Out of scope (as specified)
- TeachingTurnCoordinator `resume_session` command semantics
- UI

# Teaching event density policy (DB-P1-3)

**Status:** implemented (policy module + ledger guards)  
**Code:** `src/shared/event-density-policy.ts`  
**Related ADRs:** ADR-0002 (JSONL segments), ADR-0008 (LearningSession ledger), ADR-0015 (TeachingEvent protocol)

## Motivation

Marvis-style telemetry (≈3 sessions → ~17k events) creates volume and lock-contention risk. StudiumX separates:

1. **Canonical teaching events** that affect outcome / evidence authority  
2. **Operational debug events** that may exist only in diagnostic logs (mtime-purgeable)

Token streams must never be written “for convenient replay” into durable ledgers.

## Ledgers and closed kinds

### LearningSessionLedger (file-truth session process)

Closed kinds (must be durable evidence):

| Kind | Role |
| --- | --- |
| `lesson_opened` | Session/lesson binding |
| `lesson_completed` | Lesson completion fact |
| `retrieval_attempted` | Retrieval practice evidence |
| `quiz_attempted` | Quiz evidence |
| `flashcard_reviewed` | Flashcard evidence |
| `learner_response_recorded` | Learner response evidence |

Hard budgets (enforced in ledger + mirrored in policy):

| Budget | Value |
| --- | --- |
| Max event file | 1 MiB |
| Max payload JSON | 512 KiB |
| Max JSON depth | 64 |
| Soft max events / session | 500 |
| Soft max appends / minute / session | 30 |

Debug kinds (`token_stream`, `agent_delta`, `prompt_dump`, …) are **rejected** at append.

### learning-work.jsonl (compact conversation snapshots)

Only entry type:

| Type | Role |
| --- | --- |
| `conversation_snapshot` | Compact status + bounded evidence pointers |

Explicitly **not** stored:

- Turn / message content  
- Full tool arguments or tool result dumps  
- Token / stream deltas  
- Raw prompts or completions  

Budgets:

| Budget | Value |
| --- | --- |
| Evidence items / category | 40 |
| Text field max | 500 chars (redacted) |
| Active segment rotation | 50 MiB (ADR-0002) |
| Hard max serialized row | 256 KiB |
| Soft max snapshots / conversation / hour | 60 (idempotent `entryId` still collapses exact duplicates) |

Guard: `assertLearningWorkCanonicalEntry` / `validateLearningWorkCanonicalEntry` run before every durable append (`LearningWorkLedger`).

### TeachingEventEnvelope (runtime bus — ADR-0015)

Durability is payload-type closed:

| Tier | Payload types |
| --- | --- |
| Must durable | `session_opened`, `session_resumed`, `evidence_recorded`, `outcome_committed`, `outcome_already_committed` |
| Must ephemeral | `loop_snapshot`, `next_step`, `turn_progress`, `turn_terminal`, `replay_gap`, `legacy_adapted`, `unknown_rejected`, `command_accepted`, `command_duplicate` |
| Either | `outcome_insufficient_evidence`, `recover_reconciled` |

Ephemeral bus events are **not** a second file ledger. Legacy agent stream kinds are adapted to `legacy_adapted` summaries (≤160 chars) or `unknown_rejected` — never free-form dumps.

### Operational debug (non-canonical)

Examples: `token_stream`, `token_delta`, `stream_delta`, `agent_stream`, `debug`, `diagnostic`, `trace_dump`, `metrics_tick`, `heartbeat`, `prompt_dump`, `tool_result_dump`.

| Rule | Detail |
| --- | --- |
| Storage | Diagnostic logs only (`studiumx.log` / logger sinks) |
| Purge | mtime purge allowed (not C-2 canonical) |
| Forbidden ledgers | `learning-work.jsonl`, LearningSession `events/` |

## Enforcement

| Seam | Behavior |
| --- | --- |
| `LearningWorkLedger.appendSnapshot` | Calls `assertLearningWorkCanonicalEntry` before append |
| `LearningSessionLedger` normalize/append | Rejects non-closed and debug kinds |
| Unit tests | `tests/unit/event-density-policy.unit.test.ts` |

## Non-goals

- No automatic silent purge of canonical events  
- No FTS / search corpus from events  
- No secrets or raw prompts in ledgers  

## Verification

```bash
pnpm exec vitest run --project unit tests/unit/event-density-policy.unit.test.ts tests/unit/learning-work-ledger.unit.test.ts
```

# Multi-workspace projection performance (DB-P1-4)

**Status:** measurement plan + evaluation complete; **full rebuild retained** (no incremental writer)  
**Code today:** `src/main/local-data-index/index.ts` (`LocalDataIndex.rebuild`)  
**Related ADR:** ADR-0001 (rebuildable disposable SQLite projection)

## Current implementation (baseline)

`LocalDataIndex.rebuild()` always:

1. Scans canonical sources (workspaces, conversations, memory, learning-work JSONL segments).  
2. Computes an exact-byte **source manifest fingerprint** over provenance.  
3. In one SQLite transaction: **DELETE** all projection tables, then **INSERT** fresh rows.  
4. Marks `complete=0` during replacement, re-verifies the manifest, then `complete=1`.  
5. Adapter query paths re-check source currentness before returning projection rows.

Supporting knobs already present:

| Setting | Value | Role |
| --- | --- | --- |
| `busy_timeout` | 3000 ms | Writer/reader contention |
| `journal_mode` | WAL (best-effort) | Concurrent readers during rebuild |
| Single rebuild promise | `buildPromise` | One rebuild at a time per index |
| Quarantine on damage | rename `studiumx-index.sqlite*` | Disposable semantics |

There is **no** per-`source_key` incremental upsert writer today.

## Measurement plan

Use disposable fixtures under a temp app-data root (never production user data).

### Fixture matrix

| Fixture | Workspaces | Conversations / ws | Ledger lines / ws | Memory records |
| --- | ---: | ---: | ---: | ---: |
| S | 1 | 10 | 20 | 20 |
| M | 5 | 50 | 100 | 100 |
| L | 20 | 100 | 200 | 200 |

Generate with deterministic IDs and fixed payloads so runs are comparable.

### Metrics to capture

| Metric | How |
| --- | --- |
| Cold rebuild wall time | `performance.now()` around `rebuild()` |
| Warm rebuild (unchanged sources) | Second `rebuild()` immediately after |
| Partial change rebuild | Mutate 1 conversation in 1 workspace |
| Adapter query latency | 20× `tokenEvidenceAdapters` conversation + ledger reads |
| Peak RSS delta | `process.memoryUsage().heapUsed` before/after |
| SQLite file size | `stat(studiumx-index.sqlite)` |
| Issue count | `index.issues()` after rebuild |

### Suggested command skeleton

```bash
# From repo root; unit harness preferred over ad-hoc scripts in CI.
pnpm exec vitest run --project unit tests/unit/local-data-index.unit.test.ts
# Optional local micro-bench (not CI-blocking):
# node --import tsx scripts/bench-local-data-index.mjs  # not shipped until needed
```

Record results in a short note under `.studiumx/database-agents/reports/` when re-evaluating.

## Incremental rebuild vs full DELETE+INSERT

### Candidate design

- Keep `source_provenance(source_key, fingerprint)`.  
- Diff previous vs current fingerprints.  
- DELETE+INSERT only changed keys; leave unchanged rows.  
- On any mismatch, incomplete scan, or migration: **fall back to full rebuild**.

### Evaluation (decision: **do not implement incremental now**)

| Criterion | Full rebuild (current) | Incremental |
| --- | --- | --- |
| Correctness under concurrent source writers | Strong: whole-manifest fingerprint + multi-boundary checks | Harder: partial apply can race with cross-source consistency |
| Source-drift detection | Single fingerprint for entire input set | Must redefine fingerprint composition carefully |
| Failure recovery | Incomplete status + full rebuild | Needs partial rollback or tombstone rules |
| Code risk | Already shipped + tested | Touches every projection table writer |
| Perf gain (expected) | O(all sources) every rebuild | O(changed) when few sources change |
| Disposable semantics | Trivial | Must still allow delete-file recovery |

**Evidence threshold to revisit:** measure fixture L warm-vs-partial and show ≥2× wall-time benefit **and** no increase in incomplete/unavailable rates under injected mid-rebuild source edits. Until that evidence exists, full rebuild is the lower-risk path aligned with ADR-0001.

### When incremental would be acceptable (future)

1. Measurement note attached with fixture L numbers.  
2. Incremental path is behind a feature flag defaulting **off**.  
3. Any exception or fingerprint mismatch **must** fall back to full DELETE+INSERT.  
4. Unit tests for: single-key update, deleted source, mid-rebuild drift, quarantine still works.  
5. No change to canonical file bytes.

## Multi-workspace query notes

- Projection rows are keyed by `workspace_id` / `source_key`; queries should always filter by workspace when the product scope is single-workspace.  
- Cross-workspace analytics should tolerate `incomplete` / adapter `unavailable` and fall back to file scans (existing analytics path).  
- Do not introduce FTS or a second durable index format for this work item.

## Non-goals (this item)

- No incremental writer implementation without measurement evidence  
- No FTS  
- No secrets in projections  
- No change to canonical JSON/JSONL/Memory authority

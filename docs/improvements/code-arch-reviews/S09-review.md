# Slice S09 — code-arch-improve (read-only re-review)

**Agent:** Grok Build subagent (`improve-codebase-architecture` / `$code-arch-improve` gates)
**Revision:** `99d546a5480888d318f4511d1210c6d3971384d9` (HEAD `main`)
**Prior report rev:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary (module / interface / depth / seam / adapter / leverage / locality)
**Mode:** read-only — **0 production edits**

---

### Slice S09

Main-process remainder outside closed S01–S08: workspace peels, conversation runtime, lesson artifacts, memory catalog, local-data-index, music, observability, persistence, platform, skill-library, transport, study-planning durable store/IPC, app entry, inspectors, learning analytics (+ source-plan / token-evidence peels).

### Scope

| Item | Value |
| --- | --- |
| Revision | `99d546a5480888d318f4511d1210c6d3971384d9` |
| Residual population | ~**100–110** files / ~**22–24.5k** LOC in `src/main` after excluding closed S01–S08 clusters (giants body, agent-conversation, IPC/doctor/support, outcome/config, loop, context, tools, mcp) |
| **Examined deeply** | ~**10.5–11k** LOC hotspot sample (headers + ownership seams + tests + ADR anchors) |
| **Light / inherited** | Remaining ~**11–14k** residual small/peripheral modules — **not** re-opened as architecture debt without dual thrash signals (skill cost proportionality) |
| Sampled primary | `teaching/services/learning-analytics.ts` (~954) + `analytics/source-plan.ts` (~303) + `analytics/token-evidence.ts` (~717) ≈ **~2.0k**; `local-data-index/index.ts` (~1094) + `schema-migration.ts` (~284) ≈ **~1.4k**; `teaching-conversation-runtime.ts` (~780); `teaching-lesson-artifacts.ts` (~601); `teaching-memory-catalog.ts` (~550); workspace peels catalog/documents/inspector/change-audit/activation-lifecycle (~**2.3k**); `study-planning-durable-store.ts` (~380) + `study-planning-ipc.ts` (~157); `persistence/durable-file.ts` (~350); `learning-work-ledger` (+ evidence-snapshot); `tech-inspector.ts` (~497); `lesson-plan-production.ts` (~341); music cluster skim (service + netease/qq ~**1.5k**); `platform-capability-registry.ts`; `index.ts` (~444); usage-ledger/analytics skim |
| Explicit product-density note | Learning analytics is large but **projection / assemble only** (file truth + optional SQLite index adapters); not settlement / teaching authority |
| EXCLUDED (already closed) | S01 giants, S02 conversation cluster, S03 IPC/doctor/support, S04 outcome/config, S05 loop, S06 context, S07 tools, S08 mcp |
| ADRs / floor | ADR-0075 peel-by-touch; ADR-0117 study-planning paths/wire/store + host durable; ADR-0130 phase residual; ADR-0131 pathname_default / platform registry; memory consent + platform capability consumers; local index = disposable projection (**not** teaching truth; **no FTS**/vector product search); effect lattice; settlement sole-writer remains outside this residual (S01) |

**Material evidence**

- **Learning analytics** (`src/main/teaching/services/learning-analytics.ts` + peels): `LearningAnalyticsService` is a deep source-plan assembler (`LearningAnalyticsSourcePlan` with section-scoped fingerprints, invalidate, selective refresh). Token path uses explicit **durable adapters** + optional `LocalDataIndex` with **canonical file fallback** (`withCanonicalTokenEvidenceFallback`) — projection speedup, not second authority. Clear/export only touch app-data analytics cache / personal activity projections; `preservedSourceDomains` keeps teaching workspaces / conversations / ledger / review / memory. Shared personal-study validation stays in `shared/learning-analytics`. Size (~2k with peels) is product density, not a missing domain seam under ADR-0075. Units: `learning-analytics-source-plan`, `learning-analytics-incomplete-settings`, `teaching-analytics-token`, renderer shell tests separately.

- **Local data index** (`local-data-index/`): rebuildable SQLite projection (`studiumx-index.sqlite`); diagnostics marked `aggregateOnly: true`, `disposable: true`; schema migration separated; conversation list is metadata-only; schema comment explicitly **no FTS**. Doctor/support get aggregate issue counts, not row bodies. Adapter seams for token evidence / usage analytics fail to `unavailable` rather than inventing file authority.

- **Study planning durable host** (`study-planning-durable-store.ts` + `study-planning-ipc.ts`): ADR-0117 adapter — pure `StudyPlanningStore` in shared; host order **reload disk → trial CAS → durable persist → commit memory**; process-local `applyChain` + real-disk exclusive apply lock; fail-closed `io_failed` / `revision_conflict`. IPC parsers fail-closed on `expectedRevision` and command type set; registry keyed by resolved workspace root. Units: `study-planning-durable-store`, `study-planning-ipc` (+ shared store suite in S11).

- **Durable file** (`persistence/durable-file.ts`): shared pathname replace / backup primitive (ADR-0131); injectable `DurableFileOperations` for tests; used by study-planning, activation registry, music cookies, etc. — one deep I/O module, not duplicated orchestration.

- **Conversation runtime** (`teaching-conversation-runtime.ts`): composition root over closed S05 loop / S07 registry / S08 MCP inject; memory consent + platform capability gates; lesson tool lifecycle ports. Does not re-own settlement sole-writer. Tests exist under conversation runtime suite.

- **Memory catalog**: file-truth records via `record-file` + `platform-capability-registry` I/O profile; scan seams feed local-data-index only as disposable projection input.

- **Workspace peels** (activation-lifecycle, catalog, documents, inspector, change-audit): already extracted from giant workspace façade (S01 residual); each owns registry/docs/audit/summary concerns.

- **Tech inspector**: pure read-only assembler; default `learner_hidden`; no I/O, no auto-repair — matches doctor philosophy.

- **App entry** (`index.ts`): wires settings, workspace, skills, LocalDataIndex, LearningAnalytics, IPC/MCP/music gateways, crash marker, power bridge — composition, not a second domain core.

- **Music / transport / skill-library / observability doctor facts**: peripheral product or diagnostic surfaces with clear ownership; no settlement coupling; no YOLO product labels in residual (explicit anti-YOLO comments live in closed tool/MCP modules).

**Negative evidence**

- Residual ~22–24.5k main is a **bucket of many deep modules**, not one shallow megamodule. Exhaustive every-line review of unsampled peripherals would not create a high-payoff seam without thrash.
- No dual independent thrash signals at this HEAD (history + multi-caller friction + test pain) demanding a new cross-cutting architecture inside residual main.
- **Size alone** (analytics ~954, local-data-index ~1.1k, runtime ~780) is **not** a candidate (ADR-0075; skill cost proportionality).
- Splitting analytics further “for purity,” collapsing durable host into shared pure store, or promoting SQLite index to product search would either be speculative or **violate product floor** (files = teaching truth; no FTS/vector product search).
- Unsampled residual inherits **negative evidence** from stable peripheral status — not open architecture debt.

### Verdict

**Good enough — no architecture change recommended**

(Scope honesty: examined ~10.5–11k of ~22–24.5k residual by size + domain ownership sampling at HEAD `99d546a…`. Unsampled ~11–14k peripheral residual is **not** declared debt without dual thrash signals. Reopen only on signals below.)

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Residual areas are peels/adapters (workspace subdir, durable planning host, memory files, local index projection, analytics source-plan) |
| Interface depth | **Healthy** | Runtime/index/store/analytics service methods hide FS, CAS, rebuild, fingerprint cache; callers do not re-implement ordering |
| Seam legitimacy | **Healthy** | Projection vs file truth; durable host vs pure StudyPlanningStore; platform capability registry vs tools; token evidence adapters — domain-real |
| Test surface | **Healthy** | Units for durable-file, study-planning durable/IPC, local-data-index, learning-analytics source-plan, memory catalog, learning-work-ledger, platform registry |
| Conceptual integrity | **Watch** | Learning analytics remains a dense product assembler (WIP-era density noted in coverage tracker) — product completion / section growth, not dual-authority failure; track separately from architecture admit path |
| Cost proportionality | **Healthy** | No candidate with benefit clearly greater than migration + abstraction cost found in sample |

### Candidates

**0 candidates** (none admitted under skill gates: evidence + recurrence + causality + depth + safety + compatibility + net payoff).

**Reopen later only if:** (1) conversation-runtime grows into re-orchestrating loop/settlement invariants; (2) local-data-index becomes product search authority (FTS/vector) contrary to floor; (3) workspace peels thrash for single product changes across multiple modules; (4) study-planning CAS/lock bugs force dual authority with shared pure store; (5) analytics gains a second write path that competes with file/ledger truth or requires coordinated multi-module thrash without source-plan locality.

### Metrics for tracker

- approx_lines_examined: **10800** (deep sample; residual population ~22000–24500)
- files_examined: **~35 deep + ~20 header/skim**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: residual population larger than one ~10k slice; re-review at HEAD confirms prior honest sample; deep sample vs residual population = ~10.5–11k of ~22–24.5k; unsampled peripheral inherits negative evidence, not open debt

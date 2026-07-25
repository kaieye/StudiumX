# Slice S06 — code-arch-improve (read-only)

**Agent:** Grok Build / code-arch-improve (S06 HEAD re-confirm)
**Revision:** HEAD `d9435064` (prior 0-cand closeout; light re-review)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S06

AI context / delegation / search / provider / lesson cluster under `src/main/ai/**` (**excluding** agent-loop lifecycle owned by S05 and `tools/**` owned by S07).

Primary modules: `provider-adapter.ts` + `provider-adapter/**`, request-context / estimator / compactor / hygiene / projection-report, `delegation-runtime.ts`, `child-capability-subset.ts`, `child-run-supervisor.ts`, `search-runtime.ts`, `teaching-lexical-search.ts`, `lesson-renderer.ts`, `lesson-prompts.ts`, `provider-hooks.ts`, session/runtime façades that are not the loop core.

### Scope

| Item | Value |
| --- | --- |
| Revision | `d9435064` |
| Primary LOC | **~6.9k** across **~30** production modules (prior metric retained) |
| Expansion hop | `runAgentLoop` callers of `callProvider`/`streamProvider`/`RequestContextProjector` (S05); tool search handlers (S07) |
| ADRs | **0013** provider adapter; **0044** prompt-cache / context shape; **0045** context budget; **0050** lesson rendering; **0064**/**0065** delegation / child capability |
| Product floor | No shell product path; no YOLO; provider privacy; external search provenance untrusted; MCP tools still effect lattice (S07/S08) |
| Tests | provider SSE / context / compactor / hygiene / delegation suites |

**Material evidence**

- **Provider façade depth:** `provider-adapter.ts` exposes small `callProvider` / `streamProvider` / chat variants; invocation, request-builder, response-parser, sse-parser, formats, capabilities live behind peels. Callers use the façade — deletion test: format/SSE/auth would scatter into the loop.
- **SSE peel legitimacy:** framing loop sole in sse-parser peels; HEAD polish remains local to peels + units, not a second provider stack.
- **Request-context seam:** projector hides hygiene → estimate → compact → privacy-safe report ordering; summarizer inject is the real variation adapter (ADR-0044/0045).
- **Delegation / child subset:** capability assert and supervisor separate from provider HTTP; amplification errors explicit.
- **Search runtime:** multi-provider fallback + restricted paths + untrusted provenance envelope — adapter over tools; not teaching authority.
- **Lesson rendering:** prompts/renderer modules (ADR-0050) keep HTML locality outside provider SSE.

**Negative evidence**

- No coordinated multi-module bug series across context ladder and tools at HEAD.
- Merging sse-parser into invocation or splitting further by size fails cost proportionality (ADR-0075 size alone).
- Provider adapter is not settlement sole-writer and not teaching evidence ledger.
- No YOLO/shell product registration in this cluster.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | SSE/usage in peels; context ladder, search, delegation already separate files |
| Interface depth | **Healthy** | Façade `callProvider`/`streamProvider` + `RequestContextProjector.project` hide framing/format |
| Seam legitimacy | **Healthy** | Formats, summarizer inject, search fallback, child capability subset — demonstrated variation |
| Test surface | **Healthy** | SSE + context/delegation suites exercise public seams |
| Conceptual integrity | **Healthy** | ADR-0013/0044/0045/0064/0065 language matches modules |
| Cost proportionality | **Healthy** | Further re-partition of ~7k without dual thrash is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) callers re-implement SSE framing/format deltas outside provider-adapter; (2) hygiene/compaction thrash forces dual edits in loop + projector for one change; (3) child capability amplification leaks into provider HTTP; (4) search provenance treated as teaching evidence authority.

### Metrics for tracker

- approx_lines_examined: **6900**
- files_examined: **~30 production + hop samples**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: HEAD `d9435064` re-confirm; prior 0-cand stands

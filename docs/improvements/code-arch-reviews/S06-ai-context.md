# Slice S06 — code-arch-improve (read-only)

**Agent:** /root (main-thread re-review after provider SSE polish; wave subagent did not rewrite file)
**Revision:** `99d546a5480888d318f4511d1210c6d3971384d9`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S06

AI context / delegation / search / provider / lesson cluster under `src/main/ai/**` (excluding agent-loop lifecycle owned by S05 and tools/** owned by S07).

Primary modules: `provider-adapter.ts` + `provider-adapter/**`, `request-context-projection.ts`, `context-estimator.ts`, `context-compactor.ts`, `request-history-hygiene.ts`, `context-projection-report.ts`, `delegation-runtime.ts`, `child-capability-subset.ts`, `child-run-supervisor.ts`, `search-runtime.ts`, `teaching-lexical-search.ts`, `lesson-renderer.ts`, `lesson-prompts.ts`, `provider-hooks.ts`.

### Scope

| Item | Value |
| --- | --- |
| Revision | `99d546a5480888d318f4511d1210c6d3971384d9` |
| Primary LOC | **~6.9k** across **~30** production modules (prior metric retained; provider-adapter tree **7 files / ~1.2k** + façade **141**) |
| Drift since prior | `provider-adapter/{invocation,request-builder,response-parser,sse-parser}.ts` — SSE reasoning/usage polish + unit tests |
| Expansion hop | `runAgentLoop` callers of `callProvider`/`streamProvider`/`RequestContextProjector` (S05); tool search handlers (S07) |
| ADRs | **0013** provider adapter; **0044** prompt-cache / context shape; **0045** context budget; **0050** lesson rendering; **0064**/**0065** delegation / child capability |
| Product floor | No shell product path; no YOLO; provider privacy; external search provenance untrusted; MCP tools still effect lattice (S07/S08) |
| Tests | `provider-sse-reasoning`, `provider-sse-usage`, context/compactor/hygiene units, delegation/child capability suites |

**Material evidence**

- **Provider façade depth:** `provider-adapter.ts` exposes small `callProvider` / `streamProvider` / chat variants + types; invocation, request-builder, response-parser, sse-parser, formats, capabilities live behind peels. Callers (`runAgentLoop`, plan/repair/compact) use the façade — deletion test: format/SSE/auth details would scatter into the loop.
- **SSE peel legitimacy:** `consumeSsePayloads` is the sole framing loop; `readSseStream` / chat stream paths share decode/`data:`/`[DONE]`; `extractStreamDelta` normalizes messages/responses/OpenAI-delta including reasoning. HEAD polish adds usage + reasoning callbacks without inventing a second provider stack.
- **Request-context seam:** `RequestContextProjector.project` hides hygiene → estimate → compact → privacy-safe report ordering; summarizer is the sole injected adapter (real variation for tests). Matches ADR-0044/0045 locality.
- **Delegation / child subset:** capability subset assert and supervisor remain separate modules from provider HTTP; amplification errors are explicit — not fused into provider-adapter.
- **Search runtime:** multi-provider fallback + WeChat restricted path + fetch envelope with `externalUntrustedContentProvenance` — deep adapter over tool handlers; not teaching authority.
- **Lesson rendering:** separate prompts/renderer modules (ADR-0050) — change locality for lesson HTML stays outside provider SSE.

**Negative evidence**

- Provider SSE change is local to peels + new unit tests; no coordinated multi-module bug series across context ladder and tools.
- Merging sse-parser into invocation or splitting further by size fails cost proportionality (ADR-0075 size alone).
- No dual authority: provider adapter is not settlement sole-writer; not teaching evidence ledger.
- No YOLO/shell product registration in this cluster.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | SSE/usage/reasoning landed in peels; context ladder and search/delegation already separate files |
| Interface depth | **Healthy** | Callers use façade `callProvider`/`streamProvider` and `RequestContextProjector.project`; framing and format rules hidden |
| Seam legitimacy | **Healthy** | Provider formats, summarizer inject, search provider fallback, child capability subset — demonstrated variation |
| Test surface | **Healthy** | SSE reasoning/usage units + existing context/delegation suites exercise public seams |
| Conceptual integrity | **Healthy** | ADR-0013/0044/0045/0064/0065 language matches module headers |
| Cost proportionality | **Healthy** | Further re-partition of ~7k without dual thrash is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) callers repeatedly re-implement SSE framing or format deltas outside provider-adapter; (2) context hygiene/compaction policy thrash forces dual edits in loop + projector for one change; (3) child capability amplification leaks into provider HTTP stack; (4) search provenance is treated as teaching evidence authority.

### Metrics for tracker

- approx_lines_examined: **6900**
- files_examined: **~30 production + hop samples**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: HEAD re-review after provider SSE polish; prior 0-cand stands with updated evidence

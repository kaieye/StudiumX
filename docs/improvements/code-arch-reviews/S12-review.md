# Slice S12 — code-arch-improve (read-only)

**Agent:** Grok Build / code-arch-improve (S12 HEAD re-confirm)
**Revision:** HEAD `d9435064` (prior 0-cand closeout; light re-review)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S12

Remaining shared after S08/S10/S11: `lesson-style-themes/**` + residual root (provider*, agent-*, music*, model catalog), `learning-analytics/personal-study-source.ts`, `protocol/**`.

### Scope

| Item | Value |
| --- | --- |
| Revision | `d9435064` |
| Primary LOC | **~37 files / ~8.7k** (order of magnitude retained) |
| Examined deeply | theme contract/types/base + `lesson-style-registry`; provider-recovery/error/retry/overflow/format/url; agent-persisted-history + secret redaction; personal-study-source; thin protocol/music |
| EXCLUDED | mcp (S08), teaching-types/events/settings (S10), study-planning (S11) |
| ADRs | 0052 recovery taxonomy; 0057 bounded retry; 0125 overflow; 0070 agent runtime wire; secret redaction / privacy floor |
| Tests | provider-recovery/retry/overflow/error; agent history / redaction; lesson-style durable |

**Material evidence**

- **Lesson styles:** token + CSS data modules behind `LessonStyleDefinition` and `LessonStyleRegistry`; adding a style is local (theme file + registry entry). Large CSS strings are content depth, not shallow orchestration.
- **Provider cluster:** dual-axis UX kind vs recovery decision (`classifyProviderRecovery`, ADR-0052); retry/overflow pure helpers (ADR-0057/0125). Callers consume classifications — knowledge not reimplemented across many shared files.
- **Persisted history / redaction:** single sanitizer boundary with omit-on-uncertainty; privacy depth with tests.
- **Personal study source:** pure validation/projection of local analytics facts with caps; not teaching authority; not remote telemetry.
- **Protocol / music:** thin wire types; no second product surface.

**Negative evidence**

- Theme CSS file size is product content, not an architecture peel opportunity under skill gates.
- Main provider SSE lives in S06; shared provider modules remain stable pure helpers.
- No FTS/vector; no YOLO/shell enablement in residual shared.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Style add = theme file; provider taxonomy stays in shared helpers |
| Interface depth | **Healthy** | classify*/sanitize*/registry hide patterns and policy |
| Seam legitimacy | **Healthy** | Pure shared vs main adapter; recovery flags vs retry loop ownership |
| Test surface | **Healthy** | Provider + history + style units |
| Conceptual integrity | **Healthy** | ADRs match module headers |
| Cost proportionality | **Healthy** | No candidate with positive NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) recovery classification duplicated in main without shared decision; (2) secrets persist past sanitizer boundary; (3) lesson themes force multi-file token schema thrash for single style adds; (4) analytics pure modules become teaching authority or remote telemetry.

### Metrics for tracker

- approx_lines_examined: **8750**
- files_examined: **37**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: HEAD `d9435064` re-confirm; prior 0-cand stands

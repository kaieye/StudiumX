# Slice S12 — code-arch-improve (read-only)

**Agent:** /root (main-thread)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S12

Remaining shared after S08/S10/S11: `lesson-style-themes/**`, residual root (provider*, agent-*, music*, model catalog), `learning-analytics/personal-study-source.ts`, `protocol/**`.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | **37 files / ~8.7k** |
| Examined deeply | theme contract/types/base + registry re-export pattern; provider-recovery/error/retry/overflow/format/url; agent-persisted-history + secret redaction; personal-study-source; thin protocol/music |
| EXCLUDED | mcp (S08), teaching-types/events/settings (S10), study-planning (S11) |
| ADRs | 0052 recovery taxonomy; 0057 bounded retry; 0125 overflow; 0070 agent runtime wire; secret redaction / privacy floor |
| Tests | provider-recovery/retry/overflow/error units; agent-persisted-history / secret-redaction / conversation-turns; lesson-style durable |

**Material evidence**

- **Lesson styles:** token + CSS data modules behind `LessonStyleDefinition` and registry; `buildLessonCss` is pure generation. Large CSS strings are content depth, not shallow orchestration. Adding a style is local (one theme file + registry entry).
- **Provider cluster:** dual-axis UX kind vs recovery decision (ADR-0052); retry policy pure (ADR-0057); overflow patterns pure (ADR-0125). Callers (agent-loop, provider-adapter) consume classifications — knowledge of recovery flags not reimplemented across many files in shared.
- **Persisted history:** single sanitizer boundary with omit-on-uncertainty; never echoes secrets in failure paths — deep privacy module with tests.
- **Personal study source:** pure validation/projection of analytics facts with caps; not teaching authority; not remote telemetry.
- **Protocol / music:** thin wire types; no second product surface.

**Negative evidence**

- Theme CSS file size is product content, not an architecture peel opportunity under skill gates.
- Provider adapter dirty WIP (SSE) is main process (S06 closed); shared provider modules remain stable pure helpers.
- No FTS/vector; no YOLO/shell enablement in residual shared.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Style add = theme file; provider taxonomy changes stay in shared helpers |
| Interface depth | **Healthy** | classify*/sanitize*/buildLessonCss hide patterns and policy |
| Seam legitimacy | **Healthy** | Pure shared vs main adapter; recovery flags vs retry loop ownership |
| Test surface | **Healthy** | Provider + history + style units |
| Conceptual integrity | **Healthy** | ADRs match module headers |
| Cost proportionality | **Healthy** | No candidate with positive NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) recovery classification duplicated in main without shared decision; (2) secrets persist past sanitizer boundary; (3) lesson themes force multi-file token schema thrash for single style adds; (4) analytics pure modules become teaching authority or remote telemetry.

### Metrics for tracker

- approx_lines_examined: **8729**
- files_examined: **37**
- candidate_count: **0**
- status_for_tracker: **good_enough**

# Slice S14 — code-arch-improve (read-only)

**Agent:** Grok Build (code-arch-improve)
**Revision:** HEAD `d9435064` (analytics-focused re-review after heatmap/gauges/focus board polish)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S14

Renderer workbench B — **analytics drift at HEAD** (schedule/recurrence/sheets stable from prior S14).

### Scope

| Item | Value |
| --- | --- |
| Focus | `src/renderer/src/views/workbench/analytics/**`, `src/shared/learning-analytics/**`, main learning-analytics service sample, analytics units |
| Primary LOC | **~9200** deep sample |

**approx_lines_examined:** **~9200**  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- OfficeWorkbench is route-only for analytics; no policy in shell.
- Page/SectionBodies/charts present over closed section DTOs.
- `useStudyAnalytics` is client shell (query/IPC), not fact authority.
- `activityLedger` is local rebuildable projection with retention/diagnostics.
- Shared `personal-study-source` validates + rebuilds + builds focus/heatmap sections.
- Main LearningAnalyticsService multi-source orchestration stays local (not phone-home).
- Heatmap/gauges/focus board are UI polish on stable contracts.
- Parallel pure helpers (daily rebuild, local-date arithmetic) are sibling adapters across wire boundary, not dual writers.

### Negative evidence

- Analytics is not teaching evidence authority or settlement bypass.
- No FTS5/vector product search; no default remote telemetry.
- Peel-for-size fails ADR-0075.
- Unifying two projection rebuilds is hygiene-only (negative NPV under skill gates).

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Charts/copy change without main aggregation |
| Interface depth | **Healthy** | SectionResult + validate→build pipeline |
| Seam legitimacy | **Healthy** | Local personal facts vs teaching file truth |
| Test surface | **Healthy** | activity-ledger, personal-analytics, page-shell, focus units |
| Conceptual integrity | **Healthy** | Local study analytics; demo shares heatmap constant |
| Cost proportionality | **Healthy** | 0 candidates; polish did not create dual authority |

### Candidates

**0 candidates**.

**Reopen if:** remote telemetry; second personal-fact writer; renderer reimplements aggregation; conflicting metrics from dual rebuild drift; schedule dual-authorizes localStorage as planning truth.

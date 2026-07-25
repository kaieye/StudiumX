# Slice S18 — code-arch-improve (read-only)

**Agent:** Grok Build / code-arch-improve (S18 HEAD re-confirm)
**Revision:** HEAD `d9435064` (prior 0-cand closeout; light re-review)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**
**Method:** sampled gate inventory (not line-by-line of entire scripts tree)

---

### Slice S18

Scripts / domain CI gates and fixtures under `scripts/` — sample of `check-*` gates + fixture/lib layout.

### Scope

| Item | Value |
| --- | --- |
| Revision | `d9435064` |
| Primary LOC | **~28k total** scripts; **~150+ `check-*` gates / ~11.5k**; remainder fixtures + libs + runners |
| Sampled | largest / domain-critical check-* (evidence, doctor, tool-contract, module-size, workbench/theme, agent-loop, learning-outcome, security suite entry); fixture density; package.json check script graph |
| ADRs / policy | ADR-0023 blocking CI narrow+hard; ADR-0075 module-size warning-only; product floor domain gates over coverage fashion |

**Material evidence**

- **Gates are domain CI architecture, not product modules.** Each `check-*.mjs` encodes a hard or warning invariant (evidence, doctor, theme, workbench, IPC, security-related suites via package scripts). Intended place for thrashable policy, not `src/`.
- **Fixtures** under `scripts/fixtures/` support agent/teaching scenarios for gate scripts — test adapters, not dual authorities.
- **Module-size** remains warning-oriented (`check-module-size.mjs`) consistent with ADR-0075 — size alone is not a product peel mandate.
- Blocking vs non-blocking separation aligns with AGENTS.md / ADR-0023 (narrow hard CI; full e2e/release-audit not every PR).

**Negative evidence**

- Unifying all gates into a single framework would add abstraction cost without observed dual thrash of one shallow interface.
- No product shell/YOLO surface introduced by gate scripts.
- Full line-by-line of fixtures is low-value for architecture candidacy; inventory + largest gates suffice for skill stopping rules.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | One check file per domain invariant; fixtures colocated |
| Interface depth | **Healthy** | Package scripts invoke named gates; runner libs stay thin |
| Seam legitimacy | **Healthy** | Scripts = CI policy surface, separate from product runtime |
| Test surface | **Healthy** | Gates *are* the domain test surface |
| Conceptual integrity | **Healthy** | Matches testing.md / ADR-0023 layering |
| Cost proportionality | **Healthy** | Gate sprawl is intentional domain CI, not unearned product abstraction |

### Candidates

**0 candidates**

**Reopen if:** gates start mutating production code paths; blocking CI replaced by coverage fashion; scripts reintroduce YOLO/shell product claims; duplicate competing gate frameworks without domain reason.

### Metrics for tracker

- approx_lines_examined: **11500** (check-* gates sampled; fixtures inventory noted)
- files_examined: **~150** check-* (+ fixture inventory)
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: full scripts tree ~28k; method = gate inventory sample (honest like S09); HEAD `d9435064` re-confirm

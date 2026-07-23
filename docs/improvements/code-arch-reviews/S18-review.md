# Slice S18 — code-arch-improve (read-only)

**Agent:** /root (main-thread)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**
**Method:** sampled gate inventory (not line-by-line of all ~28k)

---

### Slice S18

Scripts / domain CI gates and fixtures under `scripts/`.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | **~28.0k total** scripts; **151 `check-*` gates / ~11.5k**; remainder fixtures + libs + runners |
| Sampled | largest check-* (lesson-styles, evidence-idempotency, pet-animation, workbench/UI/theme gates, doctor, module-size); fixture density; package.json check/test script count (~123) |
| ADRs / policy | ADR-0023 blocking CI narrow+hard; ADR-0075 module-size warning-only; product floor domain gates over coverage fashion |

**Material evidence**

- **Gates are domain CI architecture, not product modules.** Each `check-*.mjs` encodes a hard or warning invariant (evidence, doctor, theme, pet, workbench, IPC, security-related suites via package scripts). That is the intended place for thrashable policy, not `src/`.
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
| Seam legitimacy | **Healthy** | Scripts = CI policy surface, separate from product runtime |
| Cost proportionality | **Healthy** | Gate sprawl is intentional domain CI, not unearned product abstraction |
| Conceptual integrity | **Healthy** | Matches testing.md / ADR-0023 layering |

### Candidates

**0 candidates**

**Reopen if:** gates start mutating production code paths; blocking CI replaced by coverage fashion; scripts reintroduce YOLO/shell product claims; duplicate competing gate frameworks without domain reason.

### Metrics for tracker

- approx_lines_examined: **11511** (check-* gates sampled; fixtures inventory noted)
- files_examined: **151** check-* (+ fixture inventory)
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: full scripts tree ~28k; review method = gate inventory sample honest like S09

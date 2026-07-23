# Slice S04 — code-arch-improve (read-only)

**Agent:** /root (main; subagent brief-delivery failed for s04_pass1)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S04

Outcome durability + teaching config/catalogs: evaluator, committer, config resolver/overlay, course store, resume picker, usage ledger, resource grounder, config optimistic writer.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | 613+974+632+400+623+386+583+509+329 ≈ **5.0k** |
| Expansion hop | Host `commitLearningOutcome` → coordinator `commit_outcome` turn; workspace service factory path; settlement durable I/O |
| ADRs | 0010 evidence-gated record; **0011 outcome settlement**; 0018 recordless marker-only; **0025 secret-free config layers**; **0033 config optimistic concurrency**; 0075 peel-by-touch |
| Product floor | Committer is **durability writer behind ports**, not second product settlement authority; files = teaching truth; secrets out of ordinary config snapshot |
| History | Settlement durability harden series (`b19af83e`, `7292bf41`, `0acaaa4f` land committer); config resolver `a21de1bc` layered secret-free snapshot — feature landings, not multi-module thrash of one shallow seam |
| Tests | `learning-outcome-committer.unit.test.ts`, workspace outcome commit, config-related units; coordinator/host already cover sole-writer path (S01/S03) |

**Material evidence**

- **Committer interface** (`learning-outcome-committer.ts:123–132`): deep `evaluate` / `commit` / `reconcile`; module header: *only writer for evaluator-derived outcomes/records*; evaluation read-only; commit reloads canonical session under writer lock.
- **Sole-writer product path**: host synthesizes `commit_outcome` turn (`teaching-turn-coordinator-host.ts:137–156`); gateway prefers host (S03). Workspace `commitLearningOutcome` is a factory/adapter path that still uses the same committer — not a competing product settlement authority.
- **Config**: `teaching-config-resolver` layered default < managed < user < workspace < session_override; **no FS I/O**, **secret-free ordinary snapshot** (ADR-0025). Overlay parse separated. `config-optimistic-writer` pure CAS core (ADR-0033) — fingerprint mismatch → structured conflict; secret paths rejected before apply.
- **Course store / resume picker / usage ledger / resource grounder**: bounded durable stores and grounding adapters; no evidence of callers re-orchestrating settlement or config CAS invariants.

**Negative evidence**

- Committer size (~974) is durability complexity that *belongs* behind the interface; peeling for line count alone fails ADR-0075 + skill cost gate without dual friction signals.
- No series of bugs showing callers re-implementing reconcile/settlement marker logic.
- Dual host vs workspace commit entry is intentional multi-workspace composition, not a missing seam requiring a new module (host remains sole IPC settlement writer when present).

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Evaluator vs committer vs config pure CAS vs stores already split; settlement durability fixes concentrate in committer/ledger I/O |
| Interface depth | **Healthy** | Callers use `commit`/`reconcile`/`resolveTeachingConfig`/CAS write result; lock, stage, marker identity, fingerprint stay inside |
| Seam legitimacy | **Healthy** | Ports for evaluate inject + ledger lock; config layering domain-real; CAS matches multi-writer config risk |
| Test surface | **Healthy** | Committer + config units exercise public interfaces |
| Conceptual integrity | **Healthy** | ADR-0011/0018/0025/0033 language matches module headers |
| Cost proportionality | **Healthy** | Further pure peel of committer body without recurrence is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) product settlement path bypasses host/coordinator and writes markers from multiple authorities; (2) config CAS conflicts require coordinated dual-edits of resolver + writer beyond intentional co-change; (3) secrets leak into public config fingerprint surface.

### Metrics for tracker

- approx_lines_examined: **5049**
- files_examined: **9 primary + hop samples (~6)**
- candidate_count: **0**
- status_for_tracker: **good_enough**

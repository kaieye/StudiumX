# Slice S04 — code-arch-improve (read-only)

**Agent:** Grok Build / code-arch-improve (S04 HEAD re-confirm)
**Revision:** HEAD `d9435064` (prior 0-cand closeout; light re-review)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S04

Outcome durability + teaching config/catalogs: learning-outcome committer/evaluator, teaching-config-resolver, teaching-settings, course/catalog stores, resume picker, usage ledger, resource grounder, config optimistic writer.

### Scope

| Item | Value |
| --- | --- |
| Revision | `d9435064` |
| Primary modules | `learning-outcome-committer`, teaching-config-resolver, teaching-settings path, catalogs / course store / resume picker / usage ledger / resource grounder / config-optimistic-writer |
| Primary LOC | ~5.0k order of magnitude (prior campaign metric retained) |
| Expansion hop | Host `commitLearningOutcome` → coordinator `commit_outcome`; workspace factory path; settlement durable I/O |
| ADRs | 0010 evidence-gated record; **0011 outcome settlement**; 0018 recordless marker-only; **0025 secret-free config layers**; **0033 config optimistic concurrency**; 0075 peel-by-touch |
| Product floor | Committer is **durability writer behind ports**, not second product settlement authority; files = teaching truth; secrets out of ordinary config snapshot |
| Tests | committer / config / CAS units; coordinator/host sole-writer covered in S01/S03 |

**Material evidence**

- **Committer** (`createLearningOutcomeCommitter`): deep `evaluate` / `commit` / `reconcile` surface; durability + lock + marker identity stay inside; evaluation remains read-side relative to commit.
- **Sole-writer product path**: host synthesizes `commit_outcome` turn; workspace `commitLearningOutcome` is adapter/factory over the same committer — not a competing product settlement authority.
- **Config**: `resolveTeachingConfig` layered default < managed < user < workspace < session_override; **no FS I/O** in pure resolve; secret-free ordinary snapshot + `fingerprintTeachingConfig` / `isTeachingConfigSecretPath` (ADR-0025). CAS writer (ADR-0033) rejects secret paths before apply.
- **Catalogs / stores / grounder / resume picker**: bounded durable read/write adapters; no re-orchestration of settlement or config CAS invariants observed at HEAD.

**Negative evidence**

- Committer size is durability complexity behind a deep interface; peel-for-size alone fails ADR-0075 + skill cost gate without dual thrash.
- No multi-fix series of callers re-implementing reconcile/marker logic.
- Dual host vs workspace entry remains intentional multi-workspace composition.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Evaluator vs committer vs config pure CAS vs stores already split |
| Interface depth | **Healthy** | Callers use `commit`/`reconcile`/`resolveTeachingConfig`/CAS results; lock/stage/fingerprint inside |
| Seam legitimacy | **Healthy** | Ports for evaluate inject + ledger lock; config layering domain-real; CAS matches multi-writer risk |
| Test surface | **Healthy** | Committer + config units exercise public interfaces |
| Conceptual integrity | **Healthy** | ADR-0011/0018/0025/0033 language matches modules |
| Cost proportionality | **Healthy** | Further pure peel without recurrence is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) product settlement bypasses host/coordinator with multiple marker authorities; (2) config CAS conflicts force dual-edits of resolver + writer beyond intentional co-change; (3) secrets leak into public config fingerprint surface.

### Metrics for tracker

- approx_lines_examined: **5100**
- files_examined: **9 primary + hop samples**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: HEAD `d9435064` re-confirm; prior 0-cand stands

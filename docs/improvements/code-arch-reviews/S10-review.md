# Slice S10 — code-arch-improve (read-only)

**Agent:** /root (main-thread; spawn path unreliable for briefs)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S10

Shared teaching contracts: `teaching-types/**`, canonical teaching events, settings schema (pure), teaching commands, turn-review pure projections, event/backup/learner-profile policies, features registry, related root teaching pure modules. **Excluded:** `shared/mcp/**` (S08), `study-planning/**` (S11), `lesson-style-themes/**` (S12), provider/agent-history/music roots.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary population | **62 files / ~12.8k LOC** (slightly over 10k plan; one logical contract slice) |
| Examined deeply | events parse/create + durability; settings defaults/normalize/merge; learning-session/outcome/lesson-interaction; agent replay `toolsReplayed:false`; system-api facade header; command catalog; event-density / learner-profile / backup-export / features policies; turn-review cluster headers |
| Expansion hop | main `teaching-settings.ts` (FS/secret adapter over pure schema); event-bus + coordinator as sole consumers of envelopes (already S01) |
| ADRs / floor | **0015** canonical events; 0009/0010/0011 evidence/settlement language; **0025** secret-free settings layers; 0033 CAS types; 0087/0110/0114 turn-review; 0073 features; consent-gated memory; no YOLO/shell; files = teaching truth |
| History | Feature landings (MCP settings, doctor, turn-review peels, session protocol) — not multi-module thrash of one shallow shared seam |
| Tests | `teaching-events.unit.test.ts` (~703), `teaching-settings-schema.unit.test.ts` (~263), `event-density-policy.unit.test.ts` (~213), turn-review / command / IPC units |

**Material evidence**

- **`teaching-events.ts` (~1751):** closed tagged-union protocol + `createTeachingEvent` / `parseTeachingEvent` / durability policy / legacy adapter boundary. Envelope consumers are coordinator + event-bus only; parsers reject unknown payloads without raw leak (ADR-0015). Size is protocol surface + validators, not pass-through. Deletion test: complexity would reappear across authors.
- **Settings:** `teaching-settings-schema` is pure (no `fs`/electron); main service owns secret encode + durable write. Types in `teaching-types/settings.ts`; approval modes closed (no YOLO label in product enums).
- **Domain types peel:** learning-session / outcome / lesson-interaction / next-teaching-step / teaching-context are small deep contracts aligned with ledger + evidence language. `normalizeLessonInteraction` keeps validation local.
- **Agent types:** `toolsReplayed: false` (literal) on replay/fork metadata — product invariant at the type layer.
- **Policies:** event-density (canonical vs debug ledger classes), learner-profile consent policy, backup/export path classes, features metadata-only registry with forbidden bypass keys — each a single policy module, tested or clearly bounded.
- **Turn-review pure modules:** approve/handoff/last-bundle projections separated per ADR peels; not fused with settlement writers.
- **Commands:** closed teaching slash catalog; execution kinds never map to shell/tool bypass.

**Negative evidence**

- Churn concentrates on `system-api.ts` / IPC contract as **product surface growth** (new teach:* methods), not as callers re-implementing parse/CAS/settlement invariants.
- `teaching-types.ts` barrel deliberately omits some submodules (import-by-path); not a broken barrel requiring architecture change.
- `TeachingSystemApi` is a wide preload-facing facade by nature; splitting for line count alone fails ADR-0075 + skill cost gate without dual friction signals.
- No FTS5/vector product search; YOLO/shell appear only as **forbidden** feature keys.
- Dirty WIP (timer/analytics/provider SSE) is outside this pure-contract slice.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Event protocol, settings pure schema, outcome/session types, policies already split by domain concept |
| Interface depth | **Healthy** | Callers use create/parse/normalize/merge/policy objects; payload validators and durability rules stay inside |
| Seam legitimacy | **Healthy** | Pure schema vs main secret FS; runtime events vs file ledger; command catalog vs tools — domain-real |
| Test surface | **Healthy** | Events/settings/density/turn-review/command units exercise public interfaces |
| Conceptual integrity | **Healthy** | ADR-0015/0025/settlement/memory language matches module headers |
| Cost proportionality | **Healthy** | Peeling events body or system-api for size alone is negative NPV without recurrence |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) second independent teaching-event authoring/parser appears outside this module; (2) settings pure schema gains FS/secret side effects; (3) `toolsReplayed` or approval enums admit YOLO/always-approve product paths; (4) system-api thrash forces dual-edit of the same invariant across many type files without intentional co-change.

### Metrics for tracker

- approx_lines_examined: **12800**
- files_examined: **62 primary (deep sample on ~20 hotspots + hop)**
- candidate_count: **0**
- status_for_tracker: **good_enough**

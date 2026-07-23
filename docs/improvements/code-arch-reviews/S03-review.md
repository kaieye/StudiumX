# Slice S03 — code-arch-improve (read-only)

**Agent:** /root/rev_s03
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S03

Teaching IPC / doctor / support / capability: `teaching-ipc-commands.ts`, `teaching-ipc-commands-agent-conversation.ts`, `teaching-ipc-commands-turn-review.ts`, `teaching-ipc-gateway.ts`, `teaching-doctor.ts`, `support-bundle.ts`, `teaching-capability-catalog.ts`.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | 759 + 350 + 593 + 841 + 966 + 923 + 805 ≈ **5.2k** (slice plan ~6.5k incl. hop) |
| Expansion hop | `teaching-turn-coordinator-host` sole-writer commit path; shared IPC types / observability redact (not tools/** or mcp/** product surface) |
| ADRs | 0022 catalog; 0027/0084/0093 doctor; 0034/0107 support-bundle; 0082/0087/0110/0114 turn-review & agent-chat IPC; **0119/0120 by-touch peels**; 0075 size / peel-by-touch; expectedRevision CAS; secret-free DTO |
| Product floor | Settlement sole-writer via host when present; parsers never second settlement authority; no YOLO; doctor autoRepair disabled; support consent-gated export; secrets out of Doctor/support public DTO |
| History | Commands ↔ gateway ↔ IPC contract/fixture co-change (expected allowlist discipline); doctor/support land as independent feature collectors; peels already landed by touch (ADR-0119/0120) — **not** multi-module bug thrash of one shallow seam |
| Tests / gates | Units: `teaching-ipc-commands`, `teaching-ipc-gateway`, doctor*, support-bundle, capability-catalog, turn-review IPC*; scripts: `check:teaching-ipc-contract`, `check:teaching-ipc-commands`, `check:doctor`, `check:support-bundle` |

**Material evidence**

- **Gateway** (`teaching-ipc-gateway.ts:146–158`, `234–252`, `createCommands`): deep composition root — `command({ parser → action → reply })` with parse-before-side-effect; registration dedupes channels; large table is wiring, not a missing domain seam.
- **Sole-writer commit** (`teaching-ipc-gateway.ts:552–560`): `commitLearningOutcome` prefers `context.turnCoordinatorHost.commitLearningOutcome(request)` else workspace service; host synthesizes `commit_outcome` turn (`teaching-turn-coordinator-host.ts:137–156`). Parser rejects paths/evidence/outcome from renderer (`teaching-ipc-commands.ts:41–52` exact-key envelope).
- **CAS / expectedRevision**: steer/follow-up, conversation save/rename/branch map `expectedRevision` / `expectedBranchRevision` through gateway (`gateway:369`, `403`, `472`, `489`); peel ADRs require field parity.
- **IPC peels (done)**: turn-review + agent-conversation clusters extracted (ADR-0119/0120); shell residual (~759) is soft size pressure under ADR-0075, not multi-signal friction for a new seam this rev.
- **Doctor**: pure `runTeachingDoctor(facts)` + `exportTeachingDoctorReport` re-redact clone (`teaching-doctor.ts:48+`, `78–79`); product assemble stays in observability; `workspaceOpenPolicy: 'read_only_allowed'`, `autoRepair: 'disabled'` (`:64–69`, checks `autoRepairAllowed: false`).
- **Support bundle**: consent-gated `exportSupportBundle` (`support-bundle.ts:278–287`); section allowlist; shared redact (ADR-0107); `DENIED_FIELD_NAMES`; no auto-upload (module header).
- **Capability catalog**: TTL cache (`DEFAULT_CAPABILITY_SNAPSHOT_TTL_MS = 5_000`), `promptEligible` filter, degrade-to-empty on failure (`snapshot` try/catch → `degradedSnapshot`); no disk I/O in sync snapshot path.

**Negative evidence**

- File length of gateway/doctor/support alone is **not** dual-signal architectural failure (ADR-0075; skill: size ≠ candidate).
- Further gateway table split, doctor “file peel,” or a registry-generator for all IPC would be size aesthetics / one-adapter hypothetical seams without observed recurrence of cross-module thrash.
- Product MCP surface / marketplace is **out of slice** (ADR-0142); hop stopped at secret-free DTO + doctor MCP aggregate facts.
- Siblings S02/S05/S06 already closed good_enough at same revision; no new incident evidence against this slice.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Parsers / gateway composition / pure doctor / consent bundle / capability TTL already separated; peels land by touch without reopening settlement |
| Interface depth | **Healthy** | Callers use channel `command` + narrow parsers + host `commitLearningOutcome` / pure doctor facts; ordering, redaction, consent, and sole-writer routing stay inside modules |
| Seam legitimacy | **Healthy** | Host sole-writer, exact-key IPC envelopes, consent export, TTL degrade — domain-real ownership, not mock-only layers |
| Test surface | **Healthy** | Unit + check scripts exercise public parsers, gateway wiring, doctor export, support consent, catalog snapshot through the same interfaces callers use |
| Conceptual integrity | **Healthy** | ADR language matches code (peel residuals, autoRepair disabled, secret re-redact, expectedRevision CAS, sole-writer prefer host) |
| Cost proportionality | **Healthy** | Machinery (gateway table, multi-check doctor, sectioned bundle) earns its cost at current IPC/privacy surface; purity rewrites of ~5k without recurrence is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) settlement/commit bugs require coordinated edits outside gateway→host path or parsers begin accepting evidence/outcome from renderer; (2) a single product IPC change repeatedly forces dual-edits across unpeeled parser clusters **and** gateway beyond intentional allowlist co-change; (3) doctor/support redaction leaks secrets into public DTO or consent bypass appears in production paths; (4) capability catalog cache causes recurring stale-promptEligible incidents requiring a new ownership seam.

### Metrics for tracker

- approx_lines_examined: **5200**
- files_examined: **7 primary + hop samples (host, ADRs, test/gate index ~15)**
- candidate_count: **0**
- status_for_tracker: **good_enough**

# Contributing to StudiumX

## Mission → Doctor → ADR

1. **Mission** — product intent and the file-first teaching workspace model live in `README.md` and `docs/domain-language.md`.
2. **Doctor** — inspect local redacted posture with `pnpm doctor -- --json`.
3. **ADR** — durable architecture decisions live only under [`docs/adr/`](docs/adr/README.md); implementation history remains in Git and PRs.

## Setup

```bash
corepack enable
pnpm install
pnpm dev
```

Node 22.x is recommended to match CI.

## Checks

L0 teaching/privacy/security fuses take priority over generic lint or coverage. L1 runtime, L2 packaging and L4 change-detector checks are layered on top; coverage never replaces a domain gate.

| Command | When |
| --- | --- |
| `pnpm typecheck` | Any TypeScript production change |
| `pnpm run check:security` | Paths, privacy, secrets, providers, MCP or packaging boundaries |
| `pnpm run check:tool-contract` | Tool inventory, effect class or write-policy changes |
| `pnpm run check:teaching-evidence` | LearningSession, Evidence, Outcome or settlement changes |
| `pnpm run check:teaching-impact` | Prompt prefix or sensitive teaching paths, with PR body |
| `pnpm run check:prepush` | Optional local typecheck + security subset |
| `pnpm run check:module-size` | Optional warning-only module-size report |
| Targeted `pnpm run check:*` / vitest | Modules touched by the change |

Optional hook:

```bash
git config core.hooksPath .githooks
```

## Pull requests

Use the PR template impact checklist and record the commands actually run. Do not burn real model API keys in default CI. Blocking CI stays narrow and hard; full e2e and release audit remain explicit heavier checks.

## Hard red lines

- `LearningSessionLedger` is separate from `AgentRun`; `TeachingTurnCoordinatorHost` remains settlement sole-writer.
- Teaching write authority remains files; SQLite projections may be preferred reads only while current and complete.
- No SQLite FTS or vector database user product search surface without a new ADR.
- Workspace shell follows [ADR-0015](docs/adr/0015-shell-sandbox-dual-axis.md): default available, dual-axis approval/sandbox, path-fenced and no YOLO label.
- MCP Settings remains list/editor/import/OAuth with no marketplace settings page; MCP calls still pass effect/approval ([ADR-0013](docs/adr/0013-mcp-runtime-trust-and-secrets.md)).
- Public config, diagnostics, support bundles and logs remain secret-free.

## Database PR gates

Apply this checklist when a PR touches LocalDataIndex, a SQLite/projection schema or migration, usage/approval/memory projections, or index-related Doctor/support-bundle output. A documentation-only typo may state `Database-gates: n/a (docs typo only)`.

Every applicable gate needs concrete evidence in the PR description:

- [ ] **Gate 1 — Canonical immutability:** quarantine, rebuild and migration do not modify canonical JSON/JSONL/Memory bytes except through an explicitly authorized domain writer.
- [ ] **Gate 2 — Drift safety:** stale fingerprints/checksums never report `ready`; drift produces unavailable/rebuild/file-fallback behavior.
- [ ] **Gate 3 — No secrets:** schemas and projections exclude API keys, raw prompts, sensitive tool args and unredacted paths; relevant redaction/security checks pass.
- [ ] **Gate 4 — Degrade on failure:** missing native SQLite, migration conflict or unavailable index does not block the main product path; file fallback or skipped analytics remains available.
- [ ] **Gate 5 — Policy alignment:** no user-facing analytics FTS/vector search, canonical purge, SQLite teaching/session write authority or effect-lattice bypass is introduced without a new accepted ADR.
- [ ] **Gate 6 — Tests:** targeted unit tests run; migration changes cover checksum/conflict behavior; necessary integration evidence is recorded.

PR copy block:

```markdown
### Database acceptance gates

- [ ] Gate 1 Canonical immutability — evidence: …
- [ ] Gate 2 Drift safety — evidence: …
- [ ] Gate 3 No secrets in index — evidence: …
- [ ] Gate 4 Degrade on failure — evidence: …
- [ ] Gate 5 Policy alignment — evidence: …
- [ ] Gate 6 Tests — evidence: …

Boundary check:
- [ ] SQLite remains a rebuildable projection, not teaching/session write authority
- [ ] No user-facing SQLite FTS/vector search without a new ADR
- [ ] No workflow/runtime database becomes an execution or settlement authority without a new ADR
```

The architecture boundary behind these gates is [ADR-0012](docs/adr/0012-file-authority-projections-and-durable-publish.md). The documentation contract is `tests/unit/database-pr-gates.unit.test.ts`.

## Module size

Prefer new or touched TypeScript modules below roughly 500–800 lines. Historical complex modules may remain below 1000 lines with an explained boundary. Existing giants are warning-first and peeled only when touched; module size is not a Blocking CI substitute for teaching/privacy/security checks.

## Architecture changes

Changes to teaching authority, settlement, tool effects, prompt-cache shape, persistence authority, MCP trust or privacy boundaries must update or add an ADR and link it from `docs/adr/README.md`.

## Related

- `AGENTS.md` — command map, product floors and path-sensitive checks
- `SECURITY.md` — trust boundaries and non-claims
- `docs/tools/TOOL_CONTRACT.md` — tool inventory and effect contract

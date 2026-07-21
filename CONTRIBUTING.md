# Contributing to StudiumX

## Mission → doctor → ADR

1. **Mission** — product intent and file-first teaching workspace model (`MISSION.md`, `docs/GUIDE.md`).
2. **Doctor** — local redacted posture: `pnpm doctor -- --json` (see `runtimePosture` and `docs/CONFIG_PATHS.md`).
3. **ADR** — durable architecture decisions live only under `docs/adr/`. Do not invent parallel “todo plan” authority once closed into ADRs.

## Setup

```bash
corepack enable
pnpm install
pnpm dev
```

Node 22.x recommended (matches CI).

## Checks

| Command | When |
| --- | --- |
| `pnpm typecheck` | Always before PR when touching TS |
| `pnpm run check:security` | Privacy / secrets / packaging invariants |
| `pnpm run check:tool-contract` | Tool inventory / effect class drift |
| `pnpm run check:prepush` | Optional local subset (typecheck + security) |
| `pnpm run check:teaching-impact` | With PR body when sensitive paths change |
| Targeted `pnpm run check:*` / vitest unit | Modules you touch |

Optional hook:

```bash
git config core.hooksPath .githooks
```

## Pull requests

Use the PR template impact checklist:

- Teaching-impact
- Privacy-impact
- Prompt-prefix-guard
- Settlement-guard

Do not burn real model API keys in default CI.

## Hard red lines

- LearningSessionLedger ⟂ AgentRun; TeachingTurnCoordinator remains sole writer for settlement.
- No default shell / MCP market / SQLite FTS product search.
- Keep typed effect lattice and fail-closed capability catalog.
- Teaching write-authority remains files; SQLite is disposable projection (list/analytics preferred read when current); do not weaken history redaction or secret-free resolved config.


## Database PR gates

When a PR touches LocalDataIndex / SQLite projection / usage or approval projections / database policy:

1. Fill the checklist in [ADR-0053](docs/adr/0053-database-layered-authority-and-pr-gates.md) §2 (six gates + PR copy block).
2. Confirm P2 items stay out of scope unless a **new ADR** already landed — see ADR-0053 §3 (DB-P2-1…4; DB-P2-3 **won't do** for teaching/session **write** SoT; optional runtime store needs its own ADR / ADR-0052).
3. Keep layered authority: files are write-authority for teaching assets/transcripts/ledgers; SQLite is disposable projection (preferred read for list/analytics when ready); no analytics-DB FTS product surface; no secrets/prompts in projections. See ADR-0053 §1 and [ADR-0001](docs/adr/0001-rebuildable-sqlite-projection.md).

Doc-contract unit: `pnpm exec vitest run --project unit tests/unit/database-pr-gates.unit.test.ts`

## Architecture changes

If you change settlement, tool effects, prompt-cache shape, or privacy boundaries, add or update an ADR under `docs/adr/` and link it from `docs/adr/README.md`.

## Related

- `docs/testing.md`
- `SECURITY.md`
- `docs/tools/TOOL_CONTRACT.md`

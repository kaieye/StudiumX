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

分层含义（L0 领域保险丝 / L1 runtime / L2 packaging / L4 change-detector 债）见 `docs/testing.md` 与 ADR-0053。**禁止**用覆盖率替换 teaching/privacy/security 领域门禁。


| Command | When |
| --- | --- |
| `pnpm typecheck` | Always before PR when touching TS |
| `pnpm run check:security` | Privacy / secrets / packaging invariants |
| `pnpm run check:tool-contract` | Tool inventory / effect class drift |
| `pnpm run check:prepush` | Optional local subset (typecheck + security) |
| `pnpm run check:teaching-impact` | With PR body when sensitive paths change |
| `pnpm run check:module-size` | Optional local size report (ADR-0075; warning-only by default; not Blocking CI) |
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
- Files remain SoT; do not weaken history redaction or secret-free resolved config.

## Architecture changes

If you change settlement, tool effects, prompt-cache shape, or privacy boundaries, add or update an ADR under `docs/adr/` and link it from `docs/adr/README.md`.

Module size targets and giant-peel discipline: `AGENTS.md` §5 and [ADR-0075](docs/adr/0075-module-size-policy-and-giant-peel.md). Prefer new/touched TS modules under ~500–800 lines; historical giants warn first and peel only when touched—do not fail Blocking CI on size.

## Related

- `AGENTS.md` — 命令图 / 红线 / 改哪测哪
- `docs/testing.md` — L0/L1/L2/L4 分层教条（见 ADR-0053）
- `SECURITY.md`
- `docs/tools/TOOL_CONTRACT.md`

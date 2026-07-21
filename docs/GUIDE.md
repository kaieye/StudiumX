# StudiumX product guide

StudiumX is a **local teaching workspace** for Electron. Files on disk are the source of truth for missions, lessons, resources, and learning records. The app indexes, generates, and previews those files; it does not replace them with a cloud database.

## Setup checklist

1. **Install** Node 22+ and enable Corepack (`corepack enable`), then `pnpm install` (lockfile-frozen installs in CI).
2. **Launch** the desktop app: `pnpm dev`.
3. **Configure a model provider** in Settings (API keys are stored via platform secret storage when available — never commit keys).
4. **Open or create a teaching workspace** folder that will hold `MISSION.md`, lessons, resources, and learning records.
5. **Optional web tools** — only if you need search/fetch; configure providers without pasting secrets into workspace files.
6. **Smoke diagnose**: `pnpm doctor -- --json --no-checks` (or with checks for issue paste targets).

## Open a workspace → first lesson

1. Open a local folder as the teaching workspace.
2. Edit **Mission** so success criteria are concrete and local-file friendly (see root `MISSION.md` conventions).
3. Start a teaching conversation (or use lesson generation UI) to produce the first short HTML **Lesson**.
4. Save and review the lesson in the workbench; keep retrieval practice in scope for early lessons.
5. Resume later from ledger-backed session history (Session resume picker — not by replaying agent run state as truth).

## Resume, records, and support

- **Learning records / outcomes** settle only through evidence-gated host paths (ledger sole-writer). The agent loop does not own settlement authority.
- **Support bundle**: export only after consent; contents are redacted (ADR-0034). Prefer `pnpm doctor` for paste-ready posture without workspace content.
- **Doctor runtime posture** (approval mode, tools flags, proxy host-only signal, key storage shape, explicit non-productization of shell/MCP market) appears in doctor JSON/text.

## What not to expect

- No default shell / arbitrary code execution.
- No MCP plugin marketplace by default.
- No automatic telemetry or crash upload (opt-in support paths only).
- No SQLite FTS product search — SQLite is rebuildable analytics projection only (ADR-0001).

## Deeper docs

| Doc | Purpose |
| --- | --- |
| `docs/GUIDE.zh-CN.md` | Chinese product guide |
| `docs/CONFIG_PATHS.md` | Where settings and secrets live |
| `docs/adr/README.md` | Architecture decisions (authoritative) |
| `SECURITY.md` | Trust model |
| `docs/improvements/database-acceptance-gates.md` | Database PR acceptance gates (roadmap §8) |
| `docs/improvements/database-p2-boundaries.md` | Database P2 boundary / trigger gates |
| `docs/testing.md` | Testing doctrine / pre-push |
| `docs/tools/TOOL_CONTRACT.md` | Registered tool contract |
| `CONTRIBUTING.md` | Contributor entry |
| `studiumx-settings.example.json` | Secret-free settings shape |

## Commands (developer)

```bash
pnpm dev
pnpm typecheck
pnpm doctor -- --json --no-checks
pnpm run check:security
pnpm run check:tool-contract
pnpm run check:prepush   # optional local gate
```

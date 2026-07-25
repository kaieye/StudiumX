# StudiumX

Local AI teaching workspace (Electron + React + TypeScript). **Files are the source of truth** for missions, lessons, resources, and learning records.

## Start here

1. Read `docs/GUIDE.md` (or `docs/GUIDE.zh-CN.md`).
2. Install with `pnpm install`, run `pnpm dev`.
3. Configure a provider in Settings (no keys in git).
4. Open a teaching workspace and write a concrete Mission.
5. When something is wrong: `pnpm doctor -- --json` and/or ADR index `docs/adr/README.md`.

## Contributor path

See `CONTRIBUTING.md` for checks, ADRs, and safety red lines.

## Docs map

| Path | Role |
| --- | --- |
| `docs/GUIDE.md` / `.zh-CN.md` | Product how-to |
| `docs/CONFIG_PATHS.md` | Settings & secret locations |
| `docs/adr/README.md` | Architecture decisions |
| `SECURITY.md` | Trust model |
| `docs/testing.md` | Testing doctrine |
| `docs/tools/TOOL_CONTRACT.md` | Tool contract |
| `studiumx-settings.example.json` | Secret-free settings shape |
| `MISSION.md` / `CONTEXT.md` | Domain language for this repo’s own learning workspace |

## Non-goals (summary)

Mainstream agent tools (workspace shell + Codex dual-axis sandbox/approval) when tools are enabled; teaching is a specialization layer. No default-on tools master switch, MCP marketplace, automatic telemetry, or SQLite FTS product search.

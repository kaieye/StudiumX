## Summary

<!-- What changed and why -->

## Impact checklist

Fill when the corresponding path is touched. Map to existing `check:*` scripts.

- [ ] **Teaching-impact** — lesson/session/outcome/planner/presentation paths; ran relevant teaching checks
- [ ] **Privacy-impact** — history redaction, support bundle, secret-free config, logs; ran `check:security` / privacy checks
- [ ] **Prompt-prefix-guard** — system prompt / tool schema / skill index stability (ADR-0044); note cache impact
- [ ] **Settlement-guard** — ledger / evidence / outcome / coordinator sole-writer; did **not** add agent bypass writers

## Test plan

- [ ] `pnpm run typecheck` (or prepush)
- [ ] Targeted `pnpm run check:*` / vitest unit for touched modules
- [ ] N/A for docs-only

## Non-goals / safety

- [ ] No shell / MCP market expansion without independent ADR
- [ ] No SQLite FTS product search (ADR-0001)

# Backup and export policy (DB-P1-5)

**Status:** implemented (policy module + GUIDE / doctor text)  
**Code:** `src/shared/backup-export-policy.ts`  
**Related ADRs:** ADR-0001 (disposable SQLite), ADR-0002 (JSONL), ADR-0003 (critical JSON `.bak`), ADR-0034 (support bundle)

## Must backup

### Teaching workspace (learner content)

| Path (relative) | Why |
| --- | --- |
| `MISSION.md` | Mission source of truth |
| `courses/**` | Lessons, resources, conversation archives |
| `learning-sessions/**` | Canonical LearningSession ledger |
| `memory/**` | Memory catalog files |
| `.studiumx/learning-work.jsonl` | Canonical learning-work active ledger |
| `.studiumx/learning-work.sealed-*.jsonl` | Sealed segments |
| `.studiumx/approval-receipts.jsonl` | High-risk approval receipts |
| Other non-sqlite `.studiumx/**/*.json` | Durable journals |

### App user data

| Path | Why |
| --- | --- |
| `studiumx-settings.json` (+ `.bak`) | Preferences; **desensitize** — never share raw API keys |
| `workspaces.json` (+ `.bak`) | Workspace registry |
| `memory/**`, `conversations/**` | App-scoped durable content when present |

Secrets belong in platform secret storage / encrypted blobs. Export of settings for support must use redaction (ADR-0034).

## Disposable (safe to delete / rebuild)

| Path | Why |
| --- | --- |
| `studiumx-index.sqlite` (+ `-wal` / `-shm`) | Rebuildable analytics projection |
| `studiumx-index.sqlite.quarantined-*` | Damaged projection quarantine |
| Any `*.sqlite*` under app-data | Projection-only (no FTS product DB) |
| Electron `Cache` / `Code Cache` / `GPUCache` | Operational caches |
| `studiumx.log`, `logs/**` | Diagnostic logs (mtime purge OK) |

Deleting `studiumx-index.sqlite` is **safe**. The next successful `LocalDataIndex.rebuild()` restores analytics projection from file-truth sources.

## Export defaults

| Option | Default | Behavior |
| --- | --- | --- |
| `includeProjections` | `false` | Exclude disposable projections and caches |
| `includeProjections: true` | opt-in | Include for **debug only**; every included projection path is marked **`untrustedProjection: true`** and must never be restored as authority |

Helpers:

- `decideWorkspaceExportPath(path, options, scope)`  
- `shouldIncludeInDefaultExport(path, scope)`  
- `isDisposableProjectionPath(path)`  
- `formatBackupPolicySummary()` for doctor / operator text  

Support bundles remain consent-gated and redacted (ADR-0034); they never ship full conversation/memory bodies or secret keys.

## Doctor / operator text

`pnpm doctor` text reports include a short backup policy summary. Product guides:

- `docs/GUIDE.md`  
- `docs/GUIDE.zh-CN.md`  
- `docs/CONFIG_PATHS.md`  

## Verification

```bash
pnpm exec vitest run --project unit tests/unit/backup-export-policy.unit.test.ts
```

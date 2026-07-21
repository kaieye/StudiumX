# Configuration paths

This document lists **where** StudiumX stores settings and secrets. It does **not** authorize new network or shell surfaces.

## Application data (per OS user)

Doctor’s default user-data roots:

| Platform | Default user data directory |
| --- | --- |
| Windows | `%APPDATA%\StudiumX` |
| macOS | `~/Library/Application Support/StudiumX` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/StudiumX` |

Common files under that directory:

| Path (relative to user data) | Contents |
| --- | --- |
| `studiumx-settings.json` | Settings document (versioned). Secrets may appear encrypted (`safeStorage:v1:…`) after app launch, never as durable plaintext in examples. |
| `studiumx.log` | Local log (retention configurable). Not a support-bundle substitute. |

Override for doctor / tooling: `STUDIUMX_USER_DATA` or `pnpm doctor -- --user-data <path>`.

## Settings vs secrets

| Concern | Where | Notes |
| --- | --- | --- |
| Non-secret preferences (locale, theme, tool toggles, model **ids**) | `studiumx-settings.json` | Safe to inspect in doctor after redaction. |
| Provider API keys / web-search API keys | Platform secret storage when available; may be referenced from settings as encrypted blobs | Never commit real keys. Prefer empty strings in examples. |
| Custom OpenAI-compatible providers | Settings `provider.providers[]` | Use empty `apiKey` in checked-in examples. Optional env-based key injection is a future/headless concern; do not paste CI keys into workspace. |
| Workspace teaching content | The **opened teaching workspace folder** | Mission, lessons, records live here — separate from app user-data settings. |

## Teaching workspace (learner content)

Chosen by the user when opening a workspace. Typical durable files (conventions evolve with ADR / skill docs):

- Mission and resource notes at workspace root or documented skill layout
- Lesson HTML / course session folders
- Learning records and agent conversation archives under app/workspace conventions
- `.studiumx/` for local projections / journals (not a second product database of record)

SQLite under analytics paths, if present, is a **rebuildable projection** only (ADR-0001). It is not a user search corpus.


## Backup / export classification (DB-P1-5)

| Class | Examples | Notes |
| --- | --- | --- |
| **Must backup** | Workspace `MISSION.md`, `courses/`, `learning-sessions/`, Memory files, `.studiumx/learning-work.jsonl` (+ sealed segments), approval receipts; user-data `studiumx-settings.json` / `workspaces.json` (desensitize secrets) | File-truth. Settings may hold encrypted secret refs — never paste raw API keys into shared backups. |
| **Disposable projection** | `studiumx-index.sqlite`, `studiumx-index.sqlite-wal`, `studiumx-index.sqlite-shm`, `*.quarantined-*`, any analytics SQLite | Safe to delete. `LocalDataIndex.rebuild()` restores from canonical files. |
| **Operational cache / logs** | Electron Cache / Code Cache / GPUCache, `studiumx.log` | Exclude from teaching backups; logs are not learning authority. |

**Export default:** exclude disposable projections. Opt-in `includeProjections` is debug-only and marks paths `untrustedProjection: true`.

See `src/shared/backup-export-policy.ts` and [ADR-0001](adr/0001-rebuildable-sqlite-projection.md) (Backup / export section).

## Secret-free example

See repository root `studiumx-settings.example.json`. Copy shapes only; leave all key fields empty.

## Doctor runtime posture

`pnpm doctor -- --json` includes a `runtimePosture` object summarizing:

- `approvalMode`, tool enablement flags
- `proxyEnabled` / host-only signal
- `keyStorage` / safeStorage posture
- explicit `shellExecution: not_productized` and `mcpMarketplace: not_productized`

Use this when filing issues instead of pasting full settings or logs with secrets.

## Related

- ADR-0025 TeachingConfigResolver (secret-free layers)
- ADR-0034 Support bundle consent + redaction
- `SECURITY.md`

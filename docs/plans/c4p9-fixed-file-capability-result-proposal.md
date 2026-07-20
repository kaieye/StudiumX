# C-4P9 fixed-file audit append：capability/result contract proposal

> **状态：待 owner 批准；不授权 writer、generic JSONL、repair、rotation、IPC/UI 或跨文件实现。**
>
> 本提案只选择 P9-2 的单一问题：为现有 per-conversation fixed `.jsonl` append 定义主进程内部 capability/result vocabulary。它不关闭 P9，也不把现有 `Promise<void>` + warning 行为改写为已批准的 public result。

## 1. Authority, profile and exclusions

- **Authority remains unchanged:** audit JSONL is append-only session evidence. JSON/Markdown archive and learning-work ledger retain their existing authority and ordered-best-effort save sequence.
- **Candidate profile:** one main-process writer per workspace and one local fixed audit file per conversation. Cross-process access is **not supported** until a product/runtime owner either proves single-writer exclusion with a real two-process negative test or separately approves a recoverable lock/lease protocol.
- **Not in this slice:** `durable-jsonl` migration, segmentation, rotation, sealing, repair, truncation, backup/restore, deletion, row/schema/path changes, action identity, public IPC/UI, or transaction claims.

## 2. Proposed internal result vocabulary

The writer must eventually expose one of these finite, privacy-safe values to its archive caller or a main-only diagnostic seam. It must not surface a path, row ID, trace, payload, raw errno message, or source content.

| Proposed result | Bytes that may exist | Required caller/recovery behavior | Full durable success? |
| --- | --- | --- | --- |
| `not_appended` | No new canonical row is known to have been written | Return failure; do not invent a different record or repair bytes. | No |
| `conflict` | Existing bytes only, or an unprovable existing identity | Stop and retain bytes; same-ID/body/type/trace conflict requires review. | No |
| `read_unknown` | Existing bytes preserved; canonical identity cannot be proved | Stop; no blind retry or repair. | No |
| `possibly_appended` | A prefix or all missing rows may be present after write/sync/close uncertainty | Only an explicit retry with the same canonical input may use existing exact-dedupe logic; no rollback/delete/truncate. | No |
| `file_synced_directory_unknown` | File bytes may be synced; one or both directory boundaries are unproved | Return controlled non-success; operator/capability review, never label it durable success. | No |
| `file_synced_directory_unsupported` | File bytes may be synced; declared profile lacks a required directory primitive | Return controlled degraded non-success; do not market the profile as strict. | No |
| `durably_appended` | Required file and both directory boundaries completed on an approved host profile | Continue only to the next existing ordered archive stage. | Yes, only for that approved profile |
| `writer_unavailable` | No new row is intentionally attempted | Reject a second process/instance before it enters read/dedupe/write. | No |

`not_appended`, `conflict`, `read_unknown`, `possibly_appended`, and the two directory-unknown values are main-internal terms until an independent API/UI approval defines stable caller behavior. None authorizes a retry with altered canonical data.

## 3. I/O failure matrix for the fixed-file writer

| Boundary | Current safe interpretation | Proposed result | Only permitted automatic behavior |
| --- | --- | --- | --- |
| `mkdir`, leaf inspection, `open`, post-open `stat`, exact `read` before first write | no new canonical row proven | `not_appended`, `conflict`, or `read_unknown` | return; preserve bytes |
| first through final `write` | any prefix may exist | `possibly_appended` | explicit same-record retry through existing dedupe only |
| file `sync` or `close` | all bytes may exist but durability/release is unknown | `possibly_appended` | same as above |
| audit or parent directory `open`/`sync`/`close` after a successful file boundary | file may be durable while directory metadata durability is unproved | `file_synced_directory_unknown` | return controlled non-success; no rollback/delete |
| approved, specifically classified unavailable directory capability | profile lacks directory durability proof | `file_synced_directory_unsupported` | return degraded non-success and record only finite capability class |
| every required file + directory boundary succeeds on an approved host profile | append is durable within that profile | `durably_appended` | continue to ledger/verification in existing order |

Unknown errors, zero/negative/stalled transfer, non-regular targets, symlinks, and close failures never enter the availability allowlist and remain fail-closed.

## 4. Decisions still required before an implementation PR

This proposal deliberately does **not** make the following product/operations decisions:

1. **Profile owner:** exact OS, filesystem, local/removable/network storage, Node/Electron version, and the support/degraded list.
2. **Writer owner:** whether startup/runtime can guarantee one main writer, or whether P9 needs a separately approved multi-process protocol.
3. **Public result owner:** whether any renderer/API sees a stable status; absent approval, no IPC/UI changes may be made.
4. **Operations owner:** metrics vocabulary, capacity threshold, incident escalation, and the runbook acceptance signature.
5. **Host evidence owner:** real filesystem crash/restart and two-process negative-test commands for every profile that claims support.

Until these are approved, the existing writer remains a fixed-file, single-process, ordered-best-effort boundary. Its current directory-sync warning cannot be interpreted as `durably_appended` on an unapproved or Windows profile.

## 5. Implementation gate and acceptance evidence

After approval, a narrow P9-3 implementation may add a typed main-internal outcome and tests for the matrix above **without** changing the V1 rows, archive order, or authority. Its acceptance package must include:

- the existing byte-preservation, torn-tail, exact-retry, conflict, close-failure, two-directory-boundary and in-process queue regression tests;
- new tests showing each result maps to exactly one recovery action and cannot leak raw filesystem details;
- a real two-process exclusion negative test or an explicitly unsupported cross-process profile;
- host-native profile evidence and operations acceptance before any strict/full-durable claim.

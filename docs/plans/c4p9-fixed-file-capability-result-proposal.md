# C-4P9 fixed-file audit append：capability/result contract proposal（已归档）

> **状态：不采纳为新的 implementation slice。** [ADR-0021](../adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md) 已结项当前 fixed-file scope；本文保留为未来若重新提出扩张时的候选 failure vocabulary。

> **历史状态：待 owner 批准；不授权 writer、archive caller/order、generic JSONL、repair、rotation、IPC/UI 或跨文件实现。**
>
> 本提案只选择 P9-2 的单一问题：为现有 per-conversation fixed `.jsonl` append 定义主进程内部 capability/result vocabulary。它不关闭 P9，也不把现有 `Promise<void>` + warning 行为改写为已批准的 caller behavior 或 public result。

## 1. Authority, profile and exclusions

- **Authority remains unchanged:** audit JSONL is append-only session evidence. JSON/Markdown archive and learning-work ledger retain their existing authority and ordered-best-effort save sequence.
- **Candidate profile only:** one main-process writer per workspace and one local fixed audit file per conversation. Current code proves only an in-process per-path queue; this proposal neither asserts startup exclusion nor supports cross-process access. A product/runtime owner must separately prove single-writer exclusion with a real two-process negative test or approve a recoverable lock/lease protocol.
- **Not in this slice:** `durable-jsonl` migration, segmentation, rotation, sealing, repair, truncation, backup/restore, deletion, row/schema/path changes, action identity, archive save-order or degraded-result continuation changes, public IPC/UI, or transaction claims.

## 2. Proposed internal result vocabulary

If approved, the fixed-file writer would classify an attempt with one of these finite, privacy-safe main-internal values. It must not surface a path, row ID, trace, payload, raw errno message, or source content.

| Proposed result | Bytes that may exist | Required caller/recovery behavior | Full durable success? |
| --- | --- | --- | --- |
| `not_appended` | Existing audit bytes are unchanged; `mkdir` or `O_CREAT` may still have created directories or an empty file | Return failure; do not invent a different record or repair bytes. | No |
| `precondition_failed` | Existing bytes are preserved; a path/target precondition is false | Stop without fallback, rewrite, or repair. | No |
| `conflict` | Existing bytes are preserved; a canonical same-ID body/type/trace-state conflict was proved | Stop and retain bytes; conflict requires review. | No |
| `read_unknown` | The exact pre-append byte set could not be read or proved; prior bytes are preserved, while `mkdir` or `O_CREAT` may already have created directories or an empty file | Stop; no blind retry or repair. | No |
| `possibly_appended` | A prefix or all missing rows may be present after write/sync/close uncertainty | Only an explicit retry with the same canonical input may use existing exact-dedupe logic; no rollback/delete/truncate. | No |
| `file_synced_directory_unknown` | File bytes may be synced; one or both directory boundaries are unproved | Return controlled non-success; operator/capability review, never label it durable success. | No |
| `file_synced_directory_unsupported` | File bytes may be synced; declared profile lacks a required directory primitive | Emit a controlled degraded outcome to a separately approved main caller policy; do not market the profile as strict. | No |
| `durably_appended` | Required file and both directory boundaries completed on an approved host profile | Report full success for this audit boundary only; later archive stages retain their independent authority. | Yes, only for that approved profile |
| `writer_unavailable` | No new row is intentionally attempted | Reserved for a separately approved and enforced single-writer profile; reject before read/dedupe/write. | No |

Every value in this table is a design candidate and remains main-internal until an independent API/UI approval defines a stable public contract. Including `writer_unavailable` does not approve an exclusion mechanism or cross-process support. Including `file_synced_directory_unsupported` does not decide whether the archive caller stops or preserves today's warning-and-continue behavior. No value authorizes a retry with altered canonical data.

## 3. I/O failure matrix for the fixed-file writer

| Boundary | Current safe interpretation | Proposed result | Only permitted automatic behavior |
| --- | --- | --- | --- |
| `mkdir` or ordinary `open` failure before first write | no new canonical row attempted; directories or an empty file may exist | `not_appended` | return; preserve existing bytes |
| leaf inspection or post-open target validation | target/path precondition is false | `precondition_failed` | stop; no fallback or repair |
| exact `read` before first write | the exact existing byte set is unavailable, so identity evaluation is unsafe | `read_unknown` | stop; preserve prior bytes and any created empty file |
| canonical identity check before first write | a canonical same-ID body/type/trace-state conflict is proved | `conflict` | stop; preserve bytes |
| first through final `write` | any prefix may exist | `possibly_appended` | explicit same-record retry through existing dedupe only |
| file `sync` or `close` | all bytes may exist but durability/release is unknown | `possibly_appended` | same as above |
| audit or parent directory `open`/`sync`/`close` after a successful file boundary | file may be durable while directory metadata durability is unproved | `file_synced_directory_unknown` | return controlled non-success; no rollback/delete |
| approved, specifically classified unavailable directory capability | profile lacks directory durability proof | `file_synced_directory_unsupported` | emit only the finite degraded class; caller continuation remains a separate approval |
| every required file + directory boundary succeeds on an approved host profile | append is durable within that profile | `durably_appended` | return to the existing archive caller; later stages remain ordered best effort |

Unknown errors, zero/negative/stalled transfer, non-regular targets, symlinks, and close failures never enter the availability allowlist and remain fail-closed.

Malformed or unknown legacy rows alone do not produce `read_unknown`: the current reader preserves and skips them for identity purposes, then appends only missing canonical rows. `read_unknown` is reserved for failure to obtain the exact byte set needed before that evaluation.

These results classify only the audit append boundary. They are not a receipt, transaction, or proof of JSON/Markdown/ledger state. In particular, this proposal does not decide whether a directory-unsupported degraded result blocks the ledger or follows the current warning-and-continue path; that caller policy requires separate approval.

## 4. Decisions still required before an implementation PR

This proposal deliberately does **not** make the following product/operations decisions:

1. **Profile owner:** exact OS, filesystem, local/removable/network storage, Node/Electron version, and the support/degraded list.
2. **Writer owner:** whether startup/runtime can guarantee one main writer, or whether P9 needs a separately approved multi-process protocol.
3. **Archive caller owner:** whether a directory-unsupported degraded result stops the save or preserves the current warning-and-continue behavior; no choice may be described as cross-file atomicity or transaction settlement.
4. **Public result owner:** whether any renderer/API sees a stable status; absent approval, no IPC/UI changes may be made.
5. **Operations owner:** metrics vocabulary, capacity threshold, incident escalation, and the runbook acceptance signature.
6. **Host evidence owner:** real filesystem crash/restart and two-process negative-test commands for every profile that claims support.

Until these are approved, the existing writer remains a fixed-file, single-process, ordered-best-effort boundary. The current allowlisted/native-Windows directory-sync path still warns and resolves, so the existing archive flow may continue; this proposal does not change that behavior. The warning cannot be interpreted as `durably_appended` on an unapproved or Windows profile.

## 5. Implementation gate and acceptance evidence

After the profile, writer, archive-caller and operations decisions are approved, a narrow P9-3 implementation may add a typed main-internal outcome and tests for the matrix above **without** changing the V1 rows, archive order, or authority. Its acceptance package must include:

- the existing byte-preservation, torn-tail, exact-retry, conflict, close-failure, two-directory-boundary and in-process queue regression tests;
- new tests showing each writer result maps to exactly one recovery action, the separately approved caller policy is explicit, and neither leaks raw filesystem details;
- a real two-process exclusion negative test or an explicitly unsupported cross-process profile;
- host-native profile evidence and operations acceptance before any strict/full-durable claim.

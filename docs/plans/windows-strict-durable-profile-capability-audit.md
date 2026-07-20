# C-4P8 Windows strict durable profile：capability audit（已结项的 no-go 证据）

> **状态：已结项为 unsupported / no-go。** [ADR-0021](../adr/0021-c4-p6-p8-p9-closeout-scope-decisions.md) 采纳本 audit 的结论：当前不实施 Windows strict writer；本文保留为未来独立 proposal 的 capability evidence。

> **历史状态：blocker confirmed；不实施 Windows strict writer。** 本文记录 C-4P8 下一设计门所需的 native capability audit。它不是 strict-support 声明、运行时降级实现授权，亦不改变既有 non-strict Windows 行为。

## 1. Scope and target

- **Candidate profile:** local NTFS on a supported desktop Windows release; Electron/Node runtime must be pinned by a later implementation proposal.
- **Required S3 property:** the actual publish primitive must atomically require that the existing final leaf is the exact expected file identity. A prior `FILE_ID_INFO` comparison is not sufficient, because a leaf replacement can occur between that inspection and publication.
- **Non-goals:** network/removable filesystems, generic Windows containment, archive transaction semantics, automatic retry/rollback/delete, and a replacement of the strict requirement with an inspect-then-publish sequence.

## 2. Audited public primitives

| Need | Audited public primitive | What it can establish | Why it does not close S3 |
| --- | --- | --- | --- |
| Inspect final leaf identity | `GetFileInformationByHandleEx(..., FileIdInfo, ...)` | A handle's volume serial + 128-bit file ID identify the open file on one computer. | The API is an observation only. It supplies no version/identity token accepted by a later rename/replace call. |
| Descriptor-relative target naming | `SetFileInformationByHandle` with `FileRenameInfoEx` / `FILE_RENAME_INFO.RootDirectory` | A rename can name a target relative to a root-directory handle. | The contract names a target and replacement flags; it has no expected-target file-ID comparison field. |
| Replace an existing final leaf | `ReplaceFileW` | Replaces a named existing file with a named replacement file; may create a backup. | Its inputs are names/flags, not an expected file identity. The result keeps the replacement file's identity, so it cannot prove the replaced leaf was the one previously inspected. |

Official sources consulted: [FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info), [FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info), and [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).

## 3. Result

No audited supported Win32 primitive exposes an atomic **publish-if-final-leaf-has-this-`FILE_ID_INFO`** operation. Therefore:

1. Reading `FILE_ID_INFO`, then invoking `SetFileInformationByHandle` or `ReplaceFileW`, leaves the inspect-to-publish race required by C-4P8's hard blocker.
2. A pathname-only `ReplaceFileW` sequence also fails the required HANDLE-relative/reparse-safe containment proof.
3. The current `native/contained-durable-replace/contained_durable_replace.cc` deliberately fails closed on Windows rather than silently falling back to pathname traversal: descriptor-relative operations return `ENOTSUP`, while publication entrypoints use explicit unavailable errors where applicable. That boundary remains correct for this profile.

**Decision for the current proposal:** `P8-Windows-NTFS-strict` is **unsupported**. It must not be advertised as strict, and no implementation may downgrade the requirement to preflight identity checking.

## 4. Required evidence before reopening implementation

Reopen this work only with all of the following, reviewed as a separate proposal:

1. a supported native primitive (publicly documented or independently security-reviewed) that makes expected final-leaf identity a precondition of publication;
2. a HANDLE-relative parent traversal and final-leaf/reparse-point adversarial proof on the exact Windows/NTFS profile;
3. an explicit atomic no-overwrite/restricted-overwrite/exchange contract, including sharing violation, antivirus, lock, rename, flush and close dispositions;
4. a file and parent-directory persistence contract with host-native crash/reboot/power-loss evidence matching every stated claim; and
5. privacy-safe result/diagnostic vocabulary plus an operations owner and runbook.

Until then, all unknown native outcomes, sharing/lock errors, reparse findings, and I/O failures remain fail-closed; they do not permit retry, rollback, deletion, or a strict-success result.

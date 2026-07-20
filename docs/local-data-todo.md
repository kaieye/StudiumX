# 本地数据待办

> 本文是本地数据**下一步工作的唯一入口**。已完成的架构决定及其证据见 [ADR 索引](adr/README.md)。
>
> 下列条目记录未完成范围及待批准的设计门；设计文档不是实现授权。个别条目会标明已实施的受限切片，但不得把该切片的建议、验证矩阵或候选 contract 扩大为 complete durable closure。

## 先决规则

1. 任何后续切片先在对应 design gate 获得 scope / owner / API 批准，再单独立项；不得直接修改其 writer 以“顺手迁移”。
2. canonical JSON、Markdown、JSONL、immutable record 和 Memory 文件仍是事实来源；projection、分区、sealing、summary、`.bak` 与 receipt 都不授权删除或替代事实来源。
3. [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md) 记录的是**部分** consumer migration：C-4P8 已在受控 `write_workspace_file` 的文本文件 create / restricted-overwrite scope 关闭，但这不表示所有 writer 已迁移、完整 C-4P6、完整 C-4P9 或跨文件事务已经完成；C-4P6-S1 也不得扩大为完整 C-4P6。不得把 [ADR-0005](adr/0005-main-owned-trace-correlation-and-safe-logs.md) 解释为全局 actionId / retry / receipt。

## C-4：仍未完成的其它 durable writer / closure 设计门

### P8：Windows workspace publish：direct-path profile 已实施；strict durable profile 仍未实施

- C-4P8 的受控 text create / restricted-overwrite scope 保持关闭。2026-07-19 在用户明确批准不同 S3 contract 后，Windows 已注册一个参考 `codex-rust` 的 root-constrained direct-path profile：上层相对路径/root/realpath 检查，S2 `wx` no-clobber create，S3 对既有 single-link regular target 使用 non-creating `r+` truncate/write/sync，并在写后 exact reread；既有 approvalMode、operation journal replay 与隐私化 stable error 保持有效。
- 该 profile 的限制是实现事实：它不是 descriptor/HANDLE-relative traversal，不比较 target file ID，不是 CAS 或 POSIX atomic exchange，不保证 directory-fsync durability，也不能证明 external reparse/leaf replacement race 安全。必须在 UI、tool contract、测试和文档中按“Windows direct-path non-CAS”表述，不能声称为 Windows native durable publish 或 strict containment。
- **仍未完成：**2026-07-19 的 Windows host-native/SDK audit 已确认 `NtCreateFile` 的 `RootDirectory` + `OBJ_DONT_REPARSE` 可作为 HANDLE-relative S1/S2 的候选基础，但已审计的 `FileRenameInfo[/Ex]` / `ReplaceFileW` 等 API 不提供 S3 所需的 expected-target-file-ID compare-and-swap 或 exchange；仅在 publish 前检查 file ID 仍有 inspect-to-publish race。若将来要求 POSIX-equivalent Windows strict profile，仍必须先获得可审计的 Windows/NTFS S3 identity-precondition primitive，再实施 HANDLE-relative、reparse-point/junction-safe traversal、atomic no-overwrite / exchange、file/directory durability 和 adversarial host-native CI；不得把当前 direct-path profile 当作该 gate 的完成。

### P9：session-audit durable append

- 设计文档：[C-4P9 Session-audit durable append](plans/local-data-session-audit-durable-append-design.md)；已实施范围与 tests-only evidence 见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。
- **当前边界（gate 未关闭）：**仅 **P9-S2** 生产实现（audit 专用 framed、legacy-compatible、fixed-file / non-rotating durable append）+ 后续 **tests-only residual/evidence** 切片。这些 evidence 不授权把 P9 计为 complete durable closure。
- **S2 实现范围：**仅固定 `.agent-sessions/<conversation-id>.jsonl`；不 rotation、不调用 generic `durable-jsonl`；per absolute audit path queue 覆盖 same-descriptor exact-byte read / validate / dedupe / framed append / file fsync+close，随后 audit directory、再 conversation parent directory durability confirmation。directory open/sync 仅五个 allowlist code 可降级为通用 warning；post-directory failure retry 会先 dedupe exact rows，之后才继续既有 ledger flow。
- **仍未完成 / 不得越界：**generic JSONL migration；完整 file-level capability matrix（S5 等仅是定向 capability symmetry cases）；跨文件 transaction；ledger authority 或 archive save-order 变更；repair；rotation；IPC/UI；更广 residual matrix。不得接入 `appendDurableJsonlLine()` 的默认 month / size rotation；不得将 C-4P1 archive publish 或 C-5E trace 计为完整 P9；不得以 S2 改变 ledger authority 或 `JSON → Markdown → audit → 既有 ledger queue → final verify` 顺序，或扩大为其它 JSONL writer。

### P6：learning-outcome durable settlement 的剩余 close-out 设计门

- 设计文档：[C-4P6 Learning outcome durable settlement](plans/local-data-learning-outcome-durable-settlement-design.md)；既有范围与证据见 [ADR-0004](adr/0004-shared-durable-publish-and-partial-consumer-migration.md)。**P6 close-out 未关闭。**
- **待推进的 blockers：**
  1. 定义 manifest durability capability，以及 manifest `open` / `write` / `fsync` / `close` 的 failure semantics。
  2. 明确 crash / recovery state machine 的状态、转换与边界。
  3. 处理尚无 cross-file transaction、common atomicity、rollback 或 delete 语义的边界。
  4. 完成 migration、API、IPC 与 operations validation。
  5. 关闭 Windows native `fsync` 与 power-loss 验证。

## C-5：尚未覆盖的用户动作 correlation 设计门

### P5H：workspace user mutation（mission-first）

- 设计文档：[C-5H Workspace 用户变更 correlation](plans/local-data-workspace-user-mutation-correlation-design.md)
- 当前未获产品 / API 批准，**不可直接实施** `mission_updated` correlation、actionId 或 private receipt。
- 首个候选范围仅为 mission-first；`lesson_style_applied` 的 settings second write 不能被悄然并入。

### P5I：direct-UI lesson generation

- 设计文档：[C-5I Direct-UI lesson generation correlation](plans/local-data-lesson-generation-user-action-correlation-design.md)
- 当前未获产品 / API 批准，**不可直接实施**。需先决定 actionId 生命周期、provider-authority private receipt、receipt retention / authority，以及 `success`、`reused`、`rejected`、`conflict`、`indeterminate` 结果语义。
- 禁止越界：仅覆盖 renderer direct UI 的 `generateLesson` / stream；不覆盖 agent `generate_lesson`、mission、lesson style 或 generic workspace writer。provider outcome unknown 时不得自动重跑。

## C-6：controlled legacy Memory 迁移设计门

- 设计文档：[C-6 受控 legacy Memory 搬迁](plans/local-data-memory-controlled-migration-design.md)
- 已有的 C-6A 只读 aggregate preflight 不授权真实迁移。未来必须先批准可信 main identity / scope、copy → 内部 checksum verify → explicit confirmation → delete、durability / recovery 与审计协议。
- 禁止越界：不得启动、后台或自动迁移，不得由 preflight 暴露或推导 candidate/path/content/hash。

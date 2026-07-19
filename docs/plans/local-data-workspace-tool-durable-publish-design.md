# C-4P8 Workspace tool durable publish：设计门（未实施、未批准）

> **状态：仅 design gate / 审查否决后的设计约束。**当前将 `write_workspace_file` 的 pathname-based `writeFile` 直接替换为 shared `replaceDurably()` 的实现审查已被否决：该 primitive 不能单独满足 create 的原子 no-clobber、descriptor-bound containment 或 publication ambiguity 的要求。本文**不实现、不批准，也不宣称 C-4P8 已完成**；不改代码、测试、配置、canonical schema 或现有工具行为。只有完成本门规定的 sub-slice 划分与显式批准后，才可另立实现工作。

相关但不同的已实施 consumer 是 C-4P5 `TeachingWorkspaceDocuments` 的 allowlisted workspace Markdown publish。C-4P8 的 writer scope 不继承 C-4P5 的 allowlist/service contract，也不能以 C-4P5 的测试或 shared `replaceDurably()` 通过作为 C-4P8 已迁移的证据。

> 后续工作的统一入口见 [本地数据待办](../local-data-todo.md)；已实施决定见 [ADR 索引](../adr/README.md)。

## 1. 固定 scope 与非目标

未来获批的 writer scope **仅**是 agent workspace tool 的任意受控、单个文本文件写入：输入必须先经过 tool 的 workspace policy 与受控相对路径解析，随后在该 workspace root 的 descriptor-bound capability 内发布一个文本文件。

它明确不等于、也不扩展为：

- C-4P5 `TeachingWorkspaceDocuments` 的 allowlisted document service；
- trace / traceId、actionId、receipt 或任何 correlation/idempotency 协议；
- IPC、renderer/UI、tool registry 暴露或权限模型变更；
- workspace registry、touch/save registry、conversation audit、JSONL append、transactions 或跨文件原子性；
- migration、repair、历史扫描/回填、backup、retention 或 schema change。

此 scope 也不迁移其它 workspace writer；任何其它 writer 必须单独获得自己的 consumer 设计和批准。

## 2. 必须分开的两种操作

未来 API/implementation 必须将以下操作建模为**不同 operation**，不能以一个“先检查、再 rename”的 helper 伪装为两者：

| operation | 前置条件与 publication 语义 | 并发边界 |
|---|---|---|
| `createNoOverwrite` | 仅当 final name 在 publication 时不存在才发布；必须由原子 no-clobber publication 保证。`exists`/`lstat` preflight 后再普通 `rename` 不是合格实现。 | 并发外部创建同名文件时必须以稳定的 `target_exists`/冲突结果失败，且对方 bytes 不得被截断、替换或删除。 |
| `overwriteExisting` | 仅对经过 descriptor-bound type/policy 验证的允许 target 执行 replacement；它**不是 CAS**，不承诺检测或合并 external concurrent mutation。 | 必须明确 document：在 validation 与 publish 间外部可变更时，调用方不取得 compare-and-swap、版本匹配或 lost-update 防护。任何需要该语义的 future feature 必须另立 action/receipt/CAS 设计。 |

普通 `replaceDurably()` 的 canonical `rename(temp, final)` 可用于分析 overwrite durable order，但不能单独实现 `createNoOverwrite`，因为普通 rename 可替换在 preflight 后出现的 final target。

## 3. Containment capability 与 type 规则

future implementation 的安全根基必须是新的 **descriptor-relative contained-directory capability**，不是 pre/post `realpath` 的 pathname 流程：

1. 在可信 workspace root 上绑定 descriptor capability；为 child traversal 使用 no-follow 操作，按已验证的相对 component 逐级打开/创建受控目录；最后以 safe basename 操作 final name。
2. 根、child directory 与 final target 的 symlink、parent/target pathname swap、非法 component 和不允许的 file type 都必须 fail closed。pre-containment 与 post-containment 检查只能作为诊断/defence-in-depth，**不能替代** descriptor-bound publish。
3. 该能力需要新增 native 或可证明等价的 portable support；不得在 capability 缺失时退回 pathname `writeFile`、`rename`、`realpath` 或“best-effort”流程。平台/运行时不支持 required primitives 时必须 fail closed。
4. final target 必须显式 type-reject：directory、symlink、device、FIFO/socket 及其它非普通文件不得作为 overwrite target。hardlink 行为必须在批准前定为受支持且被精确验证，或一律拒绝；无论选择哪种，都不承诺保留 inode 或 hardlink identity。

## 4. Permissions、metadata 与兼容边界

- 新建文件必须使用 `0666 & umask` 的普通创建语义。
- overwrite publish 不得重新恢复或复制 setuid、setgid、sticky 等 special bits；最终只可承诺普通 permission bits 的兼容。
- 不承诺 inode identity、hardlink identity/count、owner/group、ACL、xattr、birth time 或其它 metadata 等价；任何需要这些保证的 consumer 不在 C-4P8 scope。
- 文本 encoding、现有 tool path policy 与返回 shape 的兼容要求必须在批准的 implementation sub-slice 中逐项写明；不能借 durable migration 顺带扩大输入格式或工具能力。

## 5. Durable order 与失败语义

每个获批 operation 必须有可注入、可观察的 ordered protocol。最低要求如下：

1. 在 descriptor-bound parent 内创建不跟随、不可冲突的 temp；写入文本、同步 temp file，并关闭 temp file；
2. 做 operation-specific publication：`createNoOverwrite` 原子 no-clobber，`overwriteExisting` 受限 replacement；
3. 同步/关闭**已绑定的父目录 descriptor**，并只以 descriptor-relative 操作处理未发布 temp 或 publication 产生的 temp alias；cleanup 不得通过 pathname 重新解析或触碰 canonical final。

对于可能以 hard-link/alias 形式完成 `createNoOverwrite` publication 的 primitive，批准前还必须明确、写入该 primitive 的协议与 API：

- temp alias cleanup 相对 publication、第一次 parent-directory fsync/close 的顺序；
- alias unlink/cleanup 后是否必须进行第二次 parent-directory fsync/close，及该第二次 sync 是否是成功 acknowledgement 的必要条件；
- 成功返回是否承诺不再存在 temp alias，以及无法作出该承诺时的 API/diagnostic 表述；
- cleanup 在第一次 sync 前或后失败时，canonical durable acknowledgement 与 `possibly_published` 的精确定义；不得把“canonical 已可见”与“alias 已清理且其删除已 durable”混为一项成功。

不得在本 design gate 中虚构上述顺序或选择；获批 sub-slice 必须选择一个协议并据此实现和测试。

失败边界固定为：

- **pre-publication** 的 write、file fsync、close 或 publication failure：旧 canonical bytes 必须保持不变；未发布 temp 应清理；不得报告成功。
- **publication 后**的 parent-directory sync/close、temp-alias cleanup 或其最终 directory durability failure：必须 fail closed；canonical bytes 可能已是新内容，绝不 rollback、删除或尝试用旧内容覆盖 canonical。返回结果必须按获批协议表示 canonical 是否仅可能已发布、是否已获得第一次/最终 directory durability acknowledgement，以及是否仍可能留有 temp alias；在未获此精确定义前不得报告成功。
- directory capability 仅可对 shared 五码 allowlist `EOPNOTSUPP`、`ENOTSUP`、`ENOSYS`、`EINVAL`、`EISDIR` 降级；warning 必须是 generic、无 path、无 temp name、无 payload/content。其它 directory I/O、permission、unknown、sync/close error 均 fatal。

这一协议不承诺跨文件 transaction，也不把 publication 后失败解释为“写入未发生”。

## 6. Tool error、privacy 与 retry boundary

Tool JSON 的 message/metadata 不得泄露 workspace absolute path、parent descriptor path、temp name、payload/content 或底层原始错误文本。future API 必须冻结有限、稳定且安全的错误分类；至少要能区分：

- 请求/relative-path policy rejection；
- containment capability unavailable 或 path/type rejection；
- `target_exists`（create publication 时的 no-clobber 冲突）；
- pre-publication durability failure；
- **`possibly_published`**（publication 后 directory sync/close/cleanup failure）。

`possibly_published` 必须有明确的 handler/API/retry 设计：不得把它自动重试成“尚未执行”，也不得让每个 generic I/O failure 自动重复 publish。批准前必须指定调用方如何向用户呈现、是否/how to re-read canonical state、何时允许显式 retry，以及 retry 不会绕过 `createNoOverwrite` 的 no-clobber contract。

## 7. 必需 I/O seam 与验收测试

实现前必须设计窄的 handler-level publisher/I/O injection seam；不得通过 monkey-patch 全局 `fs/promises` 模拟故障。该 seam 必须能在单测中控制并记录 create、write、file sync/close、publication、directory sync/close 与 cleanup 的事件顺序。

获批实现至少需要以下定向测试；所有**外部可观察 surface**（tool JSON、warning、handler/API metadata/error）均不得泄露 absolute path、temp name 或 payload/content。该约束不限制内部 I/O seam 的 event records；后者可保留测试所需的受控操作标识。handler privacy 仍须有独立测试。

1. `createNoOverwrite` 在 preflight 后、publication 前出现竞争 final 时收到 `EEXIST`/等价冲突：竞争方 bytes 原样保留、无 clobber、无 temp 遗留。
2. `overwriteExisting` replacement 的明确 non-CAS 边界，以及 existing final 的 symlink、directory、device/FIFO/socket 等 type rejection。
3. hardlink policy：按已批准选择验证拒绝，或验证 replacement 后外部 link 的结果并证明没有虚假 inode/hardlink-equivalence 承诺；若 `createNoOverwrite` 采用 temp alias publication，必须验证 success 对“无 temp alias”的承诺（若获批）或其明确的非承诺表述。
4. pre-publication write、file fsync、file close 与 publication failure：旧 canonical 不变、未发布 temp cleanup 正确。
5. 对获批的 temp-alias cleanup 顺序，覆盖 publication 后、第一次 parent-directory sync/close 前后、alias cleanup 前后，以及最终 parent-directory durability（包含决定为需要时的第二次 sync/close）的每个 injected failure 组合；断言 canonical 不 rollback/删除、success acknowledgement 与 `possibly_published` 精确符合获批协议、alias 留存状态不被误报。
6. shared five-code directory-capability downgrade 与非 allowlist fatal failure；warning 只含 generic 安全文本。
7. 新建 `0666 & umask`；overwrite 不恢复 setuid/setgid/sticky，且只验证承诺的普通 permission bits。
8. descriptor-bound parent/final symlink swap、child traversal swap 与 unsupported platform/capability：均不得 pathname fallback，均 fail closed。
9. 独立 handler privacy、稳定返回分类与现有 workspace-tool compatibility regression，包括 no-overwrite、overwrite、path containment、只读 registry/enablement policy。

现有 `tests/unit/durable-file.unit.test.ts` 的 `DurableFileOperations` / `memoryOperations` 可作为 file/directory fault-injection 的参考，但其普通 rename replacement semantics 不能被误当成 no-clobber 或 descriptor-containment 的完整测试设施。需要的 native/portable capability 也必须提供相应的可控测试 seam，或给出同等强度的 deterministic harness。

## 8. 实施前的批准门

C-4P8 仍无 approved implementation。实施前必须先完成并获批准：

1. 将上述 requirement 划为精确、可独立验证的 sub-slice（至少分开 capability foundation、no-clobber create、restricted overwrite、handler/API/error integration）；
2. 对 hardlink policy、temp-alias cleanup 与第一次/最终 parent-directory fsync 顺序（含是否需要第二次 sync）、成功 acknowledgement、portable/native capability matrix、stable error enum、`possibly_published` read/retry UX/API 与并发外部 mutation boundary 作出明确决定；
3. 审核 I/O seam 与全部 failure test plan，确认不以 pathname fallback 降级；
4. 明确每个 sub-slice 的 compatibility baseline、最小执行命令和 review/approval owner。

在这些决定完成前，任何“直接改用 `replaceDurably()`”或只补 pre/post `realpath` 的改动都不得称为 C-4P8、durable contained publish、no-clobber safe，或已完成。

# ADR-0065：Child capability subset 证明（拒绝子 agent 放大父工具面）

- **状态：** 已实施（ADOPTION B-10）
- **日期：** 2026-07-21
- **范围：** 纯函数子集证明 + `childRegistryForProfile` 可选父 allow-list 相交；不改变 child profile 闭集本身
- **相关：** [ADOPTION B-10](0121-improvements-adoption-closeout.md)、[ADR-0046](0046-teaching-footprint-ladder.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADR-0060](0060-tools-schema-session-fingerprint.md)、[ADR-0061](0061-tool-capabilities.md)
- **证据路径：** `src/main/ai/child-capability-subset.ts`、`src/main/ai/delegation-runtime.ts`、`tests/unit/child-capability-subset.unit.test.ts`、`docs/adr/0065-child-capability-subset.md`

## 背景

Child agent 已有 fail-closed profile（`read_only` / `research` / `workspace_audit`），经 `toolNamesForProfile` 收窄到工作区只读（+ 可选网页）工具，且 registry 构造强制 `workspaceWrite: false`。但仍缺一层**相对父 turn 的子集证明**：若未来父 policy 更窄（例如无 web、无 workspace），或误把写工具塞进 child 提案，child 不得**放大**父 allow-list。

B-10 要求：`assertChildCapabilitiesSubset`（或等价）拒绝 amplification，并接到 child registry 构造。

## 决定

### 1. 纯模块 `child-capability-subset.ts`

| 导出 | 语义 |
| --- | --- |
| `assertChildCapabilitiesSubset` | 证明 `childAllowed ⊆ parentAllowed`；失败返回 `{ ok:false, code:'child_capability_amplification', amplified, reason }` |
| `assertChildCapabilitiesSubsetOrThrow` | 同上，抛 `ChildCapabilityAmplificationError`（稳定 `code`） |
| `intersectChildToolsWithParent` | fail-closed 相交：仅保留父与子提案的交集；**空父 → 空子**；保序、去重 |

不引入 shell、不授予写工具、不抬升父 privilege。

### 2. 接线 `delegation-runtime`

- `toolNamesForProfile` 仍是 profile → **提案** 工具表（不扩张既有 `workspace_audit` / `read_only` 边界）。
- `resolveChildToolAllowList`：有 `parentAllowedToolNames` 时用 `intersectChildToolsWithParent`；省略时保持 profile 提案（兼容未传父列表的调用方）。
- `childRegistryForProfile`：可选 `parentAllowedToolNames`；相交后 `assertChildCapabilitiesSubsetOrThrow`（防御二次漂移）。
- `DelegationRuntimeOptions.parentAllowedToolNames` 透传到 `executeChild` → `childRegistryForProfile`。

父列表**未提供**时不强制空工具（避免破坏现有委托路径）；**提供**时 fail-closed 执行子集。

### 3. 与既有层正交

- 不改 `agent-capability-policy` 的父 turn 投影算法。
- 不改 TOOL_CONTRACT effect lattice、permission、settlement sole-writer。
- 不给 child 增加 `write_workspace_file` / lesson / nested delegation。
- 不替代 profile 表：父即便允许 write，child 仍只拿 profile 提案 ∩ 父 grant。

## 已实施范围与验证入口

```powershell
pnpm exec vitest run --project unit tests/unit/child-capability-subset.unit.test.ts
```

## 不变量

1. 提供 `parentAllowedToolNames` 时，child 最终 allow-list 中的每个名字必须 ∈ 父 allow-list。
2. 空父 allow-list + 强制模式 → 空 child 工具面。
3. `workspace_audit` 永不通过本模块获得 web；`read_only`/`research` 永不通过本模块获得 write / lesson / nested delegate。
4. 稳定错误码：`child_capability_amplification`。

## 不包含 / non-claims

- **不**自动从 `teaching-conversation-runtime` 注入父 policy（调用方可后续传入 `parentAllowedToolNames`）。
- **不**改 child-run-supervisor 状态机、timeout、并行上限。
- **不**引入 shell / MCP marketplace / YOLO / 远程 telemetry / FTS 搜索。
- **不**把子集证明当作唯一授权源（effect / permission 仍复核）。

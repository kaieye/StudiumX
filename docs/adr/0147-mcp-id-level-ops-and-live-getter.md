# ADR-0147：MCP id 级 ops 归约 + 实时 getter（LiveAgent Phase B）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** **已实施**（2026-07-24）：`src/shared/mcp/mcp-ops.ts` + `config-store.applyOps` CAS + IPC `getMcpSettings`/`applyMcpOps` + preload/API；secret-free public DTO；无 marketplace Settings 页
- **日期：** 2026-07-24
- **范围：** 用户 MCP 配置更新采用 **按 server id 的 ops 归约**（`McpSettingsOp` 风格纯 apply）；**禁止**无 id 合并的整对象 clobber；读路径提供 **live `getMcpSettings`**（非 turn 级陈旧快照）。产品面仍守 [ADR-0142](0142-mcp-product-surface-settings-only.md)。
- **取代：** 无
- **被取代：** 无
- **相关：** LiveAgent 历史研究清单（已结项） §3.3 / Phase B、[ADR-0127](0127-user-configurable-mcp-design-gate.md)、[ADR-0128](0128-user-configurable-mcp-implementation.md)、[ADR-0132](0132-mcp-zcode-parity-and-trust-lifecycle.md)、[ADR-0133](0133-mcp-runtime-reliability-implementation.md)、[ADR-0142](0142-mcp-product-surface-settings-only.md)、[ADR-0121](0121-improvements-adoption-closeout.md)、`AGENTS.md`、`SECURITY.md`
- **证据：** `src/shared/mcp/mcp-ops.ts`（`McpSettingsOp` + pure `applyMcpOps`）；`src/main/mcp/config-store.ts`（`applyOps` + live `getMcpSettings`）；IPC/preload `mcpGetMcpSettings`/`mcpApplyMcpOps`；unit：`mcp-ops.unit.test.ts` + store CAS applyOps

## 1. 背景

Settings / IPC 并发写若以「整份 config 替换」提交，易互相覆盖。LiveAgent 以 `McpSettingsOp` + 纯 `applyMcpOps` 按 server id 合并，并用 live getter 避免 turn 快照陈旧。

StudiumX 已有 CAS `McpConfigStore` 与 secret-free public 面；本 ADR 冻结 **ops 形状** 与 **live 读** 作为 Phase B 设计门，不扩大 Settings 产品面。

## 2. 决策

### 2.1 Id 级 ops（pure apply）

| 规则 | 说明 |
| --- | --- |
| **Op 闭集** | 以 server **id** 为键：add / update-fields / remove / enable-disable 等（实现 PR 文档化闭集） |
| **合并** | `apply(ops, current) → next` 为 **纯函数**；字段级合并，**禁止**「客户端整对象覆盖服务端未知字段」的 clobber |
| **并发** | 与既有 revision / CAS（`expectedRevision` 语义若已存在则保持）兼容；冲突 fail 可重试，不静默丢对端更新 |
| **校验** | schema / transport 校验在 apply 前后 fail-closed；非法 op 拒绝整批或单条（实现选一种并单测） |

### 2.2 Live getter

| 规则 | 说明 |
| --- | --- |
| **Live** | `getMcpSettings`（或等价 IPC）返回 **当前 store 真值** 的 **public/secret-free 投影** |
| **禁止** | 仅依赖 agent turn 开始时缓存的整份 MCP 快照作为「设置权威」去写回 |
| **用途** | Settings UI、Doctor 只读 facts、host 重载前的一致性读 |

### 2.3 产品面与秘密（硬约束）

1. **ADR-0142：** Settings 产品面 = list / editor / import / OAuth；**无** marketplace 设置页；本 ADR **不** 复活市场 UI。
2. **Secret / token 永不** 进入 public DTO、Doctor、support-bundle 明文。
3. MCP tools 仍进 effect lattice + approval；**禁止** YOLO 标签。
4. MCP **非** teaching evidence；settlement sole-writer 不变。

### 2.4 红线

- 无默认 remote catalog phone-home；无 product `autoDrain: true`；fork `toolsReplayed: true` **禁止**。
- 不借 ops 引入 jiti 全权限扩展 / code-mode 执行不可信代码 / shell-escalation。

## 3. 实现落点（已实施）

```text
src/shared/mcp/*              # McpSettingsOp types + pure applyMcpOps
src/main/mcp/config-store.ts  # CAS write path consumes ops / id merge
# IPC: update-by-ops + live getMcpSettings (secret-free DTO)
# tests: concurrent id merge no clobber; stale snapshot not sole write source;
#        secret fields absent from public DTO
```

验收已由本 ADR 的实现落点和目标测试闭环。

## 4. 与既有 ADR 的关系

| 文档 | 关系 |
| --- | --- |
| ADR-0127 / 0128 | 用户可配置 MCP **基线**；本 ADR 加 ops 归约与 live 读 |
| ADR-0132 / 0133 | 信任生命周期与 runtime **不** 被 ops 旁路 |
| ADR-0142 | Settings 产品面 **收窄不变** |
| ADR-0140 / 0141 | marketplace foundation 可保留；**无** Settings 市场页 |
| ADR-0121 | 开放项须新 ADR；本条 Phase B 配置项 |

## 5. 非目标

- 不实施 Phase C Busy 或 Phase D 远程 sync 客户端。
- 不新增 marketplace Settings 页或默认远程 catalog 产品路径。
- 不把 MCP 配置写入 teaching SoT。

## 6. 一句话

**按 server id 的纯 ops 合并更新 MCP 配置，禁止无 id 整对象 clobber；live getMcpSettings 读当前投影；守 ADR-0142 与 secret-free 边界。**
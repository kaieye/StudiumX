# ADR-0137：MCP 多来源 precedence 与受控 auto-connect — Phase E 实现合同

- **状态：** 已实施；**默认体验由 [ADR-0141](0141-mcp-product-experience-parity-policy.md) 修订**（auto-connect 可随根开关默认开启；允许冷启动/workspace 自动连接）
- **日期：** 2026-07-23
- **范围：** 多来源 MCP 配置解析（CLI/session → environment → user → workspace → plugin → system）、winner/shadowed 投影、workspace 只读文件与可选 env 文档加载、以及 **默认关闭** 的全局 `autoConnect` 受控发现连接。
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0133、ADR-0134、ADR-0135、ADR-0136、Zcode MCP 对齐历史研究 §6.1 / §6.3（已结项）、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`。

## 1. 决定与非目标

Phase E 把“用户 userData 唯一权威”扩展为 **可解析的多来源 effective 视图**，同时：

1. **userData 仍是唯一 durable 写权威**（CAS / secret merge / import 确认写入路径不变）；
2. workspace / env / CLI 层为 **只读输入**，永不就地改写源文件；
3. **root MCP 出厂默认仍可为 off**（首次安装零连接）；用户打开 root 后，**产品目标为默认自动连接已启用 server**（ADR-0141）。`autoConnect` 为可关闭偏好，不再作为永久双 gate 惩罚性仪式；
4. auto-connect **只** 做 transport initialize + tools/list 发现，**永不** tools/call。

本 phase **明确不交付**：

1. workspace-root 注入 filesystem MCP（Phase F）；
2. plugin install / template expansion 为真实来源（Phase G；plugin 层类型预留，加载器可空）；
3. marketplace discover/install（Phase H）；
4. 网络 McpSync 客户端；
5. ~~禁止冷启动 auto-connect~~（已由 ADR-0141 允许受控冷启动/workspace 自动连接）；
6. 无限 retry / 自主 reconnect loop（沿用 session manager 显式 refresh / run snapshot）。

## 2. Precedence（高 → 低）

```text
CLI / session override
→ environment
→ user configuration (userData canonical)
→ workspace configuration
→ plugin / marketplace-provided (stub layers only in E)
→ system defaults
```

数值 rank 见 `MCP_CONFIG_SOURCE_PRECEDENCE`（cli=0 … system=5）。

### 2.1 同名 server 合并

| 规则 | 行为 |
| --- | --- |
| id 冲突 | **更高 precedence 源的完整 `UserMcpServerV1` 记录获胜** |
| 败者 | 进入 `shadowed[]`，`reason: 'id_collision'`，保留完整 record 与双方 origin 供 Settings/Doctor 展示 |
| 层内重复 id | fail-soft：跳过后续项并记 warning，不中止其它 id |
| 字段级 partial merge | **不做**；胜者整记录替换败者 |

### 2.2 Root 开关与 autoConnect

| 字段 | 权威 |
| --- | --- |
| `enabled`（root） | **仅 user gate**（durable `UserMcpConfigV1.enabled`）；workspace/env **不能** 强制打开 root |
| `autoConnect` | **仅 user gate**；可选字段。**政策目标（ADR-0141）：** 根开启后默认倾向自动连接；实现可保留缺省 false 的兼容读，并迁移/UI 默认推荐 true |
| 单 server `enabled` | 取 **胜者记录** 上的值 |

## 3. Workspace 只读路径（v1）

相对 **当前 workspace root**（canonicalize 后）读取，**不** 目录向上 walk（E 不做 parent inheritance）：

| Path | Shape |
| --- | --- |
| `.agents/mcp.json` | Claude/Cursor `mcpServers` map、nested `mcp.servers`、或 StudiumX `UserMcpConfigV1` servers |
| `mcp.json`（workspace root） | 同上 |
| `zcode.json` 可选键 `mcpServers` | 仅读取 `mcpServers` 对象 map；其它键忽略 |

解析：复用 ADR-0136 `parseMcpImportDocument` / `parseMcpImportText` 的形状识别；畸形文件 fail-closed（该文件 servers 空 + warning），不污染其它层。

**永不写入** 上述路径。

## 4. Environment

可选：

- `STUDIUMX_MCP_CONFIG_JSON`：完整 JSON 文档字符串（与 import 形状相同）。空 / 未设置 → 无 env 层。
- v1 **不** 支持逐 server 拆分的多个 env 变量。

Env 层 origin label = `STUDIUMX_MCP_CONFIG_JSON`。

## 5. CLI / session

CLI 层：`STUDIUMX_MCP_CLI_JSON` 环境变量（与 import 同形状）或 `McpHost`/`loadMcpSourceLayers` 的 `cliServers` / `setCliServers`；最高 precedence。空层无副作用。

## 6. Auto-connect 合同

### 6.1 资格（全部满足）

1. `userGate.enabled === true`
2. `userGate.autoConnect === true`
3. effective server `enabled === true`
4. workspace scope 匹配（与 session manager 既有规则一致）
5. 若 server 配置了 OAuth（非 stdio）：调用方判定 OAuth ready；否则 **跳过**（不阻塞其它 server，不打开 browser）

### 6.2 行为

- 仅 `initialize` + tools/list（等价 `testServer` / `refreshServer` 发现路径）
- **禁止** tools/call、禁止 artifact 写入作为 auto-connect 副作用扩展
- **无** 无限 retry；失败记 runtime error/failed，下次仅由用户 refresh、下次 `autoConnectNow` 或 run `buildSnapshot` 再试
- 并发上限默认 `DEFAULT_MAX_AUTO_CONNECT = 4`

### 6.3 触发

- `McpHost.autoConnectNow(workspaceRoot?)`：显式 API；**no-op** 当 `autoConnect` 或 root 未开
- **不** 在 `McpHost.start()` 无条件调用
- 推荐：用户在 Settings 打开 root+autoConnect 后的 config apply 路径可选调用；workspace 激活钩子仅当 gate 为 true

## 7. 安全与教学不变量

1. Settlement sole-writer；MCP 不 import ledger / outcome committer
2. Secret / OAuth token 永不进 renderer / logs / Doctor；workspace 层 ephemeral secret 仅 main 内存，public 投影脱敏
3. Remote `readOnlyHint` 不降权 effect
4. MCP result ≠ teaching evidence
5. `toolsReplayed:false` / `expectedRevision` 不变
6. Root 默认 off；autoConnect 默认 false
7. 无 marketplace、无网络 sync、无 untrusted download

## 8. 模块锚点

```text
docs/adr/0137-mcp-multi-source-precedence-and-auto-connect.md
src/shared/mcp/source-types.ts
src/shared/mcp/source-resolver.ts
src/shared/mcp/config-schema.ts   # autoConnect optional
src/shared/mcp/types.ts
src/main/mcp/source-loaders.ts
src/main/mcp/host.ts              # autoConnectNow + optional layers
tests/unit/mcp-source-resolver.unit.test.ts
```

## 9. 验收

1. precedence：cli > env > user > workspace > plugin > system
2. 同 id：winner 全记录；loser 在 shadowed
3. root enabled / autoConnect 仅来自 user gate
4. autoConnect 缺省 false；仅 gate 全开时 eligible 非空
5. OAuth 未 ready 的 server 被 skip
6. user-only resolve 与旧行为 server 列表一致
7. 加载器对坏 JSON fail-closed

最低验证：

```bash
pnpm exec vitest run --project unit tests/unit/mcp-source-resolver.unit.test.ts
```

## 10. 一句话

Phase E 交付只读多来源 precedence 与默认关闭的受控 auto-connect 发现 API；不打开 marketplace、workspace-root 注入或启动即连的后台循环。

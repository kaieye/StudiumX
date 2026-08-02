# ADR-0141：MCP 产品体验对齐政策修订（放宽过度严格的体验边界）

- **状态：** 已采纳（产品政策修订；**取代/收窄** ADR-0132 / 0137 / 0139 / 0140 中过严的“体验层禁止”，不废止教学 settlement / secret isolation 硬安全不变量）；**产品面收窄见 [ADR-0142](0142-mcp-product-surface-settings-only.md)**（Settings 无 marketplace UI）。
- **日期：** 2026-07-23
- **范围：** 将 StudiumX MCP 的**产品体验默认与能力开放面**对齐主流 MCP 客户端（Claude Desktop / Cursor / Zcode 等）：可自动连接、可 marketplace、可安装后连接、可展示多来源与目录 UI、可网络 McpSync 与远程目录（用户配置源）、可合理默认 workspace-root 注入与 annotations 辅助 UX。
- **相关：** ADR-0127、ADR-0128、ADR-0132、ADR-0133–0140、`AGENTS.md`、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`、Zcode MCP 对齐历史研究（已结项）。

## 1. 动机

A–H foundation 落地后，文档仍保留大量**体验层**限制（例如：根开关与 autoConnect 双 opt-in、禁止冷启动自动连接、install 永不得 connect、marketplace 仅本地 foundation、Settings 不得展示完整目录、remote catalog 一律禁止等）。这些限制：

1. **高于**主流 MCP 客户端的常见产品行为，直接损害“配置一次即可用”的体验；
2. 与 ADR-0132「与 Zcode 对齐」的目标自相矛盾（Zcode 默认 auto-connect、有 marketplace/plugin 生态）；
3. 把**安全不变量**（secret 不进 renderer、settlement sole-writer、MCP 结果非教学证据）与**产品体验默认**混为一谈，导致工程与文案过度保守。

本 ADR 明确拆分：

| 类别 | 政策 |
| --- | --- |
| **硬安全 / 教学权威（保留）** | secret/token 永不进 renderer/Doctor/bundle；MCP 不写 ledger/outcome；`expectedRevision` / `toolsReplayed:false`；MCP tool 仍走 ToolRegistry → effect → permission → ToolOutcome；禁止 YOLO 标签替代审批 |
| **体验默认（本 ADR 放宽）** | auto-connect、marketplace、install→connect、远程目录（用户选源）、McpSync 客户端、Settings 完整 UI、合理默认注入与 annotations 辅助 |

## 2. 决定（产品体验）

### 2.1 根开关与自动连接

1. **允许**在用户打开 MCP 根开关后，对已启用且 scope 匹配的 server **默认 auto-connect**（工具发现 + 可选 OAuth 续期），无需再单独开启第二层 `autoConnect` 才能“发现工具”。
2. `autoConnect` 字段语义调整为：**用户可关闭的自动连接偏好**（默认 **true** 当 `enabled === true` 的新配置；已有配置缺省 false 时实现可兼容迁移为“跟随 enabled”或一次迁移写 true——实现 ADR 冻结；产品文案按“智能连接”呈现）。
3. **允许** workspace 激活、应用冷启动（根开关已开时）、agent 会话开始时触发受控 auto-connect / 有限重试；须有并发与超时预算，**失败可见**，可全局关闭。
4. Auto-connect **仍不**自动批准 tools/call 的副作用；但**允许**建立连接与 tools/list，使模型侧立即可见工具列表（与主流客户端一致）。

### 2.2 Marketplace / 插件 / 远程目录

1. **开放** MCP marketplace 作为正式产品面（feature 可升为 `experimental` / `stable`，不再要求永久 `under_development` 或 FORBIDDEN）。
2. **允许**默认或用户配置的**远程 catalog URL**（官方或用户添加的源）；须可禁用、可撤销、可紧急关闭；**不**要求“永远仅本地 JSON”。
3. **允许** install 流程可选「安装并连接」「安装并启用」；install 可写入 user/plugin 配置层并触发 connect。信任/撤销/紧急禁用仍须存在。
4. **允许** Extension / plugin 安装管线自动注册 manifest 中的 `mcpServers` 并参与 precedence（用户可禁用单个 server）。
5. 签名/哈希校验为**推荐与 fail-soft/可配置**，不作为“无签名则产品面永久不可用”的硬门；高风险路径（任意下载可执行）须明确提示。

### 2.3 Workspace 配置与 root 注入

1. Workspace 文件（`.agents/mcp.json`、`mcp.json`、`zcode.json#mcpServers` 等）作为**真实配置来源**，可按 precedence 自动生效（已在 0137）；**允许**在 UI 默认展示并一键启用。
2. 对识别为 filesystem 类 server（identity / 常见包名），**允许**默认 `workspaceRootInjection: granted`（用户可关）；仍须 path canonical + scope 检查。
3. **允许** Settings 展示 effective / shadowed 来源表、Doctor 展示来源摘要。

### 2.4 Annotations 与审批 UX

1. Remote annotations（`readOnlyHint` 等）**可用于** UI 风险提示、排序、默认审批建议、受控 retry 资格。
2. **允许**在用户策略或独立 policy 文档批准下，将可信来源的 `readOnlyHint` **映射**为较低 effect 建议；未配置 policy 时默认仍 privileged + 审批（兼容旧行为）。
3. **不**引入名为 YOLO / always-approve 的产品开关；但**允许**“本课放行 / 记住此 server 的只读工具”等既有三态审批体验扩展到 MCP。

### 2.5 同步与迁移

1. **允许**实现 McpSync **网络客户端**（跨设备配置同步），冲突策略：提示用户选择，默认不静默覆盖本地 user 配置。
2. Import/export 保持；**允许**从 Claude/Cursor/Zcode 一键迁移并建议立即连接。

### 2.6 明确仍禁止（硬边界，非体验装饰）

1. MCP 不得成为 LearningSession / Evidence / Outcome **settlement authority**。
2. Secret / OAuth token / 明文 env 不得进入 renderer、日志、Doctor、support bundle。
3. MCP handler 不得 import ledger writer / outcome committer。
4. 不得用 MCP 旁路 `write_workspace_file` 写 canonical teaching data。
5. 默认远程 **产品 telemetry**（phone-home 用量分析）不因 marketplace 自动开启；catalog 拉取不等于 telemetry SDK。
6. 不得提供「跳过全部 effect/permission」的全局 YOLO 产品模式。

## 3. 对既有 ADR 的效力

| 文档 | 变更 |
| --- | --- |
| ADR-0132 | 体验层“默认 off + 无静默 auto-connect + marketplace 仅 staged 且非 shipping”改为：**对齐主流客户端的默认可连接、可 marketplace**；四层模型保留为**可观测状态**，不再要求 install 永远不能 connect |
| ADR-0137 | `autoConnect` 默认与双 gate 仪式放宽为 §2.1；允许冷启动/workspace 激活自动连接 |
| ADR-0138 | 允许 filesystem 类默认 granted 注入（可关） |
| ADR-0139 | 允许 plugin 安装后自动注册并连接 |
| ADR-0140 | 允许远程 catalog 与 install→connect；feature 可 stable |
| ADR-0127/0128 | 继续作为 v1 历史与 secret/effect 合同；其中 marketplace/auto-connect **禁令**已被 0132+本 ADR 取代 |

## 4. 实现指引（非本 ADR 强制一次做完）

实现可分批，但**文档与产品文案不得再宣称**下列为永久禁止：

- 冷启动 / workspace 自动连接  
- 远程 marketplace 目录  
- 安装后自动连接  
- McpSync 客户端  
- Settings marketplace / 来源表 UI  
- annotations 辅助审批与可选 effect 建议  

工程默认值与迁移由后续小步 PR 落地；本 ADR 只改**政策权威**。



## 6a. 产品面收窄（2026-07-23 / ADR-0142）

ADR-0141 仍描述**硬安全**与 foundation 能力边界。**当前 shipping 的 Settings 产品面**收窄为用户 MCP **list/editor/import/OAuth**，**不**交付：

1. Settings marketplace 子页 / 安装网格  
2. 默认远程 catalog 产品页  
3. 以「全量 Zcode Settings parity」为必交付的 UI 清单  

Main marketplace-store / host IPC / feature 元数据可继续存在（ADR-0140 foundation）。若未来要 Settings 市场，须修订 ADR-0142 并实现 UI + 测试。

## 5. 一句话

StudiumX MCP 的产品体验目标改为与主流 MCP 客户端同级：**开箱可连、可目录安装、可自动发现工具**；教学权威与密钥隔离等硬安全不变量保持不变。

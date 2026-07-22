# codex.md — OpenAI Codex × StudiumX 对照审查

- **状态：** 审查记录（非实施 backlog）
- **日期：** 2026-07-21
- **上游：** `ref_project/codex`（Codex CLI / `codex-rs` 工作区：protocol、core、tools、config、features、sandboxing、execpolicy、skills、plugin、mcp、rollout、memories、app-server、TUI、`.github`）
- **本仓：** StudiumX（Electron 本地教学工作区；canonical 在文件 + LearningSessionLedger）
- **方法：** 6 路并行探子（架构 / Agent loop / 安全 / 配置扩展 / 会话上下文 / 工程化）+ 主代理对关键 `file:line` 点验；原始报告 `_agent-logs/codex-compare-v3/result-{A..F}-*.md`
- **关系：** 2026-07-21 四源借鉴已结项为 [ADR-0121](../adr/0121-improvements-adoption-closeout.md)。本文是 **再开一次源审查**，记录「已吸收证据 / 仍可借鉴的增量 / 必须拒绝」；**不**复活已关闭的 A/B/S backlog ID。开放实现须 **新建 ADR**，不得把本文当 P0 分派表。

## 0. 裁定规则（沿用 ADR-0121）

1. 与教学安全 / 既有 ADR / `SECURITY.md` / `TOOL_CONTRACT.md` 冲突 → **以 StudiumX 边界为准**。
2. 同能力多源建议 → **一个 port / 一个模块名 / 一条验收**。
3. 正确性与安全 > 吞吐 > 工程抛光。
4. 结构大搬家 → 同一阶段只开一条主结构线；其余 by-touch peel（ADR-0075 / S-03 residual）。
5. busy 默认 **`queue` 优于 `interrupt`**；`steer` 仅安全 turn 边界；**steer ≠ abort**。
6. Provider：**双轴一处**（UX kind ⟂ recovery flags）+ 共享 run 级 retry budget。
7. 重试禁区：billing / 永久 auth / context overflow / max-tokens 截断 **永不自动重试**；**禁止** credential 多 key 旋转。
8. 扩展面：TeachingCommand 闭集 + skill-pack verifier；**禁止** jiti 全权限扩展 / 默认任意 MCP / 默认 ShellTool / code-mode。

---

## 1. 上游画像（Codex 是什么）

| 区域 | 角色 | 与 StudiumX 的关系 |
| --- | --- | --- |
| `codex-rs/protocol` | 类型面 + approvals/permissions；相对 core **禁止 material business logic**（依赖面并不「绝对 minimal」） | 对应 `src/shared/protocol/*` + `teaching-events` / IPC 契约；wire 已迁 shared（ADR-0070） |
| `codex-rs/core` | 会话 turn、tool orchestrator、compact、multi-agent | 对应 `src/main/ai/*` + coordinator host；**勿**整包替换 EventBus / AgentRun SM |
| `codex-rs/tools` + core orchestrator | ToolExecutor / ToolExposure + 审批/沙箱/重试中枢 | 对应 `tools/{registry,dispatcher,effect-policy,batch-dispatch,tool-policy}`；**拒** sandbox/shell 产品化 |
| `config` + `features` | ConfigLayerSource 分层 + Feature Stage 生命周期 | 对应 `teaching-config-resolver` + denylist + `shared/features.ts`（ADR-0025/0071/0073/0092） |
| `sandboxing` / `execpolicy` / `shell-escalation` | OS 沙箱 + argv 策略 + shell 提权 | **产品非目标**（SECURITY.md / AGENTS 红线） |
| `plugin` / `mcp-*` / `code-mode*` | 扩展市场 / MCP / V8 不可信代码 | **拒绝** marketplace / 默认 MCP / code-mode |
| `rollout` / `thread-store` / `memories` | 会话归档、线程存储、**启动自动 memory Phase** | 文件 SoT + 同意 memory；**拒**自动 memory / FTS5 产品搜索 / 教学 canonical zstd |
| `app-server*` / TUI / CLI | 多宿主控制面与交互 | Electron IPC + coordinator host 已是产品路径；headless JSON-RPC = **S-07 defer** |
| `.github` + `AGENTS.md` | Blocking fan-in、skip=fail、clean-worktree、agent DX 手册 | 对应 `blocking-ci` + `check-ci-results` + 根 `AGENTS.md`（已吸收大部分） |

Codex 是 **通用 coding agent**（本地 CLI + IDE + 可选 cloud）。StudiumX 是 **教学工作区**：文件真相源、effect lattice、settlement sole-writer、无默认 shell。对齐必须是 **ports / adapters / gates**，不是「像 Codex 一样有 shell 市场」。

---

## 2. 对照总表（已落地 vs 仍可看）

| 主题 | Codex 证据 | StudiumX 现状 | 裁定 |
| --- | --- | --- | --- |
| 模块尺寸闸门 | `AGENTS.md` 目标 &lt;500 / ~800 开新模块；抵制 core 膨胀 | `AGENTS.md` §5 + ADR-0075 + `check:module-size`（warning-only） | **已吸收政策**；巨石 by-touch residual |
| Protocol / wire 分离 | `protocol/` types-only 目标；core-api facade | `shared/protocol/agent-runtime-wire.ts` + main re-export；ADR-0070 | **已吸收 wire**；TeachingEvent 整包迁 protocol 非必须 |
| Feature Stage 注册表 | `features` Stage + FEATURES 表 | `src/shared/features.ts` + FORBIDDEN ids；capability catalog；Footprint Ladder | **已吸收**（≠ 授权） |
| Config 分层 + project denylist | `ConfigLayerSource`；`PROJECT_LOCAL_CONFIG_DENYLIST` | layers + field source；`teaching-config-denylist` 禁 workspace `baseUrl` | **已吸收核心**；doctor 字符串格式 residual |
| Tool effect / 合同 | ToolExecutor exposure；orchestrator 审批+沙箱 | effect lattice + TOOL_CONTRACT + tool-policy 多路径；无 YOLO | **已吸收且更贴教学**；拒 sandbox |
| finish_reason length 拒 tool | 流式截断相关 | ADR-0051；`agent-loop` length → 拒 tool batch | **已吸收** |
| Provider recovery / 有界 retry | 各类 client 重试 | `provider-recovery` + `provider-retry` | **已吸收** |
| 输入队列 / busy / steer | `input_queue` / `steer_input` / pending drain | `agent-input-queue` + `agent-busy-input-policy` + steer/follow-up IPC；`autoDrain: false` | **已吸收模块**；busy 相位保真 + 显式 drain residual |
| 只读并行 tool | parallel tools + supports_parallel | `executeToolBatch` / `batch-dispatch` 已接线 | **已吸收**（v2「未接线」已过时） |
| Tool result 预算 | 各类截断 | ADR-0041/0056；`tool-result-budget` | **已吸收** |
| 多轴硬预算 | soft token reminder 为主 | 时长/provider/tool/tokens **硬停** + warning | **保留 SX 优势**；soft 只可作互补 |
| Settlement / revision | 会话线程模型 | sole-writer + `expectedRevision` + `toolsReplayed:false` | **保留 SX 优势**；a08 域门禁可再封一层 |
| 同意 memory | **启动自动** memories Phase1/2 | consent gate；无 auto inject | **拒移植自动 memory** |
| OS sandbox / shell policy | seatbelt/landlock/bwrap + argv DSL | path + effect + capability | **拒绝** 产品化 |
| MCP / plugin / code-mode | marketplace + V8 | FORBIDDEN_FEATURE_IDS | **拒绝** |
| 远程 OTEL / Statsig | 默认 metrics exporter Statsig 等 | 本地 doctor / study analytics 地基检查 | **拒绝** phone-home |
| Blocking CI skip=fail | `check_ci_results.py` | `check-ci-results.mjs` + `blocking-required` | **已吸收** |
| 根 AGENTS.md | ~300 行手册 | 根 `AGENTS.md`（短而硬 + 链 ADR） | **已吸收**；可选工程 runbook 增量 |
| `docs/testing.md` | 测试教条外链 | **文件缺失**（ADR/AGENTS 仍引用） | **PORT_WORTHY 文档结项** |

---

## 3. 已吸收能力（对照证据，勿重开 backlog）

下列能力在 ADR-0051–0120 / 0121 中已落地。本文只保留 **证据指针**。

### 3.1 架构 / 协议 / 配置 / 特性

| 能力 | Codex | StudiumX |
| --- | --- | --- |
| 模块尺寸政策 | `ref_project/codex/AGENTS.md` ~L49–83 | `AGENTS.md` §5；[ADR-0075](../adr/0075-module-size-policy-and-giant-peel.md)；`pnpm run check:module-size` |
| Runtime wire 在 protocol 边界 | protocol crate | `src/shared/protocol/agent-runtime-wire.ts`；main 仅 `export *`（ADR-0070） |
| Feature Stage + 禁区 id | `features/src/lib.rs` Stage 枚举 | `src/shared/features.ts`：`FeatureStage` + `FORBIDDEN_FEATURE_IDS`（shell/code_mode/yolo/mcp_marketplace…） |
| Config 分层 + managed FS | ConfigLayerSource | `teaching-config-resolver`：default/user/workspace/managed/session_override；[ADR-0092](../adr/0092-managed-config-fs-loader.md) |
| Workspace denylist `baseUrl` | PROJECT_LOCAL_CONFIG_DENYLIST | `teaching-config-denylist.ts`：`provider.providers.*.baseUrl`；resolver 应用（ADR-0071） |
| ApplicationRuntime / session façade | core-api ThreadManager | `application-runtime.ts`（~77 行 boot）；`agent-session-facade.ts`（命名冻结，勿再造 CoreFacade） |

### 3.2 Agent loop / tools

| 能力 | Codex | StudiumX |
| --- | --- | --- |
| length 截断拒 tool | 流式/截断路径 | `agent-loop.ts` ~L418–444：`finishReason === 'length'` 拒整批 tool |
| 有界 retry | client 重试 | `invokeProviderWithRetry` / `provider-retry.ts` |
| 输入队列 + busy 策略 | input_queue / steer mailbox | `agent-input-queue.ts`（hardCap 16）；`agent-busy-input-policy.ts`（queue 默认；write/privileged 禁 steer） |
| steer / follow-up IPC | mid-turn steer | `agent-chat-steer-followup-ipc.ts` + gateway；**产品 `autoDrain: false`**（`teaching-ipc-gateway.ts` ~L340–349） |
| Stream 适配与总线隔离 | 巨型 EventMsg | `agent-stream-events.ts` + `agent-event-bus.ts`（ADR 禁止 wholesale EventMsg） |
| 只读并行 | parallel tool runtime | `agent-loop.ts` → `executeToolBatch`（`batch-dispatch`） |
| Tool result 预算 | 截断 | `tool-result-budget.ts` + turn 聚合 spill |
| Cancel 关 tool pair | lifecycle abort | `close-open-tool-calls.ts` |
| 多轴硬预算 | soft reminder 为主 | `agent-loop-execution-state` 硬停 + `maybeWarnBudget` UI 警告 |

### 3.3 安全 / 工具策略

| 能力 | Codex | StudiumX |
| --- | --- | --- |
| effect lattice + 未知 fail-closed | 审批 + sandbox 类 | `effect-policy` + `classifyToolEffect` → privileged；`docs/tools/TOOL_CONTRACT.md` + `check:tool-contract` |
| 声明式 tool-policy（非 argv） | execpolicy prefix_rule（shell 语言） | `tool-policy.ts` + multi-path FS merge（ADR-0063…0118）；**无** shell argv DSL |
| 粗粒度审批模式 | AskForApproval 含 Never 等 | `AGENT_APPROVAL_MODES`；**无** YOLO / always-approve 标签 |
| Web 安全基线 | network-proxy allowlist-first | SSRF / private IP / redirect-DNS 检查（可选 **教师 host allowlist** 仍是增量） |
| 密钥 / support-bundle | keyring + sanitizer | secret-free config 投影；consent support-bundle（ADR-0034） |

### 3.4 会话 / memory / 工程

| 能力 | Codex | StudiumX |
| --- | --- | --- |
| `expectedRevision` + `toolsReplayed:false` | 线程模型不同 | IPC + session-tree CAS；`tests/unit/a08-revision-tools-memory-contracts.unit.test.ts` |
| Resume picker | TUI 大 picker | `session-resume-picker`（ADR-0030）；**S-08 UX 增量 defer** |
| Context compact | compact + auto_compact_window | `context-compactor`：默认 **不** durable rewrite 会话正文 |
| Consent memory | **启动自动** Phase1/2（勿移植） | `teaching-conversation-memory` / recall 门控；a08 覆盖 no-startup-inject |
| Blocking skip=fail | `check_ci_results.py` | `scripts/check-ci-results.mjs` + `blocking-required`（ADR-0074） |
| clean-worktree / format subset | composite action + full fmt | `check-clean-worktree.mjs` + `check-format-subset.mjs`（子集诚实） |
| 本地 analytics ≠ 远程 telemetry | OTEL/Statsig 默认风险 | `check:analytics` = study analytics **测试地基**；AGENTS 明示非 phone-home |

**当前巨石（纪律 residual，非开放 P0 重写）：**

| 文件 | ~LOC（物理行，2026-07-21） |
| --- | ---: |
| `src/main/teaching-workspace.ts` | 2992 |
| `src/main/learning-session-ledger.ts` | 2661 |
| `src/main/teaching-turn-coordinator.ts` | 2369 |
| `src/shared/teaching-events.ts` | 1750 |
| `src/main/ai/tools/workspace.ts` | 951 |

---

## 4. 仍可借鉴的增量（ADAPT / 观察）

> 仅列 **当前代码仍缺** 且与产品地板相容的项。实现须新建或更新 ADR；默认不排期。

### 4.1 高杠杆、低风险（文档 / 接线 / 审计）

| ID | 建议 | 为什么 | 落点形状 | 置信 |
| --- | --- | --- | --- | --- |
| **CX-F1** | **物化 `docs/testing.md`** | AGENTS / CONTRIBUTING / ADR-0121 多处链接，文件 **不存在**；是最大的 agent-DX 空洞 | L0–L4 教条 +「改哪测哪」表 + check 导航；**不**塞全量 e2e 进 PR | 高 |
| **CX-B1** | **Busy 相位保真接线** | `BusyInputPhase` 含 `write_tool` / `privileged_tool` / `tool_batch` / `turn_boundary`，产品路径多只见 `provider`/`idle` → steer 降级与写安全队列规则无法按设计触发 | 在 loop / dispatcher 边界 `facade.setPhase(...)`；不改默认 queue 语义 | 高 |
| **CX-B2** | **显式 drain / 消费队列**（**不**翻 `autoDrain: true`） | 中途 steer/queue 已接线；turn 结束后队列依赖 drain，产品 `autoDrain: false`（ADR-0096/0121）且无调用 `facade.drain()` 的产品通道 | 只读 project 已有；可选显式「消费下一项」IPC / UI，须新 ADR 才能考虑 autoDrain | 高 |
| **CX-C1** | **拒绝类 permissionDecision 进 durable 审计** | 允许后的 write journal 有决策字段；policy `forbidden` / 交互 `deny` 的 staging 与 write 词汇表未完全统一 | 审计枚举 `allow\|prompt\|forbidden\|deny`；**永不**用审计重放授权；deny 不启 write pre-image | 高 |
| **CX-E1** | **a08 不变量进命名域门禁** | unit 已封 `expectedRevision` / `toolsReplayed:false` / no-auto-memory；Blocking 未必点名该套 | 薄 `check:*` 或 prepush 邻接 teaching-evidence；**不**塞全量 e2e | 中–高 |

### 4.2 中优先级（形状 port，产品信号或 by-touch）

| ID | 建议 | 要点 | 置信 |
| --- | --- | --- | --- |
| **CX-A1** | 巨石 **by-touch peel**（S-03） | 触达 workspace/ledger/coordinator 时外提边界清晰模块；**禁止**三线并行大搬家；保留 sole-writer | 高（纪律） |
| **CX-A2** | CONTRIBUTING / PR 清单：触达巨石须 `check:module-size` 摘要 | 对齐 Codex「抵制往最大文件塞」；size **不进** Blocking hard-fail | 高 |
| **CX-A3** | 可选薄 `modelVisibility: direct\|hidden` | 仅当闭集工具需注册但默认不进 `definitions()`；**非** Codex Deferred/tool_search/code-mode | 中 |
| **CX-A4** | Config source **doctor 字符串格式化** | 已有 `TeachingConfigFieldSource`；补稳定 human/doctor DTO（勿上 MDM 层） | 中 |
| **CX-B3** | 可选 **模型向 soft budget 片段**（互补硬停） | UI `maybeWarnBudget` 已有；可注入短 context 让模型收尾；**禁止**替代多轴硬预算 | 中 |
| **CX-B4** | 薄 tool lifecycle middleware（start/finish/cancel） | 在 `onOutcome` 外对称审计钩子；**不**移植 shell EventMsg 洪流 | 中 |
| **CX-B5** | 紧凑 `stopReason` / abort 分类上 wire | cancel vs budget vs replaced；**非** wholesale Op/EventMsg | 中 |
| **CX-C2** | 可选 **web host allowlist**（默认关） | 在现有 SSRF 基线上叠加教师域列表；日志落 tool envelope；无 MITM proxy | 中（需产品信号） |
| **CX-C3** | tool-policy **Settings UI**（B-08） | 引擎与多路径加载已结；UI 仍 defer；编辑 allow/prompt/forbidden，禁 YOLO/argv | 高（defer） |
| **CX-D1** | FeatureRegistry：`managed-config-overlay` stage 诚实化 | 现为 `under_development` /「规划中」，FS loader 已落地 → 升 experimental/stable 文案 | 高（小改） |
| **CX-D2** | denylist 再 diff TeachingLoop 可写字段 | 例如是否禁 workspace 改 `activeProviderId`；**勿**盲搬 Codex otel/notify 键 | 中 |
| **CX-D3** | 用户级 skill enable 表（可选） | `{id,enabled}` + index 过滤；**无** plugin/MCP 安装通道 | 中 |
| **CX-E2** | 本地 context-remaining 诊断暴露 | `context-projection-report` 已有 remaining；doctor / 可选闭集命令；无 analytics | 中 |
| **CX-E3** | 本地 compaction window 元数据 | window_id / 切点链，仅本地审计；soft 只触发 compact | 中 |
| **CX-F2** | clean-worktree 参数对齐 Codex porcelain 严格度 | `porcelain=v1` + untracked/submodule 标志；仍放 fan-in | 中 |
| **CX-F3** | format subset **by-touch 扩 allowlist** | 全量 Prettier 仍 defer（mega-diff）；不把 surprise format 塞进 Blocking | 高 |
| **CX-F4** | 可选 Node/pnpm setup composite action | 减少 blocking 三 job 重复；低产品风险 | 中 |

### 4.3 明确 defer（ADR-0121 已写，不重开）

| 主题 | 触发 |
| --- | --- |
| **S-07** Headless Teaching Agent Protocol（stdio JSON-RPC / app-server 类） | 独立产品/CI 信号 + 新 ADR |
| **S-08** 会话搜索/命名/导出 UX | 产品信号；勿重造 ADR-0030 picker |
| **S-09** 真实 skill/memory consent 产品动作 | 既有 handoff 栈；**禁止 auto-apply** |
| **B-08** Granular tool-policy Settings UI | 产品信号（引擎已结） |
| **S-11** MDM / remote policy / managed-upload UI | 本地 managed FS 已够；远程需新 ADR |
| **B-02** product `autoDrain: true` | 禁止直至新 ADR + renderer 队列同步设计 |
| **B-11** doctor auto-repair | **仍禁止** |

---

## 5. 明确拒绝（REJECT）

任一份「对齐 Codex」建议若引入下列项，**以本节与 AGENTS / ADR-0121 §6 为准**：

| # | 拒绝项 | 原因 |
| --- | --- | --- |
| 1 | 默认 ShellTool / OS sandbox 产品声明 / shell-escalation / argv `prefix_rule` | 教学边界是 path+effect+capability，不是子进程沙箱市场 |
| 2 | YOLO / always-approve / DangerFullAccess 默认或 UI 标签 | TOOL_CONTRACT + `FORBIDDEN_FEATURE_IDS` |
| 3 | MCP marketplace / plugin marketplace / 默认任意 MCP | TeachingCommand 闭集 + skill-pack verifier |
| 4 | code-mode / V8 / jiti 全权限扩展 | 不可信代码执行 |
| 5 | 启动自动 memories Phase / dream / FTS5 或向量 **产品搜索** | 同意 memory + 文件 SoT；Codex `memories/write/.../start.rs` 是反面教材 |
| 6 | 默认远程 OTEL / Statsig / Mixpanel 式 phone-home | Codex metrics 默认 Statsig 等 **不可**当产品默认 |
| 7 | 用 soft token reminder **替代** 多轴硬预算 | SX 硬预算是优势；soft 最多互补 |
| 8 | 用覆盖率 / 泛型 lint **替换** teaching/privacy/security 领域门禁 | Blocking 保持窄而硬（ADR-0023） |
| 9 | 推倒 EventBus/timeline、重写 AgentRun 状态机、拆 settlement sole-writer | 红线 |
| 10 | 教学 canonical 数据 zstd 物理压缩 | ADR-0002；Codex rollout `.jsonl.zst` 不可搬到教学权威数据 |
| 11 | Fork 默认 `toolsReplayed: true` / 可执行工具历史 | 回放安全 |
| 12 | Credential 多 key 池旋转 | 重试禁区 |
| 13 | 物理 monorepo 拆包 / 独立 app-server **作为前置条件** | Electron 单进程组合已够；app-server 是 IDE 控制面 |
| 14 | 默认 durable rewrite 会话正文作 compact | `context-compactor` 默认 false |
| 15 | 学生机 fail-open 外部 shell hooks | 安全地板 |
| 16 | 第二套 `CoreFacade` / `SessionPort` 命名分叉 | 冻结：`agent-session-facade` + `ApplicationRuntime` |
| 17 | Wholesale 移植 Codex `Op` / `EventMsg` | 协议面过大；SX 紧凑 wire 是 intentional |
| 18 | module-size 进入 Blocking hard-fail | ADR-0075 有意 warning-only |
| 19 | 三巨石并行大搬家「对齐 crate 图」 | S-03 residual：by-touch only |

---

## 6. 模块落点对照（命名冻结提醒）

| 能力 | StudiumX **唯一**模块名 | 勿新建并行名 |
| --- | --- | --- |
| 运行时输入队列 | `agent-input-queue.ts` | `agent-loop-queue` / `agent-prompt-queue` / `agent-interjection` |
| Busy 策略 | `agent-busy-input-policy.ts` | runner 内魔法 if |
| 会话门面 | `agent-session-facade.ts` | `CoreFacade` / 第二套 `AgentBuilder` / `SessionPort` |
| Recovery 分类 | `provider-recovery.ts` | UX 混装 ad-hoc 正则 |
| 有界重试 | `provider-retry.ts` | loop 内联 429 sleep |
| Tool result 预算 | `tools/tool-result-budget.ts` | 与 journal 字节上限混用 |
| Stream 适配 | `agent-stream-events.ts` | 推倒 EventBus |
| Feature 元数据 | `shared/features.ts` | 第二套授权用 Feature 开关 |
| Config denylist | `teaching-config-denylist.ts` | resolver 内联第二表 |
| Tool policy | `tools/tool-policy.ts` + FS loaders | shell argv DSL / YOLO 策略语言 |

---

## 7. 建议优先级（若未来排期）

> **不是**当前 sprint backlog。仅在有产品信号或触达相关代码时启用，并 **新建 ADR**。

### P0（文档 / 正确性接线 / 审计闭合）

1. **CX-F1** 写齐 `docs/testing.md`（链接已承诺）
2. **CX-B1** busy phase 从 loop/dispatcher 如实 `setPhase`
3. **CX-C1** deny/forbidden permissionDecision 进入 durable 审计词汇
4. **CX-E1** a08 类不变量进入命名 `check:*`（薄门禁）

### P1（产品信号或触达时）

5. **CX-B2** 显式 drain/消费（仍禁 silent `autoDrain: true`）
6. **CX-A1/A2** 巨石 by-touch peel + PR checklist
7. **CX-D1** managed-config feature stage 文案诚实化
8. **CX-C2** 可选 web host allowlist（默认关）
9. **CX-A4 / CX-E2** doctor 配置来源格式 + context remaining 诊断
10. **CX-F2/F3** porcelain 严格度 + format subset 扩容

### P2 / defer

11. Soft budget 片段互补、tool lifecycle middleware、abort 分类 wire  
12. `modelVisibility`、skill enable 表、compaction window 元数据  
13. B-08 Settings UI、S-07/S-08/S-09/S-11 全表 defer 项  

---

## 8. 诚实对照：StudiumX 已更优或必须保留

- **文件真相源** + 可重建投影（非 SQLite teaching authority）
- **effect lattice** + TOOL_CONTRACT 门禁 + 无 YOLO
- **Settlement sole-writer** + `expectedRevision` CAS + `toolsReplayed:false`
- **Agent run ⟂ LearningSession**（ADR-0021）
- **多轴硬预算** + durable-success / budget fallback（强于 Codex soft reminder 体系）
- **同意门控 teaching memory**（vs Codex 启动自动 memory pipeline）
- **领域契约脚本密度**（大量 `check:*`）+ 窄 Blocking + 大 release-audit
- **TeachingCommand 闭集** 扩展面（vs marketplace）
- **ApplicationRuntime** 固定生命周期序 + Host/Coordinator 分工
- **本地 doctor / support-bundle 同意模型**（非默认 phone-home）

---

## 9. 探子工作痕迹

| 探子 | 主题 | 报告 |
| --- | --- | --- |
| A | 架构与模块边界 | `_agent-logs/codex-compare-v3/result-A-architecture.md` |
| B | Agent loop / 流式 / 工具 / 协议 | `_agent-logs/codex-compare-v3/result-B-agent-loop.md` |
| C | 安全 / 权限 / 外部内容 | `_agent-logs/codex-compare-v3/result-C-security.md` |
| D | 配置 / features / skills / 扩展面 | `_agent-logs/codex-compare-v3/result-D-config-ext.md` |
| E | 会话 / 上下文 / memory / resume | `_agent-logs/codex-compare-v3/result-E-session-context.md` |
| F | CI / 测试 / Agent DX / 可观测性 | `_agent-logs/codex-compare-v3/result-F-engineering.md` |

主代理点验（抽样，非穷尽）：`autoDrain: false` @ `teaching-ipc-gateway.ts:349`；`executeToolBatch` @ `agent-loop.ts:22,448`；wire 在 `shared/protocol/agent-runtime-wire.ts`；denylist `baseUrl` @ `teaching-config-denylist.ts`；`features.ts` Stage + FORBIDDEN；`BusyInputPhase` @ `agent-busy-input-policy.ts:22+`；`docs/testing.md` **缺失**；a08 unit 存在；`check-ci-results.mjs` / `check-module-size` 存在。

---

## 10. 结论（一句话）

Codex 仍值得学的是 **模块纪律、门禁形状与工程 fan-in**，不是 shell/sandbox/MCP/自动 memory 市场；StudiumX 在 ADR-0121 之后 **runtime/安全/配置主干已对齐或更强**，真正残留是 **busy 相位与 drain 产品保真、拒绝决策审计、testing.md 物化、以及巨石 by-touch peel**——一律 ports/adapters/gates，开放实现必须新 ADR，禁止把本文当成第二套 backlog。

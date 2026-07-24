# LiveAgent × StudiumX 对照审查

- **日期：** 2026-07-23  
- **对照源：** `ref_project/LiveAgent`（Stack-Cairn/LiveAgent，本地优先 AI Agent 桌面）  
- **本仓库：** StudiumX（本地教学工作区 / 证据链 Agent）  
- **性质：** 探索性对照与借鉴候选清单；**不是**开放实施 backlog，也**不**推翻 [ADR-0121](../adr/0121-improvements-adoption-closeout.md) 结项裁定。任何实现切片须新建 ADR，并服从 `AGENTS.md` / `SECURITY.md` / `docs/tools/TOOL_CONTRACT.md` 产品地板。  
- **精选采纳清单（只含最值得学且适合本项目的项）：** [liveagent-worth-learning.md](./liveagent-worth-learning.md)  
- **方法：** 主代理阅读 LiveAgent `docs/` 与两边目录结构后，并行派发 5 个只读 explore agent（架构运行时、工具/MCP/Skills、记忆/Gateway/UI、StudiumX 对标盘点、分主题深比），交叉合成。

---

## 0. 一句话结论

LiveAgent 是成熟的 **本地 coding/ops agent 桌面**（Tauri + 工具/Shell + MCP/Skills Hub + 静默记忆 + Go 远程 Gateway）。  
StudiumX 已是 **教学安全向 agent 内核**（effect lattice、settlement sole-writer、多轴硬预算、Settings-only MCP、同意记忆、工作区文件 SoT）。  

**值得吸收的是可靠性与信任 UX 模式**（文件触碰账本、压缩压力阶梯、Ask 截止时间戳、Edit 容错、MCP ops 归约、scroll/虚拟列表、密钥脱敏边界），**不是**把产品改造成「带 Shell 的 LiveAgent」。

| 谁更强 | 领域 |
| --- | --- |
| **StudiumX** | 教学证据链 / settlement、effect lattice + 三态审批、write rewind journal、tool-result 预算+spill、MCP trust lifecycle（CAS/secret-free DTO）、child capability subset、`toolsReplayed:false`、领域门禁 CI |
| **LiveAgent** | Fuzzy Edit、多触发压缩 + **file ledger**、Chat 队列/编辑重发 UX、Ask 截止戳、多协议 provider 矩阵、transcript 虚拟化与 scroll-follow、MCP/Skills Hub 发现体验、Gateway 远程中继工程、静默记忆组织器（与地板冲突） |

---

## 1. 产品身份对照

| 轴 | LiveAgent | StudiumX |
| --- | --- | --- |
| 使命 | 本地优先 AI Agent 桌面：真正操作 FS/Shell/进程，MCP & Skills 生态，可选远程 Gateway | 本地教学工作区：mission → lesson HTML → resources / learning records；**文件系统是教学真相源**（`MISSION.md`） |
| 权威进程 | 桌面 Chat runtime + Tauri 执行工具；Gateway **不**执行工具 | `LearningSessionLedger` + evidence-gated outcome；Agent run ⟂ LearningSession（ADR-0021）；settlement 唯一写入：`TeachingTurnCoordinator`（ADR-0023） |
| 技术栈 | Tauri 2 + React + Rust；Agent 循环在 TS（`@mariozechner/pi-ai` 等）；Go Gateway WS+Protobuf | Electron + React；main 进程 TS agent loop / tools / MCP；无独立网关进程 |
| Shell | 默认 `Bash` + `ManagedProcess` + 终端/隧道/SFTP | **无**默认 ShellTool 产品路径 |
| Memory | Markdown SoT + SQLite FTS；回合后静默提取 + 组织器 | 词法检索 + 同意门控；**禁止**自动 memory phase / FTS5 产品搜索（ADR-0050、AGENTS） |
| MCP 产品面 | MCP Hub（installed/store/import）+ 多注册源 | Settings **仅** list/editor/import/OAuth（ADR-0142）；foundation 可保留 |
| 远程 | Go Gateway + WebUI 浏览器遥控 | 本地 Electron 优先；远程 headless 教学协议 **defer**（ADR-0121 S-07） |

**重叠（可谈借鉴）：** 多模型对话、工具循环、MCP 桥、Skills 包、历史压缩、桌面 UI、本地优先。  
**不可对齐（身份差异）：** OS 级执行面、静默记忆 OS、市场型 Hub、远程 coding gateway。

---

## 2. LiveAgent 架构速览（证据）

### 2.1 分层

| 层 | 路径 | 职责 |
| --- | --- | --- |
| 桌面 GUI | `crates/agent-gui/src` | Chat、Settings、Skills/MCP Hub、Memory UI |
| 桌面后端 | `crates/agent-gui/src-tauri/src` | SQLite、FS/Shell/MCP/Memory/Cron、Gateway bridge |
| Agent 运行时 (TS) | `src/lib/chat`、`src/pages/chat`、`src/lib/tools` | 上下文、模型流、工具循环、压缩、历史编排 |
| Gateway | `crates/agent-gateway` | WS+Protobuf 中继；**不**执行本地工具、**不**存真实 API key |
| WebUI | `crates/agent-gateway/web` | 远程壳层；Tauri API → Gateway shim |

文档：`ref_project/LiveAgent/docs/architecture/overview.md`、`gateway.md`、`protocols.md`。

### 2.2 设计原则（可移植）

1. **桌面端是真相源**；远程只是投影与中继。  
2. **Gateway 有界状态**（seq 窗口、命令幂等 24h 进程内），重启后回桌面历史 snapshot。  
3. **设置同步脱敏**（presence-only / 密钥不落 WebUI）。  
4. **GUI/WebUI 字节镜像**（`scripts/mirror-manifest.json` + `check-mirror.mjs`）防双端漂移。  

对 StudiumX：即便不做 Go Gateway，**「桌面/工作区 SoT + 边界脱敏 + 有界恢复」** 应作为跨进程/跨窗口纪律。

### 2.3 核心路径索引

| 能力 | LiveAgent 路径 |
| --- | --- |
| Agent turn | `pages/chat/turns/runAgentConversationTurn.ts`、`runTextConversationTurn.ts`、`runtime/useSendChatTurn.ts` |
| 工具注册 | `lib/tools/builtinRegistry.ts`、`builtinToolCatalog.ts` |
| 压缩 | `lib/chat/compaction/{controller,policy,fileLedger,engine,prune}.ts` |
| 子代理 | `lib/subagents/{run,policy,scheduler,bus}.ts` |
| MCP | `lib/settings/mcpOps.ts`、`lib/tools/mcpTools.ts`、`src-tauri/.../mcp.rs` |
| Skills 安装 | `src-tauri/services/skills/install.rs`（stage-then-swap） |
| Edit 容错 | `src-tauri/commands/workspace/edit_match.rs` |
| Ask | `lib/chat/askUserQuestion.ts`、`lib/tools/askUserQuestionTools.ts` |
| 队列 | `pages/chat/queue/chatTurnQueue.ts` |
| Memory | `src-tauri/services/memory/`、`lib/chat/memory/extraction*.ts` |
| 镜像清单 | `scripts/mirror-manifest.json` |

---

## 3. StudiumX 已有对标（避免「假缺口」）

| 领域 | 本仓库落点 | 代表 ADR |
| --- | --- | --- |
| Agent loop / 多轴预算 / fallback | `src/main/ai/agent-loop.ts`、`agent-loop-budget-reason.ts`、`agent-loop-fallback.ts` | 0051–0057、0100/0103/0106 |
| Effect lattice + ToolOutcome | `ai/tools/effect-policy.ts`、`dispatcher.ts`、`TOOL_CONTRACT.md` | 0024、0048 |
| Busy / queue / steer / façade | `agent-input-queue.ts`、`agent-busy-input-policy.ts`、`agent-session-facade.ts` | 0055、0058、0082、0096（**autoDrain 产品 false**） |
| Compaction | `context-compactor.ts`、`request-history-hygiene.ts` | 0045、0064、0044 |
| Write / rewind / result budget | `write-policy.ts`、`write-rewind-journal.ts`、`tool-result-budget.ts` | 0048、0049、0056 |
| Child / 委派 | `child-run-supervisor.ts`、`child-capability-subset.ts`、`delegation-runtime.ts` | 0065 |
| MCP foundation + Settings UI | `src/main/mcp/*`、`src/shared/mcp/*`、Settings MCP 区 | 0127–0142 |
| Skills + 校验 | `skill-library*`、`resources/builtin-skills/` | 0121 扩展面纪律 |
| Memory | `teaching-memory*`、`teaching-lexical-search.ts`、`memory-sanitize.ts` | 0050、0076 |
| Settlement | `teaching-turn-coordinator*.ts`、ledger | 0008–0011、0023 |
| Doctor / support | 多 collector + 脱敏 bundle | 0027、0034、0084–0105 |

**判定：** 运行时「中层」与 LiveAgent 已有大量功能对等甚至更严；差距主要在 **coding 执行面** 与 **Chat 壳层抛光**，前者多数应 **REJECT**，后者可选 **ADOPT/ADAPT**。

---

## 4. 分域对照与裁定

图例：

- **ADOPT** — 模式可直接移植（改路径即可）  
- **ADAPT** — 有价值，须按教学地板改形  
- **DEFER** — 需产品信号 + 新 ADR  
- **REJECT** — 与地板/ADR-0121 冲突，禁止当「对齐上游」引入  

### 4.1 Agent 运行时与上下文压缩

| LiveAgent 能力 | 证据 | 本仓库现状 | 裁定 |
| --- | --- | --- | --- |
| text / tools / agent-dev 分流 | `runText*` / `runAgent*` | 教学对话 + agent loop 一体，教学投影与 process timeline 分面 | **ADAPT** 管线分解思路（注入 compaction/debug sink），不复制三模式产品名 |
| Pre-send / mid-stream / post-tool 压缩 | `compaction/controller.ts`、`types.ts` triggers | `ContextCompactor.compactIfNeeded`；默认 **不** durable 改写会话正文 | **ADAPT** 多触发 + 单飞 + pressure ladder；保持 ADR-0064 / 0121 §6.14 |
| **File ledger**（确定性 files touched） | `fileLedger.ts`；测试 `compaction-file-ledger.test.mjs` | 无对等；有 workspace change history / hygiene | **ADOPT**（高价值） |
| Token ledger O(1) mid-stream | `tokenLedger.ts` | 估算 + 硬预算 | **ADAPT** |
| Segment + SQLite FTS 历史搜索 | `history-compaction.md` | 词法/会话树/resume picker；无 FTS 产品搜索 | **REJECT** FTS 产品面；segment 元数据仅 **DEFER** |

**File ledger 要点（应学）：**

- 只扫工具调用的单 `path`（Read/Write/Edit/Delete）；失败调用剔除；忽略 Glob/Grep/shell。  
- `modified` 粘性；跨 checkpoint 按消息序合并。  
- 路径清洗；超长 **丢弃不截断**；注入为 **data not instructions**（JSON 引号）；**不**进 summarizer payload。  
- 教学场景：压缩摘要下的「机器地板」与「导师改了哪些工作区文件」透明性高度一致。

### 4.2 工具系统与写安全

| 能力 | LiveAgent | StudiumX | 裁定 |
| --- | --- | --- | --- |
| Bundle 组合注册表 | `buildBuiltinToolRegistry` 多 bundle 合并、子代理收紧 | 闭集 `TOOL_CONTRACT` + registry + check:tool-contract | **ADAPT** 组合模式；保持闭集门禁 |
| Fuzzy Edit 四级匹配 | `edit_match.rs` Exact→EOL→尾空白→缩进 | 仅全量 `write_workspace_file` + pathname durable + rewind | **ADAPT**：可选 `edit_workspace_file`，同一 lattice/rewind/approval |
| Path resolver scopes | workspace / skill / uploads RO | `path-access` / workspace host | **ADOPT** uploads RO、skill root 策略形状 |
| Bash / ManagedProcess | 一等公民 | 明确 non-goal | **REJECT** 默认产品路径 |
| 工具自动执行 | 注册即跑（无 effect lattice） | 三态审批 + ToolOutcome | **保持 StudiumX**；勿 YOLO |

### 4.3 MCP

| 能力 | LiveAgent | StudiumX | 裁定 |
| --- | --- | --- | --- |
| 动态命名 | `mcp_<server>_<tool>` + 长度 hash | `mcp__{serverId}__{rawToolName}` | 已对等；保持 fingerprint |
| Config sole-write ops | 纯 `applyMcpOps` id 级合并 + live getter | CAS `McpConfigStore` + secret merge | **ADAPT** ops 归约形状（并发 Settings） |
| Runtime pool 锁纪律 | map 锁短持有；同 id 串行 | SessionManager + Host 生命周期 | **ADAPT** 若有竞态则加固 |
| 非 chat scope 禁写/重启 | cron 等 ephemeral test | 可对齐「非对话作用域」 | **ADOPT** 思想 |
| MCP Hub + 多注册源商店 | Official/Smithery/Glama | ADR-0142 **无** marketplace 设置页 | **REJECT** 产品市场页；**ADAPT** import draft / 表单体验 |
| Agent 面 McpManager CRUD | 模型可改 MCP 配置 | 人类 Settings | **REJECT** 默认暴露；若有须 privileged+审批+sole-writer |
| Secret 进 transcript/DTO | 部分 gateway 脱敏 | 永不进 public DTO/Doctor | **保持并加强** |

### 4.4 Skills

| 能力 | LiveAgent | StudiumX | 裁定 |
| --- | --- | --- | --- |
| Progressive disclosure | prompt 元数据 → `SkillsManager(read)` | 稳定前缀 skill index + turn-tail/slash 正文（ADR-0044） | **ADOPT** 披露纪律（已大体具备） |
| Stage-then-swap 安装 | `.staging` + rename + write guard | builtin allowlist + pack verifier | **ADOPT** 原子安装纪律（装扩展源时） |
| ClawHub owner+slug | 防 slug 冲突 | 无第三方 store | **ADAPT** 仅当未来 **已校验** 教学 pack 源 |
| Skills Hub / 模型安装 | Hub + SkillsManager | SkillLibrary + 人类安装 | **REJECT** 无校验市场；**DEFER** 伙伴教学包分发 |
| Builtin 教学技能 | skills-creator/installer 元技能 | `resources/builtin-skills/` 教学域包 | **保持教学域** |

### 4.5 记忆

| 能力 | LiveAgent | 裁定 |
| --- | --- | --- |
| Markdown 文件 SoT + 可重建索引 | **ADOPT**（应对齐工作区文件权威，而非 `~/.app` 取代教学 SoT） |
| 结构化 evidence / confidence 契约、单序列化点 | **ADAPT** 到 TeachingMemory，且 **不**走 settlement |
| Unreviewed / reviewed + 配额阶梯 UX | **ADAPT**（人工审核默认） |
| 静默回合后提取 / 自动 organizer | **REJECT**（同意门控、禁止 auto memory phase） |
| FTS5/trigram 产品搜索 | **REJECT**（AGENTS / ADR-0050） |
| 每轮 overview 注入 system | **DEFER/ADAPT**：须 consent + footprint ladder，勿污染稳定前缀 |

### 4.6 Busy 队列 / 编辑重发 / Steer

| 能力 | 裁定 |
| --- | --- |
| 本仓库 pure policy + façade + steer≠abort | **保持**（强于「仅 Gateway 队列」） |
| Product `autoDrain: true` | **REJECT** 直至新 ADR（0096 / 0121 B-02） |
| LiveAgent 每会话 FIFO + interrupt 策略 UX | **ADAPT** 学习者安全 busy-ack UI；不放开 autoDrain |
| Edit-resend | **ADAPT**：截断/fork + **`toolsReplayed:false`**，禁止静默重放工具 |

### 4.7 Ask / 审批 UX

| 能力 | 裁定 |
| --- | --- |
| Ask 权威 `__deadlineAt` + 超时推荐项 + 双端倒计时 | **ADOPT**（仅 ask 工具；**不得**超时自动放行 write/privileged） |
| 选项数/推荐首位约定 | **ADAPT** 教学交互卡片 |
| 本仓库 permission-pending + turn-review | **保持** lattice 与 human review |

### 4.8 子代理

| 能力 | 裁定 |
| --- | --- |
| L1–L4 分层（纯域 / IPC / runtime / 工具适配） | **ADAPT** 结构 peel，不改语义 |
| readonly 默认 | **ADOPT** 思想（本仓库 child profile 已偏只读） |
| worktree + shell + auto apply | **REJECT** 默认；任何 apply 须 workspace_write + 审批 |
| Message bus 轮界投递 | **ADAPT** 多子任务研究 UX；**非** teaching evidence，除非 settlement |

### 4.9 Chat UX / 历史

| 能力 | 裁定 |
| --- | --- |
| Scroll-follow 纯 reducer + 测试 | **ADOPT** |
| Transcript 虚拟化 + measurement LRU | **ADAPT**（长会话痛点出现时） |
| Pin 会话 | **ADOPT** |
| Floor nav / 书签轨 | **ADAPT**（P2） |
| 公开分享 token | **DEFER**（教学隐私更高） |
| 历史 FTS 产品搜索 | **REJECT**；会话查找走 title/course/标签 + resume picker 增量（S-08 产品信号） |

### 4.10 Provider

| 能力 | 裁定 |
| --- | --- |
| 多协议 stream 中间件 | **ADAPT** 强化适配器；保持 finish-reason / recovery 双轴（0051/0052） |
| Custom headers + 保留键黑名单 + 日志脱敏 | **ADOPT** |
| CLI 身份伪装头 | **REJECT** / 谨慎（ToS 与诚实 UA） |
| Hosted web search 默认 | **DEFER**；若上须 effect + evidence 规则 |

### 4.11 Hooks / Cron / 自动化

| 能力 | 裁定 |
| --- | --- |
| Shell command hooks / bash cron | **REJECT**（无默认 shell；禁学生机 fail-open hooks） |
| HTTP webhook 默认外发 | **REJECT** 默认；consent 外联另议 |
| Prompt 型定时 → 入队教学轮 | **ADAPT**（可选学习提醒），须过 coordinator，sole-writer 不旁路 |
| 自动化 `base_revision` 冲突 | **ADOPT**（对齐 expectedRevision 纪律） |

### 4.12 Gateway / 远程 / 发布

| 能力 | 裁定 |
| --- | --- |
| Desktop-SoT / relay 教条 | **ADOPT**（架构原则） |
| 全量 Go WS+Protobuf 多 Agent Gateway | **DEFER**（产品非 coding remote） |
| Seq window / command dedupe / prepare-wake | **ADAPT** 多客户端/多窗口时 |
| 设置脱敏同步 | **ADOPT**（IPC/Doctor/support 立即受益） |
| Tag 驱动版本 + updater manifest | **ADAPT** Electron 发布流水线 |
| 默认远程 telemetry | **REJECT** |

---

## 5. ADR-0121 明确禁止从 LiveAgent「对齐」的项

下列 LiveAgent（或邻近）能力 **不得** 以借鉴名义引入（摘自 ADR-0121 §6 与 AGENTS 红线）：

1. 默认 ShellTool / OS sandbox 产品声明 / shell-escalation  
2. YOLO / always-approve / DangerFullAccess 标签  
3. MCP marketplace 作为 Settings 产品页 / 默认任意 MCP 信任  
4. code-mode / jiti 全权限扩展 / 执行不可信代码  
5. 启动自动 memories / dream / FTS5·向量产品搜索 / 静默改 learner-profile  
6. 默认远程 OTEL / phone-home  
7. Soft token reminder 替代多轴硬预算  
8. 泛型覆盖率 CI 替换 teaching/privacy/security 门禁  
9. 推倒 EventBus/timeline、重写 AgentRun SM、拆 settlement sole-writer  
10. Fork 默认可执行工具历史（`toolsReplayed: true`）  
11. 默认 durable rewrite 会话正文作 compact  
12. 学生机 fail-open 外部 shell hooks  
13. Product `autoDrain: true`（B-02 residual）  
14. Turn-review auto-apply  

---

## 6. 优先借鉴 backlog（候选，非已批准实施）

实施前须：产品确认 + **新 ADR** + 对应 check/单测。优先级按 **教学产品价值** 排序，不是 coding-agent 功能嫉妒。

| # | 项 | P | 工作量 | 风险 | 地板冲突 | 建议落点 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 确定性 **context file-touch ledger**（压缩与 resume 注入；路径消毒；data-not-instructions） | **P0** | M | 中（注入面） | 无（若消毒） | 新 `src/main/ai/context-file-ledger.ts`；挂钩 tool dispatch / `agent-loop.ts`；`request-context-projection.ts` |
| 2 | **Ask 截止时间戳** + 超时→推荐项 UX（仅 ask，不放行 write） | **P0** | S | 低 | 无 | `ai/tools/ask.ts`、`ask-pending.ts`、renderer Ask 卡片 |
| 3 | 压缩 **pressure / 单飞 / mid-run protect**（仍默认 reference-only，无 durable 正文 rewrite） | **P0** | M | 中（抖动） | 无（守 ADR-0064） | `context-compactor.ts`、`agent-loop.ts` |
| 4 | 可选 **`edit_workspace_file`** 多 pass 匹配 + rewind + 同一 write policy | **P1** | M–L | 中（错匹配） | 无 | 新 `edit-match.ts`、`workspace.ts`、`TOOL_CONTRACT.md`、`check:tool-contract` |
| 5 | MCP **ops 归约**（id 级 op + 并发 CAS 友好） | **P1** | S–M | 低 | 无 | `src/shared/mcp/*`、`config-store` / IPC |
| 6 | Busy **phase 贯通**（write/privileged → 抑制 steer）端到端 | **P1** | S | 低 | 无 | façade + loop + permission |
| 7 | Provider overflow / finish_reason **compact-then-retry 剧本** 加固 | **P1** | M | 中 | 无 | `provider-adapter/*`、`provider-recovery.ts`、`agent-loop.ts` |
| 8 | Spill/hygiene **时间线/Doctor 可见诊断** | **P1** | S | 低 | 无 | presentation + doctor collectors |
| 9 | Custom headers + 保留键黑名单 + 日志脱敏 | **P1** | S | 低 | 无 | provider 请求构建、settings 校验 |
| 10 | Skills/包安装 **stage-then-swap**（若扩展安装源） | **P1** | S–M | 低 | 无 | `skill-library` / installer |
| 11 | 学习者安全 **busy-ack 队列 UI**（autoDrain 仍 false） | **P2** | S | 低 | 无 | composer + queue projection |
| 12 | Transcript **虚拟化 + measurement LRU** | **P2** | M | 中 | 无 | `AgentConversationReader` 等 |
| 13 | Scroll-follow 纯核心 | **P2** | S | 低 | 无 | agent conversation views |
| 14 | 会话 pin / 查找 UX 增量（非 FTS 产品面） | **P2** | M | 低 | 忌 FTS | history sidebar；对齐 S-08 信号 |
| 15 | Child-run **分层 peel** + 有界 research bus（无 shell/worktree） | **P2** | M–L | 中 | 无 shell | `child-run-supervisor`、delegation |
| 16 | 同意型 **学习提醒/复盘入队**（prompt 定时，无 bash） | **P2** | L | 高（范围） | 禁 shell | 新 ADR；可挂钩 study-planning |
| 17 | 导师侧 **改动文件透明** 卡片（对接 ledger + workspace-changes） | **P1** | M | 低 | 无 | renderer process/teaching 投影 |
| 18 | 设置/IPC **密钥 presence 同步模式** 全面审计 | **P1** | S–M | 低 | 无 | MCP/provider/support-bundle |

### 明确不进 backlog（REJECT）

| 模式 | 原因 |
| --- | --- |
| 默认 Bash / ManagedProcess / 终端产品 | AGENTS 红线 |
| Shell hooks / bash cron | 同上 + fail-open hooks 禁令 |
| Worktree+shell 子代理 / auto apply | 特权旁路风险 |
| 静默 memory 提取 / auto organizer | 同意记忆地板 |
| FTS5/向量产品搜索 | AGENTS / ADR-0050 |
| MCP Hub marketplace 设置页 | ADR-0142 |
| Product autoDrain true | ADR-0096 |
| 全量 Gateway 作为教学脊柱 | 本地优先；需独立产品 ADR |

---

## 7. 建议分阶段（若启动实施）

### Phase A — 信任与上下文地板（建议优先）

1. File-touch ledger  
2. Ask deadline  
3. Compaction pressure（无 durable rewrite）  
4. 改动文件透明 UI  

**验收方向：** 长对话压缩后模型仍知「碰过哪些文件」；路径不可作指令突破；单测覆盖 ledger 合并/预算/消毒（可参考 LiveAgent `compaction-file-ledger.test.mjs` 形状）。

### Phase B — 写与配置工程

1. 可选 edit 工具 + 全套 tool-contract  
2. MCP ops 归约  
3. Skills 原子安装（若有新安装源）  
4. Custom headers 策略  

### Phase C — 对话壳层抛光

1. Busy-ack UI  
2. Virtualization + scroll-follow  
3. Pin / 非 FTS 会话查找  

### Phase D — 仅信号触发

- 同意型学习提醒调度  
- 多窗口/远程中继（Desktop-SoT + 脱敏，**不是** coding Gateway 抄作业）  
- 校验教学 pack 远程分发  

---

## 8. 本仓库已更强、勿「为对齐而削弱」的能力

借鉴时只允许加强，不允许借 LiveAgent 削弱：

| 能力 | 说明 |
| --- | --- |
| 文件 SoT + 可重建投影 | ADR-0001 等 |
| Settlement sole-writer + `expectedRevision` | ADR-0023 |
| Effect lattice + 无 YOLO | TOOL_CONTRACT |
| Write rewind journal | ADR-0049（教学友好、可无 git） |
| Tool-result 预算 + spill | ADR-0056（LiveAgent 偏展示截断） |
| MCP trust lifecycle + secret-free DTO | ADR-0132–0142 |
| Child capability **subset** 不放大 | ADR-0065 |
| Fork `toolsReplayed: false` | ADR-0055 |
| 多轴硬预算 + durable fallback | 禁止 soft reminder 替代 |
| 同意 memory + 词法检索 | 禁止 FTS 产品搜索与静默提取 |
| Blocking 领域门禁 | `check:teaching-evidence` / `check:security` / `check:tool-contract` 等 |
| Study workbench / 规划 / 专注场景 | LiveAgent 无对等教学产品深度 |

---

## 9. 反向差距（StudiumX 有、LiveAgent 弱）

评估借鉴时勿只看「缺什么」：

- 证据门控 learning outcome 与 session ledger  
- Lesson 生成与 HTML 教学产物、课程定义序  
- Prompt cache：稳定前缀 vs teaching-context-packet（ADR-0044）  
- Teaching Doctor 多 collector（只读、禁 auto-repair）  
- 本地学习规划 / 番茄与日程（ADR-0094 系）  
- Write rewind 与 conversation checkpoint 分离  
- 教学域 builtin skills 与 pack verifier  

这些是产品差异优势，不是「落后」。

---

## 10. 源码与文档索引

### LiveAgent

| 主题 | 路径 |
| --- | --- |
| 总览 | `ref_project/LiveAgent/docs/architecture/overview.md` |
| Chat runtime | `docs/features/chat-runtime.md` |
| Tools | `docs/features/tools.md` |
| Skills/MCP | `docs/features/skills-and-mcp.md` |
| Memory | `docs/features/memory.md` |
| History/compaction | `docs/features/history-compaction.md` |
| Gateway | `docs/architecture/gateway.md`、`protocols.md` |
| 源码图 | `docs/reference/source-map.md` |
| 镜像 | `scripts/mirror-manifest.json` |

### StudiumX

| 主题 | 路径 |
| --- | --- |
| 产品地板 | `AGENTS.md`、`SECURITY.md` |
| 结项与拒绝表 | `docs/adr/0121-improvements-adoption-closeout.md` |
| 工具合同 | `docs/tools/TOOL_CONTRACT.md` |
| Agent 核心 | `src/main/ai/` |
| MCP | `src/main/mcp/`、`src/shared/mcp/` |
| 教学协调 | `src/main/teaching-turn-coordinator*.ts` |

---

## 11. 探索覆盖说明（防「偷懒」审计）

| Agent | 范围 | 产出用途 |
| --- | --- | --- |
| A | LiveAgent 架构 / turn / 压缩 / 子代理 / hooks / 队列 | §2、§4.1、§4.6–4.8 |
| B | Tools / MCP / Skills / Shell / path | §4.2–4.4 |
| C | Memory / Cron / Gateway / UX / Provider / Release | §4.5、§4.9–4.12 |
| D | StudiumX 对标与 ADR-0121 非目标 | §3、§5、§8–9 |
| E | A–J 十主题深比 + Top-15 | §4 细节、§6 |

合成时以 **教学价值** 与 **地板** 重排优先级；冲突时以 StudiumX ADR / AGENTS 为准。

---

## 12. 下一步（文档级，非自动开工）

1. 产品/维护者勾选 §6 中 P0 是否进入下一迭代。  
2. 每项实现开 **独立 ADR**（勿复活已删除的四源 ADOPTION 伪 backlog）。  
3. 触达路径按 `AGENTS.md`「改哪测哪」补 check。  
4. 禁止在 PR 中「顺手」引入 Shell / 静默记忆 / MCP 市场设置页 / autoDrain。

---

*本文档描述对照结论与候选；落地以新 ADR 与代码门禁为准。*

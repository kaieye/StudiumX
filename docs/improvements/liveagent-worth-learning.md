# LiveAgent 最值得学、且适合 StudiumX 的内容

- **日期：** 2026-07-23  
- **对照源：** `ref_project/LiveAgent`  
- **完整对照：** [liveagent-comparison.md](./liveagent-comparison.md)（分域矩阵、REJECT 全表、探索方法）  
- **性质：** 从对照中抽出的 **采纳候选**；有利于本产品、且不违背产品地板。  
- **不是** 已批准实施 backlog。实现须 **新 ADR**，并服从 `AGENTS.md`、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md`、[ADR-0121](../adr/0121-improvements-adoption-closeout.md)。

---

> **与 ADR-0121：** 本文是 LiveAgent 对照的**研究/索引**，不是第二套开放 ADOPTION backlog。已结项的四源 backlog 仍以 [ADR-0121](../adr/0121-improvements-adoption-closeout.md) 为准；本批落地项已各自有 ADR-0143–0150，后续开放项仍须新 ADR。

## 0. 筛选原则

只收录同时满足：

1. **对教学产品有真实收益**（信任、长会话稳、写文件准、配置不丢密钥）  
2. **不引入红线**（无默认 Shell、无 YOLO、无静默 memory、无 FTS 产品搜索、无 MCP marketplace 设置页、无 product `autoDrain: true`）  
3. **能落在现有架构上**（effect lattice、settlement sole-writer、文件 SoT、投影可重建）

不收录「LiveAgent 很强但会改坏产品身份」的能力（见文末 §6）。

---

## 1. 优先清单（只做这些也不会偏航）

| 序 | 项 | 优先级 | 工作量 | 主要收益 |
| --- | --- | --- | --- | --- |
| 1 | 确定性 File-touch ledger | **P0** | M | 压缩/续聊仍知「碰过哪些教学文件」 |
| 2 | Ask 截止时间戳 + 超时落定 | **P0** | S | 交互题可靠；跨 UI 倒计时同源 |
| 3 | 压缩 pressure / 单飞 / mid-run protect | **P0** | M | 长会话不炸预算、不乱压 |
| 4 | 可选 fuzzy `edit_workspace_file` | **P1** | M–L | 大文件局部改更准，少整文件重写 |
| 5 | 导师改动透明 UI（对接 ledger） | **P1** | M | 学习者信任「AI 动了什么」 |
| 6 | MCP id 级 ops 归约 + 实时 getter | **P1** | S–M | 配置并发不互相覆盖 |
| 7 | 设置/IPC 密钥 presence-only 扫尾 | **P1** | S–M | Doctor/DTO/同步永不漏 secret |
| 8 | Provider custom headers + 保留键黑名单 | **P1** | S | 校园/中转网关更易接 |
| 9 | Skills 安装 stage-then-swap | **P1** | S–M | 半成品包不可见 |
| 10 | Busy phase 贯通（write/privileged 抑 steer） | **P1** | S | 策略与 UI 一致，不抄 autoDrain |
| 11 | Scroll-follow / 长列表虚拟化 | **P2** | S–M | 长对话跟底与性能 |
| 12 | 会话 Pin + 非 FTS 查找 | **P2** | M | 多课多会话可找，不用 FTS |
| 13 | Child 分层 peel + 只读 research bus | **P2** | M–L | 结构清晰，无 shell/worktree |
| 14 | 同意型学习提醒入队（无 bash cron） | **P2** | L | 复盘提醒走 coordinator |

**若只做 5 件事：** 1 → 2 → 3 → 4 → 5。

---

## 2. P0 详解（最值得、最适合）

### 2.1 确定性 File-touch ledger

| | |
| --- | --- |
| **LiveAgent 证据** | `crates/agent-gui/src/lib/chat/compaction/fileLedger.ts`；`docs/features/history-compaction.md`；测试 `compaction-file-ledger.test.mjs` |
| **学什么** | 不单靠 LLM 摘要里的「改了哪些文件」。扫描工具调用中的单 `path`（Read / Write / Edit / Delete），失败调用剔除；`modified` 粘性；跨 checkpoint 按消息序合并；路径消毒；超长 **丢弃不截断**；注入为 **data not instructions**；**不**进入 summarizer payload |
| **为何利于本项目** | 教学真相源是工作区文件；摘要幻觉会误导续课与复习；账本是 **投影地板**，不取代 `LearningSessionLedger` / settlement |
| **红线** | 勿把 shell/Glob 伪解析进账本当真全集；勿当 teaching evidence 权威 |
| **建议落点** | 新模块如 `src/main/ai/context-file-ledger.ts`；挂钩 tool dispatch / `agent-loop.ts`；注入 `request-context-projection.ts` / 压缩 resume 路径 |
| **验收草案** | 单测：合并序、modified 粘性、失败剔除、消毒、预算上限、不进入 summarizer payload |

### 2.2 Ask 截止时间戳 + 超时落定

| | |
| --- | --- |
| **LiveAgent 证据** | `lib/chat/askUserQuestion.ts`、`lib/tools/askUserQuestionTools.ts`；权威 `__askUserQuestionDeadlineAt` |
| **学什么** | 工具参数上盖 **权威 deadline**；双端/重连按同一戳倒计时；超时 → 推荐项或首项；取消 → Abort；卡片在参数完整后再展示 |
| **为何利于本项目** | 已有 `ask` + `ask-pending`；教学交互（选项、推荐项）高频；缺的是时钟同源与超时语义 |
| **红线** | 超时 **仅** 结算 ask；**禁止** 超时自动放行 `workspace_write` / `external_write` / `privileged` / turn-review |
| **建议落点** | `src/main/ai/tools/ask.ts`、`ask-pending.ts`；shared 类型；renderer Ask 卡片 / dialog |
| **验收草案** | 单测 deadline 单调、超时路径、cancel 路径；UI 显示剩余时间与只读回显 |

### 2.3 压缩 pressure / 单飞 / mid-run protect

| | |
| --- | --- |
| **LiveAgent 证据** | `lib/chat/compaction/{controller,policy,tokenLedger,types}.ts`；triggers：pre-send / mid-stream / post-tool |
| **学什么** | 多触发点；单飞（同时只压一次）；连续「压完仍超阈」则加强 prune（pressure ladder），而不是硬死或无脑连压 |
| **为何利于本项目** | 已有 `ContextCompactor`、ADR-0064、多轴硬预算；弱在 **运行中压力调度** |
| **红线** | **保持** 默认不 durable rewrite 会话正文（ADR-0064 / ADR-0121 §6.14）；压缩结果是投影，不是教学 SoT |
| **建议落点** | `src/main/ai/context-compactor.ts`、`agent-loop.ts`、教学对话 runtime 调用点 |
| **验收草案** | 单飞互斥；pressure 升降；与 run budget / fallback 不打架；旧行为回归（reference-only 默认） |

---

## 3. P1 详解（工程与信任）

### 3.1 可选 fuzzy `edit_workspace_file`

| | |
| --- | --- |
| **LiveAgent 证据** | `src-tauri/commands/workspace/edit_match.rs`（Exact → EOL/BOM → 行尾空白 → 统一缩进） |
| **学什么** | 局部替换容错 + 向模型回报 `matchStrategy`；缩进偏移时 **按文件真实缩进重渲染** |
| **为何利于本项目** | 全量 `write_workspace_file` 对大 lesson/源文件又贵又易偏；局部 edit 降失败率 |
| **红线** | 必须同一 path 围栏、`write-policy`、三态审批、**write-rewind journal**；**禁止** Shell / apply_patch 产品路径 |
| **建议落点** | 如 `src/main/ai/tools/edit-match.ts` + 注册进 `registry` / `TOOL_CONTRACT.md` + `check:tool-contract` |
| **验收草案** | 四级匹配单测；错匹配不静默写；rewind 可恢复；契约漂移检查过 |

### 3.2 导师改动透明 UI

| | |
| --- | --- |
| **LiveAgent 证据** | tool bubble / changed-files 类反馈；配合 file ledger |
| **学什么** | 把「本轮/压缩后触碰的文件」以学习者可读方式展示（非 coding IDE 终端流） |
| **为何利于本项目** | 信任来自「AI 动了哪些教学文件」；可对接 ledger + 已有 workspace change 投影 |
| **红线** | 脱敏路径与密钥；不展示 privileged 细节给学生误导为「已结算证据」 |
| **建议落点** | renderer agent conversation / process timeline 投影层 |

### 3.3 MCP id 级 ops 归约 + 实时 getter

| | |
| --- | --- |
| **LiveAgent 证据** | `lib/settings/mcpOps.ts`：`McpSettingsOp` + 纯 `applyMcpOps`；live `getMcpSettings` |
| **学什么** | 按 server id 合并；禁止整对象覆盖；读配置不取 turn 级陈旧快照 |
| **为何利于本项目** | 已有 CAS `McpConfigStore`；ops 形状降低 Settings 并发写丢更新 |
| **红线** | ADR-0142 **无** marketplace 设置页；secret 不进 public DTO/Doctor；工具仍进 lattice |
| **建议落点** | `src/shared/mcp/*`、`src/main/mcp/config-store.ts`、IPC 更新路径 |

### 3.4 密钥 presence-only 边界扫尾

| | |
| --- | --- |
| **LiveAgent 证据** | Gateway settings 同步：只传「已配置」不传真 key |
| **学什么** | 跨表面（IPC、Doctor、support-bundle、未来多窗口）统一 presence 语义 |
| **为何利于本项目** | 本地优先仍有多边界；部分已有脱敏，对照查漏 |
| **红线** | 永不默认远程 telemetry；support-bundle 仍须同意 |
| **建议落点** | MCP/provider 公共 DTO、`redact`、Doctor collectors、support-bundle |

### 3.5 Provider custom headers + 保留键黑名单

| | |
| --- | --- |
| **LiveAgent 证据** | custom headers 有序列表；禁止覆盖 Authorization / x-api-key 等；日志脱敏 |
| **学什么** | 企业/中转友好且不撞官方 auth 头 |
| **为何利于本项目** | 校园网关、OpenAI-compat 中转常见 |
| **红线** | **拒绝** CLI 身份伪装头包；诚实 User-Agent |
| **建议落点** | `provider-adapter` 请求构建、settings 校验、model catalog |

### 3.6 Skills 安装 stage-then-swap

| | |
| --- | --- |
| **LiveAgent 证据** | `services/skills/install.rs`：`.staging` 构建 + 原子 rename + write guard |
| **学什么** | 读者永不看见半成品技能树 |
| **为何利于本项目** | 已有 pack verifier；装机原子性是补强（扩展安装源时尤其） |
| **红线** | 不开放无校验市场；install 仍走 allowlist / verifier |
| **建议落点** | `skill-library` / pack 安装路径 |

### 3.7 Busy phase 贯通

| | |
| --- | --- |
| **LiveAgent 证据** | 会话队列产品化；interrupt/append 策略 |
| **学什么** | 运行相位（尤其 write/privileged）与 UI/façade 一致上报 |
| **为何利于本项目** | 策略层已更强（queue 默认、steer≠abort、`autoDrain: false`）；缺 phase 贯通 |
| **红线** | **禁止** product `autoDrain: true`（ADR-0096 / 0121 B-02） |
| **建议落点** | `agent-session-facade.ts`、`agent-loop.ts`、dispatcher / permission、composer busy-ack |

---

## 4. P2 详解（壳层抛光，不改身份）

| 项 | 学什么 | 利于本项目 | 约束 |
| --- | --- | --- | --- |
| Scroll-follow 纯 reducer | 跟底/用户上滑脱手/回底部阈值，可单测 | 长教学对话 | 纯 UI |
| Transcript 虚拟化 + 高度 LRU | 长列表性能 | 长会话不卡 | 有痛点再上 |
| Pin + 非 FTS 会话查找 | 置顶、title/course/标签过滤 | 多课可找回 | **禁** FTS5 产品搜索；对齐 S-08 产品信号 |
| Child L1–L4 peel + 只读 bus | 纯域/IPC/runtime/工具分层 | 可维护、多子任务研究 | **禁** worktree+shell+auto apply；`toolsReplayed: false` |
| 同意型学习提醒入队 | 到点入队一次教学轮（prompt 型） | 复盘/间隔复习 | 过 coordinator；**禁** bash/http shell cron |

---

## 5. 建议落地节奏

### Phase A — 信任与上下文地板

1. File-touch ledger  
2. Ask deadline  
3. Compaction pressure（守 ADR-0064）  
4. 改动文件透明 UI（可与 1 同 PR 或紧随）

### Phase B — 写与配置

1. 可选 `edit_workspace_file` + tool-contract  
2. MCP ops 归约  
3. presence-only 扫尾  
4. custom headers  
5. Skills stage-then-swap（有安装源变更时）

### Phase C — 壳层

1. Busy-ack / phase UI  
2. Scroll-follow / 虚拟化  
3. Pin / 非 FTS 查找  

### Phase D — 信号触发

1. 同意型学习提醒（新 ADR）  
2. 只读 multi-child research bus（新 ADR，若需要）  

每项：**新 ADR → 实现 → 按「改哪测哪」补 check/单测**。勿复活已结项的四源 ADOPTION 伪 backlog。

---

## 6. 明确不学（避免「对齐」踩红线）

| LiveAgent 亮点 | 不学原因 |
| --- | --- |
| 默认 Bash / ManagedProcess / 远程终端 | 无默认 Shell 产品路径 |
| 静默 memory 提取 / auto organizer | 同意记忆；禁 auto memory phase |
| FTS5 作 history/memory 产品搜索 | 禁 FTS5/向量产品搜索 |
| MCP Hub 商店当 Settings 产品面 | ADR-0142 |
| 工具注册即跑、无 lattice | 必须 effect + 审批；禁 YOLO |
| Product `autoDrain: true` | ADR-0096 |
| Fork 默认可执行工具历史 | `toolsReplayed: false` |
| Shell hooks / bash cron | 禁 fail-open 学生机 hooks |
| Worktree + shell 子代理 + auto apply | 特权与结算旁路风险 |
| 全量 Go Gateway 当教学脊柱 | 本地优先；远程须独立产品 ADR |
| CLI 身份伪装请求头 | ToS / 诚实身份 |

---

## 7. 与本仓库已有优势的关系

学习对方 **只允许加强**，不允许借机削弱：

| 必须保留 | 说明 |
| --- | --- |
| 文件 SoT + 可重建投影 | ADR-0001 系 |
| Settlement sole-writer + `expectedRevision` | ADR-0023 |
| Effect lattice + 无 YOLO | TOOL_CONTRACT |
| Write rewind journal | ADR-0049 |
| Tool-result 预算 + spill | ADR-0056 |
| MCP trust lifecycle + secret-free DTO | ADR-0132–0142 |
| Child capability subset | ADR-0065 |
| 同意 memory + 词法检索 | ADR-0050 |
| 多轴硬预算 | 禁 soft reminder 替代 |
| 领域门禁 CI | teaching / security / tool-contract 等 |

对方在 coding 执行面、Hub、Gateway 上的「完整分」，**不应**成为把 StudiumX 改成 LiveAgent 的理由。

---

## 8. 相关链接

| 文档 | 用途 |
| --- | --- |
| [liveagent-comparison.md](./liveagent-comparison.md) | 完整对照、分域裁定、探索覆盖 |
| [ADR-0121](../adr/0121-improvements-adoption-closeout.md) | 已结项借鉴纪律与 REJECT 表 |
| [TOOL_CONTRACT.md](../tools/TOOL_CONTRACT.md) | 工具 effect / 合同 |
| `AGENTS.md` | 产品地板与红线 |
| LiveAgent `docs/features/history-compaction.md` | file ledger 语义原文 |
| LiveAgent `docs/features/chat-runtime.md` | Ask / turn / compaction 触发 |

---

*本文只列「最值得学且适合本项目」的采纳候选；落地以新 ADR 与代码门禁为准。*

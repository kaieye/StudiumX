# StudiumX 文档「禁止 / 红线」条款审核清单

> **用途：** 汇总全仓库文档中所有「明确不做 / 禁止 / 红线 / 不得 / non-claims / out-of-scope」表述，供人工审核与修订。生成日期：2026-08-18。统计基于 `AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md`、`README.md`、`todolist.md`、`docs/`（含 170+ ADR）。
>
> **阅读提示：** 大量「禁止」条目分为三类，审核时请区分对待：
> 1. **硬红线（产品地板）** —— 教学权威 / settlement / secret / telemetry / effect 审批 / memory 同意门控等，改动需新 ADR 且极高风险；
> 2. **已被后续 ADR 取代 / 收窄的旧禁令** —— 仍残留在旧文档正文中，是「工作被文档拦住的」**最主要来源**，可放心按新 ADR 口径修订（见 §3）；
> 3. **范围限制 / non-claims** —— 不是永久禁止，只是「本 ADR 切片不覆盖 / 未实施」，扩张需另立 ADR（见 §4）。

---

## 1. 统计概览

| 指标 | 数值 |
| --- | --- |
| `docs/**/*.md` 文件数 | 187 |
| 含中文禁止标记的文件数 | 169 |
| 中文禁止类标记行（禁止/严禁/不得/不可/不允许/红线/永不/勿/请勿/不要） | 945 |
| 其中强标记行（禁止/严禁/不允许/永不/红线） | 419 |
| 英文禁止类标记行（do not / must not / never / shall not / prohibit / forbidden / red-line / YOLO / always-approve / phone-home…） | 289 |
| 含「明确不 / 不包含 / 不扩张 / 非声明 / out-of-scope」的 ADR | ~70 |

**标记密度最高的文档**（按命中行数，前 15）：

| 文档 | 中文标记 | 英文标记 |
| --- | --- | --- |
| `todolist.md` | 40 | – |
| `docs/adr/0127-user-configurable-mcp-design-gate.md` | 34 | 9 |
| `docs/adr/0126-codex-style-platform-capability-profiles-and-consumer-migration.md` | 31 | 6 |
| `docs/adr/README.md` | 30 | 11 |
| `docs/adr/0130-study-planning-phase7-and-completion-residual.md` | 29 | 15 |
| `docs/adr/0094-study-task-timer-planning-design-gate.md` | 27 | – |
| `docs/adr/0128-user-configurable-mcp-implementation.md` | 25 | 3 |
| `docs/adr/0170-agent-conversation-host-serialization-design-gate.md` | 24 | – |
| `docs/adr/0171-continuous-agent-runs-and-context-governance.md` | 22 | – |
| `AGENTS.md` | 21 | 10 |
| `docs/adr/0124-database-layered-authority-and-pr-gates.md` | 20 | 3 |
| `docs/adr/0122-usage-ledger-as-canonical-observability.md` | 19 | – |
| `docs/adr/0121-improvements-adoption-closeout.md` | 19 | 3 |
| `docs/adr/0020-c4p6-phase0-platform-profile-and-failure-matrix.md` | 18 | – |
| `docs/adr/0129-study-planning-renderer-cutover-and-sole-authority.md` | 17 | – |
| `docs/adr/0063-declarative-tool-policy.md` | – | 18 |
| `docs/tools/TOOL_CONTRACT.md` | – | 10 |
| `SECURITY.md` | – | 8 |

---

## 2. 顶层权威文档的硬红线（汇总）

### 2.1 AGENTS.md（§1 产品地板 + §3 红线 1–10）

产品地板（§1）：
- **文件是教学真相源**：AI 制定下一步教学计划时，canonical 在工作区文件 / LearningSession ledger；SQLite、agent run 与同步副本不得成为 teaching authority。
- **工具默认可用**：`tools.enabled` 仅保留兼容字段，归一化为 `true`，Settings 无总开关；workspaceShell 默认开（受双轴审批）。
- **MCP 全面对齐**：Settings 产品面 = list/editor/import/OAuth（**无** marketplace 设置页）；secret/token 永不进 public DTO/Doctor；MCP 非 teaching evidence；settlement sole-writer。
- **无自动 remote telemetry**：不静默上传、不默认 phone-home / Statsig / Mixpanel 式外发。
- **effect lattice + TOOL_CONTRACT**：三态审批；**禁止 YOLO / always-approve 标签**。
- **Settlement sole-writer**：`TeachingTurnCoordinator`/host 唯一写入路径；IPC 须 `expectedRevision`；fork 保持 `toolsReplayed: false`。
- **持续运行与上下文治理**：反对不透明、低位、默认的累计 token/调用次数/时长/iteration quota；允许可审计高位 emergency fuse 与用户显式预算，触发仅报告 `resource_limit`/`suspended`。
- **同意门控 memory**：无人批不自动注入；**禁止 FTS5 / 向量库作产品搜索**。
- **Blocking 领域门禁优先**：teaching/privacy/security 门禁优先于泛型 lint 与覆盖率。

红线（§3，10 条，逐条）：
1. 不要增加、恢复或信任 `tools.enabled` 总开关；不要用 YOLO / DangerFullAccess / always-approve 标签；不要宣称 Docker/VM 级 OS sandbox 完备。
2. 不要加 YOLO / DangerFullAccess / always-approve 默认或 UI 标签。
3. MCP 产品面以 ADR-0142 为准：Settings 仅 list/editor/import/OAuth；不要再挂 marketplace 设置页；禁止 YOLO 标签、jiti 全权限扩展、code-mode 执行不可信代码或 shell-escalation 旁路；secret 永不进 public DTO / Doctor / support bundle。
4. 不要默认远程 OTEL / phone-home；本地 doctor / support-bundle 须脱敏与同意。
5. 不要用 SQLite FTS 或向量库做产品搜索面。
6. 不要启动自动 memories / dream / 静默改 learner-profile 或自动 skill 创建。
7. 不要绕过 settlement sole-writer、放宽 `expectedRevision`、或让 fork 默认可执行工具历史（`toolsReplayed:false`）。
8. 不要用覆盖率或泛型 CI 替换 teaching/privacy/security 领域门禁。
9. 不要推倒 EventBus/timeline、重写 AgentRun 状态机，或拆 LearningSessionLedger 权威。
10. 不要在 PR 默认 CI 烧真实模型 API key。

### 2.2 CONTRIBUTING.md

- 「**禁止**用覆盖率替换 teaching/privacy/security 领域门禁」（Checks 节）。
- **Do not** burn real model API keys in default CI。
- Hard red lines：LearningSessionLedger ⟂ AgentRun；TeachingTurnCoordinator 保持 sole writer；无默认 workspace shell / MCP market / SQLite FTS 产品搜索；保留 typed effect lattice 与 fail-closed capability catalog；teaching 写权威在文件，SQLite 是可丢弃投影；**不得**削弱历史脱敏或 secret-free resolved config。
- 数据库 PR：P2 项不得入 scope 除非新 ADR；DB-P2-3 **won't do**（教学/会话写 SoT）；无 analytics-DB FTS 产品面；无 secrets/prompts 进投影。
- 架构变更须 ADR；巨石按触达 peel，不得 fail Blocking CI on size。

### 2.3 SECURITY.md

- workspace root 路径围栏（不得逃逸）；resolved config snapshot 必须 secret-free。
- support bundle 需同意 + 脱敏；history redaction。
- 工具 fail-closed（未知工具 → privileged）；`tools.enabled` 仅兼容归一化 true，Settings 无总开关；workspaceShell 默认开可关；cwd-fenced；**never labeled YOLO**；Windows helper 缺失时不虚构 OS-sandbox 完备。
- MCP：secret/token 永不进 renderer/Doctor/support bundle/logs；MCP 结果非教学权威；settlement sole-writer；无 YOLO；**Settings marketplace UI out of shipping surface**。
- Web remote control：默认关、loopback 默认、LAN 显式；**No default cloud relay**；remote tool 走 effect + approval。
- 非声明：不 claim Docker/VM 级 OS 隔离；descriptor-strict 非全平台默认；learning ledger 权威不归 agent controller。
- 报告漏洞：minimal reproduction **without** real learner secrets；**不得**公开含 API key / learner answers / unredacted bundle 的 issue。

### 2.4 README.md

- 不默认开启工作区 shell；不默认上传遥测；写入/外部/特权工具经 effect 分类与审批。
- 不要把 API 密钥提交到 Git。
- Web 端不是教学执行引擎，不承载模型密钥 / Agent loop / 本地工作区写。
- 数据：SQLite 不会取代教学事实权威地位；MCP 设置仅 list/editor/import/OAuth；密钥令牌不进公开 DTO/Doctor/support bundle。

### 2.5 docs/tools/TOOL_CONTRACT.md

- `ask`：never silently chooses for the user。
- `run_workspace_command`/`shell`：never treat as Evidence；snip bounded stdout/stderr。
- `read_only_task`：may not invoke write/privileged effects。
- 所有非 read 工具 `maxConcurrency` 硬钳 1（**Invariant:** never advertise >1）。
- UI 不得暴露或标注 YOLO 模式（三态只能称「需批准 / 按风险 / 本课放行」）。
- MCP bridge：handler 不得写 workspace 文件 / ledger / outcome；MCP 模块不得 import ledger/outcome committer；结果非 teaching evidence；secret 永不进 renderer/preload/Doctor/bundle；annotations 永不降级 effect 或跳过审批；`toolsReplayed:false` 不因 MCP 放宽。

### 2.6 todolist.md

- 已完成项**不得回退**；不得复制第二套领域实现、放宽安全边界、以集成名义重写深模块。
- 永久不变量 1–5（Evidence ≠ outcome；只有 committer 可产生 durable outcome；不得盲目重试/伪装成功；learner-facing 必须 allow-list 不泄露 raw；不回退已通过 gates）。
- M5 不得借读取触发 reconcile/write/generate/隐式修复；M6 **绝对禁止** raw chunks/路径/secret/raw evidence/answer/prompt/reasoning 进 DTO；禁止「任意 ID 字符串透传」；禁止仅靠 UI 隐藏。
- M7 禁止 renderer 直接触碰 coordinator ports 或 filesystem truth。
- M8 保持 M4 sole-writer；UI 不能自写 outcome/record、不能宣布 mastery。
- M9 不得把内存 bus/旧 renderer 状态/临时 provider 输出当 authority；不得二次保存。
- §5 禁止删/skip/放宽断言、宽泛 `as any`、silent fallback、手工演示代替自动化；已 push 分支禁止 force-push。
- §6 禁止写「生产完成 / P0 完成 / 教学闭环完成」除非全部条件满足。
- §8 禁止在共享工作区 checkout/stash/reset/clean/rebase/写文件；不得把本地 fix/* 分支写成远端分支。

---

## 3. ⚠️ 已被后续 ADR 取代 / 收窄、但仍残留在旧文档中的「过时禁令」

**这是工作中「文档标注禁止导致无法实施」的最主要来源。** 下列禁令在旧文档（含 AGENTS/ADR-0039/0127/0128/0132 等）正文仍存在，但已被新 ADR 收窄或废止。修订文档时应按新口径改写，**不建议**按旧禁令继续约束实现。

| # | 旧禁令（残留原文） | 现有效力 / 新口径 | 取代来源 |
| --- | --- | --- | --- |
| 1 | 「默认禁止任意 MCP」「通用 MCP 永不实施」 | 已废止；用户可 opt-in 自行配置 MCP server；仅禁止「未 opt-in、未过 effect lattice」的 MCP | ADR-0127（标题即「推翻『默认禁止任意 MCP』产品地板」）、ADR-0128、ADR-0039 P2-6 收窄 |
| 2 | 「MCP marketplace 禁止 / 仅本地 foundation / feature 永久 under_development」 | 开放为正式产品面（feature 可 `experimental`/`stable`）；允许用户/官方配置的远程 catalog URL | ADR-0132、ADR-0140、ADR-0141 §2.2 |
| 3 | 「无 auto-connect」「禁止冷启动自动连接」「install 永不得 connect」「根开关+autoConnect 双 opt-in」 | 允许：enabled 时默认 auto-connect（`autoConnect` 默认 true）、冷启动/workspace 激活受控自动连接、install→connect | ADR-0137、ADR-0141 §2.1/§2.2 |
| 4 | 「workspace 文件不得作为 MCP 配置来源」「workspace 配置不可作为 authority」 | workspace `.agents/mcp.json` / `mcp.json` / `zcode.json#mcpServers` 为真实配置来源（只读，按 precedence），UI 可展示并一键启用 | ADR-0137、ADR-0141 §2.3 |
| 5 | 「远程 catalog 一律禁止」「Settings 不得展示完整目录」 | 允许远程 catalog（可关）；但 **Settings 产品面仍无 marketplace 页**（见 §4.2 边界；**ADR-0142 §6 于 2026-08-18 收窄为「设计 non-claim + 开放路径」**） | ADR-0141 §2.2、ADR-0142 |
| 6 | 「settings marketplace / 来源表 UI 永久禁止」 | 产品面收窄仅 list/editor/import/OAuth；marketplace 页仍不交付，但原因从「永久禁止」变为「当前 shipping 范围外」，**修订 ADR-0142 §6 即可开放**（**2026-08-18 已修订**：收窄为「设计 non-claim + 开放路径 + 前置条件」） | ADR-0142（§6 修订）、ADR-0141 §6a |
| 7 | 「tools.enabled 总开关」相关 | 保留为兼容字段并归一化 true，Settings 无总开关 —— **这条不是放宽而是确认废除**；勿恢复 | ADR-0153 |
| 8 | 「默认通用 shell / 任意代码执行产品路径 禁止」「workspaceShell 默认关」 | `run_workspace_command` / `shell` 成为注册工具；workspaceShell **默认开**（可关）；仍受双轴审批 / 路径围栏 / 工作区信任；仍禁止 YOLO、虚假 Docker/VM 完备宣称 | ADR-0152、ADR-0153（A–F 合格交付 2026-07-25） |
| 9 | 「累计 token / provider / tool calls / duration / iteration 的 run 级上限一律禁止」「所有资源停止一律称 provider quota」 | 被取代：允许透明、可审计的高位 emergency fuse、用户显式资源预算、部署/组织策略；触发报告 `resource_limit`/`suspended`；仍禁止伪装为 provider quota 或学习成功、禁止恢复自动重放工具 | ADR-0171（取代 ADR-0057 全局 run budget 与 ADR-0145 相关表述） |
| 10 | 「P2-6 通用 MCP 默认不排期 / 无真实 Adapter 永不实施」 | 用户配置面开放；P2-6 仅对「无 Adapter 的通用 MCP 教学适配」保留信号触发 | ADR-0127、ADR-0128 |
| 11 | 「P8 Windows strict」 | Windows strict **no-go 结项**；但 Windows direct-path **non-CAS** profile 获批可暴露 `write_workspace_file`；0153 后 Windows helper 为可选延期 | ADR-0035、ADR-0004、ADR-0153 |
| 12 | 「no-FTS / 无搜索」「禁止 FTS5 / 向量库作产品搜索面」 | 产品搜索面仍禁止；但**教学内部可用**，且重开检索索引的路径已定义：独立 disposable 索引文件 + 新 ADR + 经验证用户任务（DB-P2-2） | ADR-0001、ADR-0050、ADR-0124 §3.3；ref-ima/02 明确「教学内部可用」 |
| 13 | 「C-4P6/P8/P9 完整 durable / Windows power-loss / 跨文件 transaction」 | 以受限 profile 结项，不再是开放可分派实现；扩张须**新建 ADR** | ADR-0035、ADR-0004、ADR-0019、ADR-0020 |
| 14 | 「STC-704 旅行时区产品」「allocation-from-plan 产品」 | **已移除**（2026-07-22），禁止 re-open 为 product residual | ADR-0130 |
| 15 | 「docs/improvements 第二套 backlog」 | 目录已清空，**不得重建**为第二套 backlog | ADR-0121 |
| 16 | 「product autoDrain: true」 | 决策保持 false；**禁止**无独立 queue-sync 设计 ADR 翻 true | ADR-0096、ADR-0089/0091 |

> **待办建议：** 上表 #1–#6、#9、#12 是修订收益最大的条目 —— 修改 `AGENTS.md` §1/§3、`SECURITY.md`、`CONTRIBUTING.md` 与 ADR-0127/0128/0132 正文中残留的旧措辞即可，不需改动代码与测试。

---

## 4. 仍有效且不建议放松的硬边界（修订风险高）

以下即使要改，也必须走新 ADR + design gate，且大概率会破坏产品地板：

- **教学权威**：文件 / LearningSession ledger 是 AI 教学决策的唯一真相源；SQLite、agent run、同步副本、MCP、usage 永不反写或替代（ADR-0001/0002/0008/0167/0124/0122/0129）。
- **Settlement sole-writer**：`TeachingTurnCoordinator`/host 唯一写路径；`expectedRevision` 不得放宽/删除/默认省略/伪造；fork `toolsReplayed:false`；禁止重写 AgentRun 状态机、EventBus/timeline、LearningSessionLedger（ADR-0021/0023/0055/0070/0170/0171；AGENTS 红线 7/9）。
- **Secret 隔离**：secret/token/OAuth/env 明文/headers **永不**进 renderer、public DTO、Doctor、support bundle、日志（ADR-0025/0128/0133/0135/0136/0137/0148/0149/0099/0102/0104/0105/0028/0034/0076/0122；TOOL_CONTRACT；SECURITY）。
- **YOLO / always-approve / danger-full-access / code_mode / jiti 全权限**：全仓一致禁止作为标签或产品开关（AGENTS 红线 1–3、TOOL_CONTRACT、ADR-0127/0141/0152/0153/0073/0063/0083/0088/0101/0115/0143/0146/0147 等）。
- **无默认 remote telemetry / phone-home**：默认零外发；catalog 拉取 ≠ telemetry；本地 doctor/support 脱敏 + 同意（AGENTS 红线 4、ADR-0062/0066/0122/0162/0148/0172/0173、SECURITY）。
- **Memory 同意门控**：无批准不自动注入 / 不启动自动 memory phase；禁止自动 memories / dream / 静默改 learner-profile / 自动 skill 创建；禁止 FTS/向量（AGENTS 红线 5/6、ADR-0076/0081/0150/0077）。
- **默认 CI 不烧真实模型 API key**（AGENTS 红线 10、CONTRIBUTING、ADR-0160）。
- **领域门禁不被覆盖率/泛型 CI 替换**；Blocking CI 窄而硬、永不 path-skip（AGENTS 红线 8、ADR-0053/0074）。
- **DB-P2-3（教学/会话写权威迁 SQLite）won't do**；SQLite 写权威迁库仅当产品顶层重定位 + 顶层 ADR 替换（ADR-0124 §3.4）。
- **模块尺寸纪律**：巨石仅按触达 peel；禁止三线并行大搬家；peel 不得拆 settlement sole-writer（ADR-0075）。

---

## 5. 各主题域「禁止」条款明细（含引用）

### 5.1 工具 / effect / 审批 / shell

| 来源 | 禁止内容 |
| --- | --- |
| AGENTS.md §3 红线 1–3、TOOL_CONTRACT | 禁止 YOLO / DangerFullAccess / always-approve 标签与产品开关；三态 UI 文案只能「需批准 / 按风险 / 本课放行」 |
| ADR-0063 / 0079 / 0083 / 0088 / 0101 / 0112 / 0115 | 声明式 tool-policy 禁 shell argv、`prefix_rule`、YOLO；空文档不得伪造「全禁」或 YOLO；非法文档不进入 merge |
| ADR-0024 / 0061 / 0032 / 0059 / TOOL_CONTRACT | 未知工具 fail-closed 为 privileged；写类 `maxConcurrency` 恒 1；仅 read 可并行；`status` 是成功/失败唯一真源，禁止从 free-text 推断失败；取消/超时不得伪装 succeeded |
| ADR-0065 | child 不得放大父 allow-list；`workspace_audit` 永不获得 web；`read_only`/`research` 永不获得 write/lesson/nested delegate；不引入 shell |
| ADR-0152 / 0153 | 禁止无审批/YOLO 的通用 shell；禁止 OpenSandbox/Cube 默认后端、自创「等价 Docker」话术、把 policy_fence 标成 OS 完备隔离；不 vendoring 完整 codex-rs |
| ADR-0128 / 0132 / 0134 | MCP handler 不得写盘绕过 `write_workspace_file`、不得 import ledger/outcome committer；annotations 永不降级 effect |
| ADR-0055 / 0096 / 0098 / 0147 | 禁第二命名（agent-loop-queue 等）；write/privileged tool 期间禁止 steer；禁止「模拟 drain」开第二 loop；禁止整对象 clobber 合并 MCP 配置 |

### 5.2 MCP（现效力 = ADR-0132/0141/0142 体系）

- **仍硬性禁止**：MCP 成为 settlement authority；MCP 写 ledger/outcome；secret 进 renderer/日志/Doctor/bundle；绕过 effect lattice + approval（无 YOLO）；provider API key 注入 MCP env 默认集；MCP tool 直接 commit Learning record/outcome；`expectedRevision` 放宽；`toolsReplayed:false` 改 true；静默截断 tool schema；注册与内建工具同名抢注；run 中静默扩展 tool 表面（ADR-0127/0128/0132/0134/0141/0147、TOOL_CONTRACT）。
- **已放宽（勿再按旧禁令拦）**：marketplace、auto-connect、冷启动连接、install→connect、workspace 配置来源、远程 catalog、McpSync 客户端、annotations 辅助审批（ADR-0141 §2、ADR-0142）。
- **当前 shipping 面**：Settings = list/editor/import/OAuth；marketplace 设置页不交付（ADR-0142）。

### 5.3 数据库 / SQLite / 搜索

- SQLite **永不**替代文件写权威（ADR-0001/0002/0124/0122/0123）；projection 可丢弃、`absolute_path` 非 durable SoT（ADR-0001）。
- DB-P2-3 won't do（写权威迁库）；runtime session store 仅缓存、硬门槛、不得覆盖 DB-P2-3（ADR-0123/0124）。
- **禁止 FTS5 / 向量库作产品搜索面**；analytics 库不得扩成 query-facing corpus；不得 silent swap ranking 契约（ADR-0001/0050/0122/0124/0094/0172/0173/0162；AGENTS 红线 5）。
- 禁止 canonical 物理删除（age/size purge）、禁止把 usage/投影当可见性/授权/留存/脱敏裁决依据（ADR-0002/0122）。
- Purge 严禁触及 learning-work / ledger / Evidence / outcome / Memory / conversation archive（ADR-0122）。

### 5.4 教学 / Evidence / Outcome / 评审

- Lesson 生成/打开**不得**自动写正式 Learning record；UI 乐观状态 / renderer / preview / 答案 key 均不能成为写入入口（ADR-0010）。
- `needs_practice` / `not_evidenced` 为 recordless，**不得**创建 record/outcome/completed Session；`not_evidenced` 永不升级为 established；reconcile 不得从 marker 合成/promote（ADR-0018）。
- 证据链：仅 committer 可结算；`learningRecordNote` 不得宣称已掌握；replay 不得产生重复事实（ADR-0011/0008/0009）。
- turn-review：**禁止 auto-apply**、自动 skill/profile 改写、`applyPlan`/`skillFileContent`/`writePath`/`profilePatch` 等可执行字段（ADR-0077/0080/0085/0087/0097/0109/0110/0111/0114/0116/0119）。
- Doctor：只读、**永不** auto-repair / upload / clear / reconcile；inspector 永不写文件系统（ADR-0027/0043/0084/0093/0095/0099/0102/0104/0105）。
- 教学行为合同：不阻断教学轮、不引入输出重写器（ADR-0160）；`teach` 唯一 kernel，personal 同 id 不得 shadow（ADR-0151/0164/0044）。
- 评分/掌握投影：单独评分候选**永不**产生 established；投影永不成为结算输入、永不反写 ledger（ADR-0157/0158/0159/0154/0161）。
- Memory：禁止自动 memory phase、FTS/向量、raw learner answer/API key 写入（ADR-0050/0076/0081）。

### 5.5 Provider / 网络 / 预算

- billing / 余额 / 永久 auth / context overflow / max-tokens 截断 **永不自动重试**；禁止 credential 多 key 旋转（ADR-0057/0125/0121）。
- 全局 run 配额被 ADR-0171 取代；触发只报 `resource_limit`/`suspended`，不得伪装 provider quota 或学习成功；恢复不得自动重放工具（ADR-0171）。
- custom headers：保留键（Authorization / x-api-key / User-Agent 等）禁止覆盖；拒绝 CLI 伪装头；禁止 CR/LF（ADR-0149）。
- 无默认远程 telemetry / OTEL / Statsig / Mixpanel（AGENTS 红线 4、ADR-0066/0062/0162/0148）。
- ask 超时**禁止**自动放行 write/external_write/privileged/turn-review（ADR-0144）。

### 5.6 Study planning / Timer

- TimerSession 不得冒充教学 Session / 不得成为教学真相（ADR-0094/0129）；禁止静默 focus credit、静默迁移、自动擦除 localStorage（ADR-0129）。
- 历史 TimerSession 引用不可变；改/删 plan 不得改写历史会话；禁止静默任务克隆、默认 auto-expand、静默移动锁定块（ADR-0094/0130）。
- 禁止静默整周 rezone；STC-704 旅行时区产品与 allocation 产品已移除、禁止 re-open（ADR-0130）。
- 禁止静默生成 3 分钟番茄式退化；`allocateTimeWindow` 须纯函数、提案先于写入（ADR-0094/0130）。
- §18 / sole-authority 终态不得仅凭路线图/单元矩阵宣称完成（ADR-0130/0129）。
- 首切片禁止 canonical 写入、V1→V2 迁移落盘、真实 TimerSession 生命周期替换（ADR-0094）。

### 5.7 模块尺寸 / 工程纪律 / CI / 发布

- 目标 <500–800 行；>1000 须说明；`check:module-size` 默认 exit 0、永不因尺寸失败 Blocking CI（ADR-0075）。
- 巨石仅按触达 peel，**禁止三线并行大搬家**（teaching-workspace + learning-session-ledger + teaching-turn-coordinator）；peel 不得拆 settlement（ADR-0075/0121/0070/0100/0103/0106/0119/0120）。
- **禁止**用覆盖率或泛型 CI 替换领域门禁；Blocking CI 永不 path-skip；禁止把 domain jobs 折成单一 mega job；format 门不得伪装全仓 prettier（ADR-0053/0074/0053；AGENTS 红线 8）。
- 发布：未解释 skip / bare skip / TODO / 预算漂移 / 非零退出不得声称绿；不得为掩盖回归抬高 skip 预算（ADR-0017）。
- 不得在默认 CI 烧真实模型 API key（AGENTS 红线 10、ADR-0160）。

---

## 6. 逐文档禁止条款索引（快速定位）

> 全部 ADR 均有「明确不包含 / non-claims / 红线」节。下面是高密度文档定位表；低密度 ADR 以 `禁止/不得/永不` 关键词在该文件内检索即可。

| 文档 | 禁止条款集中位置 |
| --- | --- |
| AGENTS.md | §1 产品地板、§3 红线 1–10 |
| CONTRIBUTING.md | Checks、Hard red lines、Database PR gates |
| SECURITY.md | Security boundaries、Non-boundaries、Explicit non-claims |
| README.md | 数据、隐私与工具权限节 |
| docs/tools/TOOL_CONTRACT.md | 全表 + Bridge rules |
| todolist.md | §1 永久不变量、§5、§6、§8 |
| ADR-0039 | §3 默认禁止的扩张、P2-6/P2-7 信号触发 |
| ADR-0127 | §1 废止、§3 威胁模型、§5 实现门槛、§6 明确不包含 |
| ADR-0128 | §2/§3/§8/§9/§12、§14 明确不包含 |
| ADR-0126 | §1.3 明确不借鉴、§6 永不 |
| ADR-0130 / 0094 | 决策冻结表、明确不包含 |
| ADR-0124 | §2 六大 Gate、§3 P2 边界、§3.6 won't-borrow |
| ADR-0132 / 0133–0140 | 取代范围、硬不变量、各 phase 非目标 |
| ADR-0141 / 0142 | §2.6 明确仍禁止、§6a 产品面收窄 |
| ADR-0152 / 0153 | 禁止 YOLO / 虚假 OS 完备、明确不并入 |
| ADR-0170 | §7 明确不包含 / 禁止事项、§9 remote 约束 |
| ADR-0171 | 取代范围 §3、迁移要求 §4.2、验收 §5 |
| ADR-0004 / 0035 / 0020 | C-4P6/P8/P9 结项边界、不得扩张 |
| ADR-0122 | 显式禁止写入/持久化、Purge 严禁范围 |
| ADR-0167 / 0162 | 同步 ≠ 教学权威；analytics 红线 |
| ADR-0172 / 0173 | 导图非教学权威、无远程同步/FTS/向量 |

---

## 7. 审核与修订建议

1. **优先修订「过时禁令」**（§3 表 #1–#6、#9、#12）：在 `AGENTS.md`、`SECURITY.md`、`CONTRIBUTING.md` 与 ADR-0127/0128/0132/0137/0140 正文中删除「禁止 marketplace / 无 auto-connect / 禁止冷启动连接 / install 永不 connect / workspace 不可作来源」等被 0141 取代的旧措辞，改为指向新 ADR。**ADR-0142 §6 已于 2026-08-18 修订**：把「Settings marketplace UI 永久禁止」收窄为「设计 non-claim + 开放路径 + 前置条件」，并同步 `AGENTS.md` §3 红线 3 与 `SECURITY.md`。
2. **保留硬边界措辞**（§4）：YOLO、secret、settlement、telemetry、memory 门控、DB-P2-3、领域门禁 —— 这些是产品地板，修改需新 ADR 且会触发安全/教学评审。
3. **区分「永久禁止」与「未实施 / 需新 ADR」**：ADR 中大量「禁止」实为「本切片不包含」，扩张路径是新建 ADR 而非改写禁止条款。审核时可在措辞上区分（如「当前不授权，见 ADR-xxxx」）。
4. **一致性**：`docs/adr/README.md` 已大量使用「已取代 / 收窄」标注，修订正文后同步更新索引表与交叉链接自检。
5. 修订后运行文档侧自检：ADR 交叉链接、`pnpm run check:tool-contract`（若涉及 TOOL_CONTRACT 措辞）、无强制 suite（仅文档改动）。

---

*本清单由脚本扫描 + 人工核对生成；所有引用均来自仓库现有文档原文。如需按文档生成逐条 diff 建议，可继续跟进。*

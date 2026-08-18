# StudiumX 文档「禁止 / 红线」勾选清单（全中文）

> **用途：** 全仓库文档中所有「明确不做 / 禁止 / 红线 / 不得 / 不引入 / 非目标」条款，逐条以复选框列出，供人工逐条审核打勾。
> **使用方式：** `- [x]` = 已审核且维持原状，或**已修订**（带日期标注）；`- [ ]` = 待审核 / 拟修改。勾选即代表你的审核结论，后续可据此修订文档。
> **组织：** A 顶层权威文档 → B 全部 ADR（编号序）→ C 其他文档。条款为中文概括，忠实于源文档原文，可对照源文件复核。
> **提示：** 标注「⚠️已被新 ADR 取代」的条目 = 旧文档残留、当前政策已放宽，是「工作被文档拦住」的主要来源，审核时可优先处理。

---

## A. 顶层权威文档

### A1. AGENTS.md（产品地板 + §3 红线 1–10）

- [ ] 禁止增加、恢复或信任 `tools.enabled` 总开关；工具执行仍须经过 capability、工作区信任、审批、路径围栏、沙箱与局部技术边界。
- [ ] 禁止使用 YOLO / DangerFullAccess / always-approve 默认或 UI 标签（`full_access` 仅称「本课放行 / 宽松策略」）。
- [ ] 禁止宣称 Docker/VM 级 OS sandbox 完备（无 Windows helper 时不得虚构完备）。
- [ ] 禁止再挂 MCP marketplace 设置页或半成品市场入口；Settings 产品面仅 list/editor/import/OAuth（ADR-0142）。
- [ ] 禁止 jiti 全权限扩展、code-mode 执行不可信代码、shell-escalation 旁路。
- [ ] 禁止 secret/token 进 public DTO / Doctor / support bundle。
- [ ] 禁止默认远程 OTEL / phone-home / Statsig / Mixpanel 式外发；本地 doctor / support-bundle 须脱敏与同意。
- [x]（已修订 2026-08-18，见对应文档） 禁止用 SQLite FTS5 或向量库做产品搜索面。
- [ ] 禁止启动自动 memories / dream / 静默改 learner-profile / 自动 skill 创建。
- [ ] 禁止无人批自动注入 memory / 自动启动 memory phase。
- [ ] 禁止绕过 settlement sole-writer、放宽 `expectedRevision`、或让 fork 默认可执行工具历史（`toolsReplayed:false`）。
- [ ] 禁止用覆盖率或泛型 CI 替换 teaching / privacy / security 领域门禁（只能叠加）。
- [ ] 禁止推倒 EventBus/timeline、重写 AgentRun 状态机、或拆 LearningSessionLedger 权威。
- [ ] 禁止在 PR 默认 CI 烧真实模型 API key。
- [ ] 禁止把 SQLite / agent run / 同步副本当作 teaching authority（文件是教学真相源）。
- [ ] 禁止不透明、低位、默认的累计 token / provider / 工具调用 / 运行时长 / iteration quota；触发只报告 `resource_limit` / `suspended`，不得伪装为 provider quota 或学习成功（ADR-0171）。
- [ ] 禁止同步状态反向改写教学决策事实。
- [ ] 禁止 MCP tool 不进 effect lattice / approval；禁止把 MCP 当 teaching evidence。
- [ ] 禁止 MCP 非 teaching evidence；settlement sole-writer 不变。
- [ ] 禁止恢复时自动重放工具；审批/effect 与恢复不自动重放工具不变。

### A2. CONTRIBUTING.md

- [ ] 禁止用覆盖率替换 teaching / privacy / security 领域门禁。
- [ ] 禁止在默认 CI 烧真实模型 API key（Do not burn real model API keys in default CI）。
- [ ] 禁止在 docs/adr/ 之外另建并行「todo plan」authority（已关闭进 ADR 的工作不得另起权威）。
- [x]（已修订 2026-08-18，见对应文档） 禁止默认开启 workspace shell / MCP market / SQLite FTS 产品搜索（workspace 命令 opt-in，ADR-0152）。
- [ ] 禁止削弱历史 redaction 或 secret-free resolved config。
- [ ] 数据库 PR：P2 项不得进入 scope，除非新 ADR 已落地（DB-P2-1…4；DB-P2-3 教学/会话写 SoT won't do）。
- [ ] 禁止 SQLite 作为教学/会话写 SoT；SQLite 是可丢弃 projection（list/analytics 优选读）。
- [ ] 禁止 analytics-DB FTS 产品面；禁止 secrets/prompts 进投影。
- [ ] 禁止为「对齐上游」同时三线大搬家（teaching-workspace + learning-session-ledger + teaching-turn-coordinator）。
- [ ] 模块尺寸：不得让尺寸失败 Blocking CI（check:module-size 默认 warning-only）。
- [ ] 架构变更（settlement / tool effects / prompt-cache / 隐私边界）必须新增或更新 ADR 并链入 docs/adr/README.md。

### A3. SECURITY.md

- [ ] 禁止 agent 与工具逃逸 workspace 路径围栏（workspace reads/writes path-gated）。
- [ ] 禁止 resolved config snapshot 含 secret（secret-free，ADR-0025）。
- [ ] 禁止未经显式同意与脱敏导出 support bundle（ADR-0034）。
- [ ] 禁止未知工具被放行（fail-closed，未注册即 privileged，ADR-0024）。
- [ ] 禁止 YOLO 标签；禁止虚构 OS-sandbox 完备（Windows helper 可选，缺失时如实 notConfigured）。
- [ ] 禁止 secret/token 进 renderer / Doctor / support bundle / logs（MCP 硬安全）。
- [ ] 禁止 MCP 结果作 LearningSession / Evidence / Outcome authority。
- [ ] 禁止绕过 settlement sole-writer；MCP 不写 ledger/outcome。
- [ ] 禁止 Settings marketplace UI（MCP Settings = list/editor/import/OAuth，ADR-0142）。
- [ ] 禁止默认云 relay（web remote control，无 `zcode.z.ai`；默认 loopback、默认关）。
- [ ] 禁止 remote tool 绕过 effect lattice + approval（无 YOLO）。
- [ ] 禁止在公开 issue 中放 API keys / learner answers / unredacted support bundles。
- [ ] 禁止声称 Docker/VM 级 OS 隔离或 descriptor-strict 为全平台默认（非声明）。
- [ ] 禁止把 bypass heuristic 当作自动 CVE（仅跨声明边界才构成漏洞）。

### A4. README.md

- [ ] 禁止把 API 密钥提交到 Git（敏感配置隔离在本地安全存储）。
- [x]（已修订 2026-08-18，见对应文档） 禁止默认开启工作区 shell；禁止默认上传遥测。
- [ ] 禁止写入 / 外部写入 / 特权操作不经 effect 分类与审批。
- [ ] 禁止 SQLite 取代教学事实的权威地位。
- [ ] 禁止密钥 / 令牌进公开 DTO、Doctor 输出或支持包。
- [ ] 禁止 Web 端承载模型密钥 / Agent loop / 本地工作区文件写入（Web 非教学执行引擎）。

### A5. docs/tools/TOOL_CONTRACT.md

- [ ] 禁止 `ask` 静默替用户做选择（never silently chooses）。
- [ ] 禁止把 `run_workspace_command` / `shell` 输出当作 Evidence。
- [ ] 禁止 `read_only_task` 调用 write 或 privileged effects。
- [ ] 禁止非 read 工具 `maxConcurrency` > 1（写并行永不开；纯读才可有界并行）。
- [ ] 禁止 UI 暴露或标注 YOLO / always-approve 模式（三态只称「需批准 / 按风险 / 本课放行」）。
- [ ] 禁止 MCP handler 写 workspace 文件 / LearningSession ledger / teaching outcomes。
- [ ] 禁止 MCP 模块 import ledger / outcome committer；MCP 结果非 teaching evidence（ADR-0134）。
- [ ] 禁止 MCP secret（headers/env/OAuth token）进 renderer / preload IPC / Doctor / support bundle。
- [ ] 禁止 remote annotations 降级 registry effect 或跳过审批（display-only）。
- [ ] 禁止因 MCP 放宽 `toolsReplayed:false` / `expectedRevision` / settlement sole-writer。

### A6. todolist.md

- [ ] 禁止回退已完成项；禁止复制第二套领域实现、放宽安全边界、以集成名义重写深模块。
- [ ] 禁止 renderer 重新计算 mastery/outcome、直接写 record/outcome/catalog、恢复旧乐观成功语义。
- [ ] 禁止非 committer 在证据门控外产生 durable outcome / 正式 Learning record。
- [ ] 禁止不确定副作用盲目重试或伪装成功；canonical 事实优先，catalog/projection 只能 read-repair。
- [ ] 禁止 learner-facing DTO / DOM / 日志 / 诊断泄露 raw prompt/reasoning、secret、provider payload、绝对路径、raw private learner text 或答案 key。
- [ ] 禁止回退 Protocol Core、M4 sole-writer 或已通过的 quality/security/privacy gates。
- [ ] 禁止 M5 借读取触发 reconcile、写入、生成或隐式修复（只读证明）。
- [ ] 禁止 M5 把 planner / committer / grounding 规则复制进 IPC。
- [ ] 禁止 M5 在 IPC 中复制领域规则（gateway 只做严格解析、归属与错误映射）。
- [ ] 禁止 M6 中 raw chunks、路径、secret、raw evidence、learner answer、provider payload、prompt/reasoning/答案 key 进入 DTO；禁止仅靠 UI 隐藏。
- [ ] 禁止「任意 ID 字符串透传」；identity 须 allow-list。
- [ ] 禁止静默混用 schema；禁止把未验证 v1 事件标为 v2 成功。
- [ ] 禁止 M7 renderer 直接触碰 coordinator ports 或 filesystem truth。
- [ ] 禁止 UI 自行写 outcome/record、拼装 DTO 或宣布 mastery。
- [ ] 禁止把内存 bus、旧 renderer 状态或临时 provider 输出当 authority（M9）。
- [ ] 禁止重复 replay / operation / event ID / 乱序事件产生第二个 record、第二个 active step 或第二次「已保存」。
- [ ] 禁止无法确认 durable effect 时自动写入（保持 review/reconcile/failed 安全态）。
- [ ] 禁止删 / skip / 放宽断言、只更新 snapshot、宽泛 `as any`、silent fallback、手工演示代替自动化。
- [ ] 禁止对已 push 分支 force-push（修复用追加 commit）。
- [ ] 禁止写「生产完成 / P0 完成 / 教学闭环完成」除非满足 §6 全部条件。
- [ ] 禁止在共享工作区 checkout / stash / reset / clean / rebase / 写文件（EOL 假脏 + 受保护资产）。
- [ ] 禁止把本地可见的 fix/* 分支写成远端分支（远端存在性须以 ls-remote 证明）。
- [ ] 禁止触碰、更名、提交或纳入 diff：codex.png、fault.png、测试运行 .out/.err/.pid、构建产物、临时 fixture、损坏依赖备份或他人未跟踪文件。

### A7. docs/adr/README.md（索引级）

- [ ] 禁止把 design gate / dry-run / preflight 当作直接修改 writer 或 destructive path 的授权。
- [ ] 禁止把已结项 plan 当作开放实现切片 / 把 residual 当作可分派实现。
- [x]（已修订 2026-08-18，见对应文档） 禁止重建 `docs/improvements/` 第二套 backlog（已清空）。
- [ ] 禁止重开已关闭的 P0/P1/已实施 P2。
- [ ] 禁止分派 C-6 destructive Memory migration 为实现（ADR-0038 延期）。
- [ ] 禁止把 ADR 的受限切片扩大为完整 closure；扩张必须新建 ADR。
- [ ] 禁止把「未实施 / Proposed」记为已实施事实。
- [x]（已修订 2026-08-18，见对应文档） 禁止为记录小进度新建 ADR；禁止保留无用指针 stub（已结项 plan 应删除）。
- [ ] 禁止以「产品地板绝对禁止任意 MCP」拒绝设计/实现 ADR 起草（ADR-0127）。
- [ ] 禁止把「不引入 MCP」等过时复读句当作现行政策（以新 ADR 为准）。

---

## B. 架构决策记录（ADR，按编号）

### B0001. ADR-0001 可重建 SQLite 投影

- [ ] 禁止 projection 充当 transcript / memory 正文 SoT（详情始终以文件为准）。
- [ ] 禁止删除 SQLite 后要求用户备份投影才能恢复（库可丢弃重建）。
- [ ] 禁止默认授权用户可见全文搜索产品面；禁止把 analytics 库扩成 searchable/query-facing corpus。
- [ ] 禁止静默把 analytics 库改成搜索引擎（重开检索须独立 disposable 索引 + 新 ADR + 经验证用户任务）。
- [ ] 禁止把 projection 的 `absolute_path` 当 durable SoT 恢复教学正文。
- [ ] 禁止 export 默认包含 projection（`includeProjections: false`；opt-in 须标 `untrustedProjection: true`，不得当权威恢复）。

### B0002. ADR-0002 canonical 永久保留 / 分区 / 摘要

- [ ] 禁止将已实施的分区 / sealing / summary projection 解释为物理 retention / recovery 授权。
- [ ] 禁止 operational debug 写入 learning-work / LearningSession events。
- [ ] 禁止为回放方便把 token stream 写入 durable ledger。
- [ ] 禁止相邻 agent-artifact 年龄/大小删除路径（已移除）。

### B0003. ADR-0003 关键 JSON 备份与恢复

- [ ] 禁止可读 canonical 文件被静默覆盖；禁止 `.bak` 成为唯一事实副本。

### B0004. ADR-0004 durable publish / partial consumer migration

- [ ] 禁止把未审查 writer 当作已迁移（partial migration 是历史边界）。
- [ ] 禁止对失败 / 可能已发布 / 无法证明的状态通用自动 retry、rollback、delete 或报为成功。
- [ ] 禁止把 S1/S2…S194 / Phase 0 / 受限 profile 结项推断为跨文件原子性、通用 host-native settlement 或 Windows power-loss/strict closure。
- [ ] 禁止对外暴露 raw internal error、absolute path、payload/content、descriptor path 或 temporary name。
- [ ] 禁止把 Windows direct-path profile 称为 strict containment、CAS 或 Windows durable publish。
- [ ] 禁止把 `possibly_published` 解释为「未执行」。
- [ ] 扩张到新 OS / filesystem / durability claim / writer / public result 必须新建 ADR。

### B0005. ADR-0005 trace correlation

- [ ] 禁止 renderer / IPC 提供 traceId 身份（main 生成 opaque UUID）。
- [ ] 禁止日志因本 ADR 变为全局 JSON logging（保持安全 tagged text）。

### B0006. ADR-0006 memory 分区与只读迁移 preflight

- [ ] 禁止将 readonly preflight / dry-run 复用为 destructive 授权或 consent。

### B0007. ADR-0007 历史数据脱敏

- [ ] 禁止新增独立 raw history JSONL；禁止扫描、删除或重写已有 raw artifact（清理须独立安全流程）。

### B0008. ADR-0008 LearningSession ledger 权威

- [ ] 禁止引入第二套 Session store 或以 catalog 取代 canonical ledger。
- [ ] 禁止同一 event / operation 的重放产生重复事实。

### B0009. ADR-0009 typed Evidence

- [ ] 禁止 renderer、模型自述和自由文本绕过 recorder 宣布 outcome 或 Learning record。

### B0010. ADR-0010 evidence-gated record cutover

- [ ] 禁止 Lesson 生成 / 打开 / 阅读路径自动创建或更新正式 Learning record。
- [ ] 禁止 `learningRecordNote` 宣称已掌握或触发 record 写入。
- [ ] 禁止 UI 乐观状态、renderer、Lesson preview 或预期答案成为该副作用的替代入口。
- [ ] 禁止任何 catalog / UI projection 失败使自动记录路径复活。

### B0011. ADR-0011 outcome settlement

- [ ] 禁止 renderer、Lesson 生成器、catalog、planner 和 UI 直接写正式 Learning record（仅 committer 可结算）。

### B0012. ADR-0012 确定性 next step planner

- [ ] 禁止把 `needs_practice` 包装为完成（仅纠正后 outcome 可推进）。

### B0013. ADR-0013 teaching context / provenance

- [ ] 禁止把任意工作区文本、provider payload 或隐式检索结果拼入 prompt 后声称可信。
- [ ] 禁止 ProjectionReport / GroundingPack 含 learner / assessment / transcript / provider payload。
- [ ] 禁止 fingerprint 由 raw prompt 派生（由 redacted 事实 sha256 派生）。

### B0014. ADR-0014 learner-safe presentation

- [ ] 禁止把 Agent run、provider payload、内部 prompt、工具事件或 raw chain-of-thought 当 teaching authority / 教学事实。
- [ ] 禁止 TeachingCommand 映射为任意 tool call、shell、diagnostics 或 effect-policy 旁路；composer 不得成为通用 agent/tool 控制面。
- [ ] 禁止 `continue`/`retry` 不可用时发明 planner step（fail closed）。
- [ ] 禁止 stale operation/revision 产生第二次 settlement（fail closed + host snapshot 刷新）。
- [ ] 禁止 renderer、模型和 skill 直写 outcome（host 仍是 sole-writer）。

### B0016. ADR-0016 trusted assessment artifacts

- [ ] 禁止把任意 Lesson HTML、路径可达文件、模型自述、renderer 状态或「看起来像 quiz」的自由内容解释为可信 assessment。

### B0017. ADR-0017 Win/Mac P0 release proof

- [ ] 禁止把 Windows skip 预算继承到 Linux（Linux 聚合预算为空）。
- [ ] 禁止为掩盖产品回归抬高 skip 数字。
- [ ] 禁止未解释 skip / bare skip / TODO / 预算漂移 / 非零退出时声称发布绿。
- [ ] 禁止静默删除测试或用 bare skip 冲绿。

### B0018. ADR-0018 recordless settlement authority

- [ ] 禁止 `needs_practice` / `not_evidenced` 创建正式 Learning record、`outcome.json` 或 completed Session manifest。
- [ ] 禁止 `not_evidenced` 因 restart/retry/文件存在/recovery 升级为 established / misconception_corrected。
- [ ] 禁止 reconcile 从 marker 推断、合成或 promote 出 outcome / completed Session / record。
- [ ] 禁止同一 operationId retry/restart 发布第二条 settlement 或 promote 为 record-writing outcome。
- [ ] 禁止对 recordless 冲突用 rewrite、delete、rollback 或 re-evaluate「修齐」（fail closed 进 review_required）。

### B0019. ADR-0019 session audit V1 wire

- [ ] 禁止 malformed/unknown row 获得 canonical identity 或触发 rewrite/backfill/normalize/repair。
- [ ] 禁止把 directory-sync warning 解读为完整 parent-directory / power-loss durability。
- [ ] 禁止 diagnostics 泄露 raw payload、绝对路径或 secret。
- [ ] 禁止把本 ADR 授权为 generic JSONL、rotation、repair 或跨进程 multi-writer。

### B0020. ADR-0020 C-4P6 Phase 0 profile

- [ ] 禁止在 profile/matrix 冻结前把任何 writer/schema/IPC/局部补测解释为 close-out。
- [ ] 禁止 P6-Windows-degraded 声称 strict success / power-loss。
- [ ] 禁止以「Node 能运行」或任意 desktop OS 作为默认 strict profile。
- [ ] 禁止把 Windows direct-path warning 或 immutable-record skip 解释为 P6 strict / power-loss 证据。
- [ ] 禁止 capability 失败后的未约束 pathname fallback。
- [ ] 禁止 rollback、delete canonical、re-evaluate、新 operation/outcome ID（可能已发布窗口）。
- [ ] 禁止跨文件 transaction；Windows strict 不在本 profile。
- [ ] 扩张到新 OS / filesystem / durability claim / writer / public result 必须新建 ADR。

### B0021. ADR-0021 AgentRun 状态机

- [ ] 禁止把 run 状态继承进 SessionLedger；禁止用 Session 状态机替代 run recovery。
- [ ] 禁止非法转换静默「修复」为合法边（记录并拒绝）。
- [ ] 禁止取消/恢复制造重复 run 事实或回写 teaching outcome。

### B0022. ADR-0022 capability catalog

- [ ] 禁止 disabled / unconfigured 能力进入 prompt。
- [ ] 禁止用过期 available 掩盖真实 unconfigured。

### B0023. ADR-0023 Coordinator host + blocking CI

- [ ] 禁止 CI 失败日志上传 raw secrets、learner answers 或 provider payloads。

### B0024. ADR-0024 typed tool dispatcher

- [ ] 禁止调用方从 free-text content 推断失败（`status` 是唯一真源）。
- [ ] 禁止取消/超时伪装 `succeeded`（映射 cancelled / timed_out）。
- [ ] 禁止 deny/error 文案含 secrets 或 raw args。

### B0025. ADR-0025 secret-free config resolver

- [ ] 禁止 `apiKey` 等密钥进入普通 resolved snapshot（剥离并记 `secret_stripped`）。

### B0026. ADR-0026 CourseDefinition

- [ ] 禁止把 SQLite 或 catalog projection 当作 Course/Session 真相源（文件系统是 Lesson 发现源）。

### B0027. ADR-0027 Doctor + Inspector 只读

- [ ] 禁止 Inspector 写文件系统 / auto-repair / 把 catalog projection 当 canonical 真相。
- [ ] 禁止 doctor 失败阻断只读打开 workspace（read_only_allowed）。

### B0028. ADR-0028 audit correlation

- [ ] 禁止默认投影 provider payload、secrets、完整 learner answers、raw reasoning、完整绝对路径。
- [ ] 禁止纯模块引入 fs / fetch / SQLite / MCP / shell。
- [ ] 禁止 correlation 合并 Session 状态机与 Agent run 状态机。

### B0029. ADR-0029 learning branch projection

- [ ] 禁止投影写 outcome / session / record。
- [ ] 禁止 alternate 路径伪装为已结算事实。

### B0030. ADR-0030 session resume picker

- [ ] 禁止候选携带 learner content 或 provider payload。

### B0031. ADR-0031 tech inspector

- [ ] 禁止诊断输入夹带 raw provider payload 或 learner answers；模块只读、无文件系统写入。
- [ ] 禁止自动 repair。

### B0033. ADR-0033 config optimistic concurrency

- [ ] 禁止冲突静默覆盖（必须对调用方可见）。
- [ ] 禁止把 apiKey 等 secret 写入 resolved snapshot / fingerprint 材料。

### B0034. ADR-0034 redacted support bundle

- [ ] 禁止无同意导出。
- [ ] 禁止夹带 raw transcript / provider payload / 完整 conversation/memory 正文与 secret keys。
- [ ] 禁止把 support bundle 当完整教学备份。

### B0035. ADR-0035 C-4 P6/P8/P9 结项边界

- [ ] 禁止扩张现有 writer、wire、IPC、schema 或 canonical authority。
- [ ] 禁止把结项解释为 strict/generic/cross-process/transaction/public surface 已实现。
- [ ] 禁止用 downgrade 作为 recovery 机制。
- [ ] 禁止删除 `.learning-outcome-committer-stage` residuals。
- [ ] 禁止推断 post-publish write 是否成功（只返回稳定失败类别）。
- [ ] 禁止把本结项解释为这些能力已经实现（扩张须新 ADR）。

### B0036. ADR-0036 mission update receipt

- [ ] 禁止 actionId 进入 lifecycle JSONL、日志、analytics（仅 IPC + private receipt）。
- [ ] 禁止因文件存在或同 prompt 报成功（明确 I/O 错误须返回 non-success）。
- [ ] 禁止字段：raw prompt、rendered mission、CSS、content hash、provider/request ID、secret、绝对路径、stack、error text。
- [ ] 禁止把 actionId / receipt / phase / requestTag 写入 JSONL。
- [ ] 禁止不同 actionId 按内容 dedupe。
- [ ] 禁止删除失败影响 canonical 数据（仅允许未来删除 final 且过 retention 的私有 receipt）。

### B0037. ADR-0037 direct-UI lesson generation

- [ ] 禁止 renderer reload 后自动 resubmit、附着旧 streamId。
- [ ] 禁止 receipt 进入 user-visible artifact、analytics 或 generic error text（非 canonical/jourmal/audit authority）。
- [ ] 禁止同一 actionId 在 durable provider_started 后再次进入 provider。
- [ ] 禁止 provider outcome 无法证明时自动重跑（`indeterminate: provider_outcome_unknown`）。
- [ ] 禁止 agent 复用 renderer actionId（agent 路径隔离）。
- [ ] 禁止不同 actionId 按内容 dedupe。

### B0038. ADR-0038 memory destructive 延期

- [ ] 禁止分派真实 copy/hold/publish/delete 为实现（保持未批准、未实现，须独立 ADR + owner + evidence）。
- [ ] 禁止声称跨文件 atomicity。

### B0039. ADR-0039 teaching adoption closeout

- [ ] 禁止将借鉴工作扩张为通用 coding agent、通用多 Agent 编排平台，或默认以 shell / 任意工具面驱动的开发助手。
- [ ] 禁止重开已关闭的 P0/P1/已实施 P2 为 backlog。
- [ ] 禁止 IPC/renderer 生产接线把已关闭领域规格重开为「未完成 backlog」。
- [ ] 禁止无独立 design gate + 新 ADR + 匹配证据前引入默认禁止的扩张。
- [ ] 禁止 P2-6 Adapter 成为 grounding / IPC / settlement 的旁路（仅返回既有 typed outcomes）。
- [ ] P2-6 / P2-7：无真实 Adapter / 无不可信代码需求则永不实施、默认不排期；立项必须新建 ADR。

### B0040. ADR-0040 session protocol facade

- [ ] 禁止 facade 另起一套 agent loop 或绕过 AgentRunStore / conversation runtime。
- [ ] 禁止 steer/compact 未接线时回报成功执行。

### B0041. ADR-0041 tool result budget

- [ ] 禁止截断静默丢弃（截断必须可见）。

### B0042. ADR-0042 extension manifest

- [ ] 禁止敏感 userConfig 字段进入 logs / doctor evidence / support bundles。
- [ ] 禁止未获 design gate 的 contribution 自动加载。

### B0043. ADR-0043 doctor config locator

- [ ] 禁止导出与 evidence 含 secrets、完整绝对家目录路径、raw learner answers。
- [ ] 禁止 fixSuggestion 自动执行（仅手动修复建议）。

### B0044. ADR-0044 prompt cache contract

- [ ] 禁止以下变化改变 stable prefix：stage、orchestration plan、preset、页面上下文、记忆/画像、provider runtime facts、personal/custom/stage skill 正文。
- [ ] 禁止 personal/custom skill（即使同 id）shadow 已经验证的 app-shipped teach kernel 全文。
- [ ] 禁止非 kernel 全文进入 stable prefix（只能进 dynamic turn-tail）。
- [ ] 禁止引入供应商特定 `cache_control` 协议字段。
- [ ] 禁止任意 skill 自声明 stable-prefix 权限。

### B0045. ADR-0045 context hygiene ladder

- [ ] 禁止压缩失败静默毁掉 LearningSessionLedger 权威或 settlement（冷却 / 防 thrash）。

### B0046. ADR-0046 teaching footprint ladder

- [ ] 禁止借资源读取绕过路径、manifest 或 capability 校验。
- [ ] 仍禁止 shell / marketplace / YOLO / 诊断控制面；temporary 不得获得 teaching 也没有的超集能力。
- [ ] 禁止默认裁 MCP（临时 chat 与 teaching 差距仅限教学文件生成相关能力）。
- [ ] 禁止另起一套与 ladder 平行的模式命名或工具目录；禁止把 plan-mode 的存在解释为新增能力授权。
- [ ] 禁止在 renderer、help 文档或其他 shared module 维护重复的 TeachingCommand 表（单一 catalog）。
- [ ] 禁止临时 chat 成为 teaching chat 的超集（不得多 tool / 多写权威）。
- [ ] 禁止用户 Markdown、skill 文案或模型自由文本动态注册 slash 命令或工具。

### B0047. ADR-0047 agent runtime wire

- [ ] 禁止 wire 层拥有 ledger settlement authority（no ledger settlement authority）。

### B0048. ADR-0048 tool contract + write policy

- [ ] 禁止注册表与 effect lattice 漂移（inventory 必须同步；未知工具 fail-closed）。

### B0049. ADR-0049 write rewind journal

- [ ] 禁止 journal 失败阻断 durable publication。
- [ ] 禁止削弱 durable publish 语义。

### B0050. ADR-0050 memory search + synthetic memory

- [ ] 禁止把 ADR-0001 analytics SQLite 扩成 FTS 或用户可见搜索语料。
- [ ] 禁止写入 raw learner 答案全文、API key、主机绝对路径。
- [ ] 禁止把记忆正文 bake 进稳定 system 前缀（ADR-0044）。

### B0051. ADR-0051 provider finish reason

- [ ] 禁止在 ledger 侧伪造 `'stop'`（响应未给终态信号时禁止伪造）。

### B0052. ADR-0052 provider error taxonomy

- [ ] 禁止（本切片与默认产品）把 quota/billing 伪装为 rate_limit 等其它类别。
- [ ] 禁止对 billing / auth / length / overflow 自动重试。

### B0053. ADR-0053 security suite 与测试教条

- [ ] 禁止一刀切删除既有门禁（L4 change-detector 债新建禁止、既有禁止一刀切删除）。
- [ ] 禁止用覆盖率或泛型 CI 替换领域门禁（只能叠加）。
- [ ] 禁止 Blocking CI 领域 job 被 path-skip。
- [ ] 禁止 L0 领域保险丝被泛型替换。

### B0054. ADR-0054 actions / dependabot / OSV

- [ ] 禁止外部 Actions 用非 full commit SHA（标签可移动）。
- [ ] 禁止 Dependabot 跟非 actions 生态（避免 npm 洪水 PR）。
- [ ] 禁止用泛型漏洞门替换教学/隐私/安全领域门禁。

### B0055. ADR-0055 busy queue / replay

- [ ] 禁止 `agent-loop-queue` / `agent-prompt-queue` / `agent-interjection` 第二命名。
- [ ] 禁止 write_tool / privileged_tool 期间 steer（强插 intent demote → queue）。
- [ ] 禁止破坏 expectedRevision / toolsReplayed:false / 无启动自动 memory 契约。

### B0056. ADR-0056 tool result spill

- [ ] 禁止绝对路径泄漏到 transcript / learner UI（模型可见仅 workspace-relative）。
- [ ] 禁止 pinned read 工具 spill。
- [ ] 禁止 overflow 静默吞掉（bounded spill）。

### B0057. ADR-0057 provider retry

- [ ] 禁止 billing / auth / overflow / length 自动重试（永久禁止）。
- [x]（已修订 2026-08-18，见对应文档） 禁止以累计 token / provider 调用次数 / 运行时长终止正常学习 / agent run（以 `budget_exhausted` 阻断后续调用）。
- [ ] 禁止全局 run 配额伪装（原 shared budget 已由 ADR-0171 取代）。

### B0058. ADR-0058 agent session facade

- [ ] 禁止 `agent-facade` / 对外 `CoreFacade` 等第二命名（冻结 `agent-session-facade.ts`）。
- [ ] 禁止用 façade 替换 protocol 或绕过 settlement sole-writer。

### B0059. ADR-0059 read-parallel tool batch

- [ ] 禁止既有 parallel-read-tools / agent-loop-finish-length 测试回归。
- [ ] 禁止 write/privileged 进入并行批（保持 A-02/B-04 不变量）。

### B0060. ADR-0060 tools/schema fingerprint

- [ ] 禁止静默扩展 / 变更 schema（fail closed；合法 narrow 须 `tools_schema_narrowed` 审计）。
- [ ] 禁止引入 shell / MCP marketplace / FTS / YOLO / 远程 telemetry（本 ADR 不引入）。

### B0061. ADR-0061 tool capabilities

- [ ] 禁止借此放开 write 并行（写类 maxConcurrency 永不为 >1）。
- [ ] 禁止用 capability metadata 替代 effect/permission 授权。

### B0062. ADR-0062 agent stream presentation

- [ ] 禁止 presentation 异常抛回 agent loop / publish 调用方。
- [ ] 禁止默认 remote telemetry / phone-home（diagnostic 仅本地 hook）。

### B0063. ADR-0063 declarative tool policy

- [ ] 禁止引入 shell argv、`prefix_rule` 或 YOLO / always-approve 产品标签。
- [ ] 禁止无维度规则命中造成全局 allow（永不匹配防误全局 allow）。
- [ ] 禁止把 `full_access` 重命名为 DangerFullAccess / YOLO / always-approve。
- [ ] 禁止空文档 / 空 rules 伪造「全禁」或 YOLO。

### B0064. ADR-0064 context compactor

- [ ] 禁止切点落在最新 user 之后（最近用户输入留在后缀）。
- [ ] 禁止失败路径丢弃或改写调用方 transcript。
- [ ] 禁止不足缩减当作成功 completed。

### B0065. ADR-0065 child capability subset

- [ ] 禁止 child 放大父 allow-list。
- [ ] 禁止授予 child 写工具 / shell / 抬升父 privilege。
- [ ] 禁止 `workspace_audit` 通过本模块获得 web；`read_only`/`research` 永不获得 write / lesson / nested delegate。

### B0066. ADR-0066 local observability

- [ ] 禁止默认 phone-home / OTEL / Statsig / Mixpanel 式外发。
- [ ] 禁止 secrets、绝对用户路径、任意扩展字段进入本地观测（parse fail-closed）。
- [ ] 禁止路径成为 correlation 标签。

### B0067. ADR-0067 cancel tool pair

- [ ] 禁止 renderer import main（共享 busy-ack 常量经 main façade re-export）。

### B0070. ADR-0070 runtime wire shared protocol

- [ ] 禁止 renderer deep-import main 实现（shared/protocol 是合法共享边界）。

### B0071. ADR-0071 workspace config denylist

- [ ] 禁止不可信 workspace 设置/覆盖各 provider 的 API base URL。
- [ ] 禁止 workspace 使 resolved baseUrl 取自 workspace 输入。
- [ ] 禁止被拒绝字段声称 `source: 'workspace'`。

### B0073. ADR-0073 feature registry

- [ ] 禁止借机引入 shell / code_mode / MCP marketplace / YOLO / effect bypass。
- [ ] 禁止注册 shell / code_mode / mcp_marketplace / yolo / remote_telemetry 等 feature id。
- [ ] 禁止用 feature flag 旁路 effect / settlement / toolsReplayed / 审批。
- [ ] 禁止 `under_development` 默认 product-on。

### B0074. ADR-0074 blocking CI fan-in

- [ ] 禁止替换 teaching / privacy / security 领域检查（只能叠加）。
- [ ] 禁止把 typecheck / security / teaching-evidence 折成单一 mega job。
- [ ] 禁止 CI 设置 `ALLOW_DIRTY_WORKTREE=1`（默认严格）。
- [ ] 禁止 format 门伪装成全仓 prettier 完成（子集诚实）。

### B0075. ADR-0075 module size

- [ ] 禁止「对齐上游」驱动的三线并行大搬家（teaching-workspace + learning-session-ledger + teaching-turn-coordinator）。
- [ ] 禁止借 peel 把 outcome settlement 写路径拆成多 writer。
- [ ] 禁止尺寸成为 Blocking CI 失败原因（默认 exit 0）。
- [x]（已修订 2026-08-18，见对应文档） 禁止静默进入 allowlist 以外的 STRICT 失败路径（>1000 须 PR/ADR 说明）。
- [ ] 禁止 peel 破坏 sole-writer、ledger 权威、expectedRevision、toolsReplayed:false。

### B0076. ADR-0076 memory injection sanitize

- [ ] 禁止 FTS5 / 向量库作产品搜索；禁止自动 memory phase。
- [ ] 禁止注入前不消毒（控制字符 / 路径 / 密钥形态）。

### B0077. ADR-0077 turn-review candidates

- [ ] 禁止自动 skill 创建与静默 learner-profile 改写。
- [ ] 禁止 `skillFileContent` / `profilePatch` / `writePath` / `autoApply` 等可执行 apply 形状。
- [ ] 禁止 finalize hook 写 skill、改 profile 或绕过 coordinator。
- [ ] 禁止假人批（assertReviewNotAutoApplied 拒绝）。

### B0078. ADR-0078 workspace host port

- [ ] 禁止 `workspace-host` 反向导入（check:workspace-host-imports）。
- [ ] 禁止 path containment 语义因端口变弱（端口只委托，不改写 policy）。

### B0079. ADR-0079 tool-policy FS loader

- [ ] 禁止引入 shell argv / `prefix_rule` DSL。
- [ ] 禁止缺文件时改变既有 approvalMode lattice（null → 不注入 → 默认文档）。

### B0080. ADR-0080 review finalize wire

- [ ] 禁止 review 路径推翻或改写 finalResult / settlement。
- [ ] 禁止对禁止 payload / 假人批放行（assertReviewNotAutoApplied fail-closed）。

### B0081. ADR-0081 memory sanitize non-recall paths

- [ ] 禁止 FTS5 / 向量库；禁止静默改写 learner-profile；禁止自动 memory。
- [ ] 禁止不消毒注入边界（lesson prompts + memory tools）。

### B0082. ADR-0082 steer/follow-up IPC

- [ ] 禁止开启 product autoDrain；禁止 main↔renderer 队列镜像。
- [ ] 禁止 steer ≠ abort 语义混淆；禁止 YOLO。

### B0083. ADR-0083 tool-policy product inject

- [ ] 禁止以空文档 / 空 rules 伪造「全禁」或 YOLO；禁止 argv / `prefix_rule` / always-approve 产品语言。

### B0084. ADR-0084 doctor product IPC

- [ ] 禁止 auto-repair / upload / clear（doctor 只读诊断）。

### B0085. ADR-0085 turn-review human approve projection

- [ ] 禁止 UI/IPC 现场发明 apply 语义（只提供 fail-closed 决策校验 + display-only 投影）。
- [ ] 禁止 bundle 携带 auto-apply 形 payload / 假人批（恒调用 assertReviewNotAutoApplied）。
- [ ] 禁止真实 skill 安装 / memory 创建 / lesson 跟进不经 consent 门控。

### B0086. ADR-0086 managed config overlay

- [ ] 禁止把密钥写入普通 resolved snapshot（secret-free）。
- [ ] 禁止在本切片绑定产品级 FS 路径或 MDM。
- [ ] 禁止改写 CAS 协议（仍对最终 secret-free value 做 fingerprint）。
- [ ] 禁止把 baseUrl 的 field source 标为 `workspace`（managed 层信任 org）。

### B0087. ADR-0087 turn-review approve IPC

- [ ] 禁止在 gateway 内发明 auto-apply / skill 安装 / memory 写入语义。
- [ ] 禁止投影含 `applyPlan` / `autoApply` / `skillFileContent` / `writePath` / `profilePatch` 等字段。

### B0088. ADR-0088 tool-policy secondary inject

- [ ] 禁止 YOLO / always-approve / argv / `prefix_rule` 产品语言。
- [ ] 禁止 grant false 时 FS load（policy 不绕过 grant 门）。

### B0089. ADR-0089 agent session queue projection

- [ ] 禁止默认省略 free-text 规则被突破；`textPreview` 永不带未截断全文键。

### B0090. ADR-0090 overlay-parse peel

- [ ] 禁止巨石（workspace / ledger / coordinator）三线并行大搬家（仅按触达 peel）。

### B0091. ADR-0091 queue projection IPC

- [ ] 禁止 action 调用 drain / prompt / steer / followUp / abort（仅 lookup + pure mapper）。

### B0092. ADR-0092 managed config FS loader

- [ ] 禁止 user/workspace 写入时丢掉已注入的 managed 层（CAS 重解析保真）。

### B0093. ADR-0093 doctor multi-collector

- [ ] 禁止借机 peel ledger / settlement 巨石（真实 workspace collectors residual）。

### B0094. ADR-0094 study task/timer design gate

- [ ] 禁止在未完成 Phase 0 design gate 前把任何 canonical 路径 / writer / schema / 迁移 / UI 重写解释为已批准实施。
- [ ] 禁止个人时钟与 analytics 事实冒充 teaching Session。
- [ ] 禁止用裸 "Session" 指代计时（术语硬规则：TimerSession）。
- [ ] 禁止把完全关闭休息提醒作为番茄静默默认（仅显式 breakPolicy: none / reminder_only）。
- [ ] 禁止静默批量取消默认（任务完成且有未来块须每次询问）。
- [ ] 禁止 SQLite 替代教学事实；禁止 FTS / 向量库作产品搜索。
- [ ] 禁止 exact retry 重复创建任务或会话（expectedRevision + action/operation id）。
- [ ] 禁止 UI 散落循环/休息/尾段规则（allocateTimeWindow 纯函数、提案先于写入）。
- [ ] 禁止编辑方案改写历史事实（运行中/历史 TimerSession 冻结 planSnapshot）。
- [ ] 禁止改变 TeachingTurnCoordinator / host settlement sole-writer；禁止放宽 toolsReplayed:false；禁止 fork 重放真实计时副作用。
- [ ] 首切片禁止 canonical 写入、V1→V2 迁移落盘、真实 TimerSession 生命周期替换、路径/schema「先写死再补 ADR」。
- [ ] 禁止违背本表默认策略（番茄到点默认 ask 等）。
- [ ] 禁止锁定块重叠、自动排程移动锁定块、把无法确认的长时间休眠静默记为专注。
- [ ] 禁止「永不提示」后再弹分类提示；禁止列表排序改变手动排序权威；禁止用实际超时反向改原计划。
- [ ] 禁止在无独立实施工作 / 实现 ADR 情况下直接进入 Phase 1+ 生产改动。
- [ ] 禁止借机 peel 教学 settlement 巨石（模块新增遵守 ADR-0075）。

### B0095. ADR-0095 doctor settings UI

- [ ] 禁止 auto-repair / upload / clear（只读展示 export-safe report）。

### B0096. ADR-0096 autoDrain evaluation

- [ ] 禁止把 constructor 默认改为 true 的「产品默认翻转」戏法。
- [ ] 禁止在无独立 queue-sync 设计 ADR 时将 product autoDrain 设为 true。
- [ ] 禁止依赖或启用 autoDrain（只读 consumer 展示 depth/phase/busy-ack）。
- [ ] 禁止双 FIFO 同时 drain；禁止启动第二 agentChatStream loop「模拟」drain。
- [ ] 禁止 drain 后续 turn 用 YOLO / always-approve；禁止 shell / MCP marketplace。
- [ ] 禁止在同一切片里改 gateway autoDrain: false。

### B0097. ADR-0097 review settings UI

- [ ] 禁止 auto-apply（demo bundle 只读投影 + 可选人批决策再投影）。

### B0098. ADR-0098 queue renderer consumer

- [ ] 禁止产品路径传 includeTextPreview: true（只读诊断）。
- [ ] 禁止 UI drain / prompt / steer / follow-up / abort / 翻转 autoDrain。

### B0099. ADR-0099 doctor config facts

- [ ] 禁止 `configPath` 暴露绝对 home 路径（仅逻辑标签）。
- [ ] 禁止把 raw apiKey 或其它 secrets 写入 facts / evidence。

### B0100. ADR-0100 agent-loop fallback peel

- [ ] 禁止巨石三线并行大搬家（仅按触达 peel；loop 保留 retry/budget/schema/tool-budget）。

### B0101. ADR-0101 tool-policy catalog inject

- [ ] 禁止 YOLO / always-approve / argv / `prefix_rule` 产品语言。
- [ ] 禁止因 policy 文件存在而授予 workspace 工具（grant 门与 capability policy 不变）。

### B0102. ADR-0102 doctor catalog drift facts

- [ ] 禁止绝对路径 / home 根形态条目进入 facts（relative-only，硬顶默认 32）。
- [ ] 禁止 secrets / 绝对 home 路径 / free-form renderer facts。

### B0103. ADR-0103 agent-loop budget-reason peel

- [ ] 禁止巨石三线并行大搬家（仅按触达 peel；不 peel retry/schema/tool-budget）。

### B0104. ADR-0104 doctor session/outcome scan

- [ ] 禁止调用 `LearningOutcomeCommitter.reconcile`（会 mutate/repair）或任何 outcome write/repair。
- [ ] 禁止 secrets / 绝对 home 路径 / free-form renderer facts / auto-repair。

### B0105. ADR-0105 doctor source-gap facts

- [ ] 禁止 facts 含 `resourcesPath` / `referenceDir` / 绝对路径（仅计数与布尔）。
- [ ] 禁止 secrets / 绝对路径 / free-form renderer facts。
- [ ] 禁止 `exclusionCodes` 含路径 / secrets（稳定短码 only，硬顶 12）。

### B0106. ADR-0106 agent-loop schema-guard peel

- [ ] 禁止巨石三线并行大搬家（仅按触达 peel；不 peel retry/tool-budget）。

### B0107. ADR-0107 support-bundle redact switch

- [ ] 禁止把本切片未批准的项迁入共享 redact.ts。
- [ ] 禁止密钥与绝对路径外泄（优先共享实现，保持 fail-closed）。

### B0108. ADR-0108 write capture permissionDecision

- [ ] 禁止把 journal 审计扩展为授权（registry 设置 lastJournalPermissionDecision 仅审计）。

### B0109. ADR-0109 review post-approve handoff

- [ ] 禁止未映射 candidate 发 intent（fail-closed，永不暗示 execute）。
- [ ] 禁止在 gateway 内发明 apply 语义（未来接线调用纯 API）。

### B0110. ADR-0110 review handoff IPC

- [ ] 禁止在 gateway 内发明 auto-apply / skill 安装 / memory 写入 / durable store。
- [ ] 禁止序列化路径携带 `applyPlan` / `autoApply` / `skillFileContent` / `profilePatch` / `writePath` 等可执行字段。

### B0111. ADR-0111 review handoff UI

- [ ] 禁止 Apply 按钮 / 真实 consent API 调用 / 导航（永不 auto-apply）。
- [ ] 禁止在 gateway 内发明 apply 语义。

### B0112. ADR-0112 tool-policy multi-document merge

- [ ] 禁止 UI / 多文件 FS / YOLO（纯 merge most-restrictive-wins）。
- [ ] 禁止非 most-restrictive 合并（rules 拼接 + defaultDecision strictest）。

### B0113. ADR-0113 review last-bundle store

- [ ] 禁止 auto-apply（纯 snapshot + caller-root contained FS，可重建投影缓存）。

### B0114. ADR-0114 review last-bundle IPC

- [ ] 禁止 load/save 后 auto-apply / install skill / write memory（永不 auto-apply）。

### B0115. ADR-0115 tool-policy multi-path load merge

- [ ] 禁止 secondary 缺失改变仅有主文件时的行为。
- [ ] 禁止向产品返回无效合并结果（fail-soft → null）。
- [ ] 禁止 YOLO / always-approve / argv / `prefix_rule` 产品字段（非法文档不进入 merge）。

### B0116. ADR-0116 last-bundle finalize save

- [ ] 禁止 auto-apply；禁止写 skills / learner-profile / settlement / memory。
- [ ] 禁止 save 失败 / 校验失败 / IO 异常向外 throw（catch 后 return）。
- [ ] 禁止 hook 错误回滚 finalize / settlement。

### B0117. ADR-0117 study planning store paths

- [ ] 禁止在无实现 ADR 的情况下写 canonical 生产路径（Phase 1 pure 已落地）。
- [ ] 禁止把 `tmp/` 当权威读取。
- [ ] 禁止把 localStorage key（study-space:v1 / study-task-categories:v1）继续当长期任务/排程权威。
- [ ] 禁止删除 snapshot.json 的 required 字段（实现可加 optional）。
- [ ] 禁止 renderer 直接写 `snapshot.json`（须经 StudyPlanningStore.applyCommand）。
- [ ] 禁止不可靠 active timer 迁移后静默计入专注（needs_reconcile）。
- [ ] 禁止 UI 单独持有任务列表（localStorage 仅草稿/偏好）。
- [ ] 禁止继续胀大 WorkbenchPomodoro / useStudySession / StudyTaskSchedulePage（ADR-0075）。

### B0118. ADR-0118 tool-policy secondary multi-path inject

- [ ] 禁止 YOLO / always-approve / argv / `prefix_rule` 产品字段。

### B0119. ADR-0119 turn-review IPC peel

- [ ] 禁止破坏 exact-key、fail-closed 文案、candidate/decision caps、kind/action allowlist、requiresHumanApproval、source 闭集（字节等价）。
- [ ] 禁止 autoApply / applyPlan 等字段（保持不变）。
- [ ] 禁止巨石三线并行大搬家（仅按触达 peel）。

### B0120. ADR-0120 agent-conversation IPC peel

- [ ] 禁止巨石三线并行大搬家（仅按触达 peel）。

### B0121. ADR-0121 improvements adoption closeout

- [ ] 禁止把显式 defer 与纪律 residual 当作开放 P0/P1 重新分派。
- [ ] 禁止借 residual 文案重开已实施借鉴范围为「未完成 P0/P1」。
- [ ] 禁止 doctor auto-repair（仍禁止，不得借 collector/UI 扩张为自动修复）。
- [ ] 禁止巨石三线并行大搬家（S-03 by-touch）。
- [ ] 禁止在无独立 queue-sync 设计 ADR 时将 product autoDrain 翻 true（B-02 禁止直至新 ADR）。
- [ ] 禁止再分叉命名冻结（TeachingCommand / skill 包 / 落点命名）。
- [ ] 禁止 credential 多 key 旋转；billing/余额/永久 auth/context overflow/max-tokens 截断永不自动重试。
- [ ] 禁止 jiti 全权限扩展 / 默认任意 MCP（扩展面：TeachingCommand 闭集 + skill-pack verifier）。
- [ ] 禁止未来新上游借鉴不先建 ADR；禁止重建 docs/improvements 第二套 backlog。

### B0122. ADR-0122 usage ledger

- [ ] 禁止 usage 成为 outcome / evidence / settlement authority。
- [ ] 禁止 rewrite、compact、in-place edit 或把 projection 回写进 usage JSONL（append-only）。
- [ ] 禁止 ledger I/O 失败使 agent turn / teaching turn 主成功路径失败（best-effort）。
- [ ] 禁止投影重建 / analytics 聚合双计 token（entryId 去重）。
- [ ] 禁止显式写入：token stream 全量 delta、未知键、secret 形态字段（DB-P1-3 反例）。
- [ ] 禁止 FTS；usage projection 不得变成可搜索语料。
- [ ] 禁止 projection rebuild 失败 / 锁竞争 / query 错误反向影响 turn 成功路径。
- [ ] 禁止 usage 行被 OutcomeEvaluator / record cutover / settlement marker / Evidence 绑定读取为权威输入。
- [ ] 禁止 LearningSession / Evidence 事件因缺 usage 行而失败。
- [ ] 禁止把 protocol usage 结果升级为 settlement authority。
- [ ] 禁止「无限膨胀 + 无策略」purge（未配置时须有限天数 mtime-based purge）。
- [ ] 严禁 purge 触及 learning-work、LearningSession ledger、Evidence、outcome marker、Memory、conversation archive。
- [ ] 禁止 purge 失败阻塞启动或 turn。
- [ ] 禁止把 usage projection 当可见性、授权、留存或脱敏裁决依据。
- [ ] 禁止引入 SQLite FTS 或用户可见 usage 全文搜索。

### B0123. ADR-0123 runtime session store（设计 only）

- [ ] 任一项硬门槛违反则不得实现：库写入失败不得使 turn 主成功路径失败、不得成为唯一持久化。
- [ ] 禁止删除 canonical 会话文件后 runtime 行被视为可恢复正文或 teaching evidence。
- [ ] 禁止存 raw prompt、完整 tool arguments、API key、未脱敏绝对路径、token stream 全量 delta。
- [ ] 禁止用本 ADR 覆盖 DB-P2-3（缓存不是「SQLite 为主、文件仅导出」）。
- [ ] 禁止 resume 仅凭 runtime 行复活已删除会话正文。
- [ ] 禁止在实现 PR 合并前出现 runtime session store 的生产 schema 或写路径。

### B0124. ADR-0124 database layered authority + PR gates

- [ ] 禁止 SQLite 永不替代文件写权威（教学资产与 learner evidence 写权威永远是文件）。
- [ ] 禁止删除文件后 SQLite 行成为「仍可恢复的真相」。
- [ ] 禁止合并前以「LGTM」代替六大 Gate 证明（每项给「如何证明」）。
- [ ] 禁止 adapter 静默返回 stale `ready`（source fingerprint/mtime/checksum 变更后）。
- [ ] 禁止引入 analytics 库 FTS 产品面、canonical 物理删除、绕过 effect lattice、SQLite 当教学/会话写权威。
- [ ] 禁止 DB-P2-1/2/3/4 出现在 sprint backlog 为「可分派实现」（默认不排期）。
- [ ] 禁止以「feature flag 默认关」绕过 ADR（flag 不等于授权）。
- [ ] 禁止引入向量 embedding 写入、analytics 库 FTS 语料、会话正文/教学 ledger 的 SQLite 写权威、workflow run 编排权威入库。
- [ ] 禁止 DB-P2-3（教学/会话写权威迁 SQLite）——won't do；除非产品顶层重定位 + 顶层 ADR。
- [ ] 禁止删除六大闸（只能收紧或拆分子检查项）。
- [ ] 禁止 embedding 行成为 remember/forget 或 visibility 的权威。
- [ ] 禁止 silent swap（与 ADR-0050 并存的 ranking 契约）。
- [ ] 禁止把 FTS5 / Tantivy / 用户可见全文搜索 / snippet/highlight 实现为产品面（analytics 库禁止扩成 query-facing corpus）。
- [ ] 禁止用 projection 行作授权 / 详情 / 删除裁决。
- [ ] 禁止 workflow 表成为 settlement 旁路。
- [ ] 禁止开放 script workflow 用户脚本面；禁止以 workflow SQLite 替代 LearningSessionLedger；禁止把 AG-UI / token stream 全量落库。
- [ ] 禁止借 runtime cache 覆盖 DB-P2-3 won't-do。

### B0125. ADR-0125 provider overflow patterns

- [ ] 禁止 overflow 进入 auto-retry（billing/auth/length/overflow 永不自动重试）。
- [ ] 禁止 credential rotation。

### B0126. ADR-0126 codex-style platform profiles

- [ ] 禁止把较弱 profile 伪装成 POSIX CAS / strict。
- [ ] 禁止 `danger-full-access` / YOLO / always-approve 标签。
- [ ] 禁止默认通用 shell / 任意代码执行产品路径；仍禁止 YOLO 与虚假 OS 完备宣称。
- [ ] 禁止 MCP marketplace / 默认任意 MCP（按当时口径；后经 0132/0141 收窄）。
- [ ] 禁止把 Windows 较弱写路径称为 strict / CAS（命名诚实）。
- [ ] 禁止 path / addon 路径 / raw message 外泄到 renderer。
- [ ] 禁止 profile 不可用时把 unsupported_platform 抛到 turn 顶层（须 degrade）。
- [ ] 禁止 pathname 假成功；禁止无 profile 时展示「已保存」。
- [ ] 禁止 `windows_direct_path_non_cas` 改名为 strict / cas / descriptor-equivalent。
- [ ] 禁止静默替换 POSIX memory 语义（Windows 弱 profile 须分 consumer 迁移）。
- [ ] 禁止弱于 P8 已用检查（workspace 外路径、symlink-as-directory 穿越）。
- [ ] 禁止声称与 POSIX memory 相同的 crash/power-loss / TOCTOU 边界。
- [ ] 禁止把 descriptor 英文异常直接抛给用户（区分平台降级与模型/网络错误）。
- [ ] 禁止单 PR 同时搬迁 memory + outcome + audit + UI 大爆炸。
- [ ] 禁止复制一套更弱的 resolve（与 windows-direct-path-workspace-write 共享 containment 原语）。
- [ ] 禁止回滚重新引入「聊天因 descriptor 百分百失败」。
- [ ] 禁止 authority_write degrade-to-success（capability class 强制）。
- [ ] 禁止引入默认远程 telemetry。
- [ ] 禁止 chat 路径让 NativeContainedDurableReplaceUnavailableError 逃出 turn。
- [ ] 禁止权威写路径静默假成功（迁移每步独立 PR）。

### B0127. ADR-0127 MCP design gate

- [ ] 禁止无门槛的「先接上再说」MCP PR（须过 §5 实现门槛）。
- [ ] 禁止把「用户说接了也不适配」当安全边界；禁止无审批、无 lattice 的 YOLO MCP。
- [x]（已修订 2026-08-18，见对应文档） 仍禁止 MCP marketplace 作为默认产品面（按当时口径；后经 0132/0140/0141 收窄）。
- [ ] 禁止 MCP-exposed tool 静默当 read（未知映射 fail-closed 或强制 privileged + 交互审批）。
- [ ] 禁止 MCP 绕过 TeachingTurnCoordinator / ledger / expectedRevision；MCP 输出不是 teaching 真相。
- [x]（已修订 2026-08-18，见对应文档） 禁止 ExtensionManifest mcpServers auto-connect（仅可作导入草稿，未启用禁止连接）。
- [ ] 禁止工作区不可信配置静默注册 MCP server（须用户确认并记入 user-scoped 配置）。
- [ ] 禁止 MCP 写 ledger/outcome；结果仅作 tool 证据投影。
- [ ] 禁止把 provider API key 注入 MCP server 环境变量默认集。
- [ ] 禁止可达网络的 tool 标为纯 read（除非实现 ADR 证明无副作用且仍按 untrusted external content）。
- [ ] 禁止「MCP 自己说路径安全」（写工作区必须走 workspace path containment）。
- [ ] 禁止静默截断单 turn 可注入的 MCP tool schema（超限 fail-closed 或分页）。
- [ ] 禁止 MCP tool 结果直接 commit Learning record / outcome。
- [ ] 禁止用户 MCP 配置明文含 token（须走 secret storage，不得进 workspace 明文）。
- [ ] 禁止 feature id：mcp_marketplace、yolo、danger_full_access、code_mode 作为开放默认。
- [ ] 禁止 UI 出现 YOLO / always-approve 文案。
- [ ] 禁止合并启用产品路径的 MCP client（任一项门槛未完成前）。
- [ ] 禁止塞进 teaching-turn-coordinator 巨石而不 peel。
- [ ] 禁止以「产品地板绝对禁止任意 MCP」拒绝设计/实现 ADR 的起草。
- [ ] 仍禁止 marketplace、YOLO、settlement 旁路与默认自动连接（按当时口径；自动连接后经 0141 放宽）。

### B0128. ADR-0128 MCP implementation（v1）

- [ ] 禁止 MCP 与 settlement / ledger / expectedRevision / toolsReplayed:false 旁路（正交）。
- [ ] 禁止把 client 逻辑塞进 teaching-turn-coordinator / learning-session-ledger / 巨型 registry 而不 peel。
- [x]（已修订 2026-08-18，见对应文档） 禁止 workspace 作为启用权威（仅可作导入草稿建议，须用户确认）。
- [ ] 禁止通过 config 注入 shell 元字符解释层（spawn(command, args, { shell: false })）。
- [ ] 禁止 workspace-relative 静默扩权（cwd 允许 null 或绝对路径）。
- [ ] 禁止 env/headers 含明文密钥键（/api[_-]?key|token|secret|password|authorization/i 必须走 secret refs）。
- [ ] 禁止日志记录 env 明文、header 明文、完整 tool arguments 中的疑似密钥；路径家目录脱敏。
- [ ] 禁止默认注入（硬禁止默认注入）。
- [ ] 禁止与内建教学工具同名抢注（冲突拒绝注册并记 doctor warning）。
- [ ] 禁止 run 中静默扩展 tool 表面（baseline 建立后不得新增/改 parameters schema；连接掉线不得热插拔）。
- [ ] 禁止因「临时」再裁掉 MCP、web、workspace read 等已对 teaching 开放的能力。
- [ ] 禁止借「临时」静默扩大或缩小 MCP（写 lesson 路径拆出须另开 ADR）。
- [ ] 禁止额外收窄 MCP 集（合法收窄仅因排除 generate_lesson）。
- [ ] 禁止 full_access 静默当 read（无 override 默认 privileged 走交互门）。
- [ ] 禁止 MCP handler 自行写盘绕过 write_workspace_file（Phase A 硬规则：MCP handler 不执行工作区写）。
- [ ] 禁止把映射表持久化为可被 workspace 篡改的权威。
- [ ] 禁止 workspace_write / privileged 被 full_access 静默跳过（server 启用 ≠ tool 调用授权）。
- [ ] 禁止 renderer 获得 secret 明文。
- [ ] 禁止因 MCP 把 toolsReplayed 改为 true。
- [ ] 禁止 support-bundle / doctor 导出 command/args 明文与 secret。
- [ ] 不开放 marketplace / 远程目录（按当时口径；后经 0132/0141 收窄）。
- [ ] 仍禁止 marketplace、自动连接与 settlement 旁路（按当时口径；自动连接后经 0141 放宽）。

### B0129. ADR-0129 study planning renderer cutover

- [ ] 禁止 canonical 失败时把 localStorage 升格为教学或规划长期真相源（仅 UI 可用性）。
- [ ] 禁止 TimerSession / study-space analytics 替代教学 LearningSession / settlement。
- [ ] 禁止自动擦除 localStorage 权威 key（仅用户确认或 ≥30 天备份窗口后 UX）。
- [ ] 禁止静默 migrate（Banner UX 须确认）。
- [ ] 禁止静默 finish / 计入专注（pagehide 仅 best-effort durable pin，永不静默 finish）。
- [ ] 禁止 main 写 DurableStudyPlanningStore / 成为 TimerSession sole-writer（pin 走 renderer dual-write + CAS）。
- [ ] 禁止静默 focus credit（长间隙 needs_reconcile + ReconcileSheet）。
- [ ] 禁止因 unit 矩阵宣称 §18 bullet 8 全关（完整 sleep/crash e2e 矩阵仍 residual）。
- [ ] 禁止 renderer 直接写 snapshot.json。
- [ ] 禁止静默以 V1 覆盖 canonical（dual-write 窗口须 CAS retry / 乐观 UI 诚实）。
- [ ] 禁止仅写 localStorage 后靠 hydrate 偶然覆盖的「假 sole-authority」（新写路径必须 dual-write 或 pure canonical）。
- [ ] 禁止重新启用 V1 twin 为并行 fact 权威（analytics 关闭以 TimerSession 为 segment-close 源）。
- [ ] 禁止静默放宽 fail-closed / 120 min reconcile（扩展 power 面须独立 PR + 更新 ADR）。
- [ ] 禁止为「一次对齐」同时胀大 useStudySession / WorkbenchPomodoro / StudyTaskSchedulePage。
- [ ] 禁止宣称 §18 完成；禁止超出 ADR-0117 再冻新路径。

### B0130. ADR-0130 study planning Phase 7 + residual

- [ ] 禁止仅因本 ADR 存在而勾选产品完成（须各自 PR / 测试 / cutover 证据）。
- [ ] 禁止仅凭路线图关闭或 pure API 存在而宣称 §18 11 条产品完成。
- [ ] 禁止在 V1 sole-authority 终态、sleep/crash matrix、STC-702/703 polish 等 residual 关闭前宣称 sole-authority 终态或 §18 完成。
- [ ] 禁止 roadmap completion 与 §18 product-evidence state 互换。
- [ ] 禁止仅用 clockMode==='countup' && !continuousTarget 推断 open（continuousMode）。
- [ ] 首切片禁止任意拖拽自由编辑器、自由图 / 树状状态机、无界组合爆炸的可视化工作流。
- [ ] 禁止静默改写内置 classic_25_5 / deep_50_10 / continuous 语义（自定义节奏是 kind/sequence 扩展）。
- [ ] 禁止静默生成 3 分钟番茄式退化（fail-closed：空序列、未知 kind、非正时长、非法相邻规则 → 拒绝）。
- [ ] 禁止 freeform drag 编辑器；pure sequence / partial ordered editor ≠ custom rhythm 产品完成。
- [ ] 禁止静默复制 Task（拖拽/展开不得静默克隆任务实体；1 Task : N ScheduleBlock）。
- [ ] 禁止改写已结束会话的时长、归属 ID 或 planSnapshot（历史 TimerSession 引用不可变）。
- [ ] 禁止自动展开覆盖用户 locked 块；禁止静默移动锁定块（重叠 fail-closed 出警告/冲突列表）。
- [ ] 禁止用实际超时反向改 recurrence 规则或历史块（计划 vs 实际分离）。
- [ ] 禁止默认 auto-expand / 静默任务克隆（pure expand / series edit partial ≠ 完整重复日历产品）。
- [ ] 禁止仅存模糊本地字符串当唯一权威（权威时间为 epoch ms + 显式 zone id/offset）。
- [ ] 禁止静默吞掉 1h 或生成非法段（ambiguous/nonexistent 本地时间 fail-closed 或显式消歧）。
- [ ] 禁止静默 whole-week rezone（STC-704 旅行设置 sheet / rezone / defaultTimeZone 已移除，禁止 re-open）。
- [ ] 禁止因 thrash pack / 信号桥 / unit 宣称 bullet 8 全关 / §18 关闭。
- [ ] 禁止静默自动错开（STC-707 opt-in product-signal；静默默认 banned）。
- [ ] 禁止删除「§18 still open」类事实而不提供关闭证据。
- [ ] 禁止把 STC-704 / allocation-from-plan 移除误标为 §18 关闭；禁止 re-open 为 product residual。
- [ ] 禁止仅见 pure 模块或本 ADR 就写「Phase 7 / §18 done」。
- [ ] 禁止继续胀大 WorkbenchPomodoro / useStudySession / StudyTaskSchedulePage（ADR-0075）。

### B0131. ADR-0131 pathname durable IO

- [ ] 禁止宣称 CAS / power-loss / OS sandbox 产品面；native descriptor 非默认。
- [ ] 禁止引入 default shell / YOLO / danger-full-access / MCP marketplace。
- [ ] 禁止拆 TeachingTurnCoordinator / settlement sole-writer / expectedRevision。
- [ ] 禁止 Codex default shell / 任意代码执行产品路径（按当时口径；后经 0152/0153 开放注册 shell）。
- [ ] 禁止 YOLO / DangerFullAccess / always-approve 标签。
- [ ] 禁止 MCP marketplace / 未 opt-in MCP 默认连接（用户可配置 MCP 另走 0127/0128）。
- [ ] 禁止宣称 OS sandbox 产品面（bwrap / seatbelt / RestrictedToken）为写盘替代。
- [ ] 禁止把 Windows 较弱写改名为 strict / CAS。
- [ ] 禁止任意绝对路径旁路（须先经 workspace / userData 等可信 root containment）。
- [ ] 禁止据此宣称 power-loss durability 或 CAS（可选 fsync 是 best-effort）。
- [ ] 禁止假成功「已保存」；禁止自动 rollback/delete canonical 后静默重试伪装原子性。
- [ ] 禁止继续暗示 descriptor-strict 为默认（迁移完成后应布尔/删减或诚实 pathname-only 投影）。
- [ ] 禁止借机改 settlement 顺序、manifest authority 或跨文件 transaction 宣称（写盘原语替换仅 I/O 实现）。
- [ ] 禁止命名含 strict/CAS（防读者误以为 pathname = CAS）。

### B0132. ADR-0132 MCP parity + trust lifecycle

- [ ] 禁止用隐藏 flag、未登记 IPC 或产品外脚本绕过旧绝对禁止（须显式收窄/取代）。
- [ ] 禁止把「配置存在」混同为「可执行外部副作用」。
- [ ] 禁止 install 用 YOLO 语义跳过审批。
- [ ] 禁止 MCP bridge 绕过内建 write_workspace_file 写 canonical teaching data。
- [ ] 禁止放宽 expectedRevision；fork/replay 仍默认 toolsReplayed:false。
- [ ] 禁止 secrets、OAuth tokens、headers、env、token-bearing URL 进 renderer、日志、Doctor 或 support bundle。
- [ ] 禁止因 marketplace、OAuth、sync 或诊断引入默认 remote telemetry。
- [ ] 禁止 MCP handler import ledger writer/outcome committer 或取得 canonical teaching writer authority。
- [ ] 禁止未完成阶段时声称目标能力已上线（迁移须预览、可选、可回退、保留原文件 + redacted report）。
- [ ] 禁止 server failure 阻塞本地教学 canonical read/write 或 settlement。
- [ ] 禁止 marketplace / 插件活动成为默认 phone-home telemetry。
- [ ] 禁止以单一「大 PR」混合所有 phase（每 phase 独立实现 ADR）。

### B0133. ADR-0133 MCP runtime reliability（Phase A）

- [ ] 禁止 public projection / Doctor / support bundle / renderer 含 raw stderr、URL credentials、headers、env、command token、secret ref/value 或 raw SDK error。
- [ ] 禁止用户未操作时启动无限或隐式连接循环（后台 retry 默认关）。
- [ ] 禁止把「测试连接」暗中实现为无限重连。
- [ ] 禁止 convenience field 偷渡本 phase 外能力（annotations/effect trust、result artifacts、trace payload）。

### B0134. ADR-0134 MCP result safety（Phase B）

- [ ] 禁止 MCP 结果成为 teaching evidence / outcome。
- [ ] 禁止将本 phase 之外既有 failures 归因于本 ADR 实现（不得把既有阻塞算作本 phase 回归）。

### B0135. ADR-0135 MCP OAuth PKCE（Phase C）

- [ ] 禁止 stdio 进入 OAuth flow（仅 http/sse 的 authorization-code + PKCE）。
- [ ] 禁止默认 auto-authorize、后台 token discovery、remote telemetry、renderer token/URL/code/state exposure、通用 shell 或 arbitrary callback execution。
- [ ] 禁止 pending record 持久化或进入 IPC/Doctor/log/support bundle。
- [ ] 禁止 renderer 得到 URL、verifier、state、auth code 或 token（仅 secret-free lifecycle state）。
- [ ] 禁止 response 返回 authorization URL、code、state、PKCE verifier、access token、refresh token、endpoint headers 或路径。
- [ ] 禁止自动授权（仅明确用户按钮 Authorize / Reauthorize / Revoke）。

### B0136. ADR-0136 MCP config import/export（Phase D）

- [ ] 禁止导入直接写盘（无「import apply」IPC）。
- [ ] 禁止 renderer 回读明文（secret 形 key 走 secretChanges + safeStorage）。
- [ ] 禁止导出含 OAuth access/refresh token、PKCE verifier、authorization code、deep-link 全文。
- [ ] 禁止冲突静默覆盖 local user config（须用户确认）。
- [ ] 禁止本 phase 引入网络 sync（仅本地文件 / 粘贴 + 可选 envelope）。

### B0137. ADR-0137 MCP multi-source + auto-connect（Phase E）

- [ ] 禁止 workspace / env / CLI 层就地改写源文件（只读输入）。
- [ ] 禁止 auto-connect 做 tools/call（只做 transport initialize + tools/list 发现）。
- [ ] 禁止 artifact 写入作为 auto-connect 副作用扩展。
- [ ] 禁止 secret / OAuth token 进 renderer / logs / Doctor（workspace 层 ephemeral secret 仅 main 内存）。
- [ ] 禁止 app 冷启动无条件后台循环、无 marketplace install（按当时口径；后经 0141 允许受控冷启动）。

### B0138. ADR-0138 MCP workspace-root injection（Phase F）

- [ ] 禁止非 stdio transport 注入（runtime 永不注入非 stdio）。
- [ ] 禁止读取或拼接 secret env / headers。
- [ ] 禁止 http/sse 注入。
- [ ] 禁止绕过 effect / settlement（默认 off；显式 granted 才追加一次规范化 root）。

### B0139. ADR-0139 MCP plugin lifecycle（Phase G）

- [ ] 无远程下载（仅声明解析、namespace id、allowlist 模板、trust/revoke/cleanup foundation）。

### B0140. ADR-0140 MCP marketplace local catalog（Phase H）

- [ ] 禁止 store JSON 含 OAuth token、env secret、authorization header。
- [ ] 禁止默认调用 fetchCatalog（可选注入缝，默认永不调用）。
- [ ] Settings 无市场 UI（ADR-0142）；远程 catalog 产品页非当前 shipping。

### B0141. ADR-0141 MCP 产品体验边界政策

- [ ] 禁止 secret/token 进 renderer/Doctor/bundle（硬安全保留）。
- [ ] 禁止 MCP 成为 LearningSession / Evidence / Outcome settlement authority。
- [ ] 禁止 MCP handler import ledger writer / outcome committer。
- [ ] 禁止用 MCP 旁路 write_workspace_file 写 canonical teaching data。
- [ ] 禁止因 marketplace 自动开启默认远程产品 telemetry（phone-home 用量分析）。
- [ ] 禁止提供「跳过全部 effect/permission」的全局 YOLO 产品模式。
- [ ] 禁止引入名为 YOLO / always-approve 的产品开关。
- [ ] 禁止文档与产品文案再宣称下列为永久禁止：冷启动/workspace 自动连接、远程 marketplace 目录、安装后自动连接、McpSync 客户端、Settings marketplace/来源表 UI、annotations 辅助审批与可选 effect 建议（均已放宽）。
- [ ] 禁止冲突策略静默覆盖本地 user 配置（McpSync 提示用户选择）。

### B0142. ADR-0142 MCP 产品面（Settings only）

- [x]（已修订 2026-08-18，见 ADR-0142 §6） 禁止把 feature stage 当作授权绕过 effect/approval（mcp-marketplace 元数据须写清无 Settings UI）。
- [x]（已修订 2026-08-18，见 ADR-0142 §6） 禁止 secret/token 进 public DTO / Doctor / bundle；OAuth token main-only；MCP 非 teaching evidence；settlement sole-writer。
- [x]（已修订 2026-08-18，见 ADR-0142 §6） 禁止 YOLO 标签。
- [x]（已修订 2026-08-18，见 ADR-0142 §6） 禁止交付 Settings marketplace 子页 / 安装网格 / 默认远程 catalog 产品页 / 全量 Zcode Settings parity UI —— **收窄为「当前不交付的设计 non-claim，非永久禁止」**；开放路径与前置条件见 ADR-0142 §6。硬安全不变量（secret/settlement/effect/无 YOLO）保持。

### B0143. ADR-0143 context file-touch ledger

- [ ] 禁止把失败 / 被拒 / 未完成工具的 path 记为 touched。
- [ ] 禁止合并时把 modified 降级为仅 read（modified 粘性）。
- [ ] 禁止把账本当「已结算证据」教给模型（注入为结构化 data，非指令性 system 文案）。
- [ ] 禁止账本进入 summarizer payload（压缩摘要不得用账本替换 transcript 权威）。
- [ ] 禁止把 Shell 输出、Glob 展开、MCP 多路径伪解析当作账本全集。
- [ ] 禁止 YOLO / always-approve；禁止账本绕过 effect lattice 或审批。
- [ ] 禁止将账本写入 outcome / Learning record 作为 settlement 输入。
- [ ] 禁止账本取代 LearningSessionLedger / 成为 teaching evidence。

### B0144. ADR-0144 ask authoritative deadline

- [ ] 禁止有效已有 deadline 被替换（单调权威）。
- [ ] 禁止超时自动放行 workspace_write / external_write / privileged / turn-review。

### B0145. ADR-0145 compaction pressure / single-flight

- [x]（已修订 2026-08-18，见对应文档） 禁止默认 durable rewrite 会话正文；禁止以累计 run-token 作为终止理由。
- [ ] 禁止并行两路改写同一投影（join 复用首次结果）。
- [ ] 禁止绕过 fail-closed（不足缩减 / summarize 失败 cooldown 兼容）。
- [ ] 禁止无界死循环连压（须最大 ladder 档与停止条件）。
- [ ] 禁止 ladder 默认打开 durable rewrite session JSON body。
- [ ] 禁止把 ledger 当可丢弃「指令块」截断半路径（预算丢弃须整项 drop）。
- [ ] 禁止 product autoDrain: true、fork toolsReplayed: true。
- [ ] 禁止以累计 token 使压缩停机（仅用户取消或不可恢复错误 no-op）。

### B0146. ADR-0146 fuzzy edit workspace file

- [ ] 禁止用 Shell / apply_patch 作为本编辑工具的替代产品路径。
- [ ] 禁止多命中 / 零命中静默写错位置（fail-closed）。
- [ ] 禁止 YOLO / always-approve 标签（三态审批）。
- [ ] 禁止 journal 失败静默跳过 durable 路径既有失败语义。
- [ ] 禁止 ShellTool、OS sandbox 产品声明、apply_patch / 任意 diff 应用为产品路径。
- [ ] 禁止用 fuzzy 匹配绕过 path 围栏、write-policy 或审批。
- [ ] 禁止把 edit 结果当 teaching evidence / settlement 输入。

### B0147. ADR-0147 MCP id-level ops

- [ ] 禁止无 id 整对象 clobber（字段级纯 merge）。
- [ ] 禁止仅依赖 agent turn 开始时的整份 MCP 快照作为「设置权威」写回。
- [ ] 禁止 secret / token 进 public DTO、Doctor、support-bundle 明文。
- [ ] 禁止 YOLO 标签（MCP tools 仍进 effect lattice + approval）。
- [ ] 禁止无默认 remote catalog phone-home；禁止 product autoDrain: true；禁止 fork toolsReplayed: true。

### B0148. ADR-0148 secret boundary sweep

- [ ] 禁止 secret presence 之外返回原值（presence 检查永不返回原值）。
- [ ] 禁止默认远程 telemetry。

### B0149. ADR-0149 provider custom headers

- [ ] 禁止覆盖保留认证头（Authorization、x-api-key 等闭集）。
- [ ] 禁止 CR/LF（名称 token 规则、长度上限、非法项 drop）。
- [ ] 禁止用户覆盖 User-Agent（固定产品身份）。
- [ ] 禁止 CLI 身份伪装头包。
- [ ] 禁止日志对 secret-looking 值不脱敏。

### B0150. ADR-0150 skills install stage-then-swap

- [ ] 禁止开放无校验 skill marketplace 或任意远程包安装。
- [ ] 禁止 Shell / YOLO / always-approve 安装旁路。
- [ ] 禁止把 .staging 或半成品目录暴露为 skill catalog / invoked skill 引用。

### B0151. ADR-0151 teaching kernel + skill orchestration

- [ ] 禁止 personal 同 id shadow runtime kernel（kernel 加载不要求 personal install）。
- [ ] 禁止 verifier 成功、模型自述或取消制造完成 stage（gate 只消费 allow-listed canonical facts）。
- [ ] 禁止读取或推导累计 run token 配额（budget pressure 只从当前 provider pressure / 能力数 / 局部工作量推导 soft signal）。
- [ ] Evidence 与 settlement 红线：kernel 不是 Evidence / Outcome / settlement writer。

### B0152. ADR-0152 workspace shell + Codex 审批

- [ ] 禁止引入 YOLO / always-approve UI 标签；禁止声明 OS 级 sandbox 产品完备性；禁止改变 settlement sole-writer / Evidence 权威。
- [ ] 禁止把 full_access 标为 YOLO / DangerFullAccess / always-approve。
- [ ] 禁止绝对路径逃逸（cwd 须 workspace 相对路径 + isPathInsideRoot）。
- [ ] 禁止无审批 / YOLO 标签的通用 shell（允许 run_workspace_command / shell 作为注册工具）。
- [ ] 禁止引入 argv prefix_rule 持久 execpolicy 语言（ADR-0121 明确不借项）。
- [ ] 禁止「永不 YOLO」（UI 三态文案）。

### B0153. ADR-0153 codex 双轴 sandbox + agent shell

- [ ] 禁止 UI/产品标签 YOLO / DangerFullAccess / always-approve（wire 诊断可记录 Codex 字面）。
- [ ] 禁止 OpenSandbox/Cube 作默认 shell 后端、自创「等价 Docker」话术、把 policy_fence 标成 OS 完备隔离。
- [ ] 禁止并入：OpenSandbox/Cube（L4 远程）、Grok L3 主进程 enforce、整包 pi/Grok shell 产品替换。
- [ ] 禁止 vendoring 完整 codex-rs / 引入 Docker/OpenSandbox/Cube 为默认 shell 后端。
- [ ] 禁止 tools.enabled 总开关；禁止恢复总开关。
- [ ] 禁止虚假 Docker/VM 完备宣称（Windows helper 可选延期）。

### B0154. ADR-0154 spaced review scheduler

- [ ] 禁止调度器成为第二权威：不写 LearningSessionLedger、不创建/修改 outcome、不改 record；与 ledger 冲突以重算为准。
- [ ] 禁止调度文件作为结算输入。
- [ ] 禁止 review 携带 item payload（仅计数 dueCount）。

### B0155. ADR-0155 fill quiz settlement（sidecar v2）

- [ ] 禁止学习者明文进入证据（fill-<sha256> 归一化身份）。
- [ ] 禁止 `['submit']` 之类垃圾证据升级为 verified（判 malformed）。
- [ ] 禁止放宽 ADR-0016 静态文法；HTML sidecar 变体 fill 仍 unsupported。

### B0156. ADR-0156 skill orchestration continuity

- [ ] 禁止推断 verifier 结果；禁止把任何 gate 通过当 learner Evidence。
- [ ] 禁止 save 失败影响教学轮（读写全 fail-soft）。
- [ ] 禁止编排状态成为结算输入；Evidence 不等式全套保持（ADR-0151 §4）。
- [ ] 禁止 artifact 事实派生引入 watcher、索引库或 FTS（只读扫描，有界、拒绝 symlink）。
- [ ] 禁止正文进入 plan（只有枚举/计数/token）。

### B0157. ADR-0157 outcome strength / consolidation

- [ ] 禁止投影成为第二权威 / 结算输入（RetentionProjection 可重建，与 ledger 冲突以重算为准）。
- [ ] 禁止从 provisional 单独推出 consolidated。
- [ ] 禁止因复验失败改写既有 record（只影响派生强度与复习排期）。
- [ ] 禁止原始 record 改写（判据变更以 evaluatorVersion 递增可追溯）。

### B0158. ADR-0158 model-assisted grading candidate

- [ ] 禁止评分 candidate 单独产生 established（committer 确定性核心与 sole-writer 分毫不动）。
- [ ] 禁止无默认远程 telemetry；禁止触碰同意门控 memory；禁止引入 FTS / 向量库；禁止 rubric 评分外发。
- [ ] 禁止 candidate 内嵌学习者原文正文（仅 digest 引用）。
- [ ] 禁止 rubric 条目被解释为 active content。

### B0159. ADR-0159 learning objectives / mastery projection

- [ ] 禁止投影成为结算输入或第二权威（可重建、与 ledger 冲突以重算为准）。
- [ ] 禁止由投影反写 ledger（MasteryProjection 只能作 planner 输入事实）。

### B0160. ADR-0160 teaching turn behavior contract

- [ ] 禁止进默认 CI、禁止烧真实 API key（本地教学回归命令守既有红线）。
- [ ] 禁止阻断教学轮 / 引入输出重写器（只软纠偏）。
- [ ] 禁止无默认远程 telemetry；禁止触碰同意门控记忆；禁止引入 FTS / 向量库。

### B0161. ADR-0161 today learning queue

- [ ] 禁止队列文件成为任何结算输入（零写权）。
- [ ] 禁止写 ledger / outcome / record / Study task；禁止引入第二状态机（settlement sole-writer 与 evidence-gating 不变）。
- [ ] 禁止无默认远程 telemetry；禁止触碰同意门控记忆；禁止引入 FTS / 向量库。
- [ ] Pet 明确不纳入 TodayQueue（不解决该产品断点）。

### B0162. ADR-0162 local learning analytics

- [ ] 禁止远程 telemetry（一切本地、默认零上报）；禁止全站对比（无「与其他用户比较」数据通路）。
- [ ] 禁止把 analytics SQLite 扩成 FTS / 用户可见搜索语料；禁止引入向量库；禁止触碰同意门控记忆。
- [ ] 禁止报告含 learner 正文、prompt 正文或 provider payload。
- [ ] 禁止 allow-list 之外字段出现在输出。
- [ ] 禁止指标反向成为制定下一步教学计划的 authority（ADR-0167）。

### B0163. ADR-0163 capability selection + plan preview

- [ ] 禁止 preview 写入或推进 stage cursor（永不写入或推进）。
- [ ] 禁止 preview 含 prompt/body/objective/path/secret/learner Evidence（counts-only）。

### B0164. ADR-0164 unified teaching chain + skill admission

- [ ] 禁止 personal/custom/unregistered skill 默认拥有正式 teaching-authority slot；不得成为 Kernel、primary strategy 或 settlement writer。
- [ ] 禁止 renderer 复制 registry 或从 manifest / source / catalog 自行推断 teaching authority。
- [ ] 禁止 personal 同 id shadow kernel（kernel 缺失/损坏 fail-closed）。

### B0165. ADR-0165 teaching capability trigger surface deferral

- [ ] 禁止将已下线触发按钮 / chip 恢复为常驻展示面（picker/planner/IPC/settlement 不变；slash 入口仍可用）。

### B0167. ADR-0167 teaching authority + syncable user state

- [ ] 禁止把「教学真相源」扩大解释为任何用户数据不得多端同步。
- [ ] 禁止同步归档、SQLite、analytics、agent run、UI 缓存、服务端副本覆盖、伪造或成为 AI 制定教学计划的替代依据。
- [ ] 禁止静默上传、默认 phone-home、收集原始计时或教学事件流（不禁止用户显式开启的同步）。
- [ ] 禁止用「teaching authority / local-wins / 本地优先」术语泛化禁止用户产品状态同步。

### B0168. ADR-0168 pi-compatible explicit skill invocation

- [ ] 禁止超限截断 / 调用 LLM / 执行工具或 settlement（48k 硬上限 fail-closed）。
- [ ] 禁止以累计 agent-run token 预算阻断已验证 invocation（运行时迁移见 ADR-0171）。
- [ ] 禁止引入自动 discovery（disable-model-invocation 只影响未来自动 discovery）。

### B0169. ADR-0169 web remote control

- [ ] 禁止 YOLO / always-approve（remote tool 仍走 effect lattice + TOOL_CONTRACT + 三态审批）。
- [ ] 禁止默认依赖 Zcode 云（永不默认填充 zcode.z.ai）。
- [ ] 禁止手机端「全权」绕过审批（Control RPC allowlist；工具走 pending + answer）。
- [ ] 禁止把 pairing secret 放进 public DTO。

### B0170. ADR-0170 agent conversation host serialization

- [ ] 禁止删除、放宽、默认省略或由 renderer 伪造 expectedRevision / expectedBranchRevision（CAS 由主进程验证）。
- [ ] 严禁 latest-revision force write（不得把过期请求改写为刚读到的 revision 后未经验证直接保存）。
- [ ] 禁止 queue 直接写 Evidence、Outcome、LearningSession 或 teaching plan（host 仍是 settlement 唯一写路径）。
- [ ] 禁止只按 conversationId 串行化；禁止把 mode / 标题 / 文本 / branch revision / 空字符串当 identity。
- [ ] 禁止将不同 pending lane 的队列仅因最后得到同一 conversation 或相同内容而合并。
- [ ] 禁止删除、合并或改变稳定语义字段的含义。
- [ ] 禁止 canonical target 缺 conversationId；禁止 pending target 携带 conversationId。
- [ ] 禁止 clientRequestId 包含正文、secret 或工具结果。
- [ ] 禁止 active identity 不匹配时改投另一 turn 或静默转 follow-up。
- [ ] 禁止显示原始 revision-conflict 文案（refresh_required）；rejected 不是伪成功。
- [ ] 禁止用旧 cancel 取消后来开始的 turn、保留旧队列或清理其他 lane。
- [ ] 禁止 queue cap 配置为无限（32 硬上限，第 33 个必须 rejected/queue_full，不静默丢弃）。
- [ ] 禁止重复 submission/cancel 重复启动、入队、steer、保存或取消（duplicate receipt）。
- [ ] 禁止 receipt 写入 canonical conversation、进入 SQLite/sync 或承诺跨窗口永久幂等。
- [ ] 禁止 public DTO、日志、Doctor、support bundle 泄露对话正文、secret 或工具敏感结果。
- [ ] 禁止 lane 吞错、伪装成功或永久卡死。
- [ ] 禁止 lane 旁路 parent-turn stage、assistant confirmation、staged child transcript promotion、audit、TeachingTurnCoordinator sole-writer。
- [ ] 禁止 renderer local FIFO 在 completion/cancel 后自行 drain 并再调用 start（只转发/展示）。
- [ ] 禁止借机重写 AgentRun 状态机、EventBus/timeline 或 LearningSession ledger。
- [ ] 禁止通过实现细节暗中扩展（持久化 queue / 跨进程排他 / 跨设备同步 / crash replay / 不同 cap / 取消后保留队列须另开 ADR）。
- [ ] 禁止未来 remote chat / bot / RPC / tool-approval 入口建立独立可执行 queue（须复用 shared gateway / per-conversation lane）。

### B0171. ADR-0171 continuous runs + context governance

- [ ] 禁止写入或伪造 LearningSession Evidence、Outcome、等级、XP 或 settlement 成功事实。
- [ ] 禁止跳过取消、审批、effect lattice、路径围栏、expectedRevision 或 settlement sole-writer。
- [ ] 禁止 fork / 恢复 / continuation 绕过原预算、审批或 revision 条件。
- [ ] 禁止将组织策略错误映射为 provider quota、模型能力限制或学习成功。
- [ ] 禁止恢复时自动重放工具。
- [ ] 禁止只显示一个笼统的「budget exceeded」（报告实际触发的最具体来源并保留嵌套审计）。
- [ ] 禁止 logical request 完成后因 compaction / summary / checkpoint / 旧内存自动重放、重发或自动新建 canonical turn。
- [ ] 禁止 context overflow 进入普通 transport retry；禁止因 compaction 内部尝试隐式增加 overflow recovery 次数。
- [ ] 禁止嵌套层级互相伪装（分别记录计数）。
- [ ] 禁止一层重试自动借用另一层额度；禁止 compaction summary retry 使原请求无限重试。
- [ ] 禁止资源边界 / compaction / 恢复绕过 capability policy、工作区信任、路径围栏、effect lattice、approval。
- [ ] 禁止恢复 / 资源边界 / compaction 失败自动重放工具历史、重建外部写入或伪造 settlement。
- [ ] 禁止审批默认自动复用（失效时必须重新请求）。
- [ ] 禁止渲染为「provider token quota exhausted」；禁止视为学习成功或自动生成 durable-success / budget fallback。
- [ ] 禁止以「参考项目完全无预算」作为禁止 run-level 边界的理由。
- [ ] 禁止文档把「旧字段不再作为默认 stop」误写成「系统已无任何资源边界」。
- [ ] 禁止完成、取消、中断、恢复后自动新建 canonical turn、重发 provider 或重放工具。

### B0172. ADR-0172 mind map + AI assist

- [ ] 禁止复制任何第三方导图产品代码、素材、文件格式或交互；禁止把导图变为教学权威；禁止引入第二套 provider 通道。
- [ ] 禁止 AI 对话面提供文件/文件夹选择器；禁止因一次导图请求无差别读取或向 provider 发送整个工作区。
- [ ] 禁止资料正文进入 renderer IPC DTO、导图 canonical 文档、日志或 teaching evidence；资料文本永远不是系统/开发者/执行指令。
- [ ] 禁止恢复旧的显式 source envelope 为该对话面的用户选择流程。
- [ ] 禁止引入重型图形框架或外部导图素材。
- [ ] 禁止引入远程同步、默认 telemetry、FTS 或向量搜索。

### B0173. ADR-0173 mind map schema v2

- [ ] 禁止 last-write-wins（必须 expectedRevision CAS）。
- [ ] 禁止 renderer 绕过 repository 边界直接落盘。
- [ ] 禁止引入默认远程 telemetry、向量搜索或导图对教学事实的写入。
- [ ] 禁止导图成为教学权威（来源锚点只读教学投影）。

---

## C. 其他文档

### C1. docs/ref-ima-comparison/02-ai-model-integration.md

- [ ] 禁止 FTS5 / 向量库做产品搜索面（教学内部可用）。

### C2. docs/ref-ima-comparison/04-security-privacy.md

- [ ] 禁止 YOLO / always-approve 标签。
- [ ] 禁止 secret/token 进 public DTO / Doctor / 支持包（密钥永不外泄）。

### C3. docs/ref-ima-comparison/06-recommendations.md

- [ ] 禁止任何建议降级教学权威、绕过 settlement sole-writer、引入默认遥测或 YOLO 标签。
- [ ] 禁止引入向量检索做产品搜索面。
- [ ] 禁止默认远程遥测；禁止服务端 RAG/向量检索。

---

## 结尾备注

- 统计口径：全文 187 个 md 文档，其中 169 个含中文禁止标记；中文标记行 945（强标记 419）、英文标记行 289。
- 部分 ADR（0015、0032、0047、0048、0072、0139、0166 等）正文无明确禁止条款，故未列出。
- 标注「按当时口径；后经 … 收窄」的条目属于旧文档残留禁令，当前政策以新 ADR 为准（详见 `docs/redline-audit.md` §3）。
- 勾选完成后，可据勾选结果逐条修订源文档。

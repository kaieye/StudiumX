# StudiumX 禁令第三方审核报告（子代理辅助）

> **背景：** 基于 `docs/redline-checklist.md`（778 条禁令）与 `docs/redline-audit.md`，以第三方视角识别「没有必要、反而导致边界过严」的条款。由两个子代理分别从「产品/工程务实」与「安全/教学权威」视角独立审核后综合。
> **日期：** 2026-08-18
> **核心结论：** 778 条禁令中约 90% 合理（保护教学权威 / settlement / secret / memory 门控等）；**约 60–70 条属于「不必要或过严」**，集中在：①已被新 ADR 取代但仍残留的旧措辞（~30 条）；②「本切片未实施」误写成「永久禁止」（~20 条）；③同一禁令在 8–35 份文档重复导致的「最严者生效」叠加效应。

---

## 1. 总评（我的第三视角判断）

把 778 条禁令按「成因」分类，过严/不必要条款的五个成因，按修订成本从低到高：

| 成因 | 数量级 | 是否阻碍实现 | 修订成本 |
| --- | --- | --- | --- |
| ① 时序残留：旧 ADR 未随新 ADR 更新（MCP marketplace、auto-connect、shell、run 预算等） | ~30 条 | **是（主要来源）** | 低（纯删改旧措辞） |
| ② 切片措辞误写为永久：「本切片不实施/不包含」写成「禁止/永不」 | ~20 条 | 中（未来扩张被拦） | 低 |
| ③ 叠加效应：同一禁令重复 8–35 份文档（YOLO/secret/settlement/FTS/三线大搬家） | 5 个主题 | **是（最严者生效）** | 中（统一指向单一权威） |
| ④ 流程/术语纪律过刚：命名冻结、禁止小进度建 ADR、禁止重建目录、>1000 行须 ADR | ~5–8 条 | 低–中 | 低 |
| ⑤ 防御性过度设计：把体验默认/启发式当硬门（如并行度硬钳、绝对化「永不」） | ~5–10 条 | 低 | 低–中 |

**重要提醒：** 以下「过严」判断均以「不触碰承重墙」为前提。承重墙（教学权威、settlement sole-writer、secret 隔离、无 YOLO、无默认外发、memory 同意门控、领域门禁）一旦放宽会造成真实事故，**不在放宽范围内**。

---

## 2. 子代理 A：产品/工程务实视角（结论摘要）

> 完整报告见下方 §5。关键结论：

**A 档「明确可删除（无损失）」17 条**，全部是已被新 ADR 取代的旧措辞，代表：
- CONTRIBUTING.md / README.md 中「禁止默认开启 workspace shell」→ 与 ADR-0153（workspaceShell 默认开）矛盾，应删，仅留 FTS 部分。
- ADR-0127/0128/0126/0131/0046/0060/0096 中「禁止 MCP marketplace / auto-connect / 冷启动连接 / install 不得 connect / workspace 不得作配置来源」→ 均被 0132/0140/0141 取代，应删或改指针。
- ADR-0057/0145 中「禁止以累计 run-token 终止」→ 被 ADR-0171 取代，应指向 0171。

**B 档「可放宽（需改措辞/加例外）」15 条**，代表：
- 「禁止为小进度建 ADR」「禁止重建 docs/improvements」→ 改为「不建议/建议」。
- ADR-0075「>1000 行须 ADR」→ 改为「须 PR 说明（ADR 推荐）」。
- todolist §8 的脏工作区禁令 → 缩小范围为特定路径或标注临时约束。
- ADR-0130「禁止自由拖拽编辑器」→ 改为「首切片不包含，后续可独立 ADR」。
- ADR-0142「禁止交付 Settings marketplace」→ 改为「当前 shipping 范围外，修订本 ADR 即可开放」。

**C 档「建议保留但可澄清」10 条**，代表：
- AGENTS.md FTS 禁令 → 澄清「产品搜索面禁止；教学内部检索可用；重开走 DB-P2-2」。
- YOLO / Secret / Settlement 三主题 → 各在单一权威文档定义一次，其余指针化（消除叠加）。
- 「禁止推倒 EventBus/AgentRun/Ledger」→ 澄清为「禁止未新建 ADR 前提下重写」（与 by-touch peel 不冲突）。
- ADR-0170「32 队列上限」→ 澄清为当前设计值非永久不变量。

---

## 3. 子代理 B（安全/教学权威视角）：结论摘要

> 原 B 两次失败后，以小范围重试成功。核心：

**承重墙绝不能动（12 条）**：教学权威唯一真相源；settlement sole-writer + expectedRevision + toolsReplayed:false；不重写 AgentRun 状态机/EventBus/LearningSessionLedger；secret 永不进 renderer/Doctor/bundle/日志；YOLO/always-approve/danger-full-access/code_mode/jiti 全权限全仓禁止；无默认 remote telemetry；memory 同意门控；默认 CI 不烧真实 API key；领域门禁不被覆盖率/泛型 CI 替换；DB-P2-3 won't do；模块按触达 peel 不拆 settlement。

**过度保守可放宽（11 条）**：MCP 旧禁令（默认禁止任意 MCP / marketplace / auto-connect / workspace 配置来源 / 远程 catalog / Settings 市场页）→ 全部按 0127/0132/0140/0141/0142 口径改写；workspaceShell 默认开；run 级资源上限 → 可加「透明可审计」澄清（0171）；FTS 禁令 → 教学内部可用 + 独立索引 + 新 ADR 重开；autoDrain → 可经独立 queue-sync ADR 重新评估；模块尺寸 → 可加历史模块 1000 行例外说明。

---

## 4. 综合：可直接决策的「先动 Top 10」与「绝不能动 Top 10」

### ✅ 先动（修订收益最大、不碰承重墙）

| # | 动作 | 涉及文档 | 说明 |
| --- | --- | --- | --- |
| 1 | 删「禁止默认开启 workspace shell」旧措辞 | CONTRIBUTING.md、README.md | 与 ADR-0153 直接矛盾；shell 仍受双轴审批 |
| 2 | 删 ADR-0127/0128 的 marketplace / auto-connect 旧禁令 | 0127、0128 | 已被 0141 取代；MCP 工作主参考文档 |
| 3 | ADR-0057/0145 累计 token 禁令改为指向 0171 | 0057、0145 | run 级资源边界不再被文档拦 |
| 4 | 澄清 AGENTS.md FTS 禁令（产品面禁/内部可用/DB-P2-2 重开） | AGENTS.md | 一条措辞解锁内部词法检索 |
| 5 | 删「workspace 不得作 MCP 配置来源」「install 不得 connect」 | 0127、0128 | 0141 的核心放宽 |
| 6 | C-4P6/P8/P9「禁止扩张」15 处去重 | 0004、0035、0020、README | 保留权威声明，其余指针化 |
| 7 | YOLO / Secret / Settlement 三主题统一单一权威定义 | AGENTS.md、SECURITY.md、ADR-0023 | 消除「最严者生效」叠加 |
| 8 | ADR-0075「>1000 行须 ADR」改为「须 PR 说明」 | 0075 | 减少官僚化 |
| 9 | README「禁止为小进度建 ADR」「禁止重建 backlog」改为「不建议」 | docs/adr/README.md | 恢复灵活性 |
| 10 | ADR-0142「禁止交付 Settings marketplace」改为「当前 shipping 外」 | 0142 | 为未来 UI 迭代留路 |

### 🚫 绝不能动（承重墙变体，误删会出事故）

- 教学权威：文件 / LearningSession ledger 唯一真相源，SQLite/MCP/usage/同步副本不得反写。
- Settlement sole-writer：host 唯一写路径；`expectedRevision` 不得放宽/伪造；fork `toolsReplayed:false`。
- Secret 隔离：secret/token/env 明文永不进 renderer / public DTO / Doctor / support bundle / 日志。
- YOLO / always-approve / danger-full-access / code_mode / jiti 全权限：全仓禁止。
- 无默认 remote telemetry / phone-home；本地 doctor/support 脱敏 + 同意。
- Memory 同意门控：无人批不自动注入；禁止自动 memory / dream / 静默改 learner-profile / 自动 skill。
- 默认 CI 不烧真实模型 API key。
- 领域门禁不被覆盖率/泛型 CI 替换；Blocking CI 窄而硬、不可 path-skip。
- DB-P2-3（教学/会话写权威迁 SQLite）won't do（除非顶层重定位 + 顶层 ADR）。
- 模块巨石仅按触达 peel，禁止三线并行大搬家，peel 不得拆 settlement。

---

## 5. 子代理 A 完整报告（附录）

### 5.1 A 档：明确可删除（无损失）

| # | 位置 | 条目（摘要） | 理由 |
|---|---|---|---|
| A1 | CONTRIBUTING.md | 禁止默认开启 workspace shell / MCP market / SQLite FTS 产品搜索 | workspaceShell 已由 0153 默认开；MCP market 已由 0141 放宽；仅 FTS 仍有效 |
| A2 | README.md | 禁止默认开启工作区 shell | 与 0153 矛盾 |
| A3 | ADR-0127 | 仍禁止 MCP marketplace 作为默认产品面 | 已被 0132/0140/0141 收窄 |
| A4 | ADR-0127 | 仍禁止 marketplace、YOLO、settlement 旁路与默认自动连接 | marketplace/自动连接已被 0141 放宽，仅 YOLO/settlement 保留 |
| A5 | ADR-0128 | 不开放 marketplace / 远程目录 | 已被 0132/0141 开放 |
| A6 | ADR-0128 | 仍禁止 marketplace、自动连接与 settlement 旁路 | marketplace/自动连接已放宽 |
| A7 | ADR-0126 | 禁止 MCP marketplace / 默认任意 MCP | 已被 0127/0132/0141 取代 |
| A8 | ADR-0131 | 禁止 Codex default shell / 任意代码执行产品路径 | 0152/0153 已开放注册 shell |
| A9 | ADR-0131 | 禁止 MCP marketplace / 未 opt-in MCP 默认连接 | 已被 0132/0141 取代 |
| A10 | ADR-0046 | 仍禁止 shell / marketplace / YOLO / 诊断控制面 | shell/marketplace 已放宽；仅 YOLO/诊断/超集保留 |
| A11 | ADR-0060 | 禁止引入 shell / MCP marketplace / FTS / YOLO / 远程 telemetry | 本意是「本切片不涉及」，措辞过强 |
| A12 | ADR-0096 | 禁止 drain 后续 turn 用 YOLO / always-approve；禁止 shell / MCP marketplace | shell/marketplace 已放宽 |
| A13 | ADR-0057 | 禁止以累计 token/调用/时长终止正常 run | 0171 已取代 |
| A14 | ADR-0145 | 禁止以累计 run-token 作为终止理由 | 0171 已允许透明资源边界 |
| A15 | ADR-0127 | 禁止 ExtensionManifest mcpServers auto-connect | 0141 §2.2 允许 install→connect |
| A16 | ADR-0128 | 禁止 workspace 作为启用权威 | 0137/0141 已允许 workspace 作配置来源 |
| A17 | ADR-0137 | 禁止 app 冷启动无条件后台循环、无 marketplace install | 0141 允许受控冷启动 |

### 5.2 B 档：可放宽（需改措辞 / 加例外）

| # | 位置 | 条目（摘要） | 建议 |
|---|---|---|---|
| B1 | docs/adr/README.md | 禁止为记录小进度新建 ADR | 改为「建议仅在有长期架构影响时新建」 |
| B2 | docs/adr/README.md | 禁止重建 docs/improvements 第二套 backlog | 改为「不建议重建；借鉴跟踪以 ADR 形式」 |
| B3 | ADR-0075 | >1000 行须 PR/ADR 说明 | 改为「须 PR 说明（ADR 推荐）」 |
| B4 | todolist §8 | 禁止在共享工作区 checkout/stash/reset/clean/rebase/写文件 | 缩小到特定脏工作区或标临时约束 |
| B5 | todolist §8 | 禁止触碰 codex.png / fault.png / .out/.err/.pid 等 | 改为「禁止触碰未跟踪资产」的通用表述 |
| B6 | ADR-0130 | 首切片禁止任意拖拽自由编辑器 | 改为「首切片不包含；后续可独立 ADR」 |
| B7 | ADR-0094 | 禁止用裸 'Session' 指代计时（术语硬规则） | 改为「应使用 TimerSession 避免混淆」 |
| B8 | ADR-0142 | 禁止交付 Settings marketplace 子页/安装网格等 | 改为「当前 shipping 范围不包含；修订本 ADR 即可开放」 |
| B9 | ADR-0086 | 禁止在本切片绑定产品级 FS 路径或 MDM | 改为「本切片不绑定；后续可另立 ADR」 |
| B10 | 0004/0035/0020/README | C-4P6/P8/P9「扩张须新建 ADR」重复 ~15 处 | 保留 0004 权威 + 0035 结项，其余指针化 |
| B11 | ADR-0128 | 禁止默认注入（措辞模糊） | 明确为「禁止默认注入 provider API key 到 env」 |
| B12 | ADR-0124 | 禁止 DB-P2-1/2/3/4 出现在 sprint backlog | 改为「默认不排期；进入 backlog 须先过 ADR 门槛」 |
| B13 | ADR-0165 | 禁止将已下线触发按钮/chip 恢复为常驻展示面 | 改为「当前产品决定不展示；恢复须产品决策+ADR」 |
| B14 | ADR-0082 | 禁止开启 product autoDrain；禁止 main↔renderer 队列镜像 | 改为决策陈述「保持 false；翻转须独立 ADR」 |
| B15 | ADR-0141 | 禁止文档再宣称下列为永久禁止 | 保留为「已修订」记录，同时清理源头旧措辞 |

### 5.3 C 档：建议保留（但可澄清）

| # | 位置 | 条目（摘要） | 澄清建议 |
|---|---|---|---|
| C1 | AGENTS.md | 禁止 FTS5/向量库做产品搜索面 | 澄清「产品搜索 UI 禁止；教学内部词法检索可用；重开 FTS 走 DB-P2-2」 |
| C2 | 全仓 ~25 处 | YOLO / always-approve 禁令 | AGENTS.md 定义一次，其余指向 |
| C3 | 全仓 ~28 处 | Secret 隔离禁令 | SECURITY.md 定义字段清单，其余指向 |
| C4 | 全仓 ~35 处 | Settlement sole-writer 禁令 | ADR-0023 定义精确边界，其余指向 |
| C5 | AGENTS.md | 禁止推倒 EventBus/timeline、重写 AgentRun、拆 Ledger | 澄清「禁止未新建 ADR 前提下重写」（by-touch peel 允许触达重构） |
| C6 | todolist.md | 禁止写「生产完成」类表述 | 顶部注明「本文件是工作清单，非完成声明」 |
| C7 | ADR-0170 | 禁止 queue cap 配置为无限（32 硬上限） | 澄清「32 是当前设计值，非永久不变量」 |
| C8 | ADR-0124 | 禁止 DB-P2-3（won't do） | 澄清「当前产品定位下不做；重定位可重议」 |
| C9 | AGENTS.md | 禁止启动自动 memories / dream / 静默改 profile | 澄清「禁止无人批自动注入；经同意操作仍可执行」 |
| C10 | 全仓 8 处 | 禁止三线并行大搬家 | ADR-0075 定义「三线」与「大搬家」，其余指向 |

### 5.4 叠加效应（最严者生效）汇总

| 主题 | 出现次数 | 最严重后果 | 建议 |
|---|---|---|---|
| YOLO / always-approve | ~25 | 0141 已允许 annotations 辅助审批，但旧文档仍拦 | 单一权威 + 指针 |
| Secret 隔离 | ~28 | 每次新增密钥功能查 28 份文档 | 单一权威 + 指针 |
| Settlement sole-writer | ~35 | peel 时不确定能否动 settlement 相关代码 | 单一权威 + 指针 |
| FTS / 向量库 | ~14 | 内部词法检索被误拦 | AGENTS 澄清「产品面 vs 内部」 |
| 三线大搬家 | 8 | peel 时不确定是否违规 | ADR-0075 定义一次 |
| MCP marketplace 旧禁令 | ~10 | marketplace PR 被旧 ADR 拦住 | 逐份修订（A 档） |
| workspace shell 旧禁令 | ~6 | shell PR 被旧措辞拦住 | 逐份修订（A 档） |

---

## 6. 下一步建议

1. 按 §4「先动 Top 10」逐条修订（全部纯文档改动，不碰代码/测试，不碰承重墙）。
2. 修订时采用「单一权威定义 + 其余指针化」机制，避免未来再次叠加。
3. 修订后同步更新 `docs/redline-checklist.md` 对应复选框状态（勾选 = 已处理）。
4. 如需，我可直接按 Top10 生成逐条 diff 修改。

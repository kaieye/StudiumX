# 自习室完善方案 — 对照 YPT × StudiumX

> **状态：** 产品与架构对照方案（文档）；**不**授权生产代码、路径/schema、IPC 或 UI 变更。  
> **日期：** 2026-07-23  
> **对照源：** `ref_project/YPT/`（APK 逆向拆解：`docs/*` + i18n）  
> **本仓库权威：** 产品地板 `AGENTS.md`；规划冻结 [ADR-0094](adr/0094-study-task-timer-planning-design-gate.md)；cutover [ADR-0129](adr/0129-study-planning-renderer-cutover-and-sole-authority.md)；residual [ADR-0130](adr/0130-study-planning-phase7-and-completion-residual.md)；术语 `CONTEXT.md`  
> **一句话：** YPT 是「手机端学习计时 + 强制专注 + 小组/挑战社群」；StudiumX 自习室是「本地教学工作台里的虚拟教室 + 个人规划时钟 + 轻量 presence」。借鉴交互与激励，不照搬封锁、广告、遥测与云权威。

---

## 0. 阅读指引

| 你想… | 看 |
| --- | --- |
| 两边一句话定位 | §1 |
| 能力矩阵与差距 | §2 |
| 明确**不**做 / 做了会踩地板 | §3 |
| 目标产品形态（自习室北极星） | §4 |
| 分阶段交付（P0–P3） | §5 |
| 领域模型与权威切分 | §6 |
| UI / 信息架构建议 | §7 |
| 风险、测试与验收 | §8 |
| 建议 ADR / 实现切片顺序 | §9 |

---

## 1. 两边定位

### 1.1 YPT（参考）

韩国 Pallo 的 Flutter **学习计时 / 自习社群 App**。核心卖点链：

```
开始计时 →（可选）摄像头 / 允许 App 封锁 / Hard Mode
         → 科目 / Todo / 计划
         → 小组出勤 / 任务 / 排名 / 挑战
         → 统计报告 / Premium / 火焰经济 / 广告
```

技术与产品特征（拆解可信度：资源 + path + i18n 高；业务细节推断）：

| 轴 | YPT |
| --- | --- |
| 真相源 | 云后端 JWT API + 本地 SQLite 离线缓冲后 `sync-offline-data` |
| 专注约束 | 系统级 App 封锁、Phone Lock、Accessibility、School Mode |
| 社交 | 小组（创建/审核/踢人/帖/投票/聊天/任务/Cam）、挑战、全站排名 |
| 内容扩展 | 闪卡、智能书 DRM、课表 widget、Wear |
| 变现 | Premium、火焰、广告中介、Offerwall |
| AI | 外部 AI / MCP user_key / 闪卡生成 |

### 1.2 StudiumX 自习室（现状）

桌面教学工作区内的 **Office Workbench**，不是独立手机 App：

| 轴 | StudiumX 现状（代码锚点） |
| --- | --- |
| 场景 | `OfficeWorkbench`：3D/2D 课桌场景、沉浸翻页钟 / 女孩自习视频 |
| 房间类型 | `silent` / `sprint` / `deep` / `exam`（容量、周期、氛围不同） |
| 模式 | `free` / `sync` / `deepwork` / `exam` + 本轮 **contract**（目标文案） |
| Presence | MQTT 公网 relay（EMQX / HiveMQ 候选），topic `studiumx/study-space/v1/{space}`；席位声明 + 冲突裁决 |
| 空间 | `spaceCode`（PUBLIC / 自建码）、随机入座、房间码加入、邀请 URL |
| 榜单 | 房间内今日专注小时榜（presence 成员投影，非全站云排名） |
| 时钟 | 番茄 / 连续 / 自定义节奏；canonical **TimerSession**（StudyPlanningStore dual-write） |
| 任务 / 排程 | Task + ScheduleBlock + 冲突 opt-in 错开 + 重复规则 partial |
| 分析 | 本地 study analytics（`StudyAnalyticsPage`）；**非**远程 telemetry |
| 氛围 | 简易 WebAudio 环境音 + 音乐播放器（账号/歌单） |
| 事件 | `checkin` / `focus_start` / `task_done` / `cheer`（轻量 feed） |
| 教学边界 | LearningSession / Evidence / outcome **独立**；计时不得冒充教学 Session |

### 1.3 战略差：为什么不能「做成 YPT」

| 维度 | YPT | StudiumX 必须坚持 |
| --- | --- | --- |
| 平台 | 手机 + 系统权限 | 桌面 Electron；**无**默认 shell / 系统 App 封锁产品路径 |
| 数据权威 | 云 + 本地缓冲 | **文件是真相源**；SQLite 仅可重建投影 |
| 社交深度 | 完整小组产品 | 轻量 presence / 可选协作；隐私与同意优先 |
| 变现 | 广告 / 订阅 / 虚拟币 | 本地优先；**无**默认 phone-home / 广告 SDK |
| 教学 | 弱（计时为主） | 强：Lesson / LearningSession / settlement |

**借鉴原则：** 抄 **学习动机闭环与房间仪式感**，不抄 **封锁 OS、云权威、广告与巨型社群后端**。

---

## 2. 能力矩阵（对照）

图例：`✅` 已有可用 · `◐` partial / 有基础 · `—` 无 · `⛔` 产品地板禁止或战略不做

| 能力簇 | YPT | StudiumX | 差距性质 | 完善方向 |
| --- | --- | --- | --- | --- |
| **A. 个人计时核心** | | | | |
| 开始/暂停/停止/休息 | ✅ | ✅ TimerSession + sheets | 体验与恢复 residual | 关闭 §18 #8 产品证据（见 ADR-0130），不重做状态机 |
| 番茄 / 正计时 / 方案 | ✅ | ✅ catalog + custom rhythm | polish | 方案卡片与「当前 vs 下一段」教育文案 |
| 科目 / 任务归属 | ✅ 科目 | ✅ Task + empty-start 冻结 | partial | 强化「无任务启动 ask」与归属冻结 UX |
| 离线后同步 | ✅ | ◐ 本地 durable；无云 sync | 设计差 | **不做云权威**；强化 crash/sleep reconcile 诚实 |
| 摄像头监督计时 | ✅ | — | 可选后期 | P3 可选「本机摄像头打卡」（同意门控）；**不做**默认上云 |
| App 封锁 / Hard Mode | ✅ | ⛔ | 禁止 | **永不**作为产品路径（无系统封锁） |
| **B. 计划与时间** | | | | |
| Todo / 清单 | ✅ | ✅ WorkbenchTasks | polish | 完成仪式 + 房间事件联动 |
| 日/周/月计划 | ✅ | ◐ 周排程 + 重复 partial | residual | 月网格 polish；**不**复活 allocate 提案产品 |
| 课表 timetable | ✅ + widget | — | 可选 | P2 轻量「固定周模板」= 重复规则 UI 深化 |
| D-day | ✅ | — | 高价值小功能 | P1 本地 D-day 条（文件权威） |
| 日界 05:00 | ✅ | 本地日（午夜） | 产品决策 | P1 可选 `studyDayBoundaryHour` 偏好（默认 0 或 5，显式） |
| **C. 自习室 / 社交** | | | | |
| 虚拟房间 + 席位 | ◐（Cam 列表为主） | ✅ 场景 + seat claim | 差异化优势 | 保持并深化仪式感，不改成列表 App |
| 房间类型 / 模式 | 弱 | ✅ 4 房 + 4 模式 + 房间周期 | 优势 | 模式与房间周期的「跟随」可发现性 |
| 实时 presence | 推送 + 小组 | ✅ MQTT 公网 | 可靠性 / 隐私 | P0：relay 降级、消息面硬化、可选私有 relay |
| 榜单 / 排名 | 全站日周月年 | ◐ 房内今日小时 | 刻意克制 | P1 房内多维（今日/本轮 streak）；**全站云排名默认不做** |
| 小组（创建/审核/踢人/帖/聊） | ✅ 巨型 | — | 战略 | **不做** YPT 级 group 后端；P2 仅「私人 space + 房规」 |
| 挑战 / 押金 / 火焰 | ✅ | ⛔ 经济+广告 | 禁止默认 | 可选「无经济本地挑战」模板（P2），无押金无广告 |
| 摇一摇激励 / 自定义 push | ✅ | ◐ cheer 事件 | 弱 | P1 一键 cheer / 到点广播（本地 + presence） |
| Cam 出勤墙 | ✅ | — | 可选 | 与摄像头打卡同 P3，严格同意 |
| **D. 统计与反馈** | | | | |
| 日周月趋势 / 科目占比 | ✅ | ◐ StudyAnalyticsPage | 深化 | P1 房间 vs 个人切换、任务/信号维度 |
| 防作弊上限（20h/9h） | ✅ | — | 可借鉴诚实 | P1 TimerSession 可疑间隔已有；加「日上限提示」非排名剔除云逻辑 |
| 等级 / XP / 徽章 | 弱/有 | ◐ xp + streak + badges 投影 | 浅 | P1 本地徽章规则表 + 解锁 toast |
| **E. 氛围与内容** | | | | |
| 白噪音 | ✅ CDN | ◐ 合成环境音 | 提升 | P1 本地/打包音轨库（无远程默认拉取亦可） |
| 音乐 | ✅ | ✅ 播放器 | 保留 | 与专注相位联动（休息自动降噪 optional） |
| 闪卡 / 智能书 | ✅ | 教学 Lesson 路径 | 不照搬 | 自习室只 **深链到 Lesson**，不建第二内容库 |
| AI 教练 | ✅ 外链 | 教学 Agent | 边界 | 自习室 CTA「打开教学对话」；不另起 AI MCP 默认 |
| **F. 平台周边** | | | | |
| Widget / Wear | ✅ | — | 低优先 | P3 可选桌面小组件（OS 原生），非产品主路径 |
| Premium / 广告 | ✅ | ⛔ | 禁止 | 不引入广告 SDK / 火焰经济 |
| 多语言 28 语 | ✅ | 现有 i18n | 按需 | 自习室文案键表化，不抄扁平 3k keys 结构 |

---

## 3. 红线：从 YPT 明确不搬

下列能力即使用户「感觉有用」，也与产品地板或战略冲突，方案中 **默认否决** 或降为永远可选实验：

1. **系统 App 封锁 / Hard Mode / Accessibility 劫持** — 无默认 shell、无 OS 沙箱产品声明。  
2. **广告中介、Offerwall、火焰付费解锁** — 无默认远程变现与 phone-home。  
3. **全站公开排名云服务 + 默认账号体系** — 本地优先；presence 公网已是最大社交面，不可再默认把学习时长上云成排行榜权威。  
4. **把 SQLite / agent run / presence 心跳当作 teaching authority** — LearningSession / ledger 仍唯一教学过程权威。  
5. **FTS5 / 向量库作产品搜索** — 禁止。  
6. **复活 `allocateTimeWindow` 排程提案产品** 与 **旅行时区设置产品** — 已由 2026-07-22 产品决策撤回（ADR-0094 living note / ADR-0130）。  
7. **用覆盖率/泛型 lint 替换** teaching / privacy / security 领域门禁。  
8. **YOLO / always-approve / 默认 MCP marketplace**。

---

## 4. 北极星：StudiumX 自习室应成为什么

### 4.1 产品定义（建议冻结）

> **自习室 = 本地学习工作台中的「共同在场」仪式层。**  
> 它把 **个人规划时钟事实（TimerSession）**、**任务意图（Study task）** 与 **可选实时同桌（presence）** 叠在同一场景里，服务「开始得了、待得住、看得见别人也在学」，而 **不** 替代教学 Session / Lesson / Evidence。

三层叠放（必须在 UI 与数据上可分离）：

```text
┌─────────────────────────────────────────────┐
│  Presence 层（可选）  房间 · 席位 · 榜 · 事件  │  ← 可离线降级为「本机席位」
├─────────────────────────────────────────────┤
│  Ritual 层           模式 · 合同 · 信号 · 氛围  │  ← 纯本地，无网络也可完整
├─────────────────────────────────────────────┤
│  Planning 层         Task · Block · TimerSession │  ← 文件权威 StudyPlanningStore
└─────────────────────────────────────────────┘
          ↕ 深链 / 不写入
┌─────────────────────────────────────────────┐
│  Teaching 层         LearningSession · Lesson   │  ← settlement sole-writer 不变
└─────────────────────────────────────────────┘
```

### 4.2 成功标准（可验收，非 vanity）

用户在 4 周内应能稳定完成：

1. **30 秒内入座并开始一轮可恢复的专注**（有/无任务路径均诚实）。  
2. **看懂**「计划块 ≠ 实际计时 ≠ 教学 Session」。  
3. **可选**与好友同 space 看见席位与今日时长，断网仍能完整自习。  
4. **本地**回看日/周专注与任务完成，无默认外发。  
5. 从自习室 **一键回到** 对应 Lesson / 教学对话，不产生第二套内容真相。

### 4.3 差异化（相对 YPT 要守住的）

| 守住 | 原因 |
| --- | --- |
| 虚拟教室场景 + 席位冲突美学 | YPT 弱；这是 StudiumX 记忆点 |
| 文件权威规划 + 可靠时钟 | 比 YPT 本地缓冲更「可迁移」 |
| 教学深链 | YPT 做不到的桌面教学闭环 |
| 隐私默认 | 公网 presence 仅最小字段；可关 / 可私有 relay |

---

## 5. 分阶段交付

> 原则：**先硬化现有自习室闭环，再加轻量社交与激励，最后才考虑 Cam/小组件。**  
> 每个 phase 可独立合并；禁止「同时三线大搬家」（ADR-0075 / ADR-0121 精神）。

### Phase 0 — 对照收敛与术语（文档，本文件）

| 交付 | 说明 |
| --- | --- |
| 本方案 | 对照、红线、北极星、阶段 |
| 术语对齐 | 继续强制 TimerSession / LearningSession / Study task；新增 **StudyRoomPresence**、**StudySpace**、**FocusContract** 见 §6 |
| residual 诚实 | 不把本方案写成 §18 已关闭 |

**验收：** 文档入仓；`CONTEXT.md` 可选补 presence 术语（同 workstream 义务）。

---

### Phase 1 — P0「能稳用」硬化（优先，约 1–2 个迭代）

目标：现有功能在真实桌面使用下 **不丢人**，不扩 YPT 社群面。

| ID | 项 | 现状 | 动作 | 主要锚点 |
| --- | --- | --- | --- | --- |
| **SR-101** | Presence 可靠性与降级 | 公网 MQTT + 离线本机席位 | 连接状态可见；双 relay 故障时 **明确「本机模式」**；禁止静默假 online | `study-presence-connection.ts`, `useStudyPresence.ts` |
| **SR-102** | Presence 消息面硬化 | 已有 size/TTL 限制 | 字段白名单、版本 envelope、拒绝超大/陌生 kind；文档化威胁模型 | `mqtt-wire.ts`, connection |
| **SR-103** | 入座仪式 30 秒路径 | 模式/房间/合同分散 | 「一键开自习」：选模式 → 写合同（可跳过）→ 开始 TimerSession；空任务走 ask | `OfficeWorkbench`, `useStudySession`, EmptyStartSheet |
| **SR-104** | 合同与任务对齐 | contract 与 task 松耦合 | 开始时默认合同 = 当前任务标题；锁定后改任务 **结束当前段开新段**（已有不变量，补 UI 提示） | lifecycle / transitions |
| **SR-105** | 计时恢复产品证据 | thrash/kill-9 e2e partial | 按 ADR-0130 §5.3 **只补证据，不堆功能**；产品-close 清单项 | recovery e2e, reconcile |
| **SR-106** | V1 权威 demote 终态路径 | demote UX e2e landed | 引导「canonical  sole-read」；**禁止** auto≥30d 静默擦除 | demote sheets |
| **SR-107** | 房间周期「跟随」可发现 | `followStudyRoomCycle` 已有 | 冲刺室默认提示是否跟随房间节拍；考试室默认不跟随个人方案 | viewModel hostAction |
| **SR-108** | 无障碍与键盘 | a11y partial | 计时主按钮焦点环、快捷键帮助面板 | `planning-timer-a11y-ui.ts` |

**明确不做：** 新社交实体、Cam、云排名、allocate 复活。

**建议测试：** 现有 study-planning unit/e2e + presence 单测扩展；`pnpm typecheck`；触达安全边界时 `check:security`。

---

### Phase 2 — P1「想回来」激励与统计（约 1–2 个迭代）

目标：在 **不建小组后端** 的前提下，补齐 YPT 里真正拉留存的「看见进步 + 轻互动」。

| ID | 项 | 借鉴 YPT | StudiumX 做法 |
| --- | --- | --- | --- |
| **SR-201** | 本地 D-day | `dday_*` | `.studiumx/study-planning/` 旁路或 snapshot 扩展字段；工作台顶栏倒计时；**文件权威**，另立小 ADR 若改 wire |
| **SR-202** | 房内榜多维 | 排名 tab | 今日时长 / 当前连续专注 / 本周（仅 presence 可见成员）；**非**全站 |
| **SR-203** | Cheer / 激励 | 摇一摇、push | 一键 cheer（已有 kind）；到点可发 `task_done`；可选本地通知（已有 notification host） |
| **SR-204** | 徽章与 streak 诚实 | 弱 | 规则表：3 日连、首次 90 分钟、考场模式完成等；解锁仅本地；**不** remote analytics |
| **SR-205** | Analytics 深化 | report/* | 信号/任务/房间维度；「个人 vs 当前 space 聚合（仅本地缓存的 peer 摘要，可关）」 |
| **SR-206** | 日界偏好 | 05:00 | `studyDayBoundaryHour` 默认保持本地午夜或产品选 5；影响 todayKey / streak，**不**改 TimerSession epoch |
| **SR-207** | 白噪音素材库 | white-noises CDN | **打包 3–5 条**本地 loop（雨声/键盘/咖啡馆）；默认不外拉；音量与 focus/break 联动 optional |
| **SR-208** | 邀请与空间管理 | invite | 复制邀请链接 + 显示 space 规则卡（模式建议、是否跟随周期）；随机 room 防连续撞车 |

**数据原则：** 徽章/D-day/日界进 **StudyPlanning 偏好或旁路 JSON**；peer 数据 **永不**写回 teaching ledger。

---

### Phase 3 — P2「轻协作空间」（可选，产品信号触发）

仅当用户明确需要「固定小班」时立项；**不是** YPT Group 克隆。

| ID | 项 | 说明 |
| --- | --- | --- |
| **SR-301** | StudySpace 配置卡 | 名称、默认房间类型、建议 TimerPlan、是否公开 PUBLIC、可选密码（本地约定 + 链接参数，**非**服务端 ACL） |
| **SR-302** | 房规（软） | 例如「考试室禁止 cheer 文案」「冲刺室显示同步倒计时」——纯客户端约定 |
| **SR-303** | 私人 relay | 设置里粘贴 wss relay（opt-in）；默认仍公网候选；文档写清数据暴露面 |
| **SR-304** | 本地挑战模板 | 「连续 7 天每天 2h」清单 + 进度条；**无**押金/火焰/退款 |
| **SR-305** | 教学深链 | 从任务/合同「打开 Lesson / 继续 LearningSession」；只读 catalog，不双写 outcome |
| **SR-306** | 重复/课表 polish | 在 ADR-0130 STC-703 residual 上做月份网格；**禁止**静默克隆任务 |

**需要时新 ADR：** `StudySpace` 配置路径、presence envelope v2、私人 relay 隐私声明。

---

### Phase 4 — P3「实验能力」（默认不做，单独闸门）

| ID | 项 | 闸门 |
| --- | --- | --- |
| **SR-401** | 本机摄像头打卡照片 | 显式同意；默认存工作区用户目录；**默认不上云**；可关 |
| **SR-402** | 延时摄影 / 学习 vlog | 存储与隐私审查；非主路径 |
| **SR-403** | 桌面 OS 小组件（今日专注） | 只读 projection；无交互 shell |
| **SR-404** | 多窗自习 | 当前 dual-window **N/A**；若做须先产品 API 与 sole TimerSession 不变量 |

---

## 6. 领域模型建议（与现有六层共存）

### 6.1 已冻结（规划）— 不改名

沿用 ADR-0094：Task / TimeWindow / TimerPlan / ScheduleBlock / TimerSession（AllocationProposal 产品已撤，类型层可留纯函数但无 UI）。

### 6.2 自习室增量术语（建议写入 CONTEXT 的短表）

| 中文 | 英文 | 含义 | 不得混用 |
| --- | --- | --- | --- |
| 自习空间 | **StudySpace** | 由 `spaceCode` 标识的 presence 命名空间（PUBLIC 或私人码） | Course、Group（YPT） |
| 自习室房间 | **StudyRoom** | 空间内场景类型：`silent`/`sprint`/`deep`/`exam` | 物理教室、教学 Session |
| 席位 | **StudySeat** | 房间内座位 index + claim 时间 | 任务、计时段 |
| 在场 | **StudyRoomPresence** | 心跳与 peer 投影；可降级离线 | LearningSession |
| 本轮合同 | **FocusContract** | 本轮专注目标短文案（现 `contractText`） | Mission、Lesson |
| 学习信号 | **StudySignal** | 读/写/练/复/考 状态灯 | analytics mode 可对齐但非 teaching outcome |
| 房间周期 | **StudyRoomCycle** | 房间级共享节拍（可跟随） | 个人 TimerPlan |

### 6.3 权威矩阵

| 数据 | 权威 | 投影 / 传输 |
| --- | --- | --- |
| Task / Block / TimerPlan / TimerSession / prefs | `StudyPlanningStore` → `.studiumx/study-planning/snapshot.json` | renderer dual-write + sole-read |
| 今日个人专注累计（可靠） | TimerSession segment facts → 本地 analytics | V1 snapshot 字段仅缓存 |
| 席位 / 昵称 / 信号 / 运行态 | **本机 snapshot + presence 广播** | MQTT 最小字段；不可信对端 |
| 房内榜 | **对 presence peers 的即时投影** | 无服务端排名权威 |
| Lesson / Evidence / Outcome | LearningSessionLedger + settlement sole-writer | 自习室只深链 |
| 徽章 / D-day | 建议 planning prefs 或旁路 JSON | 本地 only |

### 6.4 状态机关系（概念）

```text
FocusContract + StudySignal + StudyRoom  ──配置──►  开始
                                                    │
                         ┌──────────────────────────┼──────────────────────────┐
                         ▼                          ▼                          ▼
                  TimerSession                 StudyRoomPresence          (optional) Lesson deep-link
               running/paused/...            publish heartbeat              不写 outcome
                         │                          │
                         └──────── analytics facts ─┘
```

不变量（在 ADR-0094 之上追加）：

1. **最多一个** running 个人 TimerSession（已有）。  
2. Presence 断线 **不得** 暂停或丢弃合法 TimerSession。  
3. Peer 消息 **不得** 驱动本机计时 advance（防作弊/防注入）。  
4. Cheer / 事件 **不得** 写入 LearningSession ledger。  
5. 跟随房间周期 = 用 RoomCycle 的 remaining **初始化**本机 TimerSession，之后仍受本机可靠时钟与 reconcile 约束。

---

## 7. 信息架构与 UI 建议

### 7.1 保持三路由（已有）

`workbench=room | schedule | analytics`

### 7.2 Room 页信息层级（建议）

```text
[顶栏] 空间码 · 连接态 · D-day · 邀请
[主舞台] 课桌场景 / 沉浸钟
[左或浮层] 番茄主控 · 合同 · 信号 · 方案
[右] 任务清单（可折叠）
[底/抽屉] 榜单 · 音乐 · 环境音 · 最近事件
```

对标 YPT 底部五 Tab（Home/Todo/Group/Stats/Book）：**不要**改成五 Tab 手机 IA。  
桌面应保持 **单场景 + 侧翼工具**；Group/Book 用「深链到教学 / 私人 space」代替。

### 7.3 关键文案（防术语污染）

| 避免 | 改用 |
| --- | --- |
| 「结束 Session」指番茄 | 「结束本段专注 / 完成 TimerSession」 |
| 「同步课程」指 presence | 「跟随房间节奏」 |
| 「上传学习记录」 | 「保存到本地规划 / 打开学习记录」 |

### 7.4 YPT 交互可直接借鉴的微模式

| 微模式 | 落地 |
| --- | --- |
| 开始前选科目 | Empty-start / 任务选择 sheet（已有，补默认合同） |
| 停止时展示「集中了 xx」 | 结束段 toast + analytics intent（lifecycle 已有框架） |
| 休息提醒可关 | `breakPolicy` 已冻结；设置里暴露 |
| 日学习上限提示 | 本地 soft warning（如 >12h confirm），**非**云除名 |
| 邀请文案一键复制 | SR-208 |

---

## 8. 风险、隐私与测试

### 8.1 隐私

| 风险 | 缓解 |
| --- | --- |
| 公网 MQTT 暴露昵称/时长/信号 | 文档披露；最小字段；可关 presence；P2 私人 relay |
| 空间码可被枚举 | 码熵 + 非 PUBLIC 不进目录；不提供全站 discovery |
| Cam 照片 | 仅 P3 + 同意 + 本地路径 |
| Analytics 被误认为 telemetry | 文案与 `check:analytics` 语义保持「本地地基」 |

### 8.2 安全

- Presence payload：严格 schema、大小上限、clientId 前缀校验（已有方向，SR-102 收紧）。  
- **Peer 不可驱动计时**（§6.4）。  
- 不引入默认远程 OTEL。  
- 邀请 URL 只带 space/room，不带 token 密钥。

### 8.3 测试分层（对齐 `docs/testing.md`）

| 改动 | 至少 |
| --- | --- |
| presence / mqtt | unit：编解码、TTL、冲突席位、降级 |
| TimerSession / 恢复 | 既有 recovery / thrash e2e；产品-close 按 ADR-0130 |
| prefs / D-day wire | store unit + dual-write；必要时实现 ADR |
| UI 仪式路径 | component 或 e2e-proxy：30 秒开自习 |
| 任意 TS | `pnpm typecheck`；安全触达 `check:security` |

---

## 9. 建议落地顺序（工程切片）

```text
文档
  └─ 本方案（✓ 本文件）
  └─ 可选：CONTEXT 补 StudySpace / Presence 术语
  └─ 若改 snapshot wire：ADR-0117 补丁 ADR（D-day / dayBoundary / badges）

P0 代码（可并行但每 PR 单主题）
  1. SR-101/102 presence 降级 + envelope
  2. SR-103/104/107 开自习仪式 + 合同/跟随
  3. SR-105/106 residual 证据与 demote 引导（政策驱动，少功能）

P1
  4. SR-201 D-day + SR-206 日界（同 wire 批次）
  5. SR-202/203/204 榜 · cheer · 徽章
  6. SR-205 analytics 维度
  7. SR-207/208 音轨与邀请

P2 / P3
  产品信号后再开 ADR 与切片
```

### 9.1 模块尺寸

- 禁止继续膨胀 `useStudySession.ts`（已是巨石级）；新逻辑 **peel** 到 `study-space/presence/*`、`study-space/ritual/*`、`study-space/space/*`。  
- 遵守 ADR-0075；不借机改 teaching settlement 巨石。

### 9.2 与 study-planning residual 的关系

| 本方案 | ADR-0130 residual |
| --- | --- |
| SR-105/106 | 直接服务 §18 #8/#9 诚实关闭条件 |
| SR-201+ | **新**产品面，须另证；**不**宣称关闭 §18 |
| 不重开 | allocate / 旅行时区 |

---

## 10. 附录

### 10.1 YPT 模块 → StudiumX 映射速查

| YPT | StudiumX 对应 | 策略 |
| --- | --- | --- |
| `/study/*` 计时 | TimerSession + lifecycle | 硬化 |
| `/planner/*` | StudyPlanning schedule | residual polish |
| `/group/*` | StudySpace + presence | **大幅收缩** |
| `/challenge*` | 本地挑战模板 | P2 无经济 |
| `/report/*` `/logs/*` | StudyAnalyticsPage | 深化本地 |
| blockapps / hardmode | — | ⛔ |
| flashcard / smartbook | Lesson / Course | 深链 |
| premium / flames / ads | — | ⛔ |
| white-noise / music | ambient + WorkbenchMusicPlayer | 增强本地素材 |
| cam study | 可选本机打卡 | P3 |
| AI MCP | 教学 Agent | 深链 |

### 10.2 现状代码地图（只读）

| 区域 | 路径 |
| --- | --- |
| 场景壳 | `src/renderer/src/views/workbench/OfficeWorkbench.tsx` |
| 番茄 UI | `.../WorkbenchPomodoro.tsx` |
| 榜单 / 换房 | `WorkbenchLeaderboard.tsx`, `WorkbenchRoomSwitcher.tsx` |
| 会话 hook | `src/renderer/src/study-space/session/useStudySession.ts` |
| 生命周期 | `study-session-lifecycle.ts`, `transitions.ts` |
| Presence | `presence/study-presence-connection.ts`, `mqtt-wire.ts` |
| 常量房间/模式 | `study-space/constants.ts` |
| 规划权威 | `src/main/study-planning-durable-store.ts`, `src/shared/study-planning/*` |
| 分析 | `views/workbench/analytics/*` |

### 10.3 参考拆解文档

- `ref_project/YPT/README.md`  
- `ref_project/YPT/docs/ARCHITECTURE.md`  
- `ref_project/YPT/docs/UI_STRUCTURE.md`  
- `ref_project/YPT/docs/DATA_MODEL.md`  
- `ref_project/YPT/docs/UI_I18N_FEATURES.md`

---

## 11. 决策摘要（给评审的一页纸）

1. **定位：** 虚拟教室 + 本地规划时钟 + 可选在场；不是 YPT 手机社群。  
2. **先做：** presence 硬化、30 秒开自习、合同/任务对齐、恢复与 sole-authority 诚实（P0）。  
3. **再做：** D-day、房内多维榜、徽章、分析维度、本地白噪音、邀请（P1）。  
4. **慎做：** 私人 space 配置、本地挑战、私人 relay（P2，信号触发）。  
5. **默认不做：** App 封锁、广告/火焰、全站云排名、Cam 上云、allocate/旅行时区复活。  
6. **权威：** 规划文件 + TimerSession；presence 不可信；教学 ledger 不动。  
7. **工程：** 小切片、peel 巨石、每阶段可验收、不宣称 §18 因本方案而关闭。

---

**维护：** 实现启动时，将进入代码的条目拆成独立 PR，并在触达 wire/权威时增补 ADR；本文件保持为「对照与路线」，完成项可在文首增加 changelog 短表，避免另写第二份互相漂移的路线图。

# StudiumX 任务清单、时间排程与专注时钟 — 残余路线图

> 状态：**规划轨已关闭**；**§18 产品未全满足**  
> 日期：2026-07-22  
> 权威：
> - 设计门 / 十项冻结：[ADR-0094](adr/0094-study-task-timer-planning-design-gate.md)
> - 路径 / wire / Store：[ADR-0117](adr/0117-study-planning-store-paths-and-wire.md)
> - Renderer cutover / dual-write + sole-read：[ADR-0129](adr/0129-study-planning-renderer-cutover-and-sole-authority.md)
> - Phase7 / §18 residual 政策：[ADR-0130](adr/0130-study-planning-phase7-and-completion-residual.md)
> - 术语：[`CONTEXT.md`](../CONTEXT.md) Study planning language
>
> **路线图规划轨可关闭 ≠ §18 产品完成。** 已落地实现以代码与 ADR 为准，本文只跟踪**仍开放**的关闭触发。

---

## 1. 仍开放的 residual

| Residual | 状态 | 关闭触发（仍缺什么） |
| --- | --- | --- |
| **V1 dual-authority / sole-authority 终态** | partial | 全路径 **e2e cold-start** 产品证据（demote 后 empty V1 不能复活权威）；**禁止** auto ≥30d 静默擦除 |
| **STC-702 custom rhythm** | partial | 番茄 + 连续路径稳定性 / product-signal polish（ordered 编辑器已有；**禁止** freeform drag） |
| **STC-703 recurrence 产品** | partial | **完整重复日历 / series edit UI**（规则 persist + host 投影 + confirm expand 已有；**禁止**静默任务克隆 / 默认 auto-expand） |
| **STC-704 旅行 UX** | partial | **旅行设置页 / 用户确认 rezone**（块 `timeZone` + 周 overnight + create stamp 已有；**禁止**静默整周 rezone） |
| **睡眠 / 崩溃 / 并发完整矩阵** | open / improved partial | **e2e** crash / kill-9 冷恢复 / 多窗 thrash 产品证据（power 信号桥 + unit recovery matrix 已有 ≠ 关 bullet 8） |
| **STC-707 conflict auto-resolve** | partial | 产品信号是否将 opt-in 写回标为默认能力；**禁止**静默自动错开；须继续尊重 locked / hard end |
| **每 tick advance 写盘** | 明确不做 | sole-read 本地投影；转换 dual-write only |

已落地能力（cutover、TimerSession、catalog、empty-start、归类、power 信号桥、702/703/704/707 工程切片等）见 `src/shared/study-planning/`、`src/renderer/src/study-space/`、`src/main/system-power-bridge.ts` 与 ADR-0117/0129/0130，**不在此复述清单**。

### V1 代码锚点（仍可能触达）

- `src/renderer/src/study-space/session/useStudySession.ts`
- `src/renderer/src/views/workbench/WorkbenchPomodoro.tsx`
- `src/renderer/src/views/workbench/StudyTaskSchedulePage.tsx`
- `src/shared/study-planning/`

---

## 2. 下一产品可交付小步（触发制，非自动排期）

1. V1 sole-authority：**e2e cold-start** 包（非再造 demote UX）
2. Sleep/crash：**e2e** 矩阵证据包（非再造 power 信号桥 / unit matrix）
3. STC-702：product-signal polish（非 freeform）
4. STC-703：完整重复日历 / series edit UI
5. STC-704：旅行设置 + confirm rezone（非静默默认）
6. STC-707：产品信号裁定 opt-in 写回是否「上线能力」

**不得**仅因 pure / partial UI / unit 绿或本文件关闭而宣称 §18 完成。

---

## 3. §18 完成定义与审计

完整产品完成须满足：

1. 用户能明确理解任务、时间块、方案和实际计时的区别。
2. 09:00–12:00 可以生成可解释、可修改、可确认的专注/休息安排。
3. 正计时、倒计时和连续专注都能可靠恢复。
4. 无任务启动不会产生意外归属；快速创建能同步到清单与详情。
5. 一个任务可跨多个时间块，计划与实际分别保留。
6. 完成后归类可用、可跳过、可永久关闭并可恢复设置。
7. 方案修改不篡改当前会话和历史。
8. 睡眠、崩溃、并发和 retry 不重复记时、不丢任务。
9. canonical 仍是受控本地文件；localStorage/SQLite 不是长期教学权威。
10. 不新增默认远程 telemetry，不绕过 revision/sole-writer/effect 产品地板。
11. 领域单元、生命周期、迁移、IPC 和关键 UI 测试全部通过。

### 3.1 审计表（2026-07-22）

| # | 状态 | residual |
| --- | --- | --- |
| 1–7 | **partial** | 分面 UI / 深度 UX / V1 shell 并存；见 ADR-0129/0130 |
| 8 | **open / improved partial** | unit + power 信号桥有；**e2e crash 矩阵仍开** |
| 9 | **partial** | demote + cold-start unit 有；**e2e cold-start 仍开**；禁 auto wipe |
| 10 | **satisfied**（纪律） | 纪律绿 ≠ 其他 bullet 关闭 |
| 11 | **partial** | unit 广；全量 e2e / release-audit 未作关闭条件 |

**总裁定：`not satisfied`。**

---

## 4. 仍延后（产品信号 / 非默认）

| 延后项 | 备注 |
| --- | --- |
| freeform 节奏图 / workflow 图 | 禁止；仅 ordered list |
| 静默 auto-expand 重复 / 静默任务克隆 | 禁止 |
| 静默整周 rezone / 默认 conflict auto-stagger | 禁止 |
| auto ≥30d 擦除 V1 localStorage | 禁止静默；须用户确认路径 |
| `allow_overrun` 高级默认文案 | 调参，非默认策略 |

路径 / wire / 备份 / Store 信封以 [ADR-0117](adr/0117-study-planning-store-paths-and-wire.md) 为准。  
产品规则以 [ADR-0094](adr/0094-study-task-timer-planning-design-gate.md) 为准。

---

## 5. 测试与门禁（触达 residual 时）

```bash
pnpm typecheck
pnpm test:unit
# 涉及 canonical / IPC / writer / 路径时叠加：
pnpm run check:security
pnpm run check:teaching-ipc-contract
pnpm run check:blocking-ci
```

残余相关单测（回归）：`tests/unit/study-planning-*.unit.test.ts`（含 demote、cold-start、power bridge、recovery matrix、custom-rhythm、recurrence、zone、conflict resolve）。

架构变更须新 ADR 链入 `docs/adr/README.md`；巨石 peel 见 [ADR-0075](adr/0075-module-size-policy-and-giant-peel.md)。

---

## 6. Non-goals / 风险（仍有效）

- 不授权：默认 shell / YOLO / MCP marketplace / 远程 telemetry / FTS 产品搜索
- 不重写教学 `LearningSession` settlement / 绕过 sole-writer
- 不将静默自动休息、静默绑定首任务、静默擦除 V1、静默 conflict resolve 作默认
- 风险：localStorage 权威蔓延 → 文件真相 + 用户确认 demote；双 writer → `expectedRevision` CAS

### 文档状态

- **规划轨**：关闭  
- **§18**：`not satisfied`  
- **Open residual**：§1 表（e2e cold-start / e2e crash 矩阵 / 702–704 polish / 707 产品信号）

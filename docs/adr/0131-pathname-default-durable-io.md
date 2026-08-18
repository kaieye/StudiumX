# ADR-0131：默认 durable I/O 收口为可信 root 内 pathname 写（temp → write → 可选 fsync → rename）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已采纳并**已实施**（默认写模型 + Phase B–F 代码收口，2026-07-22；完成证据收口于本 ADR §4–5）
- **日期：** 2026-07-22
- **范围：** 冻结全平台**默认** durable 写盘模型为 **可信 root 约束下的 pathname 写**；明确 `native` `contained_durable_replace` **不是**默认路径；**不**宣称 CAS / power-loss / OS sandbox 产品面；**不**引入 default shell / YOLO / danger-full-access / MCP marketplace；**不**拆 `TeachingTurnCoordinator` settlement sole-writer。
- **取代：** 部分 [ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（默认写模型；历史结项与 inventory 保留）
- **被取代：** 无
- **相关：** 
  - 迁移执行与成功标准：已完成，见本 ADR §4–5
  - 将被本 ADR **在默认路径上 supersede** 的双 profile 默认分层：[ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（历史结项与 inventory **保留**；默认写模型不再以 dual-profile 为权威）
  - C-4 durable publish 与 partial migration：[ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)
  - C-4P6 / Windows strict no-go：[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)、[ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md)
  - Settlement sole-writer：[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)
  - 模块尺寸 / 巨石 peel：[ADR-0075](0075-module-size-policy-and-giant-peel.md)
  - 产品地板：[`AGENTS.md`](../../AGENTS.md)、[`SECURITY.md`](../../SECURITY.md)
- **证据：** 本 ADR §4–5 的完成记录 + 生产路径检索（无 hard `.node` require）+ 目标 unit（durable-file / workspace-write / memory-catalog / platform-capability / projection native-gone）。


> **长度说明：** 本 ADR 冻结默认写模型并明确对 ADR-0126/0004/0006/0035 的 supersede 范围、settlement 边界与 non-claims，属多关系决策；实施分期/成功标准与历史负担量级已移至 `docs/adr/evidence/ADR-0131.md`。

## 1. 背景

### 1.1 现状负担（摘要）

默认写路径在 2026-07-22 前维持一套过重的 durable I/O 栈（native descriptor + TS 封装 + POSIX/Windows 双协议 + platform matrix，合计数千行）。完整量级表见 `docs/adr/evidence/ADR-0131.md`。对标 `ref_project/codex` 的 `write_atomically`（pathname temp + persist）后，结论是本仓库默认写只需 **root 约束 + temp → write → 可选 fsync → rename**。

[ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md) 正确解决了「Windows 上 descriptor 失败炸热路径」与「诚实命名 weaker profile」问题，但**默认路径仍维持 dual-profile + native 可选硬依赖**的产品与工程负担。对标 `ref_project/codex` 的 `write_atomically`（pathname temp + persist，约十几行核）后，结论是：本仓库默认写只需 **root 约束 + temp → write → 可选 fsync → rename**，不需要把 descriptor-strict 当全平台默认。

### 1.2 问题陈述

1. **默认合同过重：** 教学产品不需要、也未宣称 CAS / power-loss 级写保证，却为 descriptor / dual protocol 支付数千行与 prebuild 成本。
2. **双协议分裂：** POSIX contained create/overwrite 与 Windows direct-path 两套 workspace/memory 路径增加测试与 review 面，且易被误读为「Windows = strict」。
3. **文档风险：** doctor / SECURITY / ADR 若继续暗示 `posix_descriptor_strict` 为全平台默认，会与诚实产品边界冲突。

### 1.3 明确不借（产品地板，本 ADR 重申）

| 项 | 裁定 |
| --- | --- |
| Codex **default shell** / 任意代码执行产品路径 | **禁止** |
| YOLO / DangerFullAccess / always-approve 标签 | **禁止** |
| MCP marketplace / 未 opt-in MCP 默认连接 | **禁止**（用户可配置 MCP 仍走 ADR-0127/0128，与写盘模型正交） |
| OS sandbox 产品面（bwrap / seatbelt / RestrictedToken）当写盘替代 | **禁止**宣称为本模型一部分 |
| 把 Windows 较弱写改名为 strict / CAS | **禁止** |
| 拆 `TeachingTurnCoordinator` / settlement sole-writer / `expectedRevision` | **禁止** |

本 ADR **只**借 Codex 的 **pathname 写简单性**，**不**借其 shell / sandbox / danger 产品面。

---

## 2. 决定

### 2.1 默认写模型（冻结）

**全平台默认 durable 写**统一为：

```
可信 root 内相对/解析后的 pathname
  → 同目录 temp 候选文件
  → write 内容
  → 可选 fsync（best-effort；失败可 warn，不升格为 CAS 合同）
  → rename 发布为 canonical 路径
```

| 属性 | 冻结值 |
| --- | --- |
| **路径约束** | 必须先经既有 **workspace / userData 等可信 root containment**（保留 `workspace-path-target` 级门禁）；禁止任意绝对路径旁路 |
| **发布原语** | pathname `temp → write → 可选 fsync → rename`；收口点为现有 `src/main/persistence/durable-file.ts` 的 path 变体（`replaceDurably(path, …)` 精神） |
| **默认 native** | **`contained_durable_replace` / descriptor-relative native addon 不是默认**；默认路径 **零** 对 `*.node` 的硬依赖 |
| **平台分支** | 默认 **无** POSIX/Windows 双写协议文件；实现切片（Phase B/C）须收敛为 **一套** I/O |
| **可选 fsync** | 允许 best-effort；**不得**据此宣称 power-loss durability 或 CAS |
| **失败语义** | fail-closed 稳定 code；**禁止**假成功「已保存」；**禁止**自动 rollback/delete canonical 后静默重试伪装原子性 |

### 2.2 对 ADR-0126 的 supersede 范围

| 层面 | 裁定 |
| --- | --- |
| **默认写模型权威** | **本 ADR supersede** ADR-0126 中「默认以 dual-profile（`posix_descriptor_strict` / `windows_direct_path_non_cas`）为写路径权威分层」的**默认**含义 |
| **历史结项与 inventory** | ADR-0126 正文、Phase 勾选、consumer inventory、Windows memory direct-path 历史证据 **保留** 为历史；**不**重写结项事实 |
| **Profile 枚举代码** | 实现迁移完成前，registry / doctor 字段可继续存在；迁移完成后应变为 **布尔/删减** 或诚实「pathname-only」投影（见迁移 Phase D），**不得**继续暗示 descriptor-strict 为默认 |
| **Windows strict** | 仍按 ADR-0035 **no-go**；本 ADR **不**重开 |
| **chat hot-path degrade** | 精神保留：I/O 不可用时聊天热路径 **degrade** 而非炸 turn；不再依赖 dual-profile 命名来表达 |

**一句话：** *ADR-0126 解决了「诚实分层 + 热路径不炸」；ADR-0131 决定「默认连分层写栈也不要，只保留 root + pathname 写」。*

### 2.3 与 settlement sole-writer 的边界

| 不变量 | 本 ADR |
| --- | --- |
| `TeachingTurnCoordinator` / host 为 outcome settlement **sole-writer** | **不变** |
| IPC `expectedRevision` / fork `toolsReplayed: false` | **不变** |
| LearningSession ledger 权威 | **不变** |
| 写盘原语替换 | **仅** I/O 实现；**不得**借机改 settlement 顺序、manifest authority 或跨文件 transaction 宣称 |

迁移实施保持可合并 PR；**不建议**与 settlement sole-writer 大改同 PR。

### 2.4 对 ADR-0004 / 0006 / 0035 的关系

| 既有 ADR | 本决定 |
| --- | --- |
| ADR-0004 partial writer migration | **保留** partial 纪律；未审查 writer 不自动迁移。默认原语从 dual-profile 指向 pathname `durable-file` |
| ADR-0004 P8 Windows direct-path / POSIX contained 协议细节 | 由后续 Phase B 实现替换为统一 pathname；本 ADR 只批准方向，不提前宣称 P8 协议已删 |
| ADR-0006 Memory descriptor I/O | 默认目标改为 pathname backend（Phase C）；不自动批准 destructive C-6 |
| ADR-0035 Windows strict no-go / C-4P6 | **不修改**；仍 no-go / 非跨文件 transaction |

---

## 3. 目标架构（to-be，决策层）

```
  tool / store / memory / settings writers
              │
              ▼
     path containment (trusted root)
              │
              ▼
   replaceDurably(path) / write_atomically 精神
   temp → write → optional fsync → rename
              │
              ▼
        canonical file on disk

  （无默认 native .node；无 POSIX/Win 双协议文件；
    settlement sole-writer 仍在 coordinator 层，不在 I/O 原语层）
```

**代码量目标（迁移成功后，非本 Phase）：** 写盘核 **~200–450** 生产行量级；相对现状净减约 **3.5k–4k** 生产行 + 相关测试。

---

## 4. 实施分期与成功标准（授权边界）

实施按 Phase A–F 已收口；**完整分期表、完成记录与 Definition of Done** 见
`docs/adr/evidence/ADR-0131.md`。关键完成点：

- 默认写路径 **零** 对 `contained_durable_replace.node` 的硬依赖；
- workspace + memory **一套** pathname I/O，无 POSIX/Windows 双协议文件；
- dual modules 与 native tree 删除；capability 默认 `pathname_default`；
- 目标 unit 通过（durable-file、workspace-write、memory-catalog、platform-capability、projection native-gone）。

---

## 6. 非目标（Non-claims）

本 ADR **不**宣称、**不**授权：

1. CAS、target-identity compare-and-swap、descriptor/HANDLE-bound publish  
2. power-loss / crash / reboot / 网络盘 / 可移动存储 durability 证明  
3. 跨文件 transaction / common atomicity / 自动 rollback  
4. OS sandbox 产品面或「与 Codex sandbox 等价」  
5. 默认 shell、YOLO、danger-full-access、MCP marketplace  
6. ~~已完成 native 删除、workspace/memory 双协议删除~~（**实现已落地**；本条历史 non-claim 不再适用）  
7. 任何 settlement / ledger / outcome 权威迁移  
8. Windows strict 工作线重开  

---

## 7. 风险与缓解

- 读者误以为「pathname = CAS」 → 正文/non-claims 反复禁止；命名不得含 strict/CAS。
- 实现 PR 借机改 settlement → 硬边界 §2.3；与 sole-writer 大改分 PR。
- 半迁移双栈并存过久 → 按 Phase 分期，每 phase 可独立合并与回滚。
- 删除 native 后旧测大面积红 → Phase F 改写/删除 contained 专测；保留 path containment 测。
- doctor 仍展示旧 profile 误导 → Phase D 收口文案；完成前可加「default 已改 pathname」注记。

---

## 8. 一句话决策摘要

> **默认 durable 写 = 可信 root 内 pathname（temp → write → 可选 fsync → rename）；native descriptor 非默认；不宣称 CAS/power-loss；不借 shell/YOLO/marketplace；不拆 settlement sole-writer。**  
> ADR-0126 的 dual-profile **默认权威**由本 ADR supersede；历史分层结项保留为考古与回滚线索。实现已按 Phase B–F 分 PR 收口。

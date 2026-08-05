# ADR-0131：默认 durable I/O 收口为可信 root 内 pathname 写（temp → write → 可选 fsync → rename）

- **状态：** 已采纳并**已实施**（默认写模型 + Phase B–F 代码收口，2026-07-22；完成证据收口于本 ADR §4–5）
- **日期：** 2026-07-22
- **范围：** 冻结全平台**默认** durable 写盘模型为 **可信 root 约束下的 pathname 写**；明确 `native` `contained_durable_replace` **不是**默认路径；**不**宣称 CAS / power-loss / OS sandbox 产品面；**不**引入 default shell / YOLO / danger-full-access / MCP marketplace；**不**拆 `TeachingTurnCoordinator` settlement sole-writer。
- **相关：**
  - 迁移执行与成功标准：已完成，见本 ADR §4–5
  - 将被本 ADR **在默认路径上 supersede** 的双 profile 默认分层：[ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（历史结项与 inventory **保留**；默认写模型不再以 dual-profile 为权威）
  - C-4 durable publish 与 partial migration：[ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)
  - C-4P6 / Windows strict no-go：[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)、[ADR-0020](0020-c4p6-phase0-platform-profile-and-failure-matrix.md)
  - Settlement sole-writer：[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)
  - 模块尺寸 / 巨石 peel：[ADR-0075](0075-module-size-policy-and-giant-peel.md)
  - 产品地板：[`AGENTS.md`](../../AGENTS.md)、[`SECURITY.md`](../../SECURITY.md)
- **证据提交：** 本 ADR §4–5 的完成记录 + 生产路径检索（无 hard `.node` require）+ 目标 unit（durable-file / workspace-write / memory-catalog / platform-capability / projection native-gone）。

---

## 1. 背景

### 1.1 现状负担

截至 2026-07-22，默认写路径仍维持一套 **过重** 的 durable I/O 栈：

| 块 | 量级（约） | 角色 |
| --- | ---: | --- |
| `native/.../contained_durable_replace` + gyp | ~1,310 | N-API descriptor 原语 |
| `contained-durable-directory.ts` | ~680 | TS 封装 |
| workspace contained create / restricted overwrite | ~860 | POSIX 双协议 |
| Windows direct-path workspace + memory | ~640 | 第二套后端 |
| platform-capability（shared + registry） | ~310 | 多 consumer 矩阵 |
| `durable-file.ts` pathname temp+rename | ~300 | **拟收口为唯一写原语** |
| path containment（`workspace-path-target`） | ~100 | **保留** |

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

| 既有 ADR | 本决定是否修改其结项 |
| --- | --- |
| ADR-0004 partial writer migration | **保留** partial 纪律；未审查 writer 不自动迁移。默认原语从 dual-profile 指向 **pathname `durable-file`** |
| ADR-0004 P8 Windows direct-path / POSIX contained 协议细节 | 将被 **后续 Phase B 实现** 替换为统一 pathname；本 ADR 只批准方向，**不**在文档阶段宣称 P8 协议已删 |
| ADR-0006 Memory descriptor I/O | 默认目标改为 pathname backend（Phase C）；**不**自动批准 destructive C-6 |
| ADR-0035 Windows strict no-go / C-4P6 受限结项 | **不修改**；仍 no-go / 仍非跨文件 transaction |

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

## 4. 实施分期（授权边界）

本 ADR 原 Phase A 为 design gate；**实现**已按 Phase B–F 收口。完成记录满足 §5 成功标准（检索 + typecheck 相关路径 + 目标 unit）。

| Phase | 做什么 | 本 ADR 状态 |
| --- | --- | --- |
| **A** | 本文件 + 索引 + Phase A 完成记录；ADR-0126 supersede 注记 | **完成** |
| **B** | workspace 写：POSIX/Win 同一 path 路径；去掉 contained create/overwrite 分支 | **完成** |
| **C** | memory：单 backend（list/read/`replaceDurably`）；删 Windows 专用 catalog 双轨 | **完成** |
| **D** | 缩 capability registry → pathname_default；doctor 简化 | **完成** |
| **E** | 去 prebuild/打包 `.node`；native 目录删除 | **完成** |
| **F** | 测试与 SECURITY/ADR 勾选同步；CI 不再编 native | **完成** |

---

## 5. 成功标准（Definition of Done — 全迁移；Phase A 仅文档子集）

完成状态按本 ADR §4 的 Phase A–F 记录核对：

1. 默认写路径 **零** 对 `contained_durable_replace.node` 的硬依赖  
2. workspace + memory：**一套** I/O，无 POSIX/Windows 双协议文件  
3. 写盘核代码量落到 **约 Codex 同量级（百行级）**，不再维持千行 native + 双 profile  
4. 文档与 doctor **不**再暗示 descriptor-strict 为全平台默认  

**Phase A 完成定义：**

- [x] 本 ADR 已入库且编号 **0131**  
- [x] `docs/adr/README.md` 已索引  
- [x] Phase A 完成记录已归档至本 ADR
- [x] ADR-0126 状态行注明默认路径由 ADR-0131 supersede（不重写历史正文）  

**全迁移完成定义（B–F）：**

- [x] 默认写路径无 `contained_durable_replace` hard require  
- [x] workspace / memory / C-2C projection 统一 pathname `replaceDurably({ path })`  
- [x] dual modules 与 native tree 删除；capability 默认 `pathname_default`  
- [x] 目标 unit 通过（durable-file、workspace-write、memory-catalog、platform-capability、projection native-gone）  

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

| 风险 | 缓解 |
| --- | --- |
| 读者误以为「pathname = CAS」 | 正文与 non-claims 反复禁止；命名不得含 strict/CAS |
| 实现 PR 借机改 settlement | 硬边界 §2.3；与 sole-writer 大改分 PR |
| 半迁移状态双栈并存过久 | 按 Phase 分期；每 phase 可独立合并与回滚 |
| 删除 native 后 POSIX 旧测大面积红 | Phase F 改写/删除 contained 专测；保留 path containment 测 |
| doctor 仍展示旧 profile 误导 | Phase D 收口文案；在完成前可加「default 已改 pathname」注记 |

---

## 8. 一句话决策摘要

> **默认 durable 写 = 可信 root 内 pathname（temp → write → 可选 fsync → rename）；native descriptor 非默认；不宣称 CAS/power-loss；不借 shell/YOLO/marketplace；不拆 settlement sole-writer。**  
> ADR-0126 的 dual-profile **默认权威**由本 ADR supersede；历史分层结项保留为考古与回滚线索。实现已按 Phase B–F 分 PR 收口。

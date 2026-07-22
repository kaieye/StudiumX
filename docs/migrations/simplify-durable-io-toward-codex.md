# 简化 durable I/O：向 Codex pathname 模型迁移

- **状态：** **已实施**（2026-07-22）：Phase A–F 落地；pathname_default 为唯一默认写路径；native dual-profile 删除
- **日期：** 2026-07-22
- **动机：** 当前 descriptor / dual-profile / native 栈过重；对齐 Codex「root 约束 + temp+rename」即可，不追求 CAS / power-loss 合同。
- **对照：** `ref_project/codex`（只借写盘简单性；**不**引入 default shell / danger-full-access / MCP marketplace）。

---

## 1. 目标（一句话）

全平台统一为：**可信 root 内 pathname 写**（temp → write → 可选 fsync → rename），砍掉默认路径上的 native descriptor 与 POSIX/Windows 双协议。

---

## 2. 代码量对标（约数，按物理行）

### 2.1 StudiumX 现状（拟收缩）

| 块 | 约行数 | 说明 |
| --- | ---: | --- |
| `native/.../contained_durable_replace.cc` + gyp | **~1,310** | N-API descriptor 原语 |
| `contained-durable-directory.ts` | **~680** | TS 封装 |
| workspace contained create / restricted overwrite | **~860** | POSIX 双协议 |
| Windows direct-path workspace + memory | **~640** | 第二套后端 |
| platform-capability（shared + registry） | **~310** | 多 consumer 矩阵 |
| path containment（`workspace-path-target`） | **~100** | **保留** |
| `durable-file.ts`（pathname temp+rename） | **~300** | **保留并收口为唯一写原语** |
| settlement directory-sync 等 | **~190** | 按需收薄 |
| **生产合计（上表）** | **~4,400** | |
| 相关 unit（contained / dual-profile 为主） | **~2,000+** | 可删或大幅改写；其它 `*-durable` consumer 测多数可留 |

另：`prebuild` / 打包 `extraResources` 对 `.node` 的依赖一并去掉。

### 2.2 Codex 对标（我们要的「核」）

| 块 | 约行数 | 路径 |
| --- | ---: | --- |
| **`write_atomically` 本体** | **~15** | `codex-rs/utils/path-utils`（`NamedTempFile` + `persist`） |
| path-utils 整文件（含 symlink 解析等） | **~190** | 同上 |
| secrets 局部 atomic write | **~80** | `secrets/src/local.rs`（temp + sync + rename；Win 可删旧再 rename） |
| agent 默认写 | **~10** | `DirectFileSystem::write_file` → `tokio::fs::write` |
| create-new 特例（证书等） | **~80–100** | `network-proxy` 局部，**非**全局栈 |

Codex **没有** 与我们 `contained_durable_replace` 对等的 ~1.3k C++ / 双 profile 发布栈；复杂写是 **点状** 的，不是平台默认。

### 2.3 迁移后目标量级（本仓库）

| 目标 | 约行数 |
| --- | ---: |
| 统一 `write_atomically` / 收口后的 `replaceDurably(path)` | **~100–300**（在现有 `durable-file` 上瘦） |
| root / 相对路径约束 | **~100**（现有 path-target 级） |
| factory / 平台分支 | **~0–50**（尽量无；doctor 一句即可） |
| **生产净保留（写盘核）** | **~200–450** |
| **相对现状净减** | **约 3.5k–4k 生产行 + 相关测试** |

数量级：**Codex 核心 atomic 写 ≈ 十几行；我们收口后几百行内；现状四千行级。**

---

## 3. 分期（粗）

| Phase | 做什么 | 状态 |
| --- | --- | --- |
| **A** | 新 ADR：默认 pathname 模型；native **非**默认；不宣称 CAS | **完成**（[ADR-0131](../adr/0131-pathname-default-durable-io.md)） |
| **B** | workspace 写：POSIX/Win 同一 path 路径；去掉 contained create/overwrite 分支 | **完成**（`workspace-pathname-write.ts` + dual modules deleted） |
| **C** | memory：单 backend（list/read/`replaceDurably`）；删 Windows 专用 catalog 双轨 | **完成**（`record-file.ts` + catalog pathname-only） |
| **D** | capability registry / doctor → pathname_default | **完成**（`memoryIoProfile()` → `pathname_default`） |
| **E** | 去 `prebuild`/打包 `.node`；native 目录删除 | **完成**（`native/contained-durable-replace` removed） |
| **F** | 测试与 SECURITY/ADR 勾选同步；CI 不再编 native | **完成**（dual/native tests rewritten or deleted） |

可合并 PR，但不建议与 settlement sole-writer 大改同 PR。

---

## 4. 明确不做

- 不引入 Codex **default shell / YOLO / danger-full-access**
- 不引入 OS sandbox 产品面（bwrap / seatbelt / RestrictedToken）当写盘替代
- 不把 Windows 较弱写改名为 strict/CAS
- 不借机拆 `TeachingTurnCoordinator` settlement sole-writer

---

## 5. 成功标准

1. [x] 默认写路径 **零** 对 `contained_durable_replace.node` 的硬依赖（native tree + require 路径已删；仅注释/否定断言残留）  
2. [x] workspace + memory：**一套** I/O，无 POSIX/Windows 双协议文件（dual modules deleted；catalog/workspace/projection 均 path `replaceDurably`）  
3. [x] 写盘核不再维持千行 native + 双 profile（保留 `durable-file` ~350 + `workspace-pathname-write` ~275 + path-target ~120 + memory `record-file` ~370）  
4. [x] 文档与 doctor **不**再暗示 descriptor-strict 为全平台默认（ADR-0131 / doctor-snapshot / Settings `pathname_default`）  

---

## 6. 相关

- 旧分层（**默认路径已由 ADR-0131 supersede**；历史结项保留）：[ADR-0126](../adr/0126-codex-style-platform-capability-profiles-and-consumer-migration.md)
- 新默认写模型决策：[ADR-0131](../adr/0131-pathname-default-durable-io.md)  
- Codex 参考：`ref_project/codex/codex-rs/utils/path-utils/src/lib.rs`（`write_atomically`）  
- 现成收口点：`src/main/persistence/durable-file.ts`

---

## 7. 实施落点（2026-07-22）

| 区域 | 路径 |
| --- | --- |
| 写原语 | `src/main/persistence/durable-file.ts`（pathname-only `replaceDurably`） |
| workspace | `src/main/ai/tools/workspace-pathname-write.ts` + `workspace-path-target.ts` |
| memory | `src/main/teaching-memory-catalog/record-file.ts` + catalog |
| projection | `src/main/agent-conversation-summary-projection.ts` → `replaceDurably({ path })` |
| capability | `src/main/platform/platform-capability-registry.ts`（`pathname_default`） |
| 已删 | `native/contained-durable-replace/**`、`contained-durable-directory.ts`、Windows dual workspace/memory modules、contained create/overwrite |

**非宣称：** 仍 **不** 宣称 CAS / power-loss / OS sandbox；Windows overwrite 为 unlink-then-rename 一次（非 atomic exchange）。

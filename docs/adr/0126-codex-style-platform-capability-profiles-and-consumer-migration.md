# ADR-0126：Codex 式平台能力分层（Platform Capability Profiles）与 consumer 迁移

- **状态：** **已实施（分 phase 结项）** — 2026-07-22 本地落地；outcome/audit Windows 仍 unavailable（诚实边界）。**默认写模型**由 [ADR-0131](0131-pathname-default-durable-io.md) supersede（pathname-default；native descriptor **非**默认）；本文件历史 dual-profile 结项与 inventory **保留**，不重写。
- **日期：** 2026-07-22
- **作者动机：** Windows 上 descriptor-relative catalog 把聊天热路径 fail-closed；产品要求改为 **Codex 式分层**：不同平台显式命名不同合同，热路径可降级，教学权威写路径仍 fail-closed，且 **禁止** 把较弱 profile 伪装成 POSIX CAS / strict。
- **相关已实施决定：** [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)（C-4 durable publish / P8 Windows direct-path）、[ADR-0006](0006-scoped-memory-partition-and-readonly-migration-preflight.md)（Memory 分区与 descriptor I/O）、[ADR-0035](0035-c4-p6-p8-p9-closeout-scope-decisions.md)（Windows strict no-go）、[ADR-0052](0052-provider-error-and-recovery-taxonomy.md) / [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)（空流与有界 retry）、[SECURITY.md](../../SECURITY.md)、`AGENTS.md` 产品地板。
- **参考实现（只借鉴分层，不抄产品面）：** `ref_project/codex`（`SandboxMode` / `SandboxPolicy` / `windows_sandbox` 分层；**不**引入 `danger-full-access` 产品标签或默认 shell）。workspace 侧已有同思路代码：`src/main/ai/tools/windows-direct-path-workspace-write.ts`。

---

## 1. 背景：问题不是“太严”，而是“合同没分层”

### 1.1 现状（as-is）

| 子系统 | POSIX | Windows | 聊天 / UX 行为 |
| --- | --- | --- | --- |
| `write_workspace_file`（C-4P8） | descriptor-bound profile | **已批准** direct-path non-CAS profile | registry 按 profile 可用性注册 |
| Learning-outcome settlement（C-4P6） | 受限 macOS/APFS profile 结项 | **不**宣称 Windows strict | fail-closed / review |
| Memory catalog / CRUD / C-6 discovery（C-6） | descriptor-relative | `unsupported_platform` 抛错 | **曾**在 `listMemories` 热路径直接炸整 turn（已有 runtime soft-fail 补丁，但 **无正式 profile 合同**） |
| Provider SSE | 无关平台 | 无关平台 | 空流曾硬失败；现有 JSON 回退 + recovery taxonomy |

结果：同一句用户消息同时踩到 **“教学权威 fail-closed”** 与 **“平台能力缺失”**，用户体感是“百分百不能聊天”，并质疑严格性。

### 1.2 Codex 的可借鉴点（borrow）

Codex **不是**在 Windows 上假装有 Linux bubblewrap / openat CAS，而是：

1. **显式模式枚举**（`read-only` | `workspace-write` | …），策略与实现分离。
2. **平台专属层**（`windows-sandbox-rs`、`WindowsSandboxLevel`：Disabled / RestrictedToken / Elevated），能力用 readiness 表达，而不是静默降级为“同等安全”。
3. **路径先约束到可信 root，再走该平台允许的 I/O**（与我们 P8 Windows direct-path 注释一致：“follows Codex Rust's layered model”）。
4. **沙箱/工具失败 ≠ 对话管道死亡**；传输层空响应走 retry（见 hermes/grok；我们 ADR-0052/0057 已部分对齐）。

### 1.3 明确不借鉴（non-borrow / 产品地板）

| Codex / 通用 agent 常见项 | StudiumX |
| --- | --- |
| `danger-full-access` / YOLO / always-approve 标签 | **禁止**（`AGENTS.md` / SECURITY） |
| 默认通用 shell / 任意代码执行产品路径 | **禁止** |
| MCP marketplace / 默认任意 MCP | **禁止** |
| 把 Windows 较弱写路径称为 strict / CAS | **禁止**（ADR-0035） |
| 用 soft reminder 替代硬预算 / settlement sole-writer | **禁止** |

本 ADR **只迁移“平台能力分层 + consumer 接线”**，不改 teaching settlement authority、不引入 shell 产品面。

---

## 2. 决定（design gate 批准后才可实施）

### 2.1 引入统一的 Platform Capability Profile 模型

在 main 进程暴露只读、稳定、**无本地路径/无 errno 细节** 的能力描述：

```ts
/** 稳定 public / doctor 可读命名；不得用 marketing 语言伪装强度 */
type PlatformIoProfileId =
  | 'posix_descriptor_strict'      // openat / no-follow / temp+publish 类
  | 'windows_direct_path_non_cas'  // root-constrained pathname；已用于 P8
  | 'unavailable'                  // 本 host 无安全可用 profile

type ConsumerCapabilityClass =
  | 'chat_hot_path_read'           // 发消息前 list/inject；可降级为空
  | 'durable_authority_write'      // memory CRUD、outcome publish 等；不可静默假成功
  | 'durable_authority_read'       // 权威读（设置页 catalog、migration preflight）
  | 'workspace_tool_write'         // write_workspace_file（已分层）
  | 'projection_rebuild'           // 可重建投影；可 defer

type ConsumerPlatformCapability = {
  consumer: string                 // 如 'teaching_memory_catalog'
  class: ConsumerCapabilityClass
  profile: PlatformIoProfileId
  available: boolean
  /** 仅稳定 code，禁止 path / addon 路径 / raw message 外泄到 renderer */
  code?:
    | 'ok'
    | 'degraded_empty'
    | 'write_unavailable'
    | 'containment_unavailable'
    | 'unsupported_platform'
    | 'native_unavailable'
  /** doctor / support 用短说明 key，走 i18n */
  messageKey?: string
}
```

**规则：**

1. **每个 consumer 单独声明** 自己在当前 host 上的 `profile` 与 `class`；共享原语存在 ≠ 所有 writer 自动可用（延续 ADR-0004 partial migration）。
2. **`chat_hot_path_read`：** profile 不可用时必须 **degrade**（空列表 / 跳过工具注册），**禁止** 把 `unsupported_platform` 抛到 turn 顶层。
3. **`durable_authority_write`：** profile 不可用时 **fail-closed**（稳定 error code），**禁止** pathname 假成功；也 **禁止** 在无 profile 时仍展示“已保存”。
4. **命名诚实：** `windows_direct_path_non_cas` 永远不得改名为 `strict` / `cas` / `descriptor-equivalent`。
5. **Windows strict（HANDLE-relative + publish-point identity CAS）** 仍按 ADR-0035 为 **unsupported / no-go**，除非未来**独立新 ADR** 提供审计证据。本 ADR **不**重开 strict 工作线。

### 2.2 与 Codex 的对应关系（概念映射，非 API 兼容）

| Codex | StudiumX（本 ADR） |
| --- | --- |
| `SandboxMode` / `SandboxPolicy` | `PlatformIoProfileId` + `ConsumerPlatformCapability` |
| Windows sandbox level / readiness | per-consumer capability + `pnpm doctor` 投影 |
| workspace-write 可写 root 列表 | 既有 workspace root containment（不扩张为任意 root） |
| danger-full-access | **不存在** |
| 工具在 sandbox 外失败 | tool / IPC 稳定 code；**不**杀死 SSE 管道 |

### 2.3 对 ADR-0035 / 0004 / 0006 的关系

| 既有 ADR | 本 gate 是否修改其结项 |
| --- | --- |
| ADR-0035 Windows **strict** no-go | **不修改**；仍 no-go |
| ADR-0004 P8 Windows direct-path non-CAS | **保留**；作为 workspace_tool_write 的既有 profile 样板 |
| ADR-0006 Memory descriptor I/O | **扩展**：允许 Windows 上为 Memory 增加**显式较弱** read/write profile（见 §3），须分 consumer 迁移，不得静默替换 POSIX 语义 |
| ADR-0004 “未审查 writer 不自动迁移” | **保留**；本 gate 只批准下列 consumer 切片清单 |

**批准后的权威顺序：** 实施切片以本 ADR 分阶段勾选为准；冲突时 **教学 settlement / sole-writer / 产品地板** 优先于“与 Codex 对齐”的便利。

---

## 3. 目标架构（to-be）

```
                    ┌─────────────────────────────────────┐
                    │  PlatformCapabilityRegistry (main)  │
                    │  resolve(consumer) → capability     │
                    └──────────────┬──────────────────────┘
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
  chat_hot_path_read     durable_authority_*        workspace_tool_write
  degrade → empty        fail-closed 或             POSIX descriptor
  never throw to turn    显式较弱 profile 写         或 Windows direct-path
           │                       │                       │
           ▼                       ▼                       ▼
  conversation runtime    memory IPC / tools        write_workspace_file
  listMemories / inject   catalog CRUD              (已有)
```

### 3.1 I/O 后端选择（实现层）

| Profile | 读 | 写 / publish | 适用 consumer（首期） |
| --- | --- | --- | --- |
| `posix_descriptor_strict` | descriptor list/read | temp + atomic publish / restricted overwrite | macOS/Linux：memory、既有 P8 |
| `windows_direct_path_non_cas` | root + realpath/lstat 约束后的 direct read/list | `wx` / `r+` truncate 类（对齐 P8 模块） | Windows：memory catalog **新 profile**；workspace write **已有** |
| `unavailable` | n/a | n/a | 未知平台；全部 durable write 不可用 |

**Memory 在 Windows 上的合同（本 gate 拟批准的较弱语义）：**

- **读（list / recall inject / settings 只读列表）：** 允许 `windows_direct_path_non_cas` 下列目录与读 JSON；仍拒绝 workspace 外路径、symlink-as-directory 穿越（沿用 `resolveWorkspacePathTarget` / 等价 containment，**不得**弱于 P8 已用检查）。
- **写（create/update/delete memory record）：** 允许同一 profile 的 create/overwrite，但结果码与 P8 对齐：`possibly_published` / `target_changed` 等 **不可自动 retry/rollback**；UI 必须显示“Windows 有限持久化（非 descriptor）”。
- **migration preflight / destructive C-6：** 仍 defer（ADR-0038）；Windows 较弱 profile **不**自动授权 destructive migration。
- **不得**声称与 POSIX memory 相同的 crash/power-loss / TOCTOU 边界。

### 3.2 错误与 UX 分层

| 场景 | 稳定 code / UX | 是否阻断发消息 |
| --- | --- | --- |
| Windows 上 list memory 不可用（过渡期） | `degraded_empty` + doctor 提示 | **否** |
| Windows 上 memory 写（profile 落地后）失败 | `write_unavailable` / `possibly_published` | 否（仅该操作失败） |
| 用户调用 memory 工具但 write profile 未注册 | 工具未注册或 tool error 稳定文案 | 否 |
| learning-outcome settlement 失败 | 既有 reconciliation / review | 教学路径既有策略 |
| Provider 空流 | `empty_stream` + 有界 retry / JSON fallback | 否（耗尽后可失败） |

文案原则：区分 **“平台能力降级”** 与 **“模型/网络错误”**，禁止再把 descriptor 英文异常直接抛给用户。

---

## 4. 迁移分期（实施切片）

> 每期必须：**独立 PR**、可回滚、带 unit（必要时 integration）、更新本 ADR 状态勾选与 `docs/adr/README.md` 链接。  
> **禁止** 单 PR 同时搬迁 memory + outcome + audit + UI 大爆炸（ADR-0075 / 巨石 peel 纪律）。

### Phase 0 — Design gate 冻结（文档 only，本文件）

**目标：** 范围、命名、non-claims、consumer 清单、验收闸获得批准。

**交付：**

- [x] 本 ADR 标记从 Proposed → **Accepted（gate open）** / 已实施分 phase
- [x] `docs/adr/README.md` 增加“平台能力分层 / Windows memory”索引行
- [x] 明确 **不** 打开：shell、YOLO、Windows strict CAS、destructive memory migration、MCP marketplace

**退出标准：** 维护者书面/PR 批准 gate；无代码强制变更。

---

### Phase 1 — Capability registry + 聊天热路径合同化

**目标：** 把“运行时 soft-fail”升级为**正式 API**，所有聊天路径只依赖 registry，而不是散落 `try/catch`。

**代码触点（预期）：**

| 区域 | 动作 |
| --- | --- |
| `src/main/persistence/` 或 `src/main/platform/` | 新增 `platform-capability-registry.ts`（纯解析 + 平台探测） |
| `src/main/teaching-conversation-runtime.ts` | `loadTeachingMemoryCatalogForTurn` 只读 registry；保留 degrade |
| `src/main/ai/tools/memory-tools.ts` | 按 capability 决定是否注册 write/read tools |
| doctor / diagnostics | 投影 `ConsumerPlatformCapability[]`（脱敏） |
| tests | registry 矩阵：darwin/linux/win32 × consumer class |

**行为：**

- win32 + memory `chat_hot_path_read` → `available: true, profile: windows_…` **或** 过渡期 `degraded_empty`（若 Phase 2 未完成，允许先 `available: true` + empty + `code: degraded_empty`，但 **不得** 抛 descriptor 异常）。
- 任何 `NativeContainedDurableReplaceUnavailableError` **不得** 逃出 conversation turn 边界。

**验收：**

```sh
pnpm typecheck
pnpm exec vitest run --project unit \
  tests/unit/platform-capability-registry.unit.test.ts \
  tests/unit/teaching-conversation-runtime.unit.test.ts
pnpm run check:security
```

**Non-goals：** 尚不实现 Windows memory 真实读写后端。

---

### Phase 2 — Memory catalog：Windows direct-path profile（读优先，写随后）

**目标：** 在 Windows 上提供**诚实命名**的 memory 读写，复用 P8 containment 思路，**不**加载 POSIX descriptor 冒充。

**建议子切片：**

| 切片 | 内容 | 验证 |
| --- | --- | --- |
| **2A 读路径** | `list` / index scan / recall 所需 discovery 走 direct-path list+read；symlink/root 检查对齐 `workspace-path-target` | `teaching-memory-catalog.unit.test.ts` + win32 fixture |
| **2B 写路径** | create/update/delete 走 direct-path create/overwrite；结果码对齐 P8 稳定集合子集 | catalog mutation unit + IPC gateway unit |
| **2C 工具与 consent** | memory tools 仅在 write capability `available` 时注册；consent 写同样受 profile 约束 | runtime + memory-tools tests |
| **2D UI / i18n** | Settings / doctor 显示“Windows：有限持久化（direct-path，非 descriptor）” | i18n + 快照或文案检查 |

**实现约束：**

1. **优先 peel 新模块**（例如 `windows-direct-path-memory-catalog.ts`），避免继续膨胀 `teaching-memory-catalog.ts` 巨石（ADR-0075）。
2. 与 `windows-direct-path-workspace-write.ts` **共享** path containment 原语，禁止复制一套更弱的 resolve。
3. POSIX 路径保持 descriptor；`process.platform` 分支只在 registry / factory，不在每个 call site 散落。
4. **Fail closed 保留场景：** 路径逃逸、非 regular 目标、不确定 publish → 稳定 error，不 retry 删文件。

**验收：**

```sh
pnpm typecheck
pnpm run check:security
pnpm run check:tool-contract   # 若工具注册表有变
pnpm exec vitest run --project unit \
  tests/unit/teaching-memory-catalog.unit.test.ts \
  tests/unit/teaching-memory-recall.unit.test.ts \
  tests/unit/teaching-ipc-gateway.unit.test.ts \
  tests/unit/teaching-conversation-runtime.unit.test.ts
```

**数据迁移：**  
- **不**自动改写已有 memory 文件格式。  
- legacy flat → scoped 仍只读 preflight（ADR-0006/0038）。  
- Windows 上首次可用时：能读既有 JSON 则读；不能证明安全则 recovery issue，不静默丢弃用户可见数据且不瞎删。

---

### Phase 3 — 其余 descriptor consumer 清点与分类接线

**目标：** 全库检索仍调用 `openContainedRootDirectory` / native replace 的 consumer，逐个贴上 capability class。

**清点方法（实施时执行）：**

```sh
# 示例：定位仍绑定 descriptor 原语的 call site
rg -n "openContainedRootDirectory|replaceAtContainedDirectory|NativeContainedDurableReplace" src/
```

**分类模板：**

| consumer | class | Windows 策略 |
| --- | --- | --- |
| teaching_memory_catalog | read/write authority | Phase 2 profile |
| conversation 热路径 listMemories | chat_hot_path_read | degrade 或 2A |
| C-2C / summary 等 projection | projection_rebuild | defer 或 direct-path 只读重建；失败不阻断 chat |
| write_workspace_file | workspace_tool_write | **已完成** P8 |
| learning-outcome committer | durable_authority_write | **保持**既有 profile；Windows 不宣称 P6 strict |
| session audit jsonl | durable_authority_write | **保持** ADR-0019/0035 边界 |
| music cookie / 其它 C-4 已迁移 | 既有 | 不在本 ADR 扩张 |

每项 consumer 迁移仍遵守 ADR-0004：**未审查不自动挂新 profile**。

**验收：** doctor 输出完整 consumer 表；unit 保证 chat 路径无 descriptor throw。

---

### Phase 4 — Provider / 空流与平台错误 UX 收口

**目标：** 用户不再看到裸英文 descriptor 异常；空流与平台降级文案分离。

**动作：**

- 确认 `invocation.ts` 空 SSE → JSON fallback 保留；与 ADR-0057 loop retry 不双计费混乱（文档化 attempt 边界）。
- `classifyProviderRecovery` 的 `empty_stream` 与 `unsupported_platform` **分轴**（后者不是 provider error）。
- renderer `operationFeedback`：平台 degrade 用独立 i18n key。

**验收：**

```sh
pnpm run check:provider-errors
pnpm exec vitest run --project unit \
  tests/unit/provider-sse-reasoning.unit.test.ts \
  tests/unit/provider-recovery.unit.test.ts \
  tests/unit/operation-feedback.unit.test.ts
```

---

### Phase 5 — 文档、doctor、发布证明与 close-out

**目标：** 发布说明与 Win/Mac 证明诚实。

**交付：**

- [x] 更新 `SECURITY.md` 一句：Windows memory/workspace 为 layered non-CAS，非 OS sandbox 宣称
- [x] 更新 ADR-0004 / 0006 “后果”交叉链接到本 ADR（**不**改写其历史 evidence 段落）
- [x] `pnpm doctor -- --json` 含 profile 字段（`scripts/lib/doctor-snapshot.mjs` → `platformCapabilities`）
- [x] Windows memory 可用证据：`tests/unit/teaching-memory-catalog-windows-direct-path.unit.test.ts` + `teaching-ipc-gateway` Windows memory 路径（host win32 unit）
- [x] 本 ADR 状态 → **已实施（分 phase 勾选）**；outcome/audit Windows 仍 unavailable，不宣称“全部平台同等”

**明确永不在本 ADR close-out 内：**

1. Windows strict descriptor/CAS  
2. YOLO / danger-full-access / 默认 shell  
3. destructive memory migration  
4. 跨文件 transaction  
5. 远程 telemetry  

---

## 5. 详细迁移步骤（工程师 checklist）

### 5.1 实施前

1. 读完 ADR-0004 § Windows profile、ADR-0035、ADR-0006、本文件 §2–§3。  
2. 确认产品地板未破：`AGENTS.md` 红线 1–10。  
3. Phase 0 gate 已 Accepted。  
4. 开分支：`feat/platform-capability-phase-N-…`。

### 5.2 Phase 1 落地顺序

1. 添加 `PlatformIoProfileId` / `ConsumerPlatformCapability` 类型（`src/shared/` 若需 IPC 可见则放 shared，否则 main-only）。  
2. 实现 registry：`resolvePlatformCapabilities({ platform, nativeAvailable })`。  
3. 接线 conversation runtime + memory tool 注册。  
4. 单测矩阵 + 回归“memory catalog platform degradation”。  
5. doctor 只读投影。  
6. PR 描述写明：**未**启用 Windows memory 写。

### 5.3 Phase 2 落地顺序

1. 抽出/复用 path containment（与 P8 同一模块或再 peel 共享）。  
2. 实现 Windows memory **read** backend；factory：`createTeachingMemoryCatalogIo(capability)`。  
3. POSIX 仍走 contained-durable；测试双 backend。  
4. 再实现 **write** backend；IPC gateway 从“Windows fail-closed 测”改为“Windows profile 合同测”（**改测试预期须在 PR 说明**）。  
5. UI 能力徽章 / 设置页提示。  
6. 手工：Windows 上发消息、list memory、写一条 memory、重启后再读。

### 5.4 回滚策略

| Phase | 回滚 |
| --- | --- |
| 1 | 恢复 throw→degrade 的最小 try/catch；registry 可 feature-flag 关闭 |
| 2 | factory 强制 memory → `unavailable` + chat degrade；删除 Windows backend 注册 |
| 3+ | 按 consumer 单独 revert；禁止半套 profile 名称残留 |

回滚 **不得** 重新引入“聊天因 descriptor 百分百失败”。

### 5.5 测试与门禁映射

| 变更 | 至少跑 |
| --- | --- |
| registry / runtime | unit + `check:security` |
| memory catalog / IPC | `teaching-memory-*` unit、`teaching-ipc-gateway`、相关 integration |
| 工具注册 | `check:tool-contract` |
| provider 空流 | `check:provider-errors` + SSE unit |
| 任意 TS | `pnpm typecheck` |

---

## 6. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 把 direct-path 误写成“已等同 POSIX” | 命名冻结 + code review 检查表 + SECURITY 句 |
| TOCTOU / symlink 替换 | 不宣称 CAS；containment 检查 + 失败码；不自动删 |
| 测试在 Linux CI 假绿 Windows | win32 单测用 `platform: 'win32'` 注入；关键路径加 fixture |
| 巨石文件继续膨胀 | 强制新模块 + ADR-0075 行数警告 |
| 与 settlement 错误混用 soft-fail | capability class 强制：authority_write 禁止 degrade-to-success |
| 用户以为 memory 在 Windows “永久安全” | UI 明确“有限持久化”；doctor 显示 profile id |

---

## 7. 成功标准（Definition of Done）

1. Windows 上连续发送聊天 **不再** 出现 `Descriptor-relative contained directory access is unavailable on this platform.` 作为 turn 失败原因。  
2. Memory：Windows 在 Phase 2 完成后可 list/write，且 doctor 显示 `windows_direct_path_non_cas`。  
3. macOS/Linux memory 行为与 descriptor 合同 **无回归**。  
4. 无 YOLO/shell/Windows-strict 声明混入文档或 UI。  
5. ADR-0035 strict no-go 仍成立。  
6. 空流失败率：保留有界 retry/fallback，与平台 degrade 文案不混淆。

---

## 8. 非目标（Non-claims）

- 不提供 Docker 级 OS isolation。  
- 不提供 Windows publish-point file-ID CAS。  
- 不迁移全部 C-4 writer 到新 registry（仅清单内 consumer）。  
- 不授权 C-6 destructive migration。  
- 不改变 TeachingTurnCoordinator settlement sole-writer。  
- 不引入默认远程 telemetry。

---

## 9. 建议 PR 序列（可直接当分派单）

| PR | 标题（建议） | 依赖 |
| --- | --- | --- |
| PR-0 | `docs: ADR-0126 Codex-style platform capability profiles (design gate)` | — |
| PR-1 | `feat: platform capability registry + chat hot-path contract` | PR-0 Accepted |
| PR-2a | `feat(win32): memory catalog direct-path read profile` | PR-1 |
| PR-2b | `feat(win32): memory catalog direct-path write + tools` | PR-2a |
| PR-2c | `feat(ui): memory platform profile messaging` | PR-2b |
| PR-3 | `chore: classify remaining contained-durable consumers` | PR-1 |
| PR-4 | `fix: separate platform-degrade vs empty-stream feedback` | PR-1 |
| PR-5 | `docs: SECURITY + doctor profile close-out for Windows memory` | PR-2b |

---

## 10. 附录 A — 与 ref_project 对照摘要

| 项目 | 路径模型 | 空流 | 对 StudiumX 的启示 |
| --- | --- | --- | --- |
| codex | 分层 sandbox + Windows 专层 | 复杂但管道不因 sandbox readiness 单独砖掉 chat | **主模板**：显式 profile + readiness |
| hermes | pathname deny/safe-root | EmptyStreamError + retry | 空流 retry；路径可弱但 **我们不把 authority 降到 hermes 级** |
| pi | 普通 fs + cwd | 跳过空 assistant | UX 容错 |
| grok | 产品采样 | Empty → retry | 空响应 retry |
| Reasonix | workspace 工具 | 控制面文案 | 失败可解释 |

---

## 11. 附录 B — 已存在的可复用代码（避免重写）

| 资产 | 路径 | 复用方式 |
| --- | --- | --- |
| Windows workspace direct-path | `src/main/ai/tools/windows-direct-path-workspace-write.ts` | 写语义样板 + 注释中的 Codex 分层表述 |
| Path containment | `src/main/ai/tools/workspace-path-target.ts`（及 P8 相关） | Memory Windows 读/写共用 |
| Descriptor 原语 | `src/main/persistence/contained-durable-directory.ts` | POSIX only；unavailable 错误类型 |
| Chat degrade 补丁 | `src/main/teaching-conversation-runtime.ts` `loadTeachingMemoryCatalogForTurn` | Phase 1 合同化入口 |
| 空流 fallback | `src/main/ai/provider-adapter/invocation.ts` / `sse-parser.ts` | Phase 4 保留并文档化 |
| Memory 分区 | `src/main/teaching-memory-catalog.ts` + `record-file.ts` | factory 注入 I/O，避免复制业务规则 |

---

## 12. 附录 C — 批准检查表（gate 评审用）

- [ ] 是否接受 Windows memory 为 **non-CAS direct-path**，并在 UI/doctor 诚实展示？  
- [ ] 是否确认 **不** 重开 Windows strict？  
- [ ] 是否确认 chat_hot_path **必须** degrade 而非 fail-closed？  
- [ ] 是否确认 durable_authority_write **禁止** 假成功？  
- [ ] 是否确认不引入 danger-full-access / 默认 shell？  
- [ ] 是否接受 Phase 2 分 2A/2B 以降低 PR 风险？  
- [ ] 是否指定 Windows 手工验收 owner？

**Gate 批准签字栏（PR 描述填写）：**

- 批准人：  
- 日期：  
- 批准范围：Phase _____（例如 1+2A only / 1–2 全开）  
- 附加约束：  

---

## 13. 实施后状态区（落地时改，勿在 Proposed 阶段勾完成）

| Phase | 状态 | 证据（commit / PR） |
| --- | --- | --- |
| 0 Design gate | **完成** | 本文 + `docs/adr/README.md` + SECURITY non-claim |
| 1 Registry + chat contract | **完成** | `src/shared/platform-capability.ts`, `src/main/platform/platform-capability-registry.ts`, `loadTeachingMemoryCatalogForTurn`, unit: `platform-capability-registry`, `teaching-conversation-runtime` |
| 2A Memory win32 read | **完成** | `windows-direct-path-memory-catalog.ts` discover/read; catalog `ioProfile` dispatch |
| 2B Memory win32 write | **完成** | replace/create wx + r+; catalog `commit` Windows branch; IPC unit win32 path |
| 2C Tools / consent | **完成** | `memory-tools.ts` `writeAvailable`; runtime gates write tools via `isMemoryAuthorityWriteAvailable` |
| 2D UI / i18n | **完成** | `TeachingMemoryDiagnostics.platformIoProfile`; Settings badge; `platformCapability.*` / `memory.platformProfile.*` i18n |
| 3 Consumer 清点 | **完成（分类接线，不自动扩写）** | registry consumers + inventory appendix §13.1；未审查 writer 保持既有 durable-file 合同 |
| 4 Provider UX 收口 | **完成** | `provider-recovery` `reasonCode: platform_capability`；`operationFeedback` 平台 vs empty stream 分轴 |
| 5 Docs / doctor close-out | **完成** | SECURITY.md；doctor `platformCapabilities`；本表 |

---



### 13.1 Consumer inventory（Phase 3 执行结果，路径级）

Registry 已接线（`resolvePlatformCapabilities`）：

| consumer id | class | Windows | 代码入口 |
| --- | --- | --- | --- |
| `write_workspace_file` | workspace_tool_write | `windows_direct_path_non_cas`（P8 既有） | `windows-direct-path-workspace-write.ts` |
| `teaching_memory_chat_hot_path` | chat_hot_path_read | available direct-path **或** degrade empty | `teaching-conversation-runtime.ts` |
| `teaching_memory_authority_read` | durable_authority_read | direct-path | catalog `list`/`find` |
| `teaching_memory_authority_write` / `teaching_memory_catalog` | durable_authority_write | direct-path non-CAS | catalog `commit` + memory tools |
| `learning_outcome_committer` | durable_authority_write | **unavailable**（不宣称 P6 strict） | settlement path 保持 ADR-0035 |
| `session_audit_jsonl` | durable_authority_write | **unavailable** | ADR-0019/0035 边界 |

仍使用 `durable-file` / contained-directory 原语、**本 ADR 不自动挂新 profile**（ADR-0004 partial migration 纪律）的 call site 摘要：

- POSIX memory path only: `teaching-memory-catalog/record-file.ts`
- Workspace descriptor helpers: `workspace-contained-*.ts`, `ai/tools/workspace.ts`
- Settlement I/O: `settlement-durable-io.ts`, `learning-outcome-committer.ts`
- Other durable JSON writers（既有合同）: `agent-conversation-*`, `course-definition-store`, `teaching-workspace*`, `teaching-settings`, `study-planning-durable-store`, `music-cookie-store`, `direct-lesson-action`, `teaching-turn-review-last-bundle-fs`

Chat 路径不得再让 `NativeContainedDurableReplaceUnavailableError` 逃出 turn（runtime catch + registry gate）。


### 13.2 验收命令证据（本机 2026-07-22 win32）

| 命令 | 结果 |
| --- | --- |
| registry + chat + win memory + IPC + UX units | **pass**（含 `platform-capability-registry`、`teaching-memory-catalog-windows-direct-path`、`teaching-conversation-runtime`、`teaching-ipc-gateway` win32 memory、`provider-recovery`、`operation-feedback`、`provider-sse-reasoning`） |
| `pnpm run check:security` | **ok** |
| `pnpm run check:provider-errors` | **ok** |
| `pnpm run check:tool-contract` | **ok**（16 tools） |
| `pnpm run doctor -- --json` → `platformCapabilities` | memory/workspace = `windows_direct_path_non_cas`；outcome/audit = `unavailable`；含 authority_read/write 全量 consumer 表 |
| `pnpm typecheck` 全仓 | **仍有**与本 ADR **无关** 的既有/并行 WIP 错误（lesson generation、session-resume-picker、study-planning 并行改动）。过滤本 ADR 触达路径：**零** `error TS`。 |

POSIX catalog unit（`describe.runIf(process.platform !== 'win32')`）在 win32 主机上 skip；由 registry 矩阵 + 历史 POSIX 路径保持 + 无改写 descriptor 合同覆盖「无回归」声明。

## 14. 一句话决策摘要

> **学 Codex：平台能力分层、显式较弱 Windows profile、热路径可降级；不学 Codex：danger-full-access / 默认 shell；不学“假 CAS”。**  
> 迁移顺序：**registry 合同化 → Windows memory 读 → 写 → 其它 consumer 分类 → UX/doctor 诚实收口**；每步独立 PR，权威写路径永不静默假成功。

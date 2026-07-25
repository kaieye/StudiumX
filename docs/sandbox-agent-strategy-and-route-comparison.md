# StudiumX Agent Sandbox：问题全景、ref_project 对照与路线建议

> **状态：** 分析与决策记录（非 ADR 正文；架构硬边界以 ADR 为准）  
> **日期：** 2026-07-25  
> **范围：** 教学 Agent 的 shell / 命令执行与 OS 级沙箱策略；Codex / pi / Grok / Reasonix 等参考实现对照；是否因 Windows helper 二进制而改路线  
> **实施权威（交付路线）：** [agent-shell-sandbox-delivery-roadmap.md](./agent-shell-sandbox-delivery-roadmap.md) — **Completed 2026-07-25**：Agent Shell / Sandbox qualified（without Windows OS helper）；本文仅作对照与换线否决背景  
> **关联 ADR：** [ADR-0152](adr/0152-workspace-shell-and-codex-aligned-approval.md)（审批轴地基；**部分被 0153 supersede / 非合格结项**）、[ADR-0153](adr/0153-codex-sandbox-dual-axis-and-agent-shell.md)（双轴 + shell 意图；**provisional**；合格结项以 delivery roadmap 为准）、[ADR-0126](adr/0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（平台 I/O 分层；**不**承担 shell 产品面）  
> **参考树：** `ref_project/codex`、`ref_project/pi-main`、`ref_project/grok-build-main`、`ref_project/Reasonix`、`ref_project/sandbox`（OpenSandbox / CubeSandbox）

---

## 1. 要解决什么问题

StudiumX 希望 Agent **本质上具备主流 coding agent 能力**（含 shell / 脚本命令），教学（Mission、Evidence、settlement）是特化层，而不是「阉割版无 shell 助手」。

同时必须满足产品地板：

- 工具总开关、审批与 effect lattice 仍在；
- **禁止** YOLO / always-approve / DangerFullAccess 产品标签；
- **禁止**把 policy 围栏或半吊子包装宣传成 Docker / microVM 级隔离；
- 命令输出 **不是** teaching Evidence / settlement 权威；
- Windows 为主战场时，平台能力必须 **诚实分层**（ADR-0126），不能静默伪造成 Linux 同级。

由此产生一串纠缠问题：

1. 多 skill / 教学链路与编排（另文）；与本文交叉点是 **工具与沙箱不得改写教学 authority**。  
2. 是否允许 shell、如何审批（Codex `AskForApproval` 三态）。  
3. 是否 / 如何做 OS 级 sandbox（Codex `SandboxMode` + 平台原语）。  
4. 完整迁移 Codex 时发现 **Windows RestrictedToken 依赖 helper 二进制**——是否因此 **整线改投 pi 或 Grok sandbox**。

本文把 **sandbox / shell 相关问题、对照与路线建议** 一次写清，便于评审与后续 ADR 修订。

---

## 2. 三层模型（避免苹果比橙子）

讨论「sandbox」时必须先分层，否则会把容器平台、进程级 Landlock、per-command bwrap 混为一谈。

| 层 | 含义 | 典型实现 |
| --- | --- | --- |
| **L0 策略 / 审批** | 能不能跑、要不要问人、模式枚举 | Codex `AskForApproval` × `SandboxMode`；StudiumX `approvalMode` × `sandboxMode` |
| **L1 路径与 argv 围栏** | 工作区 cwd、token 化 argv、safelist、敏感路径 deny | policy_fence、Reasonix 写根、pi deny-read 列表 |
| **L2 per-command OS 包装** | 每条命令套 seatbelt / bwrap /（Windows）helper | Codex sandboxing transform；pi `wrapWithSandbox`；Reasonix `Command`/`CommandArgs` |
| **L3 进程级内核沙箱** | 整个 Agent 进程生命周期内 Landlock/Seatbelt | Grok `xai-grok-sandbox` + `nono` |
| **L4 远程 / 虚拟化沙箱** | 容器、K8s、microVM | OpenSandbox、CubeSandbox |

StudiumX 当前产品主路径是 **L0 + L1 +（Unix 上的）L2 子集**。  
**L3 / L4 不是默认桌面路径**；L4 与「本地文件真相源」体验冲突，仅适合可选远端实验室。

---

## 3. StudiumX 已落地（截至 2026-07-25 · A–F 合格）

以 [delivery roadmap Completed](./agent-shell-sandbox-delivery-roadmap.md) 与代码为准（ADR 仍为决策/provisional 历史，**不以 ADR 标题替代合格**）。摘要如下。

### 3.1 审批轴（ADR-0152，对齐 Codex AskForApproval）

| Codex | StudiumX `approvalMode` | UI（禁止 YOLO） |
| --- | --- | --- |
| `untrusted` / UnlessTrusted | `request_approval` | 需批准 |
| `on-request` / OnRequest | `based_on_approval` | 按风险 |
| `never` / Never | `full_access` | 本课放行 |

### 3.2 沙箱轴（ADR-0153，对齐 Codex SandboxMode）

| Codex wire | StudiumX `sandboxMode` | UI |
| --- | --- | --- |
| `read-only` | `read_only` | 只读沙箱 |
| `workspace-write` | `workspace_write`（默认） | 工作区可写 |
| `danger-full-access` | `full_access` | 宽松策略（**永不**标 YOLO） |

两轴 **正交**：例如「宽松沙箱 + 需批准」合法。

### 3.3 Shell 工具（主流 Agent 姿态 · Stage A–B 已接通）

- 工具名：`run_workspace_command` + 别名 **`shell`**（effect=`privileged`）。  
- `tools.enabled` 默认关；开启后 **`workspaceShell` 默认开**（可显式关）。  
- **教学主路径 projection** 已含 shell（capability allow-list + registry.project；child/delegation 默认不继承）。  
- known-safe 自动放行 **fail-closed**（可写 git / 危险全局选项 / 路径读命令不 auto-allow）。  
- cwd 必须在教学工作区内；结果 JSON 截断；**非 Evidence**。  
- 含管道等的 `command` 字符串：按 Reasonix 方式经 `bash -lc` / `pwsh -Command` 展开（`agent-shell-resolve.ts`）。

### 3.4 OS transform 子集（合格态 · Windows = 策略围栏 only）

| 能力 | 状态 |
| --- | --- |
| `get_platform_sandbox` / `select_initial` / `should_require` 语义 | 已迁（TS） |
| macOS `sandbox-exec` + Codex 原版 `.sbpl` 片段 | 可用时 OS 包装；失败 → policy_fence |
| Linux 系统 `bwrap` + 挂载形态 + PATH / user-namespace 探测 | 可用时 OS 包装；失败 → policy_fence |
| Reasonix 写根（tmp、`.cache`、`.npm`、`.cargo` 等） | `collectWritableRoots` |
| pi 默认 deny-read（`~/.ssh` / `~/.aws` / `~/.gnupg`） | `defaultForbidReadRoots` |
| Windows `WindowsSandboxLevel` + `WindowsSandboxReadiness` | 诊断字段存在；**无 helper 时恒 `notConfigured`** |
| Windows RestrictedToken **真执行** | **未交付（Stage G Deferred）** → **仅 policy_fence + 审批**；**不得**宣称 OS sandbox |

**合格对外表述边界：** Windows = 策略围栏 + 审批，**不是** RestrictedToken/OS 沙箱。macOS/Linux 可在 backend 可用时说「命令级 OS 包装，失败则策略围栏」。任何平台都不得宣称 Docker/VM 完备隔离。

Settings / Doctor / IPC `getAgentSandboxReadiness` 与 runtime 共用 `resolveAgentSandboxReadiness` / `probeOsSandboxBackend`。

实现主文件：

- `src/main/ai/tools/codex-sandbox-transform.ts`  
- `src/main/ai/tools/agent-sandbox-policy.ts`  
- `src/main/ai/tools/workspace-shell.ts`  
- `src/main/ai/tools/agent-shell-resolve.ts`  
- `src/main/ai/tools/shell-command-safety.ts`  
- `src/shared/teaching-types/agent-sandbox.ts`  
- `src/main/ai/agent-capability-policy.ts`（L0 shell 可见性）  

---

## 4. Codex 路线与「二进制包」问题

### 4.1 Codex 本地 sandbox 结构（`ref_project/codex`）

- `codex-rs/sandboxing`：跨平台 **transform**（`SandboxManager::select_initial` / `transform` / `transform_for_direct_spawn`）。  
- `codex-rs/linux-sandbox`：bwrap + landlock helper 链。  
- `codex-rs/windows-sandbox-rs`：RestrictedToken / ACL / WFP / elevated runner 等。  
- 协议：`SandboxMode`、`SandboxPolicy`、`WindowsSandboxLevel`（Disabled / RestrictedToken / Elevated）、`WindowsSandboxReadiness`（ready / notConfigured / updateRequired）。  
- 审批与沙箱 **正交**：`AskForApproval` 管「问不问人」，Sandbox 管「能做什么」。

### 4.2 为什么 Windows 会碰到二进制

Codex 在 Windows 上 **不是** 纯「改 argv 字符串」就能完成隔离，而是：

1. 将命令交给 **helper / wrapper**（如 command-runner 一类）；  
2. helper 使用 RestrictedToken、ACL、可选 elevated + 防火墙等 **Win32 能力**；  
3. 宿主通过 `WindowsSandboxReadiness` 表达是否已配置 / 需更新。

因此在 Electron/TS 主进程里 **无法**仅靠移植几段 TS 就得到与 Codex 同级的 Windows OS 隔离，除非：

- 编译并签名分发 Codex 兼容 helper，或  
- 自研同等 helper（成本与安全审计面接近）。

### 4.3 正确拆解「完全迁移 Codex」

| 层 | 是否依赖 helper | 建议 |
| --- | --- | --- |
| 双轴策略 + 审批 + 工具合同 | 否 | **必须保留** |
| Unix seatbelt / 系统 bwrap | 否（用系统自带 / PATH） | **保留** |
| Windows RestrictedToken | **是** | **可选增强**，不是「迁移完成」的硬门闩 |

**产品表述建议：**

> 与 Codex **同构的策略与 Unix OS 包装**；Windows 在无 helper 时 = **policy_fence + 审批**（诚实降级，readiness=`notConfigured`），**不**宣称 RestrictedToken / OS sandbox 已启用。  
> （2026-07-25：delivery roadmap A–F 已按此边界 **Completed / qualified**。）

这与 Codex 自己的 readiness 语义一致，而不是「半成品失败」。

---

## 5. `ref_project` 中与 sandbox 相关的内容

| 路径 | 类别 | 对 StudiumX 的价值 |
| --- | --- | --- |
| `ref_project/codex` | L0–L2 + Windows helper | **主语义来源**；Windows 完整 L2 需二进制 |
| `ref_project/Reasonix/internal/sandbox` | L2 seatbelt/bwrap + shell 解析 | **已借鉴**：写根、bash/pwsh、拒 WSL bash |
| `ref_project/pi-main/.../extensions/sandbox` | L2 + npm `@anthropic-ai/sandbox-runtime` | **已借鉴** deny-read；可选整库包装 |
| `ref_project/grok-build-main/.../xai-grok-sandbox` | **L3** 进程级 nono | 架构不同；Windows 文档不覆盖 |
| `ref_project/sandbox/OpenSandbox-main` | **L4** 容器/K8s | 可选远端实验室，非默认 shell |
| `ref_project/sandbox/CubeSandbox-master` | **L4** microVM 集群 | 机房/SaaS，非桌面默认 |
| hermes Modal 等 | 远端评测沙箱 | 不作为本地 OS 方案 |
| LiveAgent | 未发现对等本地 OS sandbox 包 | — |

先前子 agent 结论（本地桌面适配序）仍成立：

1. Codex **模型**（策略 + 平台原语 + 正交审批）  
2. OpenSandbox（可选远端）  
3. CubeSandbox（重基础设施）  

**绝对隔离强度** Cube > Open > Codex 进程原语；**桌面产品适配** 则相反。

---

## 6. pi sandbox 详解

### 6.1 是什么

- 位置：`ref_project/pi-main/packages/coding-agent/examples/extensions/sandbox/`。  
- 依赖：`@anthropic-ai/sandbox-runtime`（示例 `0.0.26`）。  
- 行为：session 启动时 `SandboxManager.initialize(config)`；执行 bash 时 `wrapWithSandbox(command)`，再 `spawn("bash", ["-c", wrapped])`。  
- 配置：`~/.pi/.../sandbox.json` 与项目 `.pi/sandbox.json` 合并；filesystem allowWrite/denyRead/denyWrite、network domain 列表。  
- 平台门闩：**仅 `darwin` 与 `linux`**；其它平台直接禁用并通知。  
- 可 `--no-sandbox` 或 config `enabled: false`。

### 6.2 优点

1. 与 **TypeScript / Electron** 同栈，集成路径短。  
2. **per-command** 粒度，贴合 `run_workspace_command` / `shell`。  
3. 配置面成熟（域名单、写允许、读拒绝）。  
4. **无 Codex Windows helper 包袱**（因为它不做 Windows OS sandbox）。  
5. 失败可降级为未沙箱 bash，扩展式开关清晰。

### 6.3 缺点

1. **Windows 产品空洞**——对 StudiumX 主战场无 L2 增益。  
2. 依赖 **第三方 npm**（供应链、审计、Electron 打包、版本漂移）。  
3. 示例级扩展，不是 pi 核心 runtime 的唯一权威；语义以 Anthropic 库为准。  
4. 示例中心是 **bash**；pwsh / Git-bash 解析仍需自备（你们已用 Reasonix）。  
5. 不提供 Codex 式 **双轴审批** 产品模型；不解决 teaching settlement。

---

## 7. Grok Build sandbox 详解

### 7.1 是什么

- 位置：`ref_project/grok-build-main/crates/codegen/xai-grok-sandbox`。  
- 机制：Rust crate **`nono`**——Linux **Landlock**、macOS **Seatbelt**；可选 bwrap re-exec、子进程网络 seccomp（偏 Linux）。  
- 模型：进程启动时 `SandboxManager::apply` / `install`，限制 **进程生命周期内** 的 in-process FS 与子进程。  
- Profile：`off`（默认）、`workspace`、`devbox`、`read-only`、`strict`、自定义 `sandbox.toml`。  
- 文档平台表：**仅 Linux + macOS**；不支持则 warn 后无沙箱继续（自定义 profile 失败可拒启）。

### 7.2 优点

1. 内核向隔离叙事强；deny 列表可内核强制（含 glob 纪律）。  
2. **覆盖 in-process 工具路径**，不只 shell——防「绕过 bash 用别的写 API」。  
3. Profile 产品化完整，默认 off，接近「能力可选」。  
4. 失败策略可配置为诚实降级或 custom fail-closed。

### 7.3 缺点

1. **架构错配**：L3 进程级 vs StudiumX turn 级 tool + 审批；硬搬需 **独立 sandboxed worker** 或锁 Electron 主进程（高风险）。  
2. **Windows 同样不覆盖**——换路线 **补不上** Codex helper 缺口。  
3. 栈是 **Rust + nono**，不是主进程可直接 import 的 TS；侧车/N-API **仍是二进制分发问题**。  
4. 子进程网络限制偏 Linux；与 Codex 双轴审批不同构。  
5. 与「教学主进程要读设置、ledger、IPC」的进程模型冲突成本高。

---

## 8. pi vs Grok 对照表

| 维度 | pi sandbox 扩展 | Grok `xai-grok-sandbox` | 对 StudiumX 含义 |
| --- | --- | --- | --- |
| 层级 | L2 per-command | L3 进程级 | 现有 shell 更贴 pi 粒度 |
| 语言栈 | TS + npm | Rust + nono | Electron 更贴 pi |
| Windows | 不支持 | 文档不支持 | **都不能**替代 Codex Windows helper |
| 隔离强度（Unix） | 强（库实现 seatbelt/bwrap） | 通常更强（Landlock + 进程级） | Grok 更硬，但集成更重 |
| 配置 | JSON allow/deny | profile + toml | 各有所长 |
| 审批模型 | 弱 / 外置 | profile 开关 | 都不如 Codex 双轴清晰 |
| 默认 | 扩展常开 | 默认 off | Grok 更接近「可选能力」 |
| 供应链 | Anthropic npm | nono + 自建侧车 | 都要审计 |
| 教学 authority | 无关 | 无关 | 都必须外置 settlement |

**无绝对「更好」**：  
- 要 **少改 TS、per-bash 包装** → pi 更顺；  
- 要 **进程级内核硬隔离** → Grok 更强；  
- 要 **Windows OS 级 + 与审批正交** → 仍只有 Codex 路线（含 helper）或自研等价物。

---

## 9. 是否应「转移路线」到完全借鉴 pi 或 Grok？

### 9.1 触发疑虑

> 原目标是完全迁移 Codex 能力，但发现需要 Codex 二进制包，这样不好——是否改为完全借鉴 pi 或 Grok？

### 9.2 结论（建议）

| 问题 | 建议答案 |
| --- | --- |
| 是否 **完全** 改投 pi？ | **否**。Windows 无 L2；丢掉双轴叙事；引入第三方 npm；收益不足以覆盖重写成本。 |
| 是否 **完全** 改投 Grok？ | **否**。架构 L3 错配；Windows 仍无；Rust 侧车仍是二进制问题；成本接近新子系统。 |
| 是否因 helper 而否定 Codex **语义**？ | **否**。应 **缩小承诺边界**，而不是换语义骨架。 |
| 正确调整是什么？ | **Codex 同构策略 + Unix 系统 L2 + 多源补洞（Reasonix/pi 列表）+ Windows 诚实 policy_fence**；helper 为 **可选 Phase**。 |

### 9.3 换路线的真实后果

```text
换 pi  →  Unix 包装可能更「省事」  +  Windows 仍无 OS sandbox  +  供应链与重写成本
换 Grok →  Unix 进程级更硬      +  Windows 仍无 OS sandbox  +  Electron 架构大手术
留 Codex 语义 + 诚实 Windows →  双轴/审批/工具合同保留 + Unix L2 已有 + Windows 与 pi/Grok 同级「无 OS」或更好（仍有围栏）
```

**关键洞察：**  
pi 与 Grok **都没有**解决「Windows 强 OS 隔离且不自带 helper」；用它们「逃避」Codex 二进制，是 **假逃避**。

### 9.4 何时才值得认真考虑切换

| 条件 | 可考虑 |
| --- | --- |
| 产品 **只做 macOS/Linux**，接受 Anthropic runtime | 加深 pi 式 `wrapWithSandbox` |
| 愿意做 **独立 worker + Rust 侧车**，且需要进程级 deny | 评估 Grok/nono 式 L3 |
| 产品 **必须** Windows OS 级隔离宣传 | **继续 Codex helper 或自研**，不要换 pi/Grok |

---

## 10. 推荐路线（决策摘要）

### 10.1 主路线（推荐保持）

1. **保留** Codex 双轴：`sandboxMode` × `approvalMode`（ADR-0152/0153）。  
2. **保留** 主流 shell 工具与 Reasonix shell 解析。  
3. **保留** Unix：系统 `sandbox-exec` / `bwrap` + Reasonix 写根 + pi deny-read。  
4. **Windows**：policy_fence + 审批 + readiness=`notConfigured`；**不**在 UI 声称 RestrictedToken。  
5. **可选后续**：若业务强制 Windows OS 级 → 单独立项 **helper 构建/签名/分发**（许可与 CVE 响应），不与「改投 pi/Grok」混谈。  
6. **可选后续**：远端不可信代码 → OpenSandbox 类 L4 产品开关，与本地 shell 分离。

### 10.2 明确不做什么

- 不默认接入 OpenSandbox / Cube 作为 `run_workspace_command` 后端。  
- 不 vendoring 整仓 `codex-rs` / 不把 `windows-sandbox-rs` 源码当 npm 依赖硬编进主进程。  
- 不把 Grok nono 直接 apply 到 Electron **主进程**。  
- 不引入 YOLO / always-approve 标签。  
- 不把 shell 输出写入 LearningSession / Evidence / outcome。

### 10.3 与「教学特化」的关系

```text
主流 Agent 能力（shell、双轴沙箱策略、工具 effect）
        │
        ▼
教学特化层（Mission / Session / Evidence / settlement sole-writer）
```

沙箱与 shell 服务 **能力平面**；**不得**成为第二套 teaching authority。

---

## 11. 风险登记

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| 虚假完备 | UI 写「已沙箱」但 Windows 仅围栏 | readiness 字段 + Doctor 文案；禁止 Docker/VM 宣称 |
| 类别错配 | 用 Cube 隔离话术包装本地 shell | L0–L4 分层文档化（本文 §2） |
| 供应链 | Anthropic runtime / 未签名 helper | 默认不绑闭源 npm；helper 需签名与更新通道 |
| 主进程 L3 | nono apply 锁死 Electron | 禁止；若 L3 则独立 worker |
| 审批旁路 | 「已沙箱所以 always allow」 | 双轴正交；full_access 仍非 YOLO 标签 |
| 二进制倦怠 | 因 helper 放弃整个 Codex 语义 | §9：缩小边界，不换骨架 |

---

## 12. 验证与实现索引

建议命令（触达 sandbox/shell 时）：

```bash
pnpm typecheck
pnpm run check:tool-contract
pnpm run check:security
pnpm exec vitest run --project unit \
  tests/unit/agent-capability-policy.unit.test.ts \
  tests/unit/teaching-shell-capability-projection.unit.test.ts \
  tests/unit/workspace-shell.unit.test.ts \
  tests/unit/workspace-shell-lifecycle.unit.test.ts \
  tests/unit/agent-sandbox-policy.unit.test.ts \
  tests/unit/codex-sandbox-transform.unit.test.ts \
  tests/unit/agent-shell-and-sandbox-gaps.unit.test.ts \
  tests/unit/agent-shell-security-contract.unit.test.ts
```

文档与 ADR：

| 文档 | 内容 |
| --- | --- |
| 本文 | 问题全景、对照、是否换路线 |
| ADR-0152 | 审批轴 + 命令工具形状（部分被 0153 supersede；非合格结项） |
| ADR-0153 | 双轴 + shell 意图 / transform 子集（**provisional**；合格见 delivery roadmap） |
| delivery roadmap | **实施权威 / 合格结项** `docs/agent-shell-sandbox-delivery-roadmap.md`（**Completed 2026-07-25**；A–F 合格；G Deferred） |
| ADR-0126 | 平台能力诚实分层 |
| `docs/tools/TOOL_CONTRACT.md` | `run_workspace_command` / `shell` 合同 |

---

## 13. 一句话结论

**问题不是「Codex 不行所以要投 pi 或 Grok」，而是「完整 Windows RestrictedToken 等于接受 helper 二进制；在不愿接受前，应交付 Codex 同构策略 + Unix L2 + Windows 诚实围栏」。**  
pi 与 Grok 各有 Unix 长处，但 **都不能替代** Windows helper 决策，也 **不值得**为此整线推翻已落地的双轴与工具合同。

---

## 14. 修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-25 | 对齐 delivery roadmap Completed：已落地表改为 A–F 合格态；Windows = policy fence only；去掉任何 Windows OS sandbox 过度声明 |
| 2026-07-24 | 初版：汇总 Codex/pi/Grok/Reasonix/L4 对照、StudiumX 现状、换路线否决与推荐边界 |

# ADR-0153：Codex 双轴 Sandbox 迁移与主流 Agent Shell

- **状态：** **实施中（provisional）— 双轴/代码子集已落，主路径合格未完成**（2026-07-24 策略与 transform 子集落地；同日按交付路线修订状态）
- **日期：** 2026-07-24
- **修订：** 2026-07-24 — 取消「已实施 Phase 1–2 = 合格」的过度声明；开放缺口与 Stage 计划以 [agent-shell-sandbox-delivery-roadmap.md](../agent-shell-sandbox-delivery-roadmap.md) 为**实施权威**。
- **范围：** 将 Codex 的 **SandboxMode × AskForApproval** 双轴模型迁入 StudiumX TypeScript 策略与设置面；把工作区命令/`shell` 定义为 **主流 Agent 一等工具**（`tools.enabled` 开启后 `workspaceShell` 默认可用）。**不**整仓 vendoring `codex-rs` 的 Windows RestrictedToken / Linux bwrap / macOS Seatbelt 原生 helper 二进制（Windows OS helper 为 roadmap Stage G，**不阻塞** A–F 合格）。**不**改变 settlement sole-writer / Evidence 权威。
- **关联：** [ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md)（审批轴与命令工具形状；**默认值由本 ADR supersede**）；[ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（平台能力诚实分层；**不**承担 shell 产品面）；Codex `SandboxMode` / `SandboxPolicy` / `sandboxing` crate；`TOOL_CONTRACT.md`
- **长文对照（非实施权威）：** [sandbox-agent-strategy-and-route-comparison.md](../sandbox-agent-strategy-and-route-comparison.md)
- **实施权威（合格交付）：** [agent-shell-sandbox-delivery-roadmap.md](../agent-shell-sandbox-delivery-roadmap.md) — Stage A–F = 合格；Stage G = 可选 Windows helper
- **实现落点（子集，非完成证明）：** `src/shared/teaching-types/agent-sandbox.ts`；`src/main/ai/tools/agent-sandbox-policy.ts`；`codex-sandbox-transform.ts`；`workspace-shell.ts`（`run_workspace_command` + `shell`）；`agent-shell-resolve.ts`；`shell-command-safety.ts`；`settings.tools.sandboxMode` / `workspaceShell`；Settings UI 控件（readiness 闭环仍属 Stage E）；相关 unit tests

## 0. 现状诚实声明（相对「已实施」）

| 已有（provisional） | 未闭合（阻塞「合格」） |
| --- | --- |
| 双轴类型与设置：`sandboxMode` × `approvalMode` | **G1** 教学主路径 capability projection 可剥离 shell（registry 有、对话无） |
| Registry 注册 `run_workspace_command` / `shell` | **G2** known-safe 过宽，不可作高信任自动放行 |
| Policy fence + evaluateShellUnderSandbox 骨架 | **G3** Windows probe/transform 假 ready 或错误 wrapper 风险 |
| Unix seatbelt/bwrap **子集**代码与资源片段 | Settings/Doctor readiness 与执行路径一致的产品闭环（Stage E） |
| `workspaceShell` schema 默认 true（tools 开后） | 生命周期 / cancel / 测试覆盖投影（Stage D/F） |
| Windows 产品表述目标：helper 未打包 → `notConfigured` | 在 Stage C 收口前，**禁止**「exe 存在 ⇒ ready」类假绿 |

**合格标准：** 仅当 roadmap §1 Definition of Done 与 Stage A–F 勾选完成；在此之前本 ADR 状态保持 **实施中（provisional）**。

## 1. 问题

1. 用户期望 StudiumX **本质上是主流 coding agent**，教学是特化层，而不是「阉割版无 shell 助手」。
2. Codex 的可迁移精华是 **双轴**：`SandboxMode`（能做什么）与 `AskForApproval`（问不问人）正交；ADR-0152 只接了审批轴。
3. 整仓迁移 `windows-sandbox-rs` / `linux-sandbox` 体积与供应链成本过高，且与 Electron 打包、fail-closed readiness 纪律冲突。
4. 仓库中可同时存在「沙箱代码」与「主路径无 shell」——必须用交付路线闭合，而不是用 ADR「已实施」掩盖。

## 2. 决策

### 2.1 双轴（与 Codex 同构）

| 轴 | Codex | StudiumX | UI |
| --- | --- | --- | --- |
| 审批 | `untrusted` / `on-request` / `never` | `request_approval` / `based_on_approval` / `full_access` | 需批准 / 按风险 / 本课放行 |
| 沙箱 | `read-only` / `workspace-write` / `danger-full-access` | `read_only` / `workspace_write` / `full_access` | 只读沙箱 / 工作区可写 / 宽松策略 |

- **禁止** UI/产品标签 YOLO / DangerFullAccess / always-approve（wire 诊断可记录 Codex `danger-full-access` 字面）。
- 两轴独立：例如「宽松沙箱 + 需批准」合法。

### 2.2 Shell 为一等工具（产品意图；投影须接通）

- 工具名：`run_workspace_command` + 别名 **`shell`**（模型兼容）。
- **默认：** `workspaceShell: true`（当 `tools.enabled`）；显式 `false` 关闭。`tools.enabled` **仍默认 false**。
- 仍要求教学会话 `workspaceWrite` 授权与工作区 cwd 围栏（本地文件 SoT）。
- effect=`privileged`；结果 **不是** Evidence。
- **投影不变量（Stage A 必须满足）：** 当 tools 开、workspace 信任、`workspaceShell` 未关时，教学主路径最终 tool list **必须**含 `run_workspace_command` 与 `shell`；仅 registry 注册不够。

### 2.3 执行后端分层（诚实命名）

| 层 | 含义 | 产品宣称 |
| --- | --- | --- |
| **policy_fence** | argv 结构、路径围栏、`evaluateShellUnderSandbox`、审批轴 | 默认可用；**不是** Docker/VM |
| **OS transform 子集** | 每命令 seatbelt / bwrap 包装（系统工具可用时） | macOS/Linux 可尝试；失败 fail-closed 或明确降级提示 |
| **Windows OS helper** | RestrictedToken 等 | **Stage G 可选**；未打包时 readiness=`notConfigured`，**不**假 ready |

Phase 1 语义（策略沙箱）与 Phase 2 语义（OS transform 子集）在代码中可共存；**二者皆非「A–F 合格」的充分条件**。

### 2.4 Codex OS transform 子集（不整仓 vendoring）

仅迁移 `ref_project/codex/codex-rs/sandboxing` 中已有、且可在 Node 主进程复现的部分：

| Codex 来源 | StudiumX |
| --- | --- |
| `get_platform_sandbox` / `select_initial` / `should_sandbox` | `codex-sandbox-transform.ts` |
| macOS `create_seatbelt_command_args` + `.sbpl` 片段 | `resources/sandbox/macos/*` + `sandbox-exec` |
| Linux `create_bwrap_*` 挂载形态 + PATH 上 `bwrap` 探测 | `createBwrapCommandArgs` + 探测 helper |
| `WindowsSandboxLevel` + `WindowsSandboxReadiness` | settings + readiness；helper 未打包 → **`notConfigured`** |
| Windows 完整 RestrictedToken wrapper 二进制 | **未交付**（Stage G） |

**禁止：** OpenSandbox/Cube 作默认 shell 后端、自创「等价 Docker」话术、把 policy_fence 标成 OS 完备隔离。

### 2.5 用 ref_project 其它实现补齐 Codex 缺失面（借鉴点，非整包替换）

| 来源 | 补齐内容 | 落点 |
| --- | --- | --- |
| Reasonix shell 解析 | bash/pwsh、Git-for-Windows bash、拒 WSL bash、管道展开 | `agent-shell-resolve.ts` |
| Reasonix 写根 | bwrap/seatbelt 写根扩展 | `collectWritableRoots` |
| pi-main sandbox extension | 默认 deny-read `~/.ssh` `~/.aws` `~/.gnupg` 等 | `defaultForbidReadRoots` |

**明确不并入：** OpenSandbox/Cube（L4 远程）、Grok L3 主进程 enforce、整包 pi/Grok shell 产品替换（见对照文档与 roadmap 否决表）。

### 2.6 交付阶段（权威在 roadmap，此处索引）

| Stage | 主题 | 是否阻塞「合格」 |
| --- | --- | --- |
| **A** | 主路径 capability 接通 shell | 是 |
| **B** | known-safe 收紧 + 负例 | 是 |
| **C** | Windows fail-closed / 去假 ready | 是 |
| **D** | 生命周期 / cancel / 超时 | 是 |
| **E** | Settings/Doctor/审批文案闭环 | 是 |
| **F** | 契约测试硬化 + 宣告合格 | 是 |
| **G** | Windows OS helper 打包 | **否**（可选） |

细节、DoD、文件级任务与测试清单见 [delivery roadmap](../agent-shell-sandbox-delivery-roadmap.md)。

## 3. 非目标

1. 不 vendoring 完整 `codex-rs` / 不引入 Docker/OpenSandbox/Cube 为默认 shell 后端。
2. 不把 shell 输出写入 ledger / outcome。
3. 不默认 `tools.enabled=true`。
4. 不因本 ADR 存在代码子集而对外宣称「Agent shell / sandbox 已就绪」。
5. 不整包替换为 pi sandbox 扩展或 Grok sandbox 产品线。

## 4. 验证

```bash
pnpm typecheck
pnpm run check:tool-contract
pnpm test:unit -- tests/unit/agent-sandbox-policy.unit.test.ts tests/unit/workspace-shell.unit.test.ts tests/unit/codex-sandbox-transform.unit.test.ts tests/unit/agent-shell-and-sandbox-gaps.unit.test.ts
```

合格前必须补齐 roadmap 所列投影测试与安全负例（含 Stage A/B）。完整门禁见 roadmap §8。

## 5. 一句话

**StudiumX 按 Codex 双轴设计主流 Agent shell；教学权威仍在 host；当前是 provisional 子集而非合格交付；A–F 以 delivery roadmap 为准，Windows helper 不阻塞合格。**

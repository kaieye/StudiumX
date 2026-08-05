# ADR-0153：Codex 双轴 Sandbox 迁移与主流 Agent Shell

- **状态：** **已实施（合格交付，2026-07-25；不含 Windows OS helper）**
- **日期：** 2026-07-24
- **修订：** 2026-08-02 — 基于实际教学对话体验，移除 `tools.enabled` 产品总开关：Settings 不展示该选项，legacy 持久化/overlay 值仅为兼容接受且加载/解析后强制为 `true`。审批、工作区信任、沙箱、路径围栏与局部技术边界不变；全局 run-token 预算政策见 [ADR-0171](0171-continuous-agent-runs-and-context-governance.md)。2026-07-25 — Stage A–F 已完成并通过合格交付验证；将完成态、边界和验证入口收口至本 ADR。
- **范围：** 将 Codex 的 **SandboxMode × AskForApproval** 双轴模型迁入 StudiumX TypeScript 策略与设置面；把工作区命令/`shell` 定义为 **主流 Agent 一等工具**（工具调用应用级启用，`workspaceShell` 默认可用）。**不**整仓 vendoring `codex-rs` 的 Windows RestrictedToken / Linux bwrap / macOS Seatbelt 原生 helper 二进制（Windows OS helper 为可选 Stage G，**不阻塞** A–F 合格）。**不**改变 settlement sole-writer / Evidence 权威。
- **关联：** [ADR-0152](0152-workspace-shell-and-codex-aligned-approval.md)（审批轴与命令工具形状；**默认值由本 ADR supersede**）；[ADR-0126](0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（平台能力诚实分层；**不**承担 shell 产品面）；Codex `SandboxMode` / `SandboxPolicy` / `sandboxing` crate；`TOOL_CONTRACT.md`
- **完成记录：** Stage A–F 已于 2026-07-25 完成；Stage G（Windows RestrictedToken helper）是可选延期项，不阻塞合格交付。
- **实现落点（子集，非完成证明）：** `src/shared/teaching-types/agent-sandbox.ts`；`src/main/ai/tools/agent-sandbox-policy.ts`；`codex-sandbox-transform.ts`；`workspace-shell.ts`（`run_workspace_command` + `shell`）；`agent-shell-resolve.ts`；`shell-command-safety.ts`；`settings.tools.sandboxMode` / `workspaceShell`；Settings UI 控件与已完成的 readiness 闭环；相关 unit tests

## 0. 交付状态与诚实边界

| 已完成的合格交付（Stage A–F） | 持续不作的产品宣称 |
| --- | --- |
| 教学主路径 capability projection 在 tools 开启、工作区受信任且 `workspaceShell` 未关闭时露出 `run_workspace_command` 与 `shell` | 不把 policy fence、seatbelt/bwrap transform 或 Windows readiness 称为 Docker / VM 级隔离 |
| known-safe 自动放行边界已收紧，并由负例契约测试保护 | 不以 `exe` 存在或包装器存在伪造 Windows OS-sandbox ready |
| Windows 在无 helper 时 fail-closed 为 `notConfigured`；Settings / Doctor / 执行路径文案一致 | 不使用 YOLO / DangerFullAccess / always-approve 标签；工具默认开启不等于绕过审批或沙箱 |
| cancel、超时、输出预算、审批和回归契约已闭环 | 不把 shell 输出写入 Teaching Evidence、LearningSession ledger 或 outcome settlement |

工具调用是应用级能力：Settings 不提供 `tools.enabled` 总开关，既有或新写入的 legacy 值仅为兼容接受，并在加载/解析时归一化为 `true`。`workspaceShell` 默认 `true`，但仍可显式关闭。工具可用不等于自动放行：`sandboxMode × approvalMode`、工作区信任、cwd/路径围栏、effect lattice、审批门以及局部超时/输出边界持续适用；不设置全局累计 run-token 终止配额。

Windows RestrictedToken helper（Stage G）未随该合格交付打包。没有 helper 时产品只提供 policy fence/readiness 的诚实投影，绝不宣称 OS 级、Docker 或 VM 级隔离。

## 1. 问题

1. 用户期望 StudiumX **本质上是主流 coding agent**，教学是特化层，而不是「阉割版无 shell 助手」。
2. Codex 的可迁移精华是 **双轴**：`SandboxMode`（能做什么）与 `AskForApproval`（问不问人）正交；ADR-0152 只接了审批轴。
3. 整仓迁移 `windows-sandbox-rs` / `linux-sandbox` 体积与供应链成本过高，且与 Electron 打包、fail-closed readiness 纪律冲突。
4. 仓库中可同时存在「沙箱代码」与「主路径无 shell」——必须以主路径投影、readiness 和契约验证闭合，而不是用 ADR「已实施」掩盖。

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
- **默认：** 工具调用应用级启用；`tools.enabled` 仅为始终归一化为 `true` 的 legacy 兼容字段，Settings 不展示它。`workspaceShell: true`，且该具体能力仍可显式设为 `false`。
- 仍要求教学会话 `workspaceWrite` 授权与工作区 cwd 围栏（本地文件 SoT）。
- effect=`privileged`；结果 **不是** Evidence。
- **投影不变量（Stage A，已完成）：** 当工作区受信任且 `workspaceShell` 未关时，教学主路径最终 tool list **必须**含 `run_workspace_command` 与 `shell`；仅 registry 注册不够。

### 2.3 执行后端分层（诚实命名）

| 层 | 含义 | 产品宣称 |
| --- | --- | --- |
| **policy_fence** | argv 结构、路径围栏、`evaluateShellUnderSandbox`、审批轴 | 默认可用；**不是** Docker/VM |
| **OS transform 子集** | 每命令 seatbelt / bwrap 包装（系统工具可用时） | macOS/Linux 可尝试；失败 fail-closed 或明确降级提示 |
| **Windows OS helper** | RestrictedToken 等 | **Stage G 可选**；未打包时 readiness=`notConfigured`，**不**假 ready |

policy fence 与 OS transform 子集可共存；合格交付取决于主路径、审批、readiness、生命周期和契约验证的整体闭环，而不是单一后端。

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

**明确不并入：** OpenSandbox/Cube（L4 远程）、Grok L3 主进程 enforce、整包 pi/Grok shell 产品替换。

### 2.6 交付完成记录

| Stage | 主题 | 状态 |
| --- | --- | --- |
| **A** | 主路径 capability 接通 shell | **完成** |
| **B** | known-safe 收紧 + 负例 | **完成** |
| **C** | Windows fail-closed / 去假 ready | **完成** |
| **D** | 生命周期 / cancel / 超时 | **完成** |
| **E** | Settings / Doctor / 审批文案闭环 | **完成** |
| **F** | 契约测试硬化 + 合格宣告 | **完成（2026-07-25）** |
| **G** | Windows OS helper 打包 | **可选延期；不阻塞** |

完成证据由下列代码路径、工具合同检查与目标 unit tests 共同维护；后续修改必须继续满足同一套安全和教学权威不变量。

## 3. 非目标

1. 不 vendoring 完整 `codex-rs` / 不引入 Docker/OpenSandbox/Cube 为默认 shell 后端。
2. 不把 shell 输出写入 ledger / outcome。
3. 不因应用级工具调用启用而绕过 effect lattice、工作区信任、审批、路径围栏或局部技术边界。
4. 不因 policy fence 或 OS transform 子集而宣称 Docker / VM 级 OS 隔离。
5. 不整包替换为 pi sandbox 扩展或 Grok sandbox 产品线。

## 4. 验证

```bash
pnpm typecheck
pnpm run check:tool-contract
pnpm test:unit -- tests/unit/agent-sandbox-policy.unit.test.ts tests/unit/workspace-shell.unit.test.ts tests/unit/codex-sandbox-transform.unit.test.ts tests/unit/agent-shell-and-sandbox-gaps.unit.test.ts
```

上述命令与 shell/capability/sandbox 契约测试共同验证主路径投影、安全负例和输出/生命周期边界。

## 5. 一句话

**StudiumX 按 Codex 双轴交付主流 Agent shell；教学权威仍在 host；Stage A–F 已于 2026-07-25 合格完成，Windows helper 仍为可选延期且不改变任何 OS 隔离非声明。**

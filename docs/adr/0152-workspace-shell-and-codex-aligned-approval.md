# ADR-0152：工作区命令工具与 Codex 对齐的三态审批

- **状态：** **部分被 ADR-0153 supersede；地基仍有效，但非合格交付**（2026-07-24 初落地；2026-07-24 按交付路线修订状态）
- **日期：** 2026-07-24
- **修订：** 2026-07-24 — 与 [agent-shell-sandbox-delivery-roadmap.md](../agent-shell-sandbox-delivery-roadmap.md) 对齐：默认值以 ADR-0153 为准；known-safe / 主路径 projection 仍属开放缺口，**不得**据此宣称 shell 合格。
- **范围：** 在既有效果格子（effect lattice）与 `settings.tools.approvalMode` 三态上，增加工作区命令工具 `run_workspace_command`；审批语义与 Codex CLI `AskForApproval` 三态对齐映射。**不**引入 YOLO / always-approve UI 标签；**不**声明 OS 级 sandbox 产品完备性；**不**改变 settlement sole-writer / Evidence 权威。
- **关联：** [TOOL_CONTRACT](../tools/TOOL_CONTRACT.md)；[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)；[ADR-0063](0063-declarative-tool-policy.md)；[ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md)（双轴 + shell 默认与 OS transform 子集；**产品默认 supersede 本 ADR**）；Codex 参考 `ref_project/codex`（`AskForApproval` / `ApprovalModeCliArg`）；`Agents.md` 产品地板
- **实施权威（合格交付）：** [agent-shell-sandbox-delivery-roadmap.md](../agent-shell-sandbox-delivery-roadmap.md)（Stage A–F）。本 ADR 记录**审批轴与命令工具形状**的决策地基，不是「主路径 shell 已合格」的结项证明。
- **实现落点：** `src/main/ai/tools/workspace-shell.ts`；`src/main/ai/tools/shell-command-safety.ts`；`effect-policy.ts` / `registry.ts` / `TOOL_CONTRACT.md`；`settings.tools.workspaceShell`；`tests/unit/workspace-shell.unit.test.ts`；`tests/unit/agent-approval-mode.unit.test.ts`（扩展）

## 0. Supersession 与诚实边界

| 项 | 权威 |
| --- | --- |
| **审批三态映射**（需批准 / 按风险 / 本课放行） | **本 ADR 仍有效** |
| **`run_workspace_command` 工具形状**（privileged、cwd 围栏、非 Evidence） | **本 ADR 仍有效** |
| **默认是否注册 / 默认 `workspaceShell`** | **[ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md) supersede**：`tools.enabled` 开启后 `workspaceShell` **默认 true**（可显式关）；`tools.enabled` 仍默认 false |
| **沙箱轴 `sandboxMode`、OS transform、readiness** | **ADR-0153** |
| **主路径能否真正露出 shell、safelist 是否可信、Windows 是否 fail-closed** | **[delivery roadmap](../agent-shell-sandbox-delivery-roadmap.md)** Stage A–F；当前 **In progress — not yet qualified** |

**已知未闭合（相对本 ADR 原文乐观表述）：**

1. Registry 可注册 shell，但教学 capability projection 历史上可剥离 shell（roadmap **G1**）——须 Stage A 接通后主对话才有工具。
2. `isKnownSafeReadCommand` 过宽（roadmap **G2**）——safelist **不得**在收紧前当作高信任自动放行依据。
3. Windows OS helper / readiness 诚实性见 ADR-0153 与 roadmap Stage C/G。

## 1. 问题

1. 产品地板历史表述为「无默认 shell」，阻止了 Agent 在教学工作区内执行构建/测试/脚本类命令，影响课程产物与站点流水线效率。
2. 用户希望 **参考 Codex 的三种审批状态** 管理命令与写入风险，而不是另造 YOLO 词表。
3. 现有 `AgentApprovalMode` 已是三态（`request_approval` / `based_on_approval` / `full_access`），但交互门仅覆盖 `workspace_write` 文件写，且权限解析对非 write 一律 `allow_once`。

## 2. 决策

### 2.1 Codex 三态 ↔ StudiumX 映射

Codex CLI（`ApprovalModeCliArg` / `AskForApproval`）主三态：

| Codex | 含义（摘要） | StudiumX `approvalMode` | UI 文案（保持中文，禁止 YOLO） |
| --- | --- | --- | --- |
| `untrusted` / `UnlessTrusted` | 仅「已知安全」读向命令自动通过；其余询问 | `request_approval` | **需批准** |
| `on-request` / `OnRequest`（默认） | 模型/策略决定何时询问；可对低风险自动放行 | `based_on_approval` | **按风险** |
| `never` / `Never` | 不向用户询问；失败回模型 | `full_access` | **本课放行** |

**不**采用 Codex 的 `granular` 细粒度配置作为产品面（可后续 ADR）。  
**不**把 `full_access` 标为 YOLO / DangerFullAccess / always-approve。

### 2.2 命令工具：`run_workspace_command`

- **工具名：** `run_workspace_command`（非泛型 `ShellTool` 营销名）；ADR-0153 增加模型兼容别名 **`shell`**。
- **effect：** `privileged`（未知副作用 / 进程执行；fail-closed 与 ADR-0024 一致）。
- **默认（以 ADR-0153 为准，supersede 本 ADR 初稿 opt-in-only 表述）：**
  - `tools.enabled` **默认 false**（总开关仍关 = 无 shell）。
  - 用户开启 `tools.enabled` 后，`workspaceShell` **默认 true**（主流 Agent）；显式 `false` 可关。
  - 历史表述「无默认 shell」= **无默认开启 tools**，不是「tools 开了仍默认无 shell」。
- **工作区围栏：** `cwd` 必须为工作区相对路径；解析后 `isPathInsideRoot`；禁止绝对路径逃逸。
- **执行：** `child_process.spawn`（无 shell 字符串拼接）；argv 数组；超时与输出字节硬预算；继承 `AbortSignal`。
- **Windows：** 允许 `cmd.exe /c` 与 `powershell.exe -NoProfile -Command` 作为显式宿主（仍走审批门），不伪装为 OS sandbox。
- **结果：** JSON ToolOutcome 形状；stdout/stderr 截断；exit code；**不是** teaching Evidence / settlement。

### 2.3 审批门（扩展 `resolveToolPermission`）

对带 `permission` 描述符的工具统一走门（不再仅 `workspace_write`）：

| 模式 | 工作区文件写（既有） | `run_workspace_command` |
| --- | --- | --- |
| `request_approval` | 每次写询问（既有） | **始终**交互审批（对齐 untrusted：安全名单仅用于 **诊断/提示**，仍须批准，避免静默执行任意命令） |
| `based_on_approval` | 新建文件可自动；覆盖询问（既有） | **已知安全读向**命令（Codex 风格 safelist，**须按 roadmap Stage B 收紧后才可依赖**）可 `allow_for_run`；其余询问 |
| `full_access` | 本 run 自动写（既有） | 本 run 自动执行（仍受超时/路径围栏/声明式 tool-policy / `sandboxMode`） |

声明式 tool-policy（ADR-0063）仍可 `forbidden` / `force_interactive` 覆盖 auto 路径。  
Memory 强制人审与 MCP 非 read 交互规则不变。

### 2.4 安全名单（Codex 对齐的子集）

Host-owned 纯函数 `isKnownSafeReadCommand(argv)`：

- **意图允许：** 只读向探测类命令（如无危险选项的 `ls`/`dir`/`cat`/`type`/`head`/`tail`/`wc`/`pwd`/`echo`/`rg`/`grep`/`find` 等）。
- **意图拒绝自动：** 管道重定向写文件、`rm`/`del`/`curl`/`wget`/`npm install`、可写 git 配置类等。
- **现状诚实声明：** 初版实现 **过宽**（见 roadmap G2：git config/branch/tag/remote、弱路径参数等）。在 Stage B 收紧并有负例测试前，**不得**把 safelist 当作高信任自动放行或 `read_only` 唯一防线。
- **不**把 safelist 当作 OS sandbox；`full_access` 下仍可执行非 safelist 命令（仍受围栏与 policy）。

### 2.5 产品地板修订

| 旧表述 | 新表述 |
| --- | --- |
| 无默认 shell | **无默认开启 tools**；`tools.enabled` 开后 `workspaceShell` 默认开（ADR-0153）+ 三态审批 + 路径围栏 + sandbox 双轴 |
| 禁止引入 ShellTool | 禁止 **无审批 / YOLO 标签** 的通用 shell；允许 `run_workspace_command` / `shell` 作为注册工具 |
| 「命令工具已落地 = 合格」 | 代码子集与决策地基可存在；**合格**仅当 roadmap Stage A–F 完成 |

Settlement、ledger、MCP 非 evidence、无默认远程 telemetry 等不变。

## 3. 非目标

1. 不实现 Codex 完整 `linux-sandbox` / `windows-sandbox` 产品声明。
2. 不引入 argv `prefix_rule` 持久 execpolicy 语言（ADR-0121 明确不借项保持）。
3. 不把命令输出写入 LearningSession / Evidence / outcome。
4. 不改变 `expectedRevision`、fork `toolsReplayed:false`。
5. 不默认 `tools.enabled=true`（总开关仍用户打开）。
6. 不把本 ADR 单独当作「主路径 shell 已合格」的证据。

## 4. 验证入口

```bash
pnpm typecheck
pnpm run check:tool-contract
pnpm test:unit -- tests/unit/workspace-shell.unit.test.ts tests/unit/agent-approval-mode.unit.test.ts
pnpm run check:security
```

合格交付的完整门禁与负例矩阵见 [delivery roadmap](../agent-shell-sandbox-delivery-roadmap.md) §1 / §8。

## 5. 一句话

**工作区命令是 privileged 工具；审批三态与 Codex untrusted / on-request / never 语义对齐；UI 仍称「需批准 / 按风险 / 本课放行」，永不 YOLO。默认与双轴以 ADR-0153 为准；合格交付以 delivery roadmap 为准。**

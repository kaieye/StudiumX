# StudiumX Agent Shell / Sandbox 交付路线图

> **状态：** Completed — Agent Shell / Sandbox qualified (without Windows OS helper)  
> **日期：** 2026-07-25  
> **完成说明：** Stage A–F 交付；Windows RestrictedToken helper 仍为 Stage G Deferred  
> **范围：** 教学主 Agent 的工作区命令执行能力（shell）与执行后端（policy fence / OS transform / readiness）  
> **定位：** 实现交付文档，不以 ADR 完成度为目标；完成后应具备**可对真实用户开启的合格能力**  
> **关联背景：** [sandbox-agent-strategy-and-route-comparison.md](./sandbox-agent-strategy-and-route-comparison.md)（对照与否决换线）；实现以本文件为准  
> **关联 ADR（已按本路线修订状态，避免「已实施=合格」）：** [ADR-0152](adr/0152-workspace-shell-and-codex-aligned-approval.md)（审批轴地基 / 部分被 0153 supersede）、[ADR-0153](adr/0153-codex-sandbox-dual-axis-and-agent-shell.md)（双轴 / **provisional**）、[ADR-0126](adr/0126-codex-style-platform-capability-profiles-and-consumer-migration.md)（I/O profile；不承担 shell 产品面）

---

## 0. 一句话目标

让 StudiumX 在 **tools 开启 + 工作区已信任 + shell 未关闭** 时，教学主 Agent 能安全、可见、可取消地执行工作区命令：

- 模型真实看得到并调得到 `run_workspace_command` / `shell`
- 自动放行边界极小且可证明
- 用户在执行前知道是 OS 包装还是仅策略围栏
- Windows 无真 helper 时诚实降级，不伪装隔离
- shell 输出不是教学 Evidence；settlement 权威不变

完成本路线后，shell 应从「仓库里有一套沙箱代码」变成「可交付的主流 Agent 能力」。

---

## 1. 合格能力定义（Definition of Done）

以下全部满足，才算本路线完成。任一不满足，不得对外宣称 shell/sandbox 已就绪。

### 1.1 功能合格

| # | 要求 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| F1 | 教学主路径最终 tool list 含 `run_workspace_command` 与 `shell` | runtime projection 测试 + 手工一次 turn | [x] unit projection 已锁；合格声明不依赖手工 turn |
| F2 | `tools.enabled=false` 时无 shell | unit | [x] |
| F3 | 工作区未 trust 时无 shell | unit | [x] |
| F4 | `workspaceShell=false` 时无 shell | unit | [x] |
| F5 | temporary chat 在具备 workspace grant 时可与主路径一致地暴露/不暴露 shell（与文件写同权策略） | unit | [x] |
| F6 | child / delegation 默认**不**继承 shell | unit | [x] |
| F7 | argv 与简单 command 字符串可执行；含管道的 command 经 bash/pwsh 展开 | unit | [x] |
| F8 | cwd 必须在教学工作区内，越界拒绝 | unit | [x] |
| F9 | 超时、输出字节上限、取消信号生效 | unit + 至少 1 个 lifecycle 负例 | [x] |

### 1.2 安全合格

| # | 要求 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| S1 | `based_on_approval` 仅对**严格 known-safe** 自动放行 | 安全负例测试集 | [x] known-safe 契约 + shell 审批钩子 |
| S2 | `read_only` 仅允许严格 known-safe；其余拒绝或要求升模式 | unit | [x] |
| S3 | known-safe **不得**包含可写 git（config/branch/tag/remote 等） | 负例 | [x] |
| S4 | known-safe **不得**因 `-C` / `-c` / `--git-dir` / `--work-tree` 等全局选项放行 | 负例 | [x] |
| S5 | known-safe **不得**对无法证明在工作区内的路径读命令自动放行（至少 Windows policy-only / 默认策略下） | 负例 | [x] |
| S6 | Windows 无完整 helper 协议握手时 readiness 恒为 `notConfigured`，不得因同名 exe 变 `ready` | unit | [x] |
| S7 | 禁止 YOLO / DangerFullAccess / always-approve 产品标签；`full_access` 仅称「本课放行 / 宽松策略」 | UI/文案检查 | [x] Settings/readiness 文案 unit + 代码路径 |
| S8 | shell 结果 JSON 明确非 Evidence；不进入 settlement 权威路径 | 代码注释 + 契约测试/审查 | [x] result.note + TOOL_CONTRACT |

### 1.3 可观测与诚实降级合格

| # | 要求 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| O1 | Settings 展示当前 backend / osEnforcement / windowsReadiness（或等价摘要） | UI 手工 + 类型存在 | [x] Settings 消费 getAgentSandboxReadiness |
| O2 | Doctor（或等价诊断面）使用与 runtime 相同的 readiness 数据源 | 代码路径检查 | [x] teaching-doctor-config-facts → resolveAgentSandboxReadiness |
| O3 | 审批/执行前用户能理解「OS 沙箱」vs「仅策略围栏」 | UI 文案 | [x] permission reason 含 sandboxMode/backend；Settings 摘要 |
| O4 | transform 失败不得静默装成已隔离；结果与 readiness 一致 | unit | [x] |

### 1.4 工程合格

| # | 要求 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| E1 | `pnpm typecheck` 通过 | CI/本地 | [x] 2026-07-25 |
| E2 | `pnpm run check:tool-contract` 通过 | CI/本地 | [x] 2026-07-25 |
| E3 | `pnpm run check:security` 通过 | CI/本地 | [x] 2026-07-25 |
| E4 | shell/capability/sandbox 相关 unit 全绿，且覆盖主路径 projection | vitest | [x] 8 files / 84 tests |
| E5 | 无预 abort TDZ；取消路径不抛未捕获异常 | unit | [x] |
| E6 | 模块边界清晰：capability / safety / policy / transform / execute 可独立测 | 代码审查 | [x] |

### 1.5 明确不纳入本路线 DoD 的内容

以下**完成与否不影响**本路线宣告合格：

- Windows RestrictedToken **真** helper 的构建、签名、分发
- Docker / VM / OpenSandbox / Cube 级隔离
- 搬迁整套 pi / Grok sandbox 或 shell 产品
- 自动 memory / dream / 向量搜索
- 远程 telemetry

Windows OS 级隔离若未来要做，单列里程碑（见 §9），不阻塞本路线合格声明。

---

## 2. 现状诊断（基线，2026-07-24）

### 2.1 已有资产（可复用）

- 设置双轴：`approvalMode` × `sandboxMode`，`workspaceShell` 默认 true（tools 总开关仍默认 false）
- 工具实现：`run_workspace_command` + `shell`（`workspace-shell.ts`）
- 注册：`buildDefaultRegistry` 在 workspaceWrite + workspaceShell 时注册
- 策略评估：`evaluateShellUnderSandbox`、`resolveAgentSandboxReadiness`
- Unix transform 子集：seatbelt 资源、bwrap 探测与包装、deny-read / writable roots
- effect：`privileged`；结果注明非 Evidence
- 局部单测：registry 注册、部分 safelist、sandbox policy

### 2.2 阻断级缺口（必须先修）

| 缺口 | 位置 | 后果 |
| --- | --- | --- |
| **G1 主路径投影断裂** | `agent-capability-policy.ts` 的 allow-list 不含 shell；`teaching-conversation-runtime.ts` `project()` 删除未允许工具 | 用户开 tools 后主对话仍无 shell |
| **G2 known-safe 过宽** | `shell-command-safety.ts`：git config/branch/tag/remote；跳过危险全局选项；路径参数不约束 | 自动放行与 read_only 不可信 |
| **G3 Windows 假 ready** | `probeWindowsSandboxHelper` 见 exe 即 ready；错误 flag 包装 | 可能伪装 OS 隔离 |
| **G4 readiness 未产品化** | 仅 tool result / unit 使用；Settings/Doctor 无统一消费 | 用户执行前不可见真实后端 |
| **G5 lifecycle 瑕疵** | 预 abort 可能 TDZ；只杀直接 child | 取消/超时不稳健 |
| **G6 测试假绿** | 测 registry 不测 teaching projection | 门禁绿但主路径不可用 |

### 2.3 架构判断

- **不换线**到 pi / Grok 整包方案（接口不匹配、Windows 仍无 OS 隔离、集成税高于修现栈）
- **可取材**：pi deny-read / 进程组 kill；Grok profile 严谨测试态度
- **中心控制面保留在 StudiumX**：capability → approval → sandbox posture → optional OS transform → spawn

---

## 3. 目标架构

### 3.1 四层控制面（必须保持正交）

```text
┌─────────────────────────────────────────────────────────────┐
│ L0 Capability：本 turn 模型能看见哪些工具                      │
│   resolveTeachingCapabilityPolicy + registry.project         │
├─────────────────────────────────────────────────────────────┤
│ L1 Approval：这次调用问不问人                                  │
│   approvalMode + permission grants + known-safe 自动放行      │
├─────────────────────────────────────────────────────────────┤
│ L2 Sandbox posture：命令本身允不允许                           │
│   sandboxMode + evaluateShellUnderSandbox + cwd 围栏          │
├─────────────────────────────────────────────────────────────┤
│ L3 Execution backend：如何强制（可选）                         │
│   policy_fence | macos_seatbelt | linux_bwrap | win helper   │
│   readiness 诚实；失败则明确降级，不伪装                       │
└─────────────────────────────────────────────────────────────┘
```

规则：

1. L0 否决 → 模型不应看到工具  
2. L1 否决 → 不执行  
3. L2 否决 → 不执行（即使已批准，也不应靠批准绕过 read_only 语义；批准 UI 可提示升模式）  
4. L3 不可用 → **不静默假装可用**；按 §6 降级策略执行或拒绝

### 3.2 模块职责

| 模块 | 职责 | 禁止混入 |
| --- | --- | --- |
| `src/main/ai/agent-capability-policy.ts` | 工具可见性 allow/deny | spawn、OS probe |
| `src/main/teaching-conversation-runtime.ts` | 组装 registry 并 project | 平台细节 |
| `src/main/ai/tools/shell-command-safety.ts` | argv 解析 + **严格** known-safe 纯函数 | 文件系统猜测式“安全” |
| `src/main/ai/tools/agent-sandbox-policy.ts` | sandboxMode 决策 + readiness 聚合 | 具体 argv 包装细节 |
| `src/main/ai/tools/codex-sandbox-transform.ts` | 平台 probe + argv transform | 审批、capability |
| `src/main/ai/tools/workspace-shell.ts` | 编排：解析 → 策略 → 围栏 → transform → spawn → ToolOutcome | 膨胀成巨石；平台探测应调用 transform/policy |
| Settings / Doctor | 消费 readiness 单一数据源 | 本地再实现一套判断 |

### 3.3 Shell 能力归属语义

- shell 属于 **workspace write grant 侧**能力（与 `write_workspace_file` 同级信任门槛，不是只读工具）
- 暴露条件：
  - `tools.enabled === true`
  - `workspaceToolAccessGranted === true`
  - `settings.tools.workspaceShell !== false`
  - registry 侧仍要求 `workspaceRoot` + `workspaceWrite` 会话条件（与现实现一致）
- child agent：**默认拒绝 shell**（只读研究子任务不得 privileged 执行）

### 3.4 known-safe 的产品语义

known-safe 是**高信任接口**，同时服务：

- `based_on_approval` 自动放行
- `read_only` 是否允许执行

因此：

- 默认 fail-closed  
- 白名单极小  
- 凡无法静态证明只读且无路径逃逸者，**可以走审批执行，但不得 auto-allow**

---

## 4. 总路线（阶段总览）

| 阶段 | 名称 | 目标 | 预估 | 阻塞发布？ |
| --- | --- | --- | --- | --- |
| **A** | 主路径接通 | 教学对话真实拥有 shell | 1–2 天 | 是 |
| **B** | 自动放行收口 | known-safe 可证明 | 1–2 天 | 是 |
| **C** | 执行后端诚实化 | probe/transform/降级一致且可见 | 2–3 天 | 是 |
| **D** | 生命周期与稳健性 | 取消/超时/输出可靠 | 1–2 天 | 是（基础项） |
| **E** | 产品面与诊断闭环 | Settings/Doctor/审批文案 | 1–2 天 | 是（合格声明前） |
| **F** | 硬化与回归锁 | 负例矩阵、文档收口、假绿消除 | 1 天 | 是 |
| **G** | （可选）Windows helper | 真 OS 隔离 | 独立项目 | 否 |

**推荐合并迭代：**

- **迭代 1 = A + B + Windows probe fail-closed（C 的最小子集）** → 内部可用 MVP  
- **迭代 2 = C 剩余 + D + E** → 合格候选  
- **迭代 3 = F** → 正式合格  
- **迭代 4 = G 决策** → 可选增强

---

## 5. 阶段详案

### Stage A — 主路径接通

#### A.1 目标

修复「registry 注册了但 capability projection 删掉」的断裂，使教学主路径最终工具集包含 shell。

#### A.2 实现任务

1. **扩展 capability policy**
   - 文件：`src/main/ai/agent-capability-policy.ts`
   - 新增：
     ```ts
     const WORKSPACE_SHELL_TOOL_NAMES = ['run_workspace_command', 'shell'] as const
     ```
   - 当 `workspaceGranted === true` 时并入 `allowedToolNames`
   - 并入 `ALL_KNOWN_TOOL_NAMES`（保证 denied 列表与投影一致）
2. **确认 runtime 投影路径**
   - 文件：`src/main/teaching-conversation-runtime.ts`
   - 保持 `project({ allow, deny })` 单真相源；**不要**为 shell 开旁路硬编码
3. **delegation 边界**
   - 文件：`src/main/ai/delegation-runtime.ts`（及相关 child allow-list）
   - 断言 child profile 默认 names **不含** shell
   - 若未来要给 child shell，必须新 ADR/新阶段，不在本 Stage
4. **catalog / 配置投影**
   - 检查 teaching capability catalog、settings 文案是否与真实 allow-list 一致
   - 避免 UI 写「已启用 shell」但 runtime 无工具

#### A.3 测试（先写失败用例再修）

新增或扩展：

- `tests/unit/agent-capability-policy.unit.test.ts`
  - trusted workspace + tools on → contain shell tools
  - no grant / tools off /（若 policy 感知 workspaceShell，则 false 时不含；若 workspaceShell 仅 registry 侧过滤，则在 projection 集成测覆盖）
- **关键集成测**（新建建议名）：
  - `tests/unit/teaching-shell-capability-projection.unit.test.ts`
  - 步骤：构造 settings（tools on, workspaceShell true）→ `buildDefaultRegistry(..., { workspaceRoot, workspaceWrite: true })` → `resolveTeachingCapabilityPolicy(...)` → `registry.project({ allow: policy.allowedToolNames, deny: policy.deniedToolNames })` → `names()` 含 `run_workspace_command` 与 `shell`
  - 对照：workspaceShell false 或 write false 时不含

#### A.4 验收

- [ ] F1–F6 中与本阶段相关项满足  
- [ ] 不再依赖“只测 buildDefaultRegistry”作为主路径证据  
- [ ] `pnpm typecheck` + 相关 unit 绿

#### A.5 非目标

- 不在本阶段扩大 safelist  
- 不改 Windows helper 协议（除了若顺手发现 ready 误报，可记入 Stage C；**迭代 1 建议最小 fail-closed 见 C0**）

---

### Stage B — 自动放行与 read_only 收口

#### B.1 目标

把 `isKnownSafeReadCommand` 变成可证明的安全契约，堵住「接通主路径后自动执行危险命令」的最大风险。

#### B.2 known-safe 目标规则（实现契约）

**可纳入 known-safe 的方向（最终以测试锁定，可略收不可放宽）：**

- 纯状态类：`pwd`、`true`、`false`、`uname`、`whoami`、`id`（无危险参数）
- 只读列举：`ls` / `dir`（禁止危险 flags；路径策略见下）
- 只读 git **子命令白名单**（示例基线）：
  - 允许：`status`, `log`, `show`, `diff`, `rev-parse`, `describe`, `ls-files`, `ls-tree`, `blame`, `help`, `version`
  - **禁止**：`config`, `branch`, `tag`, `remote`, `checkout`, `switch`, `merge`, `rebase`, `reset`, `clean`, `add`, `commit`, `push`, `pull`, `fetch`, `stash`, …
- git **全局选项**：
  - **拒绝**（出现即 non-safe）：`-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path` 等可改变执行上下文/触发外部逻辑的选项
- `find`：继续拒绝 `-exec/-delete/...`；默认不 auto-allow 任意路径深搜（见路径策略）
- `rg`：拒绝 `--pre` 等外部程序触发

**路径策略（强制）：**

- known-safe **不**试图做完美 shell 路径解析  
- 对带路径参数的读命令（`cat`/`type`/`grep`/`find`/`rg`/`head`/`tail` 等）：
  - **默认：不进入 known-safe**（仍可在 `workspace_write`/`full_access` 下经审批执行）
  - 或仅允许「无路径参数 / 仅相对且无 `..` 的极窄形态」（若实现，必须单测锁死）
- 理由：Windows 无 OS helper 时，仅靠 cwd 围栏挡不住参数指向工作区外文件

**明确移出 known-safe（立即）：**

- `git config` / `git branch` / `git tag` / `git remote`
- 任何带 shell 元字符、需 `bash -lc` / `pwsh -Command` 展开的复杂 command（展开后的包装命令本身不得标 known-safe）

#### B.3 实现任务

1. 重写/收紧 `src/main/ai/tools/shell-command-safety.ts`
2. 确认调用点一致：
   - `evaluateShellUnderSandbox`（read_only / autoApproveEligible）
   - `registry.ts` 中 `based_on_approval` 分支
   - `workspace-shell.ts` 结果字段 `knownSafeRead`（仅诊断，不授权）
3. 更新过时正例测试（若旧测试期望 `git branch` safe，必须改掉）

#### B.4 测试矩阵（最低集）

| 输入 | known-safe? |
| --- | --- |
| `git status` | true |
| `git log -1 --oneline` | true 或 false（若 flags 未白名单则 false；宁严勿宽） |
| `git config user.name x` | **false** |
| `git branch -D foo` | **false** |
| `git -C .. status` | **false** |
| `git -c diff.external=... diff` | **false** |
| `npm install` | false |
| `rm -rf .` | false |
| `cat C:\\Users\\x\\.ssh\\id_rsa` | **false**（auto-allow 意义下） |
| `find / -name x` | false |
| `echo hi` | true（可选） |
| 含 `&&` / `|` 的 command 展开包装 | false |

#### B.5 验收

- [ ] S1–S5  
- [ ] 旧的“宽松正例”测试已删除或改写  
- [ ] 安全负例全部锁定

---

### Stage C — 执行后端诚实化

#### C0. 迭代 1 最小补丁（与 A/B 同发）

**Windows probe fail-closed：**

- `probeWindowsSandboxHelper`：在未实现完整 wrapper 协议前，**直接返回 `notConfigured`**
- `transformArgvWithCodexSandbox` 的 windows 分支：不得用错误 flag 包装执行
- 单测：resources 下存在假 `codex-command-runner.exe` / setup exe 时仍 `notConfigured` 且 `applied:false`

这是安全止血，工作量小，必须进迭代 1。

#### C.1 目标

readiness 与 transform 共用可信探测；降级策略显式；结果与 UI 一致。

#### C.2 实现任务

1. **统一 probe 层**
   - 同一函数/缓存服务：
     - macOS：`sandbox-exec` 存在 + seatbelt 资源文件可读
     - Linux：bwrap PATH + user namespace 探测（**修复 `result.error => true` 误报**）
     - Windows：仅完整握手后才 ready；否则 notConfigured
   - `resolveAgentSandboxReadiness` 与 `transformArgvWithCodexSandbox` 读同一结果
2. **降级策略（产品默认，可配置余地留给后续）**

| sandboxMode | OS backend 不可用时 |
| --- | --- |
| `read_only` | 允许 policy-only 执行**严格 known-safe**；结果/UI 标记 `policy_fence`。非 safe 拒绝并提示升到 workspace_write |
| `workspace_write` | 允许 policy-only 执行（仍审批）；**执行前**可见「仅策略围栏」 |
| `full_access` | 允许 policy-only；文案为宽松策略，不宣称 OS 隔离 |

3. **删除/禁用危险 stub**
   - 不得再出现「文件存在 ⇒ ready ⇒ 错误协议包装」路径
4. **结果 JSON**
   - 保持 `sandbox` + `osSandbox.applied/note` 字段
   - `applied:false` 时 reason 人类可读

#### C.3 测试

- readiness：win32 无 helper / 假 helper  
- linux probe error 不得误报 available（可用 mock spawn）  
- transform applied 与 readiness.osEnforcementAvailable 不互相矛盾  
- 降级矩阵：mode × backend available

#### C.4 验收

- [ ] S6、O4  
- [ ] Windows 假 ready 路径消失  

---

### Stage D — 进程生命周期与稳健性

#### D.1 目标

shell 作为长期开启能力时，取消与超时行为可预期。

#### D.2 实现任务

1. **修复 pre-aborted signal TDZ**
   - 文件：`workspace-shell.ts` `runSpawn`
   - `timer` 在 `finish` 可安全清理（先声明 `let timer: NodeJS.Timeout | undefined`，或 abort 路径不访问未初始化绑定）
2. **取消/超时**
   - 短期 DoD：直接 child 收到 TERM/KILL；不抛未捕获；`aborted`/`timedOut` 字段正确
   - 增强（尽量做）：
     - Unix：`detached` + 进程组 kill（可借鉴 pi）
     - Windows：文档化限制；后续 Job Object/helper 归 Stage G
3. **输出**
   - 维持字节硬上限与截断标记
4. **错误形状**
   - 统一 JSON error；不泄漏绝对主机敏感路径（能相对路径则相对）

#### D.3 测试

- signal 已 aborted 再 run → 不 throw，返回 aborted  
- timeout → timedOut true  
- 大 stdout 截断  

#### D.4 验收

- [ ] F9、E5  

---

### Stage E — 产品面与诊断闭环

#### E.1 目标

用户与支持路径能看到真实执行模型，而不是只有开发者读 tool JSON。

#### E.2 实现任务

1. **Settings**
   - 在工具/沙箱区域展示：
     - 当前 `sandboxMode` / `approvalMode`（已有控件可保留）
     - readiness 摘要：backend、是否 OS 强制、Windows readiness
   - 文案禁止 YOLO；Windows 无 helper 时明确「当前为策略围栏」
2. **Doctor**
   - 调用与 runtime 相同的 `resolveAgentSandboxReadiness`
   - 输出进 doctor JSON（注意脱敏，不进 secret）
3. **审批 UI**
   - 对 shell 调用展示：命令摘要、cwd、sandboxMode、是否 known-safe、是否 OS applied（若审批时尚未 transform，则展示「预期后端 / 可能降级」）
4. **capability catalog**
   - 与 allow-list 同步，避免目录谎报

#### E.3 验收

- [ ] O1–O3  
- [ ] 手工：关/开 tools、切换 sandboxMode，Settings 与一次 shell 调用结果不矛盾  

---

### Stage F — 硬化、回归锁与文档收口

#### F.1 目标

消除假绿，固化契约，宣告合格。

#### F.2 任务

1. 汇总负例矩阵进 `tests/unit/`（可单文件 `agent-shell-security-contract.unit.test.ts`）
2. 跑全套门禁：
   - `pnpm typecheck`
   - `pnpm run check:tool-contract`
   - `pnpm run check:security`
   - shell/capability/sandbox 相关 vitest
3. 更新本文件状态为 **Completed**，填写完成日期与已知限制
4. 背景文档 `sandbox-agent-strategy-and-route-comparison.md` 的「已落地」表改为指向本路线完成态，去掉过度声明
5. ADR 仅作历史参考时，可补一行 “implementation authority: this roadmap”；**不要求**为了合规重写 ADR

#### F.3 合格签字清单

§1 DoD 表已于 2026-07-25 按门禁与 unit 证据勾选（见「状态」列 `[x]`）。宣布：

> **Agent Shell / Sandbox 合格能力已交付（不含 Windows OS helper）。**

---

### Stage G — 可选：Windows OS helper（独立里程碑）

仅当产品硬性要求 Windows OS 级隔离宣传时启动。

#### G.1 前置条件

- Stage A–F 已完成  
- 明确许可、签名、更新、CVE 响应责任人  
- 接受 Electron 打包体积与运维成本  

#### G.2 最小交付链

1. 锁定上游 helper 版本与许可证  
2. 实现**正确** wrapper 协议（禁止误用 fs-helper flag）  
3. 双架构构建  
4. 代码签名  
5. 打入 `resources/sandbox/windows`  
6. readiness handshake + `updateRequired`  
7. Windows manual/e2e：read_only 无法写出工作区外；workspace_write 写围栏生效  
8. 安全响应 runbook  

#### G.3 若不做 G

文档与 UI 长期写明：

> Windows 使用策略围栏 + 审批；不宣称 RestrictedToken/OS 沙箱已启用。

这与 macOS/Linux 在 backend 可用时的 OS 包装可以并存（平台差异诚实展示）。

---

## 6. 平台能力矩阵（完成后应达到）

| 平台 | Capability+Approval+Fence | OS transform | 合格声明允许的表述 |
| --- | --- | --- | --- |
| macOS | 是 | seatbelt（资源与 sandbox-exec 可用时） | 「命令级 OS 包装（Seatbelt），失败则策略围栏」 |
| Linux | 是 | bwrap（PATH + userns 可用时） | 「命令级 OS 包装（bwrap），失败则策略围栏」 |
| Windows | 是 | 无（Stage G 前） | 「策略围栏 + 审批；OS helper 未配置」 |

任何平台都不得表述为 Docker/VM 完备沙箱。

---

## 7. PR / 提交切片建议

避免大爆炸 PR。推荐切片：

| PR | 内容 | 合并门槛 |
| --- | --- | --- |
| **PR-1** | 失败测试：projection + 安全负例骨架 | 测试红在正确位置 |
| **PR-2** | Stage A：capability 接线 + projection 测试绿 | F1–F6 相关 |
| **PR-3** | Stage B：known-safe 收紧 + 负例全绿 | S1–S5 |
| **PR-4** | Stage C0：Windows fail-closed | S6 |
| **PR-5** | Stage C：统一 probe + 降级一致性 | O4 |
| **PR-6** | Stage D：lifecycle | F9/E5 |
| **PR-7** | Stage E：Settings/Doctor/审批可见性 | O1–O3 |
| **PR-8** | Stage F：门禁 + 文档 Completed | §1 全满足 |

允许 PR-2/3/4 在同一短迭代内连续合并，但**不要**把 G helper 混入。

---

## 8. 测试与门禁地图

### 8.1 必测文件（随阶段增长）

| 测试 | 覆盖 |
| --- | --- |
| `tests/unit/agent-capability-policy.unit.test.ts` | allow-list |
| `tests/unit/teaching-shell-capability-projection.unit.test.ts`（新建） | 主路径投影 |
| `tests/unit/workspace-shell.unit.test.ts` | 注册、执行编排、审批钩子 |
| `tests/unit/agent-sandbox-policy.unit.test.ts` | readiness / evaluate |
| `tests/unit/codex-sandbox-transform.unit.test.ts` | transform / probe |
| `tests/unit/agent-shell-and-sandbox-gaps.unit.test.ts` | resolve / deny-read 等 |
| `tests/unit/agent-shell-security-contract.unit.test.ts`（新建建议） | 安全负例总契约 |

### 8.2 每次相关改动最少命令

```bash
pnpm exec vitest run --project unit tests/unit/agent-capability-policy.unit.test.ts tests/unit/teaching-shell-capability-projection.unit.test.ts tests/unit/workspace-shell.unit.test.ts tests/unit/agent-sandbox-policy.unit.test.ts tests/unit/codex-sandbox-transform.unit.test.ts tests/unit/agent-shell-and-sandbox-gaps.unit.test.ts
pnpm typecheck
pnpm run check:tool-contract
pnpm run check:security
```

Stage F 前再补安全契约文件（若已拆分）。

### 8.3 手工验收脚本（合格前至少跑一遍）

1. 新用户默认：tools 关 → 对话无 shell  
2. 开 tools，trust 工作区，workspaceShell 开 → 模型可调用 `git status` 类命令  
3. `approvalMode=based_on_approval`：`git status` 可自动；`git config` / `npm install` 必须询问或拒绝（按 mode）  
4. `sandboxMode=read_only`：非 safe 命令失败且提示  
5. Windows：Settings/Doctor 显示 notConfigured / 策略围栏  
6. 执行中取消 turn：进程停止、UI 可恢复  
7. 确认 conversation/ledger 未把 shell stdout 当 Evidence 写入权威教学结果  

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 只修 registry 不修 capability | 主路径继续假绿 | projection 集成测作为门禁 |
| known-safe 为图方便放宽 | 静默高危执行 | 负例契约；放宽必须新阶段评审 |
| 提前做 helper | 进度假象、安全 stub | G 独立；C0 先 fail-closed |
| 换 pi/Grok 整包 | 重写控制面、Windows 仍空 | 明确否决；仅允许局部取材 |
| child 继承 shell | 只读子任务越权 | 默认 deny + 测试 |
| 主进程套 L3 sandbox | 桌面稳定性崩溃 | 不做 Grok 式主进程 apply |
| 文档与实现再次分叉 | 误导后续开发 | 本文件为实施权威；完成后改 Completed |

---

## 10. 明确不做什么（全程约束）

1. 不整包替换为 pi sandbox 扩展或 Grok sandbox/shell 产品  
2. 不把 Grok/nono 直接 apply 到 Electron 主进程  
3. 不引入 YOLO / always-approve / DangerFullAccess 产品标签  
4. 不默认 `tools.enabled=true`  
5. 不把 shell 输出升级为 teaching Evidence / settlement 输入  
6. 不绕过 workspace trust 与 cwd 围栏  
7. 不在 Stage G 完成前宣称 Windows OS 沙箱已启用  
8. 不使用 SQLite FTS / 向量库充当本能力的搜索面（无关但保持产品地板）  

---

## 11. 可借鉴外部实现（取材清单，非换线）

| 来源 | 可借鉴 | 不可借鉴为整包 |
| --- | --- | --- |
| pi sandbox 扩展 | deny-read 列表、wrap 接口形状、进程组 kill | bash 工具替换模型、强制依赖 Anthropic runtime 作为唯一后端 |
| Grok sandbox | profile 严谨、deny 测试态度、子进程网络策略思想 | 进程启动式 L3、整壳 shell 产品、主进程 enforce |
| Codex | 双轴语义、readiness 枚举、Windows helper **真**协议（仅 Stage G） | 未签名/未握手的 exe 假集成 |
| Reasonix | shell 展开、writable roots | 替代 capability/approval 栈 |

---

## 12. 关键代码索引

| 路径 | 角色 |
| --- | --- |
| `src/main/ai/agent-capability-policy.ts` | L0 可见性 |
| `src/main/teaching-conversation-turn-context.ts` | turn 上下文与 policy 输入 |
| `src/main/teaching-conversation-runtime.ts` | registry 组装与 project |
| `src/main/ai/tools/registry.ts` | 注册、permission resolve、based_on_approval |
| `src/main/ai/tools/workspace-shell.ts` | 执行编排 |
| `src/main/ai/tools/shell-command-safety.ts` | argv / known-safe |
| `src/main/ai/tools/shell-hardline.ts` | unconditional catastrophic denylist（本课放行之下的硬底） |
| `src/main/ai/tools/shell-env-scrub.ts` | shell child env scrub（剥离 provider/token） |
| `src/main/ai/tools/agent-sandbox-policy.ts` | L2 决策 + readiness |
| `src/main/ai/tools/codex-sandbox-transform.ts` | L3 probe/transform |
| `src/main/ai/tools/effect-policy.ts` | privileged 映射 |
| `src/shared/teaching-settings-schema.ts` | 默认值 |
| `src/shared/teaching-types/agent-sandbox.ts` | 类型 |
| `src/renderer/src/views/settings/SettingsView.tsx` | 设置面 |
| `docs/tools/TOOL_CONTRACT.md` | 工具合同 |

---

## 13. 进度跟踪

| 阶段 | 状态 | 完成日期 | 备注 |
| --- | --- | --- | --- |
| A 主路径接通 | Completed | 2026-07-25 | capability + projection 集成测 |
| B 自动放行收口 | Completed | 2026-07-25 | known-safe 负例契约锁定 |
| C0 Windows fail-closed | Completed | 2026-07-25 | readiness 恒 notConfigured |
| C 后端诚实化 | Completed | 2026-07-25 | 共享 probe + 降级一致性 |
| D 生命周期 | Completed | 2026-07-25 | abort/timeout/截断 |
| E 产品面诊断 | Completed | 2026-07-25 | Settings/Doctor/审批摘要 |
| F 硬化合格 | Completed | 2026-07-25 | 门禁全绿；文档收口 |
| G Windows helper | Deferred | | 可选，不阻塞合格；无 OS sandbox 宣称 |

**路线状态：** `Completed — Agent Shell / Sandbox qualified (without Windows OS helper)`

**已知限制（合格边界内）：**

- Windows 无 RestrictedToken / command-runner helper；始终 `policy_fence` + 审批，`windowsReadiness=notConfigured`。
- macOS/Linux OS 包装依赖本机 `sandbox-exec` / `bwrap`；不可用时诚实降级为策略围栏。
- 不宣称 Docker/VM 完备隔离；不引入 YOLO / DangerFullAccess / always-approve 产品标签。
- **本课放行**（`approvalMode=full_access`）= 本 run 自动放行 shell/写操作（Codex `never` 语义）；**不是**产品标签 “YOLO”。其下仍受 hardline 灾难命令黑名单、路径围栏、env scrub 约束。
- Stage F 以 unit + typecheck + tool-contract + security 门禁为合格证据；端到端手工 smoke（§8.3）可作为发布前复验，不阻塞本路线 Completed。
- **Expanded parity（2026-07-25 后）**：Hermes 风格 hardline denylist；shell child env scrub；`sandboxAllowsOutboundNetwork` 统一网络姿态；打包 `resources/sandbox` → `extraResources`。非目标：整包 pi/Grok runtime、Hermes Docker/Modal 默认后端、Windows Stage G helper。

---

## 14. 完成后的能力说明书（预期对外表述）

完成 A–F 后，产品可如是描述（且必须与实现一致）：

> StudiumX 教学 Agent 在开启工具并信任工作区后，可使用工作区命令工具（`run_workspace_command` / `shell`）。  
> 命令执行受工作区路径围栏、审批三态与沙箱模式约束。  
> 已知安全的只读命令可在「按风险」模式下自动放行；其余需确认或受只读沙箱拒绝。  
> 在 macOS/Linux 上，若系统能力可用，将对命令尝试 OS 级包装；不可用时回退为策略围栏并明确展示。  
> Windows 当前为策略围栏 + 审批，不宣称 OS 级沙箱。  
> 命令输出用于 Agent 推理与工程反馈，**不是**教学 Evidence，也不改变 settlement 权威。

---

## 15. 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-07-25 | Stage F 完成：A–F Completed；路线状态 qualified（without Windows OS helper）；§1 DoD 勾选；门禁 typecheck / tool-contract / security / shell unit 全绿；Windows helper 仍 Deferred |
| 2026-07-24 | 初版：基于仓库现状核验，定义合格能力、A–G 阶段、测试门禁、否决整包换线与 Windows helper 解耦 |

---

## 16. 后续（A–F 已完成后）

A–F 已于 2026-07-25 完成；实施权威状态见 §13。

可选后续：

1. 发布前按 §8.3 手工 smoke 复验一次（非本路线阻塞项）  
2. 若产品硬性要求 Windows OS 级隔离宣传 → 启动 **Stage G**（helper 构建/签名/分发），不得回写假 ready  
3. 勿再把本路线状态降级为「仅有沙箱代码」；变更须更新本文件与相关 unit  

**全路线完成标志（已满足）：**  
§1 合格能力定义已按证据勾选，§13 中 A–F Completed，§14 表述与实现一致（Windows = 策略围栏，无 OS helper）。

## 17. Expanded sandbox parity（post A–F，对标 pi/hermes 的可采纳子集）

在 A–F 合格交付之上，补齐与参考实现的 **defense-in-depth** 子集（**非整包换线**）：

| 能力 | 参考 | StudiumX 落地 | 备注 |
| --- | --- | --- | --- |
| 本 run 全自动放行 | hermes YOLO / Codex never | `approvalMode=full_access` → **本课放行** | **禁止** UI/设置/合同出现 YOLO 标签 |
| 灾难命令硬底 | hermes hardline | `shell-hardline.ts`，执行前 fail-closed | 在 本课放行 之下仍拦截 `rm -rf /`、mkfs、dd 到块设备、shutdown 等 |
| 子进程环境脱敏 | hermes env scrub | `shell-env-scrub.ts` | 剥离 provider/token；保留 PATH/HOME/LANG |
| 出站网络姿态 | Codex workspace-write 默关网 | `sandboxAllowsOutboundNetwork(mode)` | full_access 才开；transform 与 policy 共用 |
| OS 策略资源打包 | Codex seatbelt 资源 | `package.json` `extraResources` → `sandbox/` | 修复打包后 seatbelt 策略不可达 |
| 域名级网络策略 | pi sandbox-runtime | **未**整包引入 | 可选后续；不阻塞 |
| Landlock 主进程 | grok nono | **明确否决**用于 Electron main | 见策略对照文档 |
| Docker/Modal 默认后端 | hermes L4 | **非目标** | 无默认 shell 后端换线 |

**产品表述：** 需要“完全放行命令”时，使用设置中的 **本课放行**（`approvalMode=full_access`）。这与主流 Agent 的 run-scoped auto-allow 对齐；hardline 仍是不可关闭的安全地板。


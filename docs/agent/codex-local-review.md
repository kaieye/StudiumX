# Codex 本地审查后的 StudiumX 迁移记录

日期：2026-07-12  
范围：基于本机 Codex App/CLI 的可观察架构特征，只迁移对 StudiumX 有学习产品价值的机制；不复制 Codex 专有源码、内部提示词、credential 或高权限桌面自动化能力。

## 结论

Codex 对 StudiumX 最有价值的不是“通用 coding agent”体验，而是这些工程机制：

1. **本地 runtime 可审计**：任务/工具/权限/错误可回放、可诊断。
2. **安全策略显式化**：provider、proxy、workspace、external link、工具写入都有可测试边界。
3. **默认有界**：agent loop、child run、工具调用不能默认无限执行。
4. **诊断一等化**：把分散的安全/环境检查聚合成可运行入口。
5. **事实与索引分离**：workspace 文件仍是真相，索引/日志/doctor 负责恢复与解释。

StudiumX 不迁移 Codex 的这些方向：通用 IDE 心智、任意 MCP/插件市场、remote-control、Computer Use、自动操作登录网站、让 child agent 直接写长期学习资产。这些方向对“学习改变可信度”的收益不足，风险过高。

## 已迁移到代码的决策

### 1. Repository / package hygiene

- 根目录的 Codex reference bundle 已移出 workspace root，放入被 `.gitignore` 忽略的 `ref_project/codex-desktop/`。
- 包管理器明确为 pnpm：`packageManager: pnpm@11.9.0`。
- 删除 stale `package-lock.json`，保留 `pnpm-lock.yaml` + `pnpm-workspace.yaml`。
- `pnpm-workspace.yaml` 的 `allowBuilds` 占位已显式决策为 true。
- 新增 `check:repository-hygiene`，防止根目录再次混入 Codex bundle 或 lockfile 策略漂移。

### 2. Agent loop 默认有界

Codex 的本地 agent runtime 强调可控执行。StudiumX 已将默认工具循环从 unbounded 改为有界：

- `src/main/ai/agent-loop.ts`：`DEFAULT_MAX_ITERATIONS = 8`。
- `src/main/teaching-settings.ts`：默认 `tools.maxIterations = 8`。
- settings normalize 最小值为 1，UI 已按 1-12 暴露高级调节。
- 显式传入 `maxIterations: 0` 的低层 fixture 仍可测试“不限制直到 final answer”的兼容路径。

### 3. Tool cancellation / bounded runtime

在默认有界循环之外，工具执行也补齐了取消信号传播：

- `ToolContext` / `ToolCallContext` 带 `AbortSignal`，`runAgentLoop`、父会话和 child run 都会把当前 run signal 传给工具。
- `executeToolCall()` 在 handler 前后检查取消状态，已取消时不再运行 handler，并返回结构化“工具调用已取消”。
- `web_search` / `web_fetch` / WeChat fetch 将 parent signal 与内部 timeout 组合，避免用户点停止后网络工具继续后台跑。
- `check:tool-execution` 覆盖取消前不执行 handler 和 signal 转发。

### 4. Provider / proxy / key privacy

从 Codex 的权限和诊断模型中迁移了 provider 安全边界：

- 新增 `src/shared/provider-url-policy.ts`：
  - 默认只允许 `https://` provider URL；
  - 允许 `http://localhost` / `127.0.0.1` / `::1` 本地开发例外；
  - 拒绝 URL userinfo；
  - 拒绝把 `api_key`、`token`、`secret` 等放入 query/hash。
- `probeModelProvider()` 在 probe 前执行 URL policy。
- 正式 provider call / chat call / streaming call 在发请求前执行 URL policy。
- proxy 失败后的 direct reachability probe 不再带 provider API key。
- 新增 `redactProviderErrorText()`，provider/network/http 错误先脱敏再截断。
- `TeachingSettingsService` 的 atomic temp write 使用 `mode: 0o600`。
- 新增 `check:provider-privacy`，覆盖远程 HTTP 拒绝、本地 HTTP 例外、direct probe 不带 key、错误脱敏、敏感 query/hash 拒绝。

仍未完成：把 provider/search keys 从 settings JSON 迁移到 OS keychain / Electron `safeStorage`。这是下一步 P0/P1 交界项。

### 5. Path access 语义拆分

Codex 的 sandbox/doctor 思路要求路径策略可解释。StudiumX 已把 path helper 拆清楚：

- `isLexicallyInsideRoot()`：纯词法 containment。
- `isPathInsideRoot()`：保留旧名，作为兼容 lexical helper。
- `isRealPathInsideRoot()`：解析 symlink 后检查 containment。
- `assertRealPathInsideRoot()`：用于安全边界断言。
- `openPath` IPC：先做已配置 root 的 lexical allowlist，再用 realpath containment 防 symlink 越界。
- `check:path-access` 增加 symlink 越界 fixture。

### 6. Security check aggregator

新增聚合门禁：

```bash
pnpm check:security
```

当前包含：

- repository hygiene
- path access
- tool permissions
- tool execution / cancellation
- workspace write tool
- web fetch safe URL
- external link controls
- app data migration
- provider error redaction
- provider privacy policy

这相当于 StudiumX 的轻量 `doctor --security` 前身。

## 保留但尚未迁移的 Codex 借鉴方向

### P1：轻量 diagnostics / doctor

建议新增：

```bash
pnpm doctor -- --json --redacted
```

或 UI 中“复制诊断快照”。第一版只需要聚合：

- app/package version；
- package manager / lockfile policy；
- root pollution；
- security checks coverage；
- provider URL policy / redaction policy；
- settings storage mode；
- log path / retention；
- connector statuses；
- workspace path policy。

### P1：Agent event bus + activity timeline

当前 `runAgentLoop -> teaching-conversation-runtime -> UI stream` 还能工作，但后续需要：

- recent event replay；
- terminal event；
- permission / ask immediate delivery；
- batch byte budget；
- gap/snapshot invalidation；
- child run timeline 合并。

建议新增 `src/main/ai/agent-event-bus.ts`，UI 展示“活动记录/执行过程”，不要展示 chain-of-thought。

### P1：Permission / elicitation 一等事件

当前 permission/ask 仍偏工具事件。建议演进成明确 lifecycle：

```ts
type AgentChatProcessEvent =
  | { kind: 'status' }
  | { kind: 'tool_call' }
  | { kind: 'tool_result' }
  | { kind: 'permission_request' }
  | { kind: 'permission_resolved' }
  | { kind: 'elicitation_request' }
  | { kind: 'elicitation_resolved' }
  | { kind: 'child_run_started' }
  | { kind: 'child_run_completed' }
  | { kind: 'compaction' }
```

UI 不应靠 tool name 判断“这是不是审批”。

### P1/P2：Durable learning task index

借鉴 Codex 的 thread/job index，但 StudiumX 要用学习语言：

```text
.studiumx/tasks.jsonl
或 appData SQLite task index
```

记录 learning task、conversation、course/session、child runs、sources、artifacts、permission decisions、error/retry path。目标是回答“这节课如何生成、读过哪些资料、为什么写入学习记录”。

### P2：双轨持久化

保留这个方向，但不要过早把 workspace truth 搬进 DB：

- 原始事实：workspace markdown / lesson HTML / JSONL；
- 查询索引：SQLite 或 appData index；
- 一致性：doctor reconcile。

### P2/P3：Learning Pack / Skill manifest

Codex 的 plugin/skill progressive disclosure 值得迁移为教学包，但只做受控 learning pack，不做任意 MCP marketplace：

```text
learning-pack/
  pack.json
  skills/
  resources/
  references/
  assets/
```

manifest 声明 capabilities、default prompts、resource index、policy。脚本默认不执行，仅 builtin 白名单可用。

## 已删除/不再作为 StudiumX 路线的方向

- 复制 Codex Desktop 的 native helper / Sparkle / app-server / remote-control 结构。
- 引入任意 shell/MCP/computer-use/browser automation。
- 让 child agent 直接写 `MISSION.md`、`learning-records/`、`lessons/*.html`、course/session index。
- 把 compaction summary 当成 learner memory。
- 把 lesson generation 视为普通 patch application。
- 在产品文案中使用 generic project/task/thread 取代 Mission/Course/Session/Lesson/Learning Record。

## 当前验证入口

推荐每次改安全边界后运行：

```bash
pnpm check:security
pnpm check:agent-loop-baseline
pnpm check:agent-loop-empty-final
pnpm check:tool-execution
pnpm check:agent-chat-cancel
pnpm build
```

若只验证本次迁移：

```bash
pnpm check:repository-hygiene
pnpm check:provider-privacy
pnpm check:provider-errors
pnpm check:path-access
```

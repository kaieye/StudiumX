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

### 7. Lightweight doctor / redacted diagnostics

Codex 的日志导出和 redaction 机制对 StudiumX 有价值，但不迁移 repo snapshot 上传或高权限环境采集。已新增本地只读诊断快照：

```bash
pnpm doctor -- --json --redacted
```

当前实现：

- `scripts/doctor.mjs` 输出 app/package version、runtime、package manager / lockfile policy、root pollution、settings storage mode、log path / retention、workspace path policy、security checks coverage。
- 默认 redacted：home path、secret-shaped keys、Bearer token、URL userinfo、敏感 query 参数都会脱敏。
- 不包含 workspace 内容，不打包日志正文，不上传任何诊断。
- `scripts/security-checks.mjs` 作为 `check:security` 与 `doctor` 的共享检查清单。
- `check:doctor` 覆盖 JSON snapshot 不泄漏 provider/search/proxy secret。

仍未完成：UI 中“复制诊断快照”、connector statuses 的 doctor 汇总、doctor reconcile。

### 8. Agent process event semantics

Codex 的 activity timeline 值得迁移，但 StudiumX 不展示 chain-of-thought，只展示可审计过程事件。已完成第一步：

- `AgentChatProcessEvent.kind` 已扩展为一等 lifecycle：`permission_request` / `permission_resolved`、`elicitation_request` / `elicitation_resolved`、`child_run_*`、`compaction`。
- renderer process panel 不再只能用 `tool_permission` / `ask` 名称表达审批和用户选择；这些事件有稳定 kind、图标和可展开详情。
- `teaching-agent-conversations` 保存/读取时保留完整 process event kind，不再把非 tool event 压回 `status`。
- 新增 `src/main/ai/agent-event-bus.ts`，先把 `AgentLoopEvent -> chunk/status/tool` 的 main-side 投影集中起来，并为每个 stream 记录 sequence、recent replay、terminal event 和 replay byte budget。
- `check:agent-conversation-state`、`check:agent-process-timeline`、`check:agent-conversation-audit-metadata` 覆盖当前会话投影、timeline 去重和保存后读取。
- `check:agent-event-bus` 覆盖三通道兼容投影、recent replay、gap 计数和 terminal marker。

仍未完成：replay/subscribe IPC、permission / ask immediate delivery 从 main-side typed event 发出、batch flush、gap/snapshot invalidation、child run nested timeline 合并。当前 renderer 仍消费 `agentChatChunk` / `agentChatStatus` / `agentChatTool` 三条兼容 stream channel，加 renderer fallback projection。

### 9. Learning Work Ledger

Codex 的 thread/job index 已迁移为 StudiumX 语言下的 **Learning Work Ledger**，不叫 generic task index：

```text
.studiumx/learning-work.jsonl
```

当前实现：

- `src/main/learning-work-ledger.ts` 在保存 agent conversation 时写入 append-only JSONL；workspace 对话写入 workspace-local `.studiumx/learning-work.jsonl`，temporary conversation 写入 appData root 的同名 ledger。
- ledger entry 只引用现有 truth：conversation markdown、materialized conversation JSON、`.agent-sessions` audit log。
- entry 汇总 learning work status、conversation/course pointer、sources、child runs、compactions、tool-result artifact archive、generated lesson artifact、permission decisions。
- 同一 conversation snapshot 去重；对话继续后追加新 snapshot。
- 原始事实仍在 workspace markdown / lesson HTML / JSONL / audit log 中，ledger 只是恢复和查询索引。

仍未完成：ledger reconcile、UI 查询入口；跨 workspace/appData derived cache 仅在确有查询性能需求时再做。

## 保留但尚未迁移完成的 Codex 借鉴方向

### P1：Agent event bus replay

当前已有轻量 `AgentEventBus`，但它还只是 main-side 兼容 adapter。后续需要把 Codex 的 realtime bus 思路继续收敛到 StudiumX：

- `subscribe/replay(streamId, afterSeq)` IPC；
- permission / ask immediate delivery 从 main-side typed event 发出；
- token delta batch flush，tool/permission/status terminal 立即 flush；
- gap/snapshot invalidation，renderer 能发现缺事件并用最终 `done.turns` 或 saved conversation 纠偏；
- child run nested timeline 合并。

不迁移 Codex 的完整 host/remote/lease 系统；StudiumX 只需要单机教学会话的可恢复 stream。现有 process panel 和 process event kind 已经是基础，不需要重建 timeline UI。

### P2：Ledger reconcile / 双轨持久化

Learning Work Ledger 已落地。下一步优先做 reconcile，而不是先做 SQLite：

- 原始事实：workspace markdown / lesson HTML / JSONL；
- 查询索引：`.studiumx/learning-work.jsonl`；
- 一致性：doctor reconcile 扫描 ledger pointer，输出 missing/stale 计数；
- appData derived cache 或 SQLite 只在跨 workspace 汇总变慢后再加。

### P2/P3：受控 Skill Pack / manifest

Codex 的 plugin/skill progressive disclosure 已迁移成 StudiumX 的受控 skill library，不做任意 MCP marketplace：

- `resources/builtin-skills/*/SKILL.md` 是内建 skill 包入口；
- `SkillLibraryService` 只从内建 roots 安装到 `~/.studiumx/skills`，slash command 只加载已安装 skill；
- 安装内建 skill 时会把 pack-level `_shared` 资源合并到个人 skill root：只补缺失文件，不覆盖用户已有版本；`_shared` 不进入 skill catalog；
- `read_skill_resource` 只读本轮 invoked skill 目录或其明确的 `../_shared/...` 文本资源，并对两种路径都做 realpath 越界保护；
- `teaching-site` router 文案已改为 StudiumX 的真实能力：明确提示用户用已安装的 leading slash command，不虚构动态 `Skill` / `activate_skill` 工具；
- `check:skill-library` 覆盖安装、slash 推断、progressive disclosure、shared-resource 合并/读取、用户文件保留和资源逃逸。

仍未完成：typed manifest/schema。当前保留显式 slash 路由，不迁移隐藏的动态 sub-skill activation；脚本默认不执行，仅 builtin 白名单可用。

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
pnpm check:doctor
pnpm check:provider-privacy
pnpm check:provider-errors
pnpm check:path-access
pnpm check:agent-conversation-state
pnpm check:agent-event-bus
pnpm check:agent-process-timeline
pnpm check:agent-conversation-audit-metadata
pnpm check:skill-library
```

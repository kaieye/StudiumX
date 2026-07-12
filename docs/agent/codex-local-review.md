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

本次比对以本机 Codex Desktop bundle 的可观察协议与状态名为证据，只提炼机制，不复制实现。可确认的 realtime 特征包括递增 batch/op sequence、pending operations、replay/replay-unavailable、gap 后 snapshot invalidation，以及 permission/terminal event 的即时投递；这些证据用于约束下面的 sequence/replay/gap 设计。Codex 的 host、remote、lease、repo snapshot upload 等结构没有迁移。

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
- Electron 可用 `safeStorage` 时，provider API key、proxy URL 与 Brave/Firecrawl/Tavily/Exa/Parallel/xAI search key 以 `safeStorage:v1:<ciphertext>` 写盘；runtime/UI 内存接口仍使用解密值。
- app 启动读取旧 plaintext settings 时会自动迁移；若平台暂时无法解密，更新无关设置不会覆盖现有 ciphertext，也不会把 ciphertext 当成 API key 使用。
- 新增 `check:provider-privacy`，覆盖远程 HTTP 拒绝、本地 HTTP 例外、direct probe 不带 key、错误脱敏、敏感 query/hash 拒绝。
- 新增 `check:settings-secret-storage`，覆盖加密写盘、plaintext 自动迁移、不可用时保留 ciphertext 和敏感字段完整枚举。

平台没有提供 Electron `safeStorage` 时，新输入的 secret 仍只能落在受权限保护的 settings JSON 中；doctor 会明确报告 `pending_app_launch` 或 partial 状态，不伪装为已完成加密。

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
- settings secret storage

这相当于 StudiumX 的轻量 `doctor --security` 前身。

### 7. Lightweight doctor / redacted diagnostics

Codex 的日志导出和 redaction 机制对 StudiumX 有价值，但不迁移 repo snapshot 上传或高权限环境采集。已新增本地只读诊断快照：

```bash
pnpm doctor -- --json --redacted
pnpm doctor -- --json --redacted --workspace /path/to/workspace
```

当前实现：

- `scripts/doctor.mjs` 输出 app/package version、runtime、package manager / lockfile policy、root pollution、settings secret encryption 状态、log path / retention、workspace path policy、security checks coverage。
- 默认 redacted：home path、secret-shaped keys、Bearer token、URL userinfo、敏感 query 参数都会脱敏。
- 不包含 workspace 内容，不打包日志正文，不上传任何诊断。
- `scripts/security-checks.mjs` 作为 `check:security` 与 `doctor` 的共享检查清单。
- doctor 总是检查 appData ledger；传入 `--workspace` 时额外 reconcile workspace-local `.studiumx/learning-work.jsonl`，只输出条目、无效行、重复 ID、missing/stale pointer 等计数。
- `check:doctor` 覆盖 JSON snapshot 不泄漏 provider/search/proxy secret，`check:learning-work-reconcile` 覆盖 pointer containment、symlink escape、missing/stale truth 与重复 entry。

不增加 UI“复制诊断快照”：当前 CLI 入口已覆盖开发与支持场景，额外 UI 会扩大敏感信息误分享面，却没有直接学习价值。connector status 继续由各连接器自身设置/探测展示，不塞进与当前故障无关的全局快照。

### 8. Agent process event semantics

Codex 的 activity timeline 值得迁移，但 StudiumX 不展示 chain-of-thought，只展示可审计过程事件：

- `AgentChatProcessEvent.kind` 已扩展为一等 lifecycle：`permission_request` / `permission_resolved`、`elicitation_request` / `elicitation_resolved`、`child_run_*`、`compaction`。
- renderer process panel 不再只能用 `tool_permission` / `ask` 名称表达审批和用户选择；这些事件有稳定 kind、图标和可展开详情。
- `teaching-agent-conversations` 保存/读取时保留完整 process event kind，不再把非 tool event 压回 `status`。
- `src/main/ai/agent-event-bus.ts` 把 `AgentLoopEvent -> chunk/status/tool` 的 main-side 投影集中起来；每个 realtime event 都带 stream-local sequence，并受 replay byte budget 约束。
- main process 通过统一 `teach:agent-chat-event` 投递 sequenced event，同时保留原三条 channel 作为兼容 API；最近 32 个 stream 的 event bus 可通过 `teach:agent-chat-replay` 按 `afterSequence` 重放。
- preload 的 `agentChatStream` 只消费统一 channel；发现 sequence gap 时自动请求 replay、去重，并在 stream promise 返回前等待事件队列排空。
- permission request/resolution 与 ask/tool/terminal 状态都从 main-side typed bus 即时发出；最终 stream result 和已保存 conversation 仍作为超出 replay window 时的事实来源。
- `check:agent-conversation-state`、`check:agent-process-timeline`、`check:agent-conversation-audit-metadata` 覆盖当前会话投影、timeline 去重和保存后读取。
- `check:agent-event-bus` 覆盖兼容投影、recent replay、gap/dropped 计数和 terminal marker；IPC fixture 覆盖统一 event/replay contract；preload fixture 证明跳过的 live event 只恢复一次。

不继续迁移 Codex 的 token batch flush 和 nested child timeline：StudiumX 当前是单窗口、本地教学会话，sequence/replay/final-result reconciliation 已解决正确性；只有 profiling 证明 IPC token 压力，或 child-run UX 明确需要树形展开时才引入额外复杂度。

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
- `scripts/lib/learning-work-reconcile.mjs` 校验 JSONL 行、entry ID、markdown/materialized JSON/session audit pointer、realpath containment，以及最新 snapshot 的更新时间与消息/turn 数。
- doctor 将 reconcile 结果作为 redacted counts 输出，不打印课程或对话内容。

不先做 ledger UI、跨 workspace cache 或 SQLite。当前 append-only ledger + doctor reconcile 已满足恢复与诊断；等出现明确的跨 workspace 搜索 UX 和性能数据后再选择索引实现。

### 10. 受控 Skill Pack / manifest

Codex 的 plugin/skill progressive disclosure 已迁移成 StudiumX 的受控 skill library，不做任意 MCP marketplace：

- 15 个 builtin skill 都有严格 `skill-pack.json`：固定 schema version、semver、有限 capability 枚举、显式 resource path/kind，未知字段与未知能力直接拒绝。
- `SkillLibraryService` 只接受 builtin ID 白名单；builtin 安装、列举和读取都重新校验 manifest、资源完整声明、普通文件类型与 realpath containment。
- 安装时只复制 manifest 声明的 `_shared` 资源，不覆盖用户已有版本；symlink、未声明包内文件和越界资源均拒绝。
- `read_skill_resource` 只有在 manifest 声明 `read-resources` / `read-shared-resources` 能力时才能读取对应资源，并返回 `resourceKind`。
- 已存在的无 manifest 个人 Skill 保持 legacy 兼容；它们不会获得 builtin 白名单或可执行脚本能力。
- `teaching-site` router 文案已改为 StudiumX 的真实能力：明确提示用户用已安装的 leading slash command，不虚构动态 `Skill` / `activate_skill` 工具；
- `check:skill-library` 覆盖全部 builtin manifest、白名单、未知字段/危险能力、未声明资源、legacy 兼容、shared-resource 读取和 symlink escape。

## 已删除/不再作为 StudiumX 路线的方向

- 复制 Codex Desktop 的 native helper / Sparkle / app-server / remote-control 结构。
- 引入任意 shell/MCP/computer-use/browser automation。
- 让 child agent 直接写 `MISSION.md`、`learning-records/`、`lessons/*.html`、course/session index。
- 把 compaction summary 当成 learner memory。
- 把 lesson generation 视为普通 patch application。
- 在产品文案中使用 generic project/task/thread 取代 Mission/Course/Session/Lesson/Learning Record。
- 为当前单窗口 event stream 增加 token batch scheduler 或完整 host/remote/lease 层。
- 在没有查询需求和性能证据时引入 ledger UI、全局 cache 或 SQLite。
- 为 doctor 增加 UI copy/export、repo snapshot upload 或日志正文打包。

## 当前验证入口

推荐每次改安全边界后运行：

```bash
pnpm check:security
pnpm check:agent-loop-baseline
pnpm check:agent-loop-empty-final
pnpm check:tool-execution
pnpm check:agent-chat-cancel
pnpm check:settings-secret-storage
pnpm check:learning-work-reconcile
pnpm build
```

若只验证本次迁移：

```bash
pnpm check:repository-hygiene
pnpm check:doctor
pnpm doctor -- --json --redacted --workspace /path/to/workspace
pnpm check:provider-privacy
pnpm check:provider-errors
pnpm check:path-access
pnpm check:agent-conversation-state
pnpm check:agent-event-bus
pnpm check:agent-process-timeline
pnpm check:agent-conversation-audit-metadata
pnpm check:skill-library
```

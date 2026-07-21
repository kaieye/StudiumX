# ZCode 对照学习笔记（StudiumX）

> 对照对象：`ref_project/Zcode`（从 `/Applications/ZCode.app` 解包，版本 **3.3.3**，build `205ad158`，构建时间 `2026-07-08T16:10:02.424Z`，Electron Builder **26.8.1**）
> 对照主体：本仓库 **StudiumX**（本地 AI 教学工作区，Electron + React + TypeScript，版本 **0.1.0**，Electron ^42.5.0 / electron-vite ^5 / electron-builder ^26.15.3）
> 审查方式：对 ZCode 解包产物（main/host/preload/renderer + glm runtime + plugins + model catalog + Info.plist）与 StudiumX 源码/ADR/打包脚本做**直接互相比对**。
> 并行审查：主审查 + 四条域内审查线（架构进程、Agent/Tools/MCP/Skills、产品包装/运维、安全配置）。本环境无独立子 agent 工具，四条线以并行证据抽取 + 汇总落盘代替。
> 日期：2026-07-21（**相对既有文档的全量复核重写**：修正错误路径、补齐遗漏、细化证据）

---

## 0. 结论摘要

ZCode 是「通用 coding agent 桌面壳 + 独立 agent runtime（`glm/zcode.cjs`）+ 插件/MCP 生态」的成熟产品形态；StudiumX 是「教学工作区 + 文件真相源 + 受约束 teaching agent」产品形态。

**最值得借鉴的不是把 ZCode 的 MCP/SSH/终端/远程控制搬过来**，而是：

1. **进程职责分层**（Electron shell / 长生命周期 host / agent runtime / 独立诊断窗）
2. **工具包装的完整横切能力**（permission / timeout / cancel / tracing / result budget / formatModelContent / 大图 artifact offload）
3. **可诊断的配置与技能**（配置定位表 + 症状→原因→修复 + 严格 schema 边界）
4. **模型目录的可数据驱动扩展**（多协议 `kinds` + path-based `set`/`unset` request patch）
5. **发布与可支持性基础设施**（build-meta、updater 通道、process metrics、export logs、E2E 故障注入）

StudiumX **已经借鉴过**的 ZCode 形态（ADR-0040/0041/0042/0043/0046，以及后续 0047–0049 的运行时/工具契约）应继续作为基线，不要回退成“再造一个 coding agent”。

---

## 1. 两边产品定位对照

| 维度 | ZCode | StudiumX |
| --- | --- | --- |
| 产品目标 | 桌面 coding agent / 任务与工作区 IDE 壳 | 本地教学工作区：Mission → Lesson → Learning record |
| 真相源 | 任务/会话 store + 工作区代码 + 用户/插件配置 | **文件系统**是真相源（MISSION/CONTEXT、lesson HTML、records） |
| Agent 定位 | 通用 agent loop + MCP + shell/终端 + 远程 | 教学 agent：effect policy、capability catalog、无默认 shell/MCP |
| 扩展面 | plugin（skills/commands/hooks/mcpServers/userConfig） | skill-pack + 最小 ExtensionManifest 类型（loader 未全开） |
| 运维面 | process monitor、usage 图表、updater、OAuth、远程 | doctor、support-bundle、tech-inspector、release-audit |
| 明确非目标 | （产品本身就是 coding agent） | 云同步、MCP 市场、自动遥测、SQLite FTS 产品搜索、默认 shell（见 README/SECURITY/ADR-0039） |

**借鉴原则**：只吸收能提升 *教学工作区可靠性、可支持性、agent 横切能力、配置可诊断性* 的设计；凡是把产品拉向「通用 coding agent 平台」的能力，一律降级为“信号触发 / 远期 / 不抄”。

---

## 2. 架构与进程模型对照

### 2.1 ZCode 进程拓扑（解包证据）

```
Electron App Bundle (ZCode.app)
├── MacOS/ZCode                         # Electron 宿主
├── Frameworks/* Helper.app             # GPU / Renderer / Plugin helpers
└── Resources/
    ├── app/out/
    │   ├── main/                       # 桌面壳：窗口、IPC、更新、系统集成（index.js ~712KB）
    │   ├── host/                       # 桌面 host service：协议面、MCP 列表、会话/工作区绑定（index.js ~1.26MB）
    │   ├── preload/                    # 主窗 preload + processMonitor preload（各 ~410–424KB）
    │   ├── renderer/                   # 主 UI + process-monitor.html 独立入口 + material-icons
    │   └── metadata/build-meta.json    # 版本/commit/构建时间/electron-builder 版本
    ├── glm/
    │   ├── zcode.cjs                   # 打包后的 agent/CLI runtime（~9.1MB）
    │   ├── .node-bundle-meta.json      # runtime=electron-node, source=apps/zcode-cli/...
    │   └── packages/*-plugin/          # 内置插件（skills/commands/mcp/hooks）
    ├── model-providers/*.json          # 出厂模型目录
    ├── tools/ripgrep/rg                # 捆绑搜索工具
    ├── app.asar / app.asar.unpacked/   # ASAR + native unpack（node-pty 等）
    └── app-update.yml                  # generic updater + arch 通道
```

关键证据：

- 入口与分层说明：`ref_project/Zcode/README.md`
- 包元数据：`.../app/package.json`（`@zcode/desktop` v3.3.3，workspace 依赖 `@zcode/{client,rpc,server,services,shared,ui}`）
- main / host / preload / renderer 物理分包：`.../app/out/{main,host,preload,renderer}`
- agent runtime 独立包：`.../glm/zcode.cjs` + `.node-bundle-meta.json`
- 独立诊断窗：`.../renderer/process-monitor.html` + `preload/processMonitor.cjs`
- 构建元数据：`.../metadata/build-meta.json`
- 自动更新：`.../app-update.yml`（`provider: generic`，`.../update/mac/arm64/`）
- Info.plist：`CFBundleURLSchemes: zcode`、`ElectronAsarIntegrity` SHA256、`NSAllowsArbitraryLoads: true`

#### 2.1.1 从 IPC 看 shell 职责（抽取 86 个 `zcode:*` 通道，节选）

| 类别 | 示例 IPC | 职责 |
| --- | --- | --- |
| 窗口/壳 | `zcode:new-tab`, `zcode:sync-window-tabs`, `zcode:focus-tab`, `zcode:set-title-bar-theme`, `zcode:get-desktop-zoom-level` | 多标签、主题、缩放、未读同步 |
| 工作区 | `zcode:open-workspace`, `zcode:open-workspace-path`, `zcode:activate-or-set-workspace` | 打开/激活工作区 |
| 系统集成 | `zcode:open-in-editor`, `zcode:get-installed-editors`, `zcode:open-in-file-manager`, `zcode:list-ssh-config-aliases`, `zcode:execute-desktop-command` | 外部编辑器、SSH 发现、桌面命令 |
| 更新 | `zcode:get-update-state`, `zcode:update-state-changed`, `zcode:quit-and-install-update`, `zcode:post-update-release-notes` | 更新状态机 + 更新说明 |
| 诊断 | `zcode:open-process-monitor`, `zcode:get-process-metrics`, `zcode:export-logs`, `zcode:perf:start/stop`, `zcode:capture-window-screenshot` | 进程监控、日志、性能 |
| MCP 配置迁移 | `zcode:load-mcp-from-user-directory`, `zcode:save-mcp-to-user-directory`, `zcode:migrate-legacy-common-mcp` | 用户目录 MCP 读写与迁移 |
| Host 协议 | host `listMcpServerStatuses`、`appendWorkspaceToFilesystemMcpServers`、`McpSync` | 协议/状态合并，而非纯 UI |
| 远程 | `zcode:connect-remote`, Docker/WSL list, `service-port`, web-remote-control* | 远程会话与端口 |
| 账户/支付/遥测 | `zcode:oauth-*`, `zcode:payment-callback`, `zcode:report-telemetry-event`, `zcode:report-arms-custom-event` | **教学产品不抄** |
| 通知 | `zcode:show-task-notification`, `zcode:task-notification-click`, `zcode:task-notification-sound` | 长任务完成通知 |

**关键设计点**：main 偏“桌面壳与系统能力”，host 偏“长生命周期服务与协议”，glm runtime 偏“agent 执行内核”。这让 UI 卡顿与 agent/MCP 热路径解耦，并允许独立预加载诊断窗。

#### 2.1.2 Monorepo 包切分信号

ZCode desktop `package.json` 依赖 `@zcode/client|rpc|server|services|shared|ui`，说明桌面只是 workspace 里的壳；agent 内核另有 `apps/zcode-cli` → `zcode.cjs` 打包路径。StudiumX 当前是单 app 树（`src/main|preload|renderer|shared`），逻辑边界靠模块与 ADR，而不是 package 边界——这本身没错，但可把“边界模块”写得更像稳定 facade。

### 2.2 StudiumX 进程拓扑

```
StudiumX (electron-vite)
├── src/main/                 # 几乎全部宿主逻辑同进程
│   ├── index.ts              # 窗口 + ApplicationRuntime 启动序
│   ├── teaching-ipc-gateway  # teach:* IPC 大门
│   ├── teaching-ipc-commands # 命令实现面
│   ├── ai/*                  # agent loop / tools / provider / session runtime
│   ├── teaching-*            # 工作区、ledger、doctor、inspector
│   └── application-runtime   # prepare→create→recover→register→open→applyBehavior；activate/drain
├── src/preload/              # 单一 preload 桥（index + agent-realtime-delivery）
├── src/renderer/             # 单一主 UI（无独立 process-monitor 入口）
└── src/shared/               # 契约与领域类型
```

证据：`electron.vite.config.ts`（main/preload/renderer 三目标，**无 host 目标**）、`src/main/application-runtime.ts`、`src/shared/teaching-ipc-contract.ts`（约 77 个 `teach:*` 通道）。

`ApplicationRuntime` 固定 boot 序：

`prepare → create → recover → register → open → applyBehavior`，退出时 `beginShutdown → drain`。这比“巨大 monobundle 无生命周期”更清晰。

### 2.3 差距与可借鉴（架构）

| 点 | ZCode | StudiumX 现状 | 建议 |
| --- | --- | --- | --- |
| Shell / Host 分离 | `out/main` + `out/host` 物理分包 | 同 main 进程；逻辑上已有 `ApplicationRuntime` + `teaching-turn-coordinator-host` + `TeachingSessionProtocol` | **P1 逻辑分层**（modules/packages），**P2 才考虑物理拆进程**（对齐 ADR-0039 P2-7，默认不排期） |
| 独立诊断窗 | process-monitor 独立 HTML/preload | tech-inspector / doctor 多为模块或 CLI | **P1** 主窗内只读 metrics/logs 面板；**P2** 独立 BrowserWindow |
| 会话协议边界 | host 协议 + glm runtime | `TeachingSessionProtocol` facade（ADR-0040）：`src/shared/teaching-types/teaching-session-protocol.ts` + `src/main/ai/teaching-session-runtime.ts` | 保持 in-process；新能力优先挂协议方法集，而不是再堆 `teach:*` 散点 |
| Runtime 产物 | 打包 `glm/zcode.cjs` 作为 agent 内核 | agent 在 main 源码树内编译 | 不必抄 CLI 打包；可借鉴 **build-meta / 明确 runtime 边界模块** |
| 启动体验 | `body.zcode-startup-ready` 遮罩 + logo 动画 + reduced-motion | `src/renderer/index.html` 仅空 root，无 ready 门闩 | **P1** 首屏稳定遮罩，避免白闪/半初始化 UI |
| 预加载职责 | 主窗 preload + 诊断窗专用 preload | 单一 preload | 若做独立诊断窗，再拆 preload；否则保持单一 |

**已有更好、不要照抄**：StudiumX 的 `ApplicationRuntime` 固定 boot 序比“隐式启动”更清晰；领域 IPC 用 `teaching-ipc-contract` 做 typed channel map；settlement / ledger 权威分离是教学产品独有优势。

---

## 3. Agent 运行时 / 工具 / MCP / Skills 对照

### 3.1 ZCode Agent 运行时要点

1. **Runtime 与 Desktop 解耦**：`glm/zcode.cjs` 是 agent 实现本体（source: `apps/zcode-cli/packages/cli/dist/zcode.cjs`，runtime=`electron-node`）；desktop host 通过协议调用，而不是把全部 agent 逻辑塞进 renderer。
2. **MCP 全链路**（minified 符号，README + 源码抽样均确认存在）：
   - 注册：`Wke` — 遍历工具 → `qmn` 命名 → `Gmn` 包装 → `register`
   - 命名：`qmn` → 默认 `mcp__<server>__<tool>`
   - **包装 `Gmn`（比“五件套”更完整）**：
     - annotations → `readOnlyHint` / `destructiveHint` / 派生 `riskLevel`（high/medium/low）
     - `sideEffectScope: "network"`
     - `needsApproval: true`（MCP 默认需批准）
     - `permission` 对象（patternSources、denyPriority=`beforeAsk`）
     - `timeout`（defaultMs，`allowCallOverride: false`）
     - `cancellation`（supported、cleanup=`bestEffort`、userVisibleMessage）
     - `trace`（required、propagateToAdapters、recordInput/Output=`summary`）
     - `resultBudget`：`maxInlineBytes: 1e5`、`maxModelBytes: 5e4`、`strategy: "truncate"`、preview head
     - `handler`：`callTool` + abortSignal + timeoutMs
     - `formatModelContent`
   - 结果后处理：`Wmn` / `Vmn` — 尤其 **大图 base64 超限时 offload 到 artifactStore**，否则替换为说明文本
   - 状态：`listMcpServers`；host `listMcpServerStatuses`（对 `mcpList` 超时/兼容问题 **重试**；新协议字段失败时回退旧形状）
   - 工作区注入：`appendWorkspaceToFilesystemMcpServers`（filesystem MCP + workspace path）
3. **配置多层合并**：user / workspace / plugin / env / CLI；`.zcode` 优先于 `.agents` 兼容回退；**严格 schema，未知 key 丢弃整条 server**（diagnosing-mcp 明确记载）。
4. **插件形态**（`glm/packages/*/.zcode-plugin/plugin.json`）：
   - `skills` / `commands` / `mcpServers` / `userConfig` / hooks
   - 模板变量：`${ZCODE_PLUGIN_ROOT}`、`${ZCODE_PROJECT_DIR}`、`${ZCODE_PLUGIN_DATA}`、`${user_config.KEY}`（**仅插件侧展开**；配置文件 MCP **不**展开模板）
   - 内置：android-emulator、ios-simulator、document-skills、skill-creator、zcode-guide、restore-legacy-sessions
   - android/ios 的 `hooks/hooks.json` 当前为空对象，但 **hooks 扩展点已存在**
5. **Diagnosing skills**（`zcode-guide-plugin`）：
   - `diagnosing-mcp` / `diagnosing-plugins` / `diagnosing-skills` / `diagnosing-commands` / `diagnosing-hooks`
   - 另有 `zcode-configuration-guide`
   - 结构范式：**配置位置表 → schema 边界 → 状态如何查看 → 症状→原因→修复 → 有序定位工作流**
6. **Skill 多根发现**（skill-creator 文档，优先级高→低）：
   1. `<project>/.zcode/skills/<name>/SKILL.md`
   2. `<project>/.agents/skills/<name>/SKILL.md`
   3. `~/.zcode/skills/<name>/SKILL.md`
   4. `~/.agents/skills/<name>/SKILL.md`
   - 默认**新建**技能写到 `.agents/skills`（跨工具）；`.zcode/skills` 用于 **override**

### 3.2 StudiumX Agent 现状（对照）

| 能力 | StudiumX 证据 | 与 ZCode 关系 |
| --- | --- | --- |
| Agent loop | `src/main/ai/agent-loop.ts`（budget/cancel/compaction 等） | 教学向完整；无 shell 默认路径 |
| Tool effect / dispatcher | `tools/effect-policy.ts`, `dispatcher.ts`, ADR-0024 | 更偏安全分类；dispatch：abort 检查 → authorize → parse args → handler → budget |
| Risk annotations + result budget | `tools/annotations.ts`, ADR-0041 | **已借鉴**；默认 32KiB UTF-8 硬预算 + truncation marker |
| Capability catalog | `teaching-capability-catalog.ts`, ADR-0022 | fail-closed 教学能力清单 |
| Session protocol facade | ADR-0040；`src/shared/teaching-types/teaching-session-protocol.ts` + `src/main/ai/teaching-session-runtime.ts` | **已借鉴** in-process 协议面 |
| Runtime wire / orchestrator | ADR-0047；`agent-runtime-wire.ts`, `teaching-turn-orchestrator.ts` | 教学 turn 序列化与聚合 |
| ExtensionManifest | ADR-0042；`src/shared/teaching-types/extension-manifest.ts` | **类型面已借鉴**；loader/hooks/MCP 未开；含 `sensitive` userConfig |
| Skill library | `skill-library.ts` + `resources/builtin-skills/*` | builtin + personal `~/.studiumx/skills`；无 project/`.agents` 多根 |
| Provider catalog | `shared/model-provider-catalog.ts` | modalities + reasoning protocol/efforts；**尚无 path-based patch DSL** |
| Tool contract / write policy | ADR-0048、`docs/tools/TOOL_CONTRACT.md`、`write-policy.ts` | 教学写策略比解包可见层更显式 |
| Write rewind | ADR-0049 | 教学侧可撤销写入 |
| Footprint ladder | ADR-0046 | skill/host/tool/MCP 成本阶梯 |
| MCP 产品路径 | ADR-0039、README non-goals | **默认不实现**；仅信号触发 |

### 3.3 模型目录对照（高价值）

**ZCode** 出厂目录：`model-providers/models_catalog_china_llm_zcode_2026-06-03.json`

- `schemaVersion: zcode.model-providers.v1`
- 10 个 provider：`moonshot-kimi`, `minimax`, `deepseek`, `qwen-alibaba-model-studio-cn/intl`, `xiaomi-mimo`, `zai`, `bigmodel`, `zai-coding-plan`, `bigmodel-coding-plan`
- model：`kinds[]`（可同时 `anthropic` + `openai-compatible`）、`modalities`、`contextWindow`、`maxOutputTokens`
- **reasoning.levels** 用 **path patch**：
  - `set: [{ path: ["thinking"], value: { type: "enabled", budgetTokens: 1024 } }]`
  - openai-compatible：`path: ["extra_body","thinking","type"]`
  - 支持 `unset`（例：deepseek 关闭 reasoning 时 unset `reasoningEffort`）
  - 同一 level 可对多 kind 写不同 patch

**StudiumX** catalog（`MODEL_PROVIDER_CATALOG` TypeScript 常量）：

- provider：deepseek / glm / xiaomi / minimax / anthropic / custom
- reasoning 多为 `protocol + efforts` 枚举（`anthropic|deepseek|minimax_openai|openai`）
- request-builder **未见** path patch / `extra_body` / 通用 path set 执行器
- 能力 lookup 友好，但扩展新厂商“非标 thinking 字段”时往往要改代码适配器

**建议（P0/P1）**：为 catalog 增加可选 `requestPatches` / reasoning level path-set（`set`/`unset`）；让 provider adapter 按 path 写入 body。Catalog 可保留 TS 源并可选导出 JSON 随包更新。

### 3.4 Tool 横切包装：精确差距

| 横切能力 | ZCode `Gmn` | StudiumX 现状 | 动作 |
| --- | --- | --- | --- |
| Effect / risk 分类 | annotations → riskLevel + sideEffectScope | effect-policy + annotationsForEffectClass | 已有；保持 |
| 执行前授权 | permission 对象 + needsApproval | authorizeToolEffect + registry 交互授权 | 已有；可统一入口 |
| Timeout | 每工具 timeoutMs，wrapper 层默认 | dispatcher 识别 timeout error，但无统一 per-tool 默认 timeout 包装 | **P0** 补统一 timeout 包装 |
| Cancel / abort | cancellation.supported + abortSignal 传入 callTool | dispatcher 检查 callCtx.signal | 已有；可标准化 userVisibleMessage |
| Tracing | required + summary I/O | audit correlation 存在，但非 tool wrapper 强制 | **P1** wrapper 强制 summary span |
| Result budget | maxInline/maxModel + truncate strategy | 默认 32KiB enforceToolResultBudget | 已有；可区分 inline vs model budget |
| 大产物 offload | 图像超限 → artifactStore 或文本说明 | 截断文本标记 | **P1** 超大结果考虑 artifact 路径 |
| formatModelContent | 独立格式化钩子 | outcome → content 字符串为主 | P2 视多模态需要 |
| 单一入口 | register 时一律 Gmn | dispatcher + registry + execution 仍有分叉 | **P0** 收敛唯一成功路径 |

### 3.5 可借鉴清单（Agent）

#### P0（与现有 ADR 同向，收益高）

1. **把 tool 横切包装收敛成单一 wrapper**
   - 学 ZCode Gmn 形态：permission gate → timeout → abort → trace → result budget → call → format
   - 落点：`src/main/ai/tools/{dispatcher,execution,annotations,registry}.ts`
2. **模型目录 path-based reasoning / request patch**
   - 借鉴 catalog JSON 的 set/unset path
   - 保持 secret-free 与现有 provider-adapter 能力探测
3. **Diagnosing skill packs（Phase B 补齐）**
   - ADR-0043 已指向 docsRef diagnosing-provider 等 id，但技能包本体未落地
   - 结构对齐 diagnosing-mcp：位置表 + schema 边界 + 状态查看 + 症状树 + 有序工作流
   - StudiumX 优先：`diagnosing-provider`、`diagnosing-settings`、`diagnosing-workspace`、`diagnosing-agent-run`
   - **不要**先做通用 MCP 市场诊断
4. **配置严格校验与未知字段可见失败**
   - settings / skill-pack / extension manifest 一致策略
   - 当前 normalizeTeachingSettings 偏“容错归一”，不像 ZCode MCP “unknown key drop + 可诊断”
   - 建议：归一化同时产出 droppedKeys / doctor 可见警告

#### P1

5. **Skill 多根发现与优先级文档化**
   - 建议优先级：workspace override → personal `~/.studiumx/skills` → builtin
   - 可选兼容 `.agents/skills` 只读 fallback（跨工具），但默认创建仍写 `~/.studiumx/skills` 或 workspace `.studiumx/skills`
   - 与 ADR-0042 contributions 对齐，仍 **local-install first**
6. **插件 userConfig schema（敏感字段标注）**
   - 已有 ExtensionUserConfigField.sensitive；落地 loader 时必须继承：敏感字段不进 doctor/support-bundle
7. **MCP 状态 UX 的“形状”可预研，实现仍受 ADR-0039 门禁**
   - Settings 中 status 行（connected/failed/disabled + 错误内联）
   - 配置严格 schema、未知 key 丢弃
   - **禁止**默认 auto-connect 所有 scope
8. **大结果 artifact / preview 策略**（学 Vmn，不必抄 MCP 图像链路）

#### P2 / 默认不排期

9. 通用 MCP 客户端/市场、shell 工具、远程 agent 矩阵
10. 物理 Helper Isolation（P2-7）
11. 把 document-skills 那种重型 PDF/DOCX 流水线整包迁入（教学可另做 lesson 导出，不必抄插件体量）

### 3.6 明确不要抄（Agent）

- **MCP auto-connect + 工作区 MCP 默认信任**（diagnosing-mcp 明确：各 scope 自动连接；与 StudiumX fail-closed / 无 MCP 市场原则冲突）
- **`mcp__server__tool` 作为默认工具扩张路径**（违反 footprint ladder）
- **把 coding terminal / ssh2 / docker / WSL 作为教学核心路径**
- **为“像 ZCode”而引入第二 agent 产品面或无鉴权网络 RPC**
- **`execute-desktop-command` 类宽权限桌面命令面**

---

## 4. 产品 UX / 包装 / 运维对照

### 4.1 ZCode 产品与运维面（解包证据）

| 能力 | 证据 | 说明 |
| --- | --- | --- |
| **Startup ready 门闩** | `app/out/renderer/index.html`：`body.zcode-startup-ready #root { opacity:1 }` + `#loading` 全屏遮罩 + reduced-motion | 首屏在 ready 前不露出半初始化 UI，避免白闪/闪烁 |
| **Process Monitor** | 独立 `process-monitor.html` + 专用 preload + main 中相关 chunk | 诊断窗与主 UI 解耦，适合长会话/高占用排查 |
| **Usage / export logs** | renderer `usageStatsUiParts-*.js`、main `exportLogs` 符号 | 用量统计 UI + 日志导出，支持「我这台机器出了啥」 |
| **Build meta** | `app/out/metadata/build-meta.json`：`appVersion` / `buildCommitId` / `buildTime` / `electronBuilderVersion` | 支持包、issue、release 审计都能钉到精确构建 |
| **Updater** | `app-update.yml`：`provider: generic`，CDN `cdn-zcode.z.ai/.../mac/arm64/`；main 含 `electron-updater` | 正式通道更新；`useMultipleRangeRequest: false` 兼容部分 CDN |
| **URL scheme** | Info.plist：`CFBundleURLSchemes = zcode` | 深链打开设置/任务/工作区 |
| **E2E 故障注入** | main/host：`ZCODE_E2E_FS_FAULTS` | 文件系统故障可注入，提升恢复路径可测性 |
| **Settings 导航意图** | 解包后 minify 符号多为 `settings-section-nav` / `settings-usage-tab` 等 testid；**精确 `*-intent` localStorage 键名在本次扫描中未完整复现** | 可借鉴「打开设置时恢复上次分区/provider」的产品意图，不必绑定未证实的键名 |
| **AsarIntegrity** | Info.plist 含 `ElectronAsarIntegrity` | 发布完整性校验 |
| **ATS 宽松** | `NSAllowsArbitraryLoads: true` + `NSAllowsLocalNetworking: true` | **不要学**：为 MCP/本地服务器放宽 ATS 与教学产品威胁模型冲突 |

### 4.2 StudiumX 产品与运维面

| 能力 | 现状 | 相对 ZCode |
| --- | --- | --- |
| Startup ready | `src/renderer/index.html` 基本是空 root，无 ready 门闩 | 弱于 ZCode |
| 诊断 | TeachingDoctor（`src/main/teaching-doctor.ts`）+ Workspace Inspector + tech-inspector + CLI `scripts/doctor.mjs` | **结构化诊断更强**，但缺少独立 process metrics 窗 |
| Support bundle | ADR-0034：preview → consent → export；默认 redact prompts/secrets/home paths/learner answers | **隐私与同意模型明显优于**「直接 export logs」 |
| Release audit | `scripts/release-audit.mjs` + ADR-0017 clean-checkout / Golden | 有发布证明文化；**缺 build-meta 进产物** |
| Updater | `package.json` **无** `electron-updater` 依赖 | 未做自动更新通道 |
| URL scheme | 源码未见 `setAsDefaultProtocolClient` / `studiumx://` | 未做深链 |
| Check scripts 矩阵 | `scripts/check-*.mjs` 大量契约门禁 | **可支持性与回归文化优于**典型闭源解包产品 |
| Process metrics | 无独立 process-monitor | 可做主窗只读面板，不必先拆窗 |

### 4.3 可借鉴（产品/运维）

#### P0

1. **构建产物写入 `build-meta.json`（或等价）**
   - 字段对齐：`appVersion`、`buildCommitId`、`buildTime`、`electronBuilderVersion`（可选：node/electron 版本、channel）
   - 消费方：TeachingDoctor environment facts、support-bundle `environment` section、`release-audit`、关于页
   - 落点：`scripts/package-host-native.mjs` / electron-builder `extraResources` + 小模块 `src/main/build-meta.ts`

#### P1

2. **Startup ready 遮罩**
   - `body.studiumx-startup-ready`（或等价 class）+ reduced-motion
   - 在 preload/renderer 首个「services ready / IPC hello」后再揭开
   - 避免半初始化 settings/workspace 闪烁

3. **Settings 打开意图恢复**
   - 记住 last section / last model provider（session 或 user settings，非 secret）
   - 从 Doctor fixSuggestion / deep link 可跳到具体分区
   - 与 ADR-0043 `configPath` 联动：诊断 → 一键打开对应设置区

4. **主窗内只读 Process / Runtime 面板**
   - 学 process-monitor 的**信息架构**（CPU/内存/agent run 数/IPC 错误率），不必先独立 BrowserWindow
   - 数据源优先复用现有 audit correlation、run state、doctor facts

5. **E2E / check 故障注入钩子（受控）**
   - 学 `ZCODE_E2E_FS_FAULTS` 思路：仅 test/CI 环境可注入 FS / provider 超时
   - 落点：`scripts/fixtures/*` + 已有 check 矩阵，**永不**进生产默认路径

#### P2

6. **electron-updater 通道**（产品需要正式分发时再做；需签名、CDN、channel 策略）
7. **`studiumx://` URL scheme**（设置深链、workspace 打开）；需威胁模型（只打开已允许动作）
8. **独立 process-monitor 窗 + 专用 preload**（仅当主窗面板不够用）

### 4.4 明确不要抄（产品/运维）

- 为「看起来专业」引入 **自动遥测 / 无同意上传日志**
- **ATS 全局 `NSAllowsArbitraryLoads`**
- 把 Usage 图表做成默认联网计费面板而弱化教学主路径
- 用 export raw logs 替代已脱敏的 support-bundle 流程

---

## 5. 安全 / 配置 / 信任边界对照

### 5.1 对照表

| 维度 | ZCode | StudiumX | 建议 |
| --- | --- | --- | --- |
| 网络 ATS | 全局允许任意加载 | 默认更收敛；provider URL 有 policy（`provider-url-policy`） | **保持 StudiumX 更严** |
| MCP 连接 | diagnosing-mcp：**各 scope 自动连接**；工作区 MCP 默认信任倾向 | ADR-0039：MCP **默认不排期**；无市场 | **不抄 auto-connect** |
| 工具授权 | MCP 默认 `needsApproval`；permission pattern | `authorizeToolEffect` + effect-policy + scoped permissions | 已有；P0 收敛 wrapper 入口 |
| 配置校验 | MCP server **未知 key 丢弃整条** + 可诊断 | `normalizeTeachingSettings` **容错归一**（`src/shared/teaching-settings-schema.ts`） | **P0**：归一化产出 `droppedKeys` / doctor 警告 |
| Secret 存储 | 插件 userConfig 敏感字段 | `TeachingSettingsService` + `safeStorage:v1:` + `check-settings-secret-storage` | 已有优势；extension loader 必须继承 `sensitive` |
| 导出 | export logs 类能力 | support-bundle：preview + consent + redaction policy | **保持 consent-gated** |
| 路径沙箱 | 工作区/插件路径模板 | `path-access` / skill pack realpath 约束 / workspace write policy | 已有；继续 fail-closed |
| 发布完整性 | AsarIntegrity | release-audit + security-checks | 可补 build-meta；AsarIntegrity 视打包器支持启用 |
| 远程/终端 | SSH / 终端 / docker / WSL 等 coding 面 | 明确非目标 | **永不默认开启** |

### 5.2 配置严格性：精确差距

**ZCode（MCP 配置范式，来自 diagnosing skills + runtime 行为描述）**

- 严格 schema
- 未知字段 → drop server / 配置项失败可见
- 多层合并顺序可诊断（user / workspace / plugin / env）

**StudiumX**

- `normalizeTeachingSettings` 偏容错：坏字段尽量修好继续跑
- Doctor 已有 config availability / configPath / fixSuggestion（ADR-0043）
- **缺口**：用户不知道「哪些字段被静默丢掉或改写」

**建议落地（P0）**

1. normalize 返回 `{ value, diagnostics: [{ path, reason, action: drop\|clamp\|default }] }`
2. TeachingDoctor / support-bundle config_fingerprint 展示 dropped/clamped 计数（无 secret）
3. skill-pack / extension manifest 校验与 settings **同一套「未知字段策略」文档**

### 5.3 可借鉴 vs 不抄（安全）

**可借鉴**

- 配置失败可诊断（位置表 + 症状树）——对齐 diagnosing skills，但内容换成 provider/settings/workspace/agent-run
- 敏感 userConfig 字段标注并排除出 support 导出
- E2E 故障注入仅限测试

**不要抄**

- MCP auto-connect / 工作区默认信任
- 宽权限桌面命令、任意 shell、远程控制
- 为插件生态放宽 ATS 与路径沙箱
- 无用户同意的日志/遥测外传

---

## 6. StudiumX 已有优势（不要回退）

这些是对照后 **StudiumX 明确更好或更贴合产品** 的点；借鉴 ZCode 时禁止以「对齐 ZCode」为名削弱：

1. **文件系统真相源 + Learning Session Ledger 权威分离**（ADR-0008 系）——不是会话 store 驱动的 coding IDE
2. **Teaching footprint ladder**（ADR-0046）——工具/能力扩张有梯子，不是 MCP 默认扩张
3. **Tool contract + write policy + write-rewind journal**（ADR-0048/0049）
4. **Agent run 与 session 状态机分离**（ADR-0021 系）+ turn orchestrator（ADR-0047）
5. **Redacted support bundle**（ADR-0034）与 audit correlation 安全元数据（ADR-0028）
6. **Read-only TeachingDoctor / Inspector**（ADR-0027/0043）：诊断与修复效应分离，autoRepair 恒禁用
7. **ApplicationRuntime 固定 boot 序**（prepare → create → recover → register → open → applyBehavior → drain）
8. **海量 check scripts / release-audit / security-checks**——契约回归文化
9. **Settings secret storage（safeStorage）** 与 presentation redaction
10. **C-2C packing / containment 取向**——比宽松桌面 agent 更适合教学机本地部署
11. **无默认 shell / 无 MCP 市场 / 无自动遥测**（README/SECURITY/ADR-0039）

---

## 7. 已实施的 ZCode 相关 ADR 与路径（复核）

| ADR | 状态 | 主题 | 正确证据路径 |
| --- | --- | --- | --- |
| **0040** | 已实施 | Teaching Session Protocol facade | `src/shared/teaching-types/teaching-session-protocol.ts`、`src/main/ai/teaching-session-runtime.ts` |
| **0041** | 已实施 | Tool annotations + result budget | `src/main/ai/tools/annotations.ts`、`dispatcher.ts`、effect-policy 相关 |
| **0042** | 已实施（类型/最小清单） | ExtensionManifest 最小形态 | `src/shared/teaching-types/extension-manifest.ts`（**不是** `src/shared/extension-manifest.ts`） |
| **0043** | 已实施 Phase A | Doctor configPath + fixSuggestion | `src/shared/teaching-types/teaching-doctor.ts`、`src/main/teaching-doctor.ts`；**diagnosing skill 包本体属 Phase B，未落地** |
| **0046** | 已实施 | Teaching footprint ladder | `docs/adr/0046-teaching-footprint-ladder.md` |
| **0047** | 已实施 | Agent runtime wire + turn orchestrator | 见 ADR-0047 正文证据入口 |
| **0048** | 已实施 | Tool contract + write policy | 见 ADR-0048；`scripts/check-tool-contract.mjs` |
| **0049** | 已实施 | Write rewind journal | 见 ADR-0049 |
| **0039** | 已采纳边界 | 结项 + 信号触发 P2-6 MCP / P2-7 Helper Isolation | **默认不排期**；不得因 ZCode 对照重开 |

**旧文档错误（已在本次重写中修正）**

| 旧路径（错误） | 正确路径 |
| --- | --- |
| `src/main/teaching-session-runtime.ts` | `src/main/ai/teaching-session-runtime.ts` |
| `src/shared/extension-manifest.ts` | `src/shared/teaching-types/extension-manifest.ts` |

---

## 8. 优先路线图（对照后的行动序）

### P0 — 高收益、与现有 ADR 同向、不扩产品边界

| # | 项 | 学自 ZCode | StudiumX 落点 | 验收暗示 |
| --- | --- | --- | --- | --- |
| P0-1 | **build-meta 进产物** | `metadata/build-meta.json` | 打包脚本 + doctor/support-bundle environment | 关于页/support 可见 commit+time |
| P0-2 | **Tool 横切单一 wrapper** | `Gmn`：permission→timeout→abort→trace→budget→call→format | `src/main/ai/tools/{dispatcher,execution,annotations,registry}.ts` | 所有工具共享 timeout 默认与唯一成功路径；check-tool-execution 绿 |
| P0-3 | **Catalog path-based request patch** | model-providers JSON `set`/`unset` path | `src/shared/model-provider-catalog.ts` + provider-adapter/request builder | 新厂商 thinking 字段无需新适配器分支（至少 deepseek/glm/minimax 覆盖） |
| P0-4 | **Diagnosing skill packs（Phase B）** | zcode-guide diagnosing-* | builtin skills：`diagnosing-provider` / `diagnosing-settings` / `diagnosing-workspace` / `diagnosing-agent-run` | Doctor fixSuggestion.docsRef 可解析到包；**不做 diagnosing-mcp 优先** |
| P0-5 | **配置 unknown 可见失败** | MCP 严格 schema + drop 可诊断 | `teaching-settings-schema` normalize diagnostics + doctor | droppedKeys 可在 doctor 看到且无 secret |

### P1 — 体验与可支持性

| # | 项 | 说明 |
| --- | --- | --- |
| P1-1 | Startup ready 遮罩 | 防白闪 |
| P1-2 | Settings section / provider 恢复与深链意图 | 配合 Doctor 跳转 |
| P1-3 | Skill 多根优先级文档化 + 可选 workspace override | 默认仍 `~/.studiumx/skills` + builtin；可选 `.agents/skills` 只读 fallback |
| P1-4 | 主窗 Runtime/Process 只读面板 | 不先拆独立窗 |
| P1-5 | Wrapper 强制 summary tracing | audit correlation 与 tool span 对齐 |
| P1-6 | 大结果 artifact/offload 策略 | 学 `Vmn` 思路，服务 lesson/export 大产物，不抄 MCP 图像链路 |
| P1-7 | Extension userConfig sensitive 贯穿 loader | 未全开 loader 前写进类型不变量即可 |
| P1-8 | CI 故障注入钩子 | 仅 test env |

### P2 — 信号触发 / 默认不排期

| # | 项 | 门禁 |
| --- | --- | --- |
| P2-1 | electron-updater | 正式分发 + 签名 + channel 策略 |
| P2-2 | `studiumx://` URL scheme | 威胁模型：仅白名单动作 |
| P2-3 | 独立 process-monitor 窗 | 主窗面板不够用时 |
| P2-4 | 逻辑 monorepo 分包（main-shell / host-services / agent-runtime） | 非必须物理多进程 |
| P2-5 | MCP 客户端（P2-6） | ADR-0039：真实教学 Adapter + 威胁模型 + 新 ADR |
| P2-6 | Helper Isolation（P2-7） | 仅当执行不可信代码 |
| P2-7 | document-skills 级重型办公流水线 | 教学导出可另做；不整包迁入 |

---

## 9. 一页纸速查

| 主题 | 学 | 不学 | StudiumX 现状锚点 |
| --- | --- | --- | --- |
| 进程 | 逻辑分层、诊断信息架构 | 立刻物理多进程/远程 host | `ApplicationRuntime` |
| Agent | Gmn 式横切 wrapper | MCP 默认工具面、shell | dispatcher + ADR-0041/48 |
| Catalog | path set/unset patch、多 kinds | 闭源 JSON 唯一真相 | `model-provider-catalog.ts` |
| Skills | diagnosing 范式、多根优先级 | 插件市场、hooks 任意执行 | skill-library + ADR-0042/43 |
| 配置 | 未知字段可诊断 | 静默吞错或过度严格致不可启动 | teaching-settings-schema + doctor |
| 运维 | build-meta、startup ready、受控故障注入 | 无同意遥测、raw log 外传 | support-bundle + release-audit |
| 安全 | 敏感字段标注、完整性元数据 | ATS 全开、MCP auto-connect | path-access + ADR-0039 |
| 产品 | 设置意图恢复、可支持性 | coding IDE 第二产品面 | Mission/Lesson/Record 主线 |

---

## 10. 关键路径索引

### 10.1 ZCode（`ref_project/Zcode`）

| 路径 | 用途 |
| --- | --- |
| `README.md` | 解包说明、关键 runtime/MCP 指针 |
| `Contents/Info.plist` | 版本、`zcode://`、ATS、AsarIntegrity |
| `Contents/Resources/app-update.yml` | generic updater + CDN |
| `Contents/Resources/app/out/metadata/build-meta.json` | 构建元数据 |
| `Contents/Resources/app/out/main/` | 桌面壳、updater、exportLogs、E2E faults |
| `Contents/Resources/app/out/host/` | host service、MCP 状态协议 |
| `Contents/Resources/app/out/preload/` | 主窗 + process-monitor preload |
| `Contents/Resources/app/out/renderer/index.html` | startup-ready 遮罩 |
| `Contents/Resources/app/out/renderer/process-monitor.html` | 独立诊断窗 |
| `Contents/Resources/glm/zcode.cjs` | agent runtime（Gmn/Wke/Vmn 等） |
| `Contents/Resources/glm/packages/*-plugin/` | 内置插件与 diagnosing skills |
| `Contents/Resources/model-providers/*.json` | `schemaVersion: zcode.model-providers.v1` catalog |
| `Contents/Resources/tools/ripgrep/` | 捆绑工具 |

### 10.2 StudiumX

| 路径 | 用途 |
| --- | --- |
| `src/main/application-runtime.ts` | 固定 boot/shutdown 序 |
| `src/main/ai/teaching-session-runtime.ts` | Session protocol 运行时 |
| `src/main/ai/tools/dispatcher.ts` | 工具调度（auth→parse→handler→budget） |
| `src/shared/model-provider-catalog.ts` | 模型目录（protocol+efforts，无 path patch） |
| `src/shared/teaching-settings-schema.ts` | settings 归一化 |
| `src/main/teaching-settings.ts` | 持久化 + safeStorage |
| `src/main/teaching-doctor.ts` | 只读诊断 |
| `src/main/support-bundle.ts` | 脱敏支持包 |
| `src/main/skill-library.ts` | builtin + `~/.studiumx/skills` |
| `src/shared/teaching-types/extension-manifest.ts` | 最小扩展清单类型 |
| `src/shared/teaching-types/teaching-doctor.ts` | Doctor 类型 + fixSuggestion |
| `docs/adr/0039`–`0049`（相关） | 边界与已实施借鉴 |
| `scripts/check-*.mjs` / `release-audit.mjs` / `doctor.mjs` | 契约与可支持性 |
| `scripts/package-host-native.mjs` | 打包入口（build-meta 落点候选） |

---

## 11. 审查方法与文档修正记录

### 11.1 审查方法

- **对照对象**：`ref_project/Zcode` macOS 解包应用（**非**源码 monorepo）；版本 3.3.3 / commit `205ad158` / Electron Builder 26.8.1
- **对照主体**：StudiumX 源码 + ADR + scripts + package 配置
- **并行审查线**（替代独立子 agent 工具）：
  1. 架构 / 进程 / IPC / ApplicationRuntime
  2. Agent / Tools / MCP / Skills / Catalog
  3. 产品 UX / updater / build-meta / process-monitor / startup
  4. 安全 / 配置 / ATS / support-bundle / ADR-0039 边界
- **证据类型**：解包文件存在性与内容抽样、Info.plist、build-meta、app-update.yml、renderer HTML、minified 符号抽样、StudiumX 源码与 ADR 交叉验证
- **限制**：ZCode 主体为 minify 产物，符号名（Gmn/Wke 等）以 README + 字符串证据为准；**未宣称**恢复完整 TypeScript 源结构。Settings `*-intent` 精确 localStorage 键名在本次全量字符串扫描中**未完整复现**，文档改为记录「产品意图可借鉴、键名不武断」。

### 11.2 相对既有 `Zcode.md` 的修正

| 问题 | 处理 |
| --- | --- |
| 错误路径 `src/main/teaching-session-runtime.ts` | 改为 `src/main/ai/teaching-session-runtime.ts` |
| 错误路径 `src/shared/extension-manifest.ts` | 改为 `src/shared/teaching-types/extension-manifest.ts` |
| 可能把 ZCode settings intent 键名写死 | 降级为「意图可借鉴；键名未在解包中稳定复现」 |
| 可能低估 StudiumX support-bundle / doctor / check 矩阵优势 | §6 显式列为不可回退优势 |
| 可能把 MCP/终端当可选项 | §3.6 / §4.4 / §5.3 / §8 P2 明确 **不抄 / 信号触发** |
| Agent 横切写成笼统「五件套」 | §3.4 对齐 Gmn 全字段（含 resultBudget 双阈值、formatModelContent、artifact offload） |
| 缺 build-meta / updater / ATS / E2E faults 专节 | §4 / §5 补齐 |
| 缺已实施 ADR 正确索引与 Phase B 缺口 | §7 |
| 缺可执行 P0/P1/P2 | §8 |

### 11.3 仍可能随 ZCode 版本漂移的项

- minify 符号名（Gmn/Wke/Vmn…）
- IPC 通道数量与命名（打包策略变化会导致字符串抽取不稳定）
- 内置插件列表与 catalog provider 集合
- updater CDN URL

再次对照时以 **build-meta.commit + appVersion** 为锚，不要假设符号名长期稳定。

---

## 12. 一句话决策

**学 ZCode 的分层、工具横切、可诊断配置、数据驱动 catalog 与发布可支持性；不学它的 MCP 市场/auto-connect、终端远程矩阵与宽松信任边界——在 ADR-0039～0049 已铺的教学底座上，用 P0 五项把可靠性与可支持性再收紧一档，而不是把 StudiumX 做成第二个 coding agent。**

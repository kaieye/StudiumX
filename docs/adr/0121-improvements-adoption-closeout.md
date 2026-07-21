# ADR-0121：四源改进借鉴 ADOPTION 结项与信号触发 residual

- **状态：** 已采纳（2026-07-21）
- **范围：** 结项原 `docs/improvements/`（`ADOPTION.md` + `pi.md` / `codex.md` / `grok.md` / `hermes.md`）中仍具长期效力的 backlog 裁定、命名冻结、明确不采纳与信号触发 residual；**不**新增运行时实现切片，**不**重开已以 ADR-0051–0120 记录的已实施范围。
- **相关：** [ADR-0039](0039-teaching-adoption-closeout-and-signal-triggered-p2.md)（Codex Rust 教学化结项先例）、[ADR-0051](0051-provider-finish-reason-and-length-tool-rejection.md)–[ADR-0067](0067-cancel-tool-pair-close-and-busy-ack.md)（Phase 0–1）、[ADR-0070](0070-agent-runtime-wire-shared-protocol.md)–[ADR-0120](0120-teaching-ipc-commands-agent-conversation-peel.md)（Phase 2 与 residual peels）、[AGENTS.md](../../AGENTS.md)、[`docs/testing.md`](../testing.md)、[`SECURITY.md`](../../SECURITY.md)、[`docs/tools/TOOL_CONTRACT.md`](../tools/TOOL_CONTRACT.md)

## 背景

2026-07-21 对 `ref_project` 四份上游（pi / codex / grok / hermes）做对照审查，收敛为 [ADR-0121](0121-improvements-adoption-closeout.md) 唯一 backlog（A-01–A-10、B-01–B-12、S-01–S-12）。各切片已实施并分别沉淀为 ADR-0051–0116、0118–0120（0117 为 study-planning 旁路，非本 backlog）。源审查与 ADOPTION 表已完成其「收敛 + 分派」使命；继续保留会形成第二套伪 backlog 与断裂链接。

点验（closeout 当日）：Phase 0–2 **可实现**项均有对应 ADR 与代码/门禁证据；仅余 **显式 defer** 与 **纪律 residual**（见第 3 节），不得当作开放 P0/P1 重新分派。

## 决定

### 1. `docs/improvements/` 结项删除

- 删除 [ADR-0121](0121-improvements-adoption-closeout.md)、`pi.md`、`codex.md`、`grok.md`、`hermes.md` 及该目录下其余文件。
- 长期权威为 **本目录 ADR** 与 **代码 / check 脚本**；历史对照审查不再作为实施 backlog。
- 外链原指向 [ADR-0121](0121-improvements-adoption-closeout.md) 或源审查文件的文档，改指本 ADR 或具体实施 ADR。

### 2. 已关闭借鉴范围不得重开为 backlog

下列 ID 已实施；后续只允许窄接入、design gate 修订或**新建 ADR**，不得借 residual 文案重开为「未完成 P0/P1」：

| 批次 | ID | 权威 ADR（代表） |
| --- | --- | --- |
| Phase 0 安全/门禁 | A-01–A-10 | ADR-0051–0055、0057、0053、0054 |
| Phase 1 运行时 | B-01–B-12 | ADR-0055–0067 及 B-02/B-08/B-11 后续接线 ADR（0082–0118 等） |
| Phase 2 结构/抛光（可实现切片） | S-01–S-06、S-09–S-12 | ADR-0070–0081、0086、0092、0072–0077 等；S-03 peel residual 见 ADR-0075 + 0090/0100/0103/0106/0119/0120 |

已合入实现以 Git 与各 ADR「已实施范围与验证入口」为准。

### 3. 信号触发 / 纪律 residual（默认不排期、不可当开放实现分派）

| ID / 主题 | 状态 | 触发前提 |
| --- | --- | --- |
| **S-07** Headless Teaching Agent Protocol（stdio JSON-RPC） | 显式 defer | 独立产品/CI 信号 + 新 ADR；默认关闭产品暴露 |
| **S-08** 会话搜索/命名/导出 UX 增量 | 显式 defer | 产品 UX 信号 + 新 ADR；勿重复造 resume picker（ADR-0030） |
| **S-09** 真实 skill/memory consent 产品动作 | 显式 defer | 既有 consent 门控路径；handoff/last-bundle 栈已备（ADR-0109–0116）；**禁止 auto-apply** |
| **B-08** Granular tool-policy Settings UI | 显式 defer | 产品信号；multi-path 主+次已结（ADR-0115/0118） |
| **S-11** MDM / remote policy fetch / managed-upload UI | non-goal residual | 产品信号 + 新 ADR；FS loader 已备（ADR-0092） |
| **B-11** doctor auto-repair | **仍禁止** | 不得借 collector/UI 扩张为自动修复 |
| **S-03** 巨石 peel（workspace / ledger / coordinator 等） | 纪律 residual | **仅 by-touch**；政策 ADR-0075；**禁止**三线并行大搬家 |
| **B-02** product `autoDrain: true` | **禁止**直至新 ADR | 产品路径保持 `autoDrain: false`（ADR-0096）；无队列同步设计不得翻 true |

### 4. 落点命名冻结（禁止再分叉）

| 能力 | **唯一**模块名 | 废弃并行命名（勿新建） |
| --- | --- | --- |
| 运行时输入队列 | `agent-input-queue.ts` | `agent-loop-queue.ts`、`agent-prompt-queue.ts`、`agent-interjection.ts` |
| Busy 策略 | `agent-busy-input-policy.ts` | 散落在 runner 的魔法 if |
| 会话门面 | `agent-session-facade.ts` | 第二套对外 `CoreFacade` / 重复产品 `AgentBuilder` API |
| Recovery 分类 | `provider-recovery.ts` | 与 UX 混在一个膨胀函数里的第二套 ad-hoc 正则 |
| 有界重试 | `provider-retry.ts` | loop 内联 429 sleep |
| Tool result 预算 | `tools/tool-result-budget.ts` | 与 journal 字节上限混用 |
| Stream 适配 | `agent-stream-events.ts` | 推倒重写 timeline / EventBus |

### 5. 裁定规则（跨上游冲突时仍有效）

1. 与教学安全 / 既有 ADR / `SECURITY.md` / `TOOL_CONTRACT.md` 冲突 → **以 StudiumX 边界为准**。
2. 同能力多源建议 → **一个 port / 一个模块名 / 一条验收**。
3. P0 vs P1 → **正确性与安全 > 吞吐 > 工程抛光**。
4. 结构大搬家 → **同一阶段只开一条主结构线**；其余随触达 peel。
5. busy 默认 **`queue` 优于 `interrupt`**；`steer` 可选且仅安全 turn 边界；**steer ≠ abort**。
6. Provider：**双轴一处**——UX kind 与 recovery flags 解耦；共享 run 级 retry budget。
7. 重试禁区：billing / 余额 / 永久 auth / context overflow / max-tokens 截断 **永不自动重试**；**禁止** credential 多 key 旋转。
8. 扩展面：TeachingCommand 闭集 + skill-pack verifier；**禁止** jiti 全权限扩展 / 默认任意 MCP。

### 6. 明确不采纳（假升级清单）

任一份上游或外部建议若引入下列项，**仍以本节与 [AGENTS.md](../../AGENTS.md) 红线为准**，除非新 ADR 推翻：

1. 默认 ShellTool / OS sandbox 产品声明 / shell-escalation / argv `prefix_rule` 策略语言  
2. YOLO / always-approve / DangerFullAccess 默认或 UI 标签  
3. MCP marketplace / plugin marketplace / 默认任意 MCP 加载  
4. code-mode / V8 执行不可信代码 / jiti 全权限扩展  
5. 启动自动 memories Phase / dream / FTS5 产品搜索 / 向量记忆系统注入 system  
6. 默认远程 OTEL / Statsig / Mixpanel 式 phone-home  
7. 用 soft token reminder 替代多轴硬预算  
8. 用覆盖率或泛型 CI 替换 teaching/privacy/security 领域门禁  
9. 推倒 EventBus/timeline、重写 AgentRun 状态机、拆 settlement sole-writer  
10. 教学 canonical 数据 zstd 物理压缩（见 ADR-0002）  
11. Fork 默认复制可执行工具历史（破坏 `toolsReplayed:false`）  
12. Credential 多 key 池旋转 / 自动跳未配置聚合器  
13. 物理 monorepo 拆包或独立 app-server 作为前置条件  
14. 默认 durable rewrite 会话正文作 compact  
15. 学生机 fail-open 外部 shell hooks  

### 7. 借鉴时必须保留（只允许加强，不允许「对齐上游」削弱）

文件 SoT + 可重建投影；教学证据链与 settlement sole-writer；Agent run ⟂ LearningSession；effect lattice + 无 YOLO；`expectedRevision` + `toolsReplayed:false`；多轴硬预算 + durable fallback；同意 memory + secret-free config；write rewind journal；Blocking 领域门禁；support-bundle 同意模型；prompt 稳定前缀；Footprint Ladder。

## 明确不包含

- 不批准现在实现第 3 节 defer / non-goal 项  
- 不把历史源审查中的过时「仍缺」表述解释为当前缺口  
- 不授权无新 ADR 时把 product `autoDrain` 翻 true，或对 turn-review **auto-apply**  
- 不要求为结项重跑全量 e2e / 真实模型；证据为既有 ADR + 代码路径点验  

## 后果

1. `docs/improvements/` 清空；实施与边界以 ADR-0051–0120 与本 ADR 为准。  
2. [AGENTS.md](../../AGENTS.md) / [`docs/testing.md`](../testing.md) 不再指向 ADOPTION 为 backlog 源，改指本 ADR 与 `docs/adr/`。  
3. 原指向 `../improvements/ADOPTION.md` 的 ADR「相关」链接改指本 ADR（历史 ID 标签可保留为纯文本）。  
4. 未来新的上游借鉴必须 **先** 新建 ADR（或更新本 ADR 的 defer 表），**不得**重建 `docs/improvements/` 第二套 backlog。  

## 验证入口（结项）

- 目录：`docs/improvements/` 无实施 backlog 文件（或目录不存在 / 为空）。  
- 代表点验（非穷尽）：`finishReason === 'length'` 拒 tool（`agent-loop`）；`invokeProviderWithRetry`；`SECURITY_CHECKS` 含 external-content；product `autoDrain: false`（`teaching-ipc-gateway`）；ADR-0051–0120 文件存在。  

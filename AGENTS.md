# AGENTS.md — StudiumX 代理 / 贡献者速查

短于通用 coding-agent 的 mega-AGENTS。**不替代** ADR；冲突时以 `docs/adr/`、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md` 与产品地板为准。

更完整的贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。四源借鉴 backlog 已结项，见 [ADR-0121](docs/adr/0121-improvements-adoption-closeout.md) 与 `docs/adr/`。

---

## 1. 产品地板（不可被「借鉴」降级）

| 边界 | 含义 |
| --- | --- |
| 文件是教学真相源 | 投影可重建；canonical 在工作区文件，不把 SQLite / agent run 当 teaching authority |
| 无默认 shell | `tools.enabled` 默认关；开启后 **workspaceShell 默认开**（主流 Agent，ADR-0153）。`sandboxMode` × `approvalMode` 双轴 + 路径围栏；**禁止** YOLO 标签与虚假 Docker/VM 完备宣称。**合格交付**见 [`docs/agent-shell-sandbox-delivery-roadmap.md`](docs/agent-shell-sandbox-delivery-roadmap.md)（**Completed 2026-07-25** — qualified without Windows OS helper；ADR-0152/0153 为决策/provisional） |
| MCP 全面对齐 | [ADR-0132](docs/adr/0132-mcp-zcode-parity-and-trust-lifecycle.md) + 体验边界 [ADR-0141](docs/adr/0141-mcp-product-experience-parity-policy.md) + **产品面 [ADR-0142](docs/adr/0142-mcp-product-surface-settings-only.md)**：A–H foundation 可保留；**Settings 产品面 = list/editor/import/OAuth**（**无** marketplace 设置页）。硬安全不变：secret/token 永不进 public DTO/Doctor；MCP 非 teaching evidence；settlement sole-writer；MCP tool 仍进 effect lattice / approval / ToolOutcome；禁止 YOLO 标签。 |
| 无自动 remote telemetry | 本地优先；**不**默认 phone-home / Statsig / Mixpanel 式外发 |
| effect lattice + TOOL_CONTRACT | `read` / `workspace_write` / `external_write` / `privileged` 三态审批；**禁止 YOLO / always-approve 标签** |
| Settlement sole-writer | `TeachingTurnCoordinator` / host 为 outcome settlement 唯一写入路径；IPC 须 `expectedRevision`；fork 路径保持 `toolsReplayed: false` |
| 多轴硬预算 | run budget + durable-success / budget fallback；禁止用 soft reminder 替代硬预算 |
| 同意门控 memory | 无人批不自动注入 / 不启动自动 memory phase；**禁止 FTS5 / 向量库作产品搜索** |
| Blocking 领域门禁优先 | teaching / privacy / security 领域门禁 **优先于** 泛型 lint 与覆盖率时尚 |

`pnpm run check:analytics` 是 **本地 study analytics 测试地基检查**，**不是** 远程 telemetry / phone-home。

---

## 2. 命令图（本地常用）

```bash
corepack enable && pnpm install
pnpm dev
pnpm typecheck
pnpm run check:security          # SECURITY_CHECKS 全套（含 external-content boundary）
pnpm run check:prepush           # typecheck + check:security（可选 pre-push）
pnpm run check:tool-contract     # TOOL_CONTRACT / 注册表漂移
pnpm run check:teaching-evidence # P0 教学证据链门禁
pnpm run check:teaching-impact   # 有 PR body 时的路径敏感元数据
pnpm run check:provider-privacy
pnpm doctor -- --json
pnpm test:unit
# 发布审计（重）：pnpm run audit:release
```

可选 hook：

```bash
git config core.hooksPath .githooks
```

---

## 3. 红线（Do not）

1. **不要** 在 `tools.enabled` 关闭时静默执行 shell；不要用 YOLO / DangerFullAccess / always-approve 标签；不要宣称 Docker/VM 级 OS sandbox 完备（ADR-0152/0153）。
2. **不要** 加 YOLO / DangerFullAccess / always-approve 默认或 UI 标签（`full_access` 仅称「本课放行 / 宽松策略」）。
3. **MCP 产品面**以 [ADR-0142](docs/adr/0142-mcp-product-surface-settings-only.md) 为准：Settings **仅** list/editor/import/OAuth；**不要**再挂 marketplace 设置页或半成品市场入口。host/foundation（ADR-0140 store/IPC）可保留。所有 MCP tools 仍必须入 effect lattice 与 approval；禁止 YOLO 标签、jiti 全权限扩展、code-mode 执行不可信代码或 shell-escalation 旁路；secret 永不进 public DTO / Doctor / support bundle。
4. **不要** 默认远程 OTEL / phone-home；本地 doctor / support-bundle 须脱敏与同意。
5. **不要** 用 SQLite FTS 或向量库做产品搜索面。
6. **不要** 启动自动 memories / dream / 静默改 learner-profile 或自动 skill 创建。
7. **不要** 绕过 settlement sole-writer、放宽 `expectedRevision`、或让 fork 默认可执行工具历史（破坏 `toolsReplayed:false`）。
8. **不要** 用覆盖率或泛型 CI **替换** teaching / privacy / security 领域门禁；只能叠加。
9. **不要** 推倒 EventBus/timeline、重写 AgentRun 状态机，或拆 LearningSessionLedger 权威。
10. **不要** 在 PR 默认 CI 烧真实模型 API key。

---

## 4. 改哪测哪（摘要）

| 你改了… | 至少跑… |
| --- | --- |
| 任意 TS 生产路径 | `pnpm typecheck` |
| 路径 / 工具权限 / provider 隐私 / 密钥存储 / external content | `pnpm run check:security`（或对应单项） |
| 工具注册表 / effect / write-policy | `pnpm run check:tool-contract` + 相关 `check:tool-*` / unit |
| LearningSession / Evidence / outcome / committer | `pnpm run check:teaching-evidence` + 触及的 unit |
| Agent loop / budget / context / cancel | 对应 `check:agent-*` / `check:agent-loop-*` / unit |
| IPC / gateway / coordinator host | `check:teaching-ipc-contract`、`check:blocking-ci`、相关 unit |
| Prompt 前缀 / cache 形状 | `check:teaching-impact`（PR 元数据）+ ADR-0044 相关检查 |
| 仅文档 / ADR | 交叉链接自检；无强制 suite |

分层含义与 L0–L4 教条见 [`docs/testing.md`](docs/testing.md)。Blocking CI 保持窄而硬（ADR-0023）；全量 e2e / release-audit 不塞进每个 PR。

---

## 5. 模块尺寸政策（摘要）

- **目标：** 新/触达 TS 模块尽量 **&lt; 500–800** 行（不含测试）；超过 ~800 优先开新模块，而不是继续塞「最大文件垃圾桶」。
- **TS 放宽：** 历史或不可避免的复杂模块可到 **&lt; 1000**，但须在 PR / ADR 说明边界。
- **历史巨石：** `teaching-workspace`、`learning-session-ledger`、`teaching-turn-coordinator` 等 **先 warning、按触达 peel**；禁止为了「对齐上游」同时三线大搬家（见 [ADR-0075](docs/adr/0075-module-size-policy-and-giant-peel.md) / [ADR-0121](docs/adr/0121-improvements-adoption-closeout.md) S-03 residual）。
- peel 时 **保留** sole-writer 入口与 ledger 权威，不借机拆 settlement。

正式政策见 [ADR-0075](docs/adr/0075-module-size-policy-and-giant-peel.md)；可选 `pnpm run check:module-size`（默认 warning-only，不进 Blocking CI）。Phase 2 结构纪律结项见 [ADR-0121](docs/adr/0121-improvements-adoption-closeout.md)。

---

## 6. 权威文档链接

| 文档 | 用途 |
| --- | --- |
| [`docs/adr/README.md`](docs/adr/README.md) | 已实施架构决定索引 |
| [`docs/testing.md`](docs/testing.md) | 测试教条与 check 分层（L0–L4） |
| [ADR-0121](docs/adr/0121-improvements-adoption-closeout.md) | 四源改进借鉴 ADOPTION 结项；开放项须新 ADR |
| [`SECURITY.md`](SECURITY.md) | 产品信任边界与非声明 |
| [`docs/tools/TOOL_CONTRACT.md`](docs/tools/TOOL_CONTRACT.md) | 工具 effect / 合同 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献流程与 PR 清单 |
| [`MISSION.md`](MISSION.md) | 产品意图 |

架构变更（settlement、effect、prompt-cache、隐私边界）必须新增或更新 ADR，并链入 `docs/adr/README.md`。

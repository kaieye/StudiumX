# AGENTS.md — StudiumX 代理 / 贡献者速查

短于通用 coding-agent 的 mega-AGENTS。**不替代** ADR；冲突时以 `docs/adr/`、`SECURITY.md`、`docs/tools/TOOL_CONTRACT.md` 与产品地板为准。

更完整的贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。当前有效架构决定只在 [`docs/adr/`](docs/adr/README.md) 维护；实施历史由 Git 与 PR 保存。

---

## 1. 产品地板（不可被「借鉴」降级）

| 边界 | 含义 |
| --- | --- |
| 文件是教学真相源 | **仅指 AI 教学决策事实**：根据学习进度、答题表现制定下一步学习计划时，canonical 在工作区文件 / LearningSession ledger；SQLite、agent run 与同步副本不得成为 teaching authority。等级/XP、偏好、规划快照与经同意的分析摘要是可同步用户状态，不因此获得教学权威。详见 [ADR-0001](docs/adr/0001-teaching-authority-and-session-ledger.md)。 |
| 工具默认可用 | 工具调用是应用级默认能力：`tools.enabled` 仅保留持久化兼容字段，加载后始终归一化为 `true`，Settings 不提供总开关。**workspaceShell 默认开**（主流 Agent，[ADR-0015](docs/adr/0015-shell-sandbox-dual-axis.md)）；`sandboxMode` × `approvalMode` 双轴、工作区信任、具体工具配置与路径围栏持续适用；可选 OS helper 未配置时必须报告真实状态；**禁止** YOLO 标签与虚假 Docker/VM 完备宣称。 |
| MCP 产品与信任边界 | MCP runtime / OAuth / secret 边界见 [ADR-0013](docs/adr/0013-mcp-runtime-trust-and-secrets.md)；**Settings 产品面 = list/editor/import/OAuth**（**无** marketplace 设置页）。secret/token 永不进 public DTO/Doctor/support bundle；MCP 非 teaching evidence；settlement sole-writer 不变；所有 MCP tool 仍进 effect lattice / approval / ToolOutcome；禁止 YOLO 标签。 |
| 无自动 remote telemetry | 本地优先指**不静默上传**、**不**默认 phone-home / Statsig / Mixpanel 式外发；不禁止用户显式开启的账号与多端同步。同步状态不得反向改写教学决策事实。 |
| effect lattice + TOOL_CONTRACT | `read` / `workspace_write` / `external_write` / `privileged` 四类 effect 与“需批准 / 按风险 / 本课放行”三态审批彼此独立；**禁止 YOLO / always-approve 标签** |
| Settlement sole-writer | `TeachingTurnCoordinator` / host 为 outcome settlement 唯一写入路径；IPC 须 `expectedRevision`；fork 路径保持 `toolsReplayed: false` |
| 持续运行与上下文治理 | 反对不透明、低位、默认的累计 token / provider 调用次数 / 工具调用次数 / 运行时长 / iteration quota；允许可审计的高位 emergency fuse、用户显式资源预算与部署/组织策略，触发时仅报告 `resource_limit` / `suspended`，不得伪装为 provider quota 或学习成功。优先通过上下文压缩、续接与用户可取消的运行处理压力；模型上下文上限、工具超时和工具输出截断属于局部技术边界。教学 authority、settlement sole-writer、`expectedRevision`、`toolsReplayed:false`、审批/effect 与恢复不自动重放工具不变。详见 [ADR-0010](docs/adr/0010-agent-recovery-and-resource-boundaries.md)。 |
| 同意门控 memory | 无人批不自动注入 / 不启动自动 memory phase；**禁止 FTS5 / 向量库作面向用户的产品搜索面**（教学内部词法检索如 `memory_search` 不受此限，见 [ADR-0009](docs/adr/0009-consent-gated-memory.md)；重开产品搜索面须独立 disposable 索引 + 新 ADR，见 [ADR-0012](docs/adr/0012-file-authority-projections-and-durable-publish.md)） |
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

1. **不要**增加、恢复或信任 `tools.enabled` 总开关；工具执行仍须经过具体 capability、工作区信任、审批、路径围栏、沙箱与局部技术边界。不要用 YOLO / DangerFullAccess / always-approve 标签；不要宣称 Docker/VM 级 OS sandbox 完备（[ADR-0015](docs/adr/0015-shell-sandbox-dual-axis.md)）。
2. **不要** 加 YOLO / DangerFullAccess / always-approve 默认或 UI 标签（`full_access` 仅称「本课放行 / 宽松策略」）。
3. **MCP 产品面**：Settings **仅** list/editor/import/OAuth；**不要**再挂 marketplace 设置页或半成品市场入口（当前不交付是设计 non-claim，不是永久禁止；重开需独立产品与安全审查）。host/foundation 可保留。所有 MCP tools 仍必须入 effect lattice 与 approval；禁止 YOLO 标签、jiti 全权限扩展、code-mode 执行不可信代码或 shell-escalation 旁路；secret 永不进 public DTO / Doctor / support bundle。
4. **不要** 默认远程 OTEL / phone-home；本地 doctor / support-bundle 须脱敏与同意。
5. **不要** 用 SQLite FTS 或向量库做**面向用户的产品搜索面**；教学内部词法检索（`memory_search`）不受此限；重开 FTS 产品面须走独立 disposable 索引 + 新 ADR；数据库门禁见 [CONTRIBUTING](CONTRIBUTING.md#database-pr-gates)，文件权威边界见 ADR-0012。
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
| Prompt 前缀 / cache 形状 | `check:teaching-impact`（PR 元数据）+ ADR-0008 相关检查 |
| 仅文档 / ADR | 交叉链接自检；无强制 suite |

分层检查约定见本文“改哪测哪”与 [`CONTRIBUTING.md`](CONTRIBUTING.md)：L0 领域保险丝、L1 runtime、L2 packaging、L4 change-detector 债。Blocking CI 保持窄而硬；全量 e2e / release-audit 不塞进每个 PR。

---

## 5. 模块尺寸政策（摘要）

- **目标：** 新/触达 TS 模块尽量 **&lt; 500–800** 行（不含测试）；超过 ~800 优先开新模块，而不是继续塞「最大文件垃圾桶」。
- **TS 放宽：** 历史或不可避免的复杂模块可到 **&lt; 1000**，但须在 PR / ADR 说明边界。
- **历史巨石：** `teaching-workspace`、`learning-session-ledger`、`teaching-turn-coordinator` 等 **先 warning、按触达 peel**；禁止为了「对齐上游」同时三线大搬家。
- peel 时 **保留** sole-writer 入口与 ledger 权威，不借机拆 settlement。

正式政策以本节与 [`CONTRIBUTING.md`](CONTRIBUTING.md) 为准；可选 `pnpm run check:module-size`（默认 warning-only，不进 Blocking CI）。

---

## 6. 权威文档链接

| 文档 | 用途 |
| --- | --- |
| [`docs/adr/README.md`](docs/adr/README.md) | 已实施架构决定索引 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献流程、分层检查约定与 PR 清单 |
| [`SECURITY.md`](SECURITY.md) | 产品信任边界与非声明 |
| [`docs/tools/TOOL_CONTRACT.md`](docs/tools/TOOL_CONTRACT.md) | 工具 effect / 合同 |
| [`docs/domain-language.md`](docs/domain-language.md) | 产品领域术语与命名约定 |

架构变更（settlement、effect、prompt-cache、隐私边界）必须新增或更新 ADR，并链入 `docs/adr/README.md`。

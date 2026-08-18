# ADR-0053：根 AGENTS.md、security suite 闭环与测试教条分层

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** 根级 `AGENTS.md`；`SECURITY_CHECKS` 纳入 external-content boundary；`AGENTS.md` / `CONTRIBUTING.md` 的 L0/L1/L2/L4 分层约定；CONTRIBUTING 交叉引用
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0045](0045-context-hygiene-ladder-and-quality-gates.md)、[`SECURITY.md`](../../SECURITY.md)、[`docs/tools/TOOL_CONTRACT.md`](../tools/TOOL_CONTRACT.md)、[ADR-0121](0121-improvements-adoption-closeout.md) **A-06 / A-07 / A-10**
- **证据：** `scripts/security-checks.mjs`（`SECURITY_CHECKS` 含 external-content boundary）、根 `AGENTS.md`、`CONTRIBUTING.md`（L0/L1/L2/L4 交叉链接）

## 背景

ADOPTION Phase 0 要求三条低成本、高杠杆的门禁与文档闭环：

1. **A-06** — `scripts/check-agent-external-content-boundary.mjs` 已存在且有 `check:agent-external-content-boundary` 脚本，但未列入 `SECURITY_CHECKS`，导致 `pnpm run check:security` / `check:prepush` 漏跑。
2. **A-07** — 仓库缺根级 `AGENTS.md`：贡献者与 coding agent 缺少「命令图 + 红线 + 改哪测哪 + 模块尺寸」单页入口；ADR 与 CONTRIBUTING 仍是权威，但入口过散。
3. **A-10** — 百余 `check-*.mjs` 需要 L0 领域保险丝 / L1 runtime / L2 packaging / L4 change-detector 债的正式分层，避免正确重构被源码正则锁死，同时 **禁止一刀切删除** 既有门禁。

## 决定

### 1. Security suite 纳入 external-content boundary（A-06）

`scripts/security-checks.mjs` 的 `SECURITY_CHECKS` **增加**：

```text
scripts/check-agent-external-content-boundary.mjs
```

`scripts/check-security.mjs` 仍按数组顺序 `spawnSync` 全量执行；`package.json` 的 `check:security` 与 `check:prepush` **无需**改脚本名即可覆盖。单项 `check:agent-external-content-boundary` 保留便于定向调试。

### 2. 根级 `AGENTS.md`（A-07）

仓库根新增短 `AGENTS.md`（中英可混；短于 Codex mega-AGENTS），至少包含：

| 块 | 内容 |
| --- | --- |
| 产品地板 | 文件 SoT；无默认 shell / MCP marketplace / 自动 remote telemetry；effect lattice + 禁 YOLO；settlement sole-writer + `expectedRevision` / `toolsReplayed:false`；持续运行与上下文治理（无累计 run-token 终止配额）；同意 memory；Blocking 领域门禁优先 |
| 命令图 | `typecheck`、`check:security`、`check:prepush`、`check:tool-contract`、`check:teaching-evidence`、doctor、unit 等 |
| 红线 | 与 ADOPTION §5 / CONTRIBUTING 对齐的 Do not 列表 |
| 改哪测哪 | 模块 → 最小检查映射摘要 |
| 模块尺寸 | 目标 &lt;500–800；TS 可 &lt;1000 需说明；历史巨石 warning + 触达 peel |
| 链接 | ADR 索引、`AGENTS.md`、ADOPTION、SECURITY、TOOL_CONTRACT、CONTRIBUTING |

**明确：**

- `check:analytics` = **本地** study analytics 测试地基检查，**不是** 远程 telemetry。  
- `AGENTS.md` **不替代** ADR；冲突时以 ADR / SECURITY / TOOL_CONTRACT 为准。

### 3. 测试教条分层（A-10）

`AGENTS.md` 的"改哪测哪"与 `CONTRIBUTING.md` 共同定义：

| 层 | 含义 |
| --- | --- |
| **L0** | teaching / privacy / security 领域保险丝；Blocking CI 永不 path-skip |
| **L1** | runtime contract（import 真模块 + fixture） |
| **L2** | packaging / allowlist / 合同清单元数据 |
| **L4** | change-detector 债（纯源码正则）；**新建禁止**；既有 **禁止一刀切删除**，触达时升格 |

**禁止** 用覆盖率或泛型 CI **替换** 领域门禁；只能叠加。CONTRIBUTING 增加指向本教条与 `AGENTS.md` 的交叉链接。

## 验证

```bash
# 语法 / 清单
node -e "import('./scripts/security-checks.mjs').then(m=>console.log(m.SECURITY_CHECKS.length))"
# 全量安全套件（含新项；耗时取决于各子检查）
pnpm run check:security
# 可选本地子集
pnpm run check:prepush
```

## 非目标

- 不改变 effect lattice、settlement sole-writer、LearningSession 权威或 AgentRun 状态机。  
- 不引入 shell、MCP marketplace、自动 remote telemetry、YOLO、FTS 产品搜索或自动 memory。  
- 不把 Blocking CI 扩成 full e2e；不批量删除既有 `check-*.mjs`。  
- 不实施 ADOPTION 其它 Phase 0/1 运行时项（A-01–A-05、B-* 等）。  
- 不声称所有 check 已完成 L4→L1 迁移；本 ADR 只定教条与 security suite 闭环。

# ADR-0078：WorkspaceHost 薄端口 + 轻量 import 方向门

- **状态：** 已实施（ADOPTION S-02 thin port；**无** monolith peel）
- **日期：** 2026-07-21
- **范围：** 冻结路径 `src/main/workspace-host/*` 作为工具/agent 对路径与注册根解析的**薄端口**；委托既有 `path-access` / `teaching-workspace-paths` / `teaching-workspace-access`；可选轻量 import 方向检查。**本 ADR 不做任何巨石拆分。**
- **相关：** [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)、[TOOL_CONTRACT](../tools/TOOL_CONTRACT.md)、[ADOPTION S-02](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/workspace-host/types.ts`
  - `src/main/workspace-host/node-workspace-host.ts`
  - `src/main/workspace-host/path.ts`
  - `src/main/workspace-host/index.ts`
  - `scripts/check-workspace-host-imports.mjs`
  - `package.json` → `check:workspace-host-imports`
  - `tests/unit/workspace-host.unit.test.ts`
  - 本 ADR

## 背景

agent tools 与主进程路径工具长期直接混用 `path-access`、相对路径 helper、注册根解析，以及巨型 `teaching-workspace.ts` 的其它职责。借鉴侧（composition-root / shell / tools / workspace 分层）要求：**工具应依赖 port，而不是 raw OS mix-in 或反向依赖 agent-loop**。

S-02 需要的是**可测的薄 façade + 依赖方向文档 + 可选 import 门**，不是第二套 IO 栈，也不是对 `teaching-workspace` / ledger / coordinator 的 peel。

## 决定

### 1. 薄端口：`WorkspaceHostPort`

目录冻结为 `src/main/workspace-host/*`。`createNodeWorkspaceHost()` 返回 `WorkspaceHostPort`，方法 **1:1 委托**既有 helper，**零新安全策略**：

| 方法 | 委托 |
| --- | --- |
| `toRelative` | `toWorkspaceRelativePath` |
| `normalizeRelative` | `normalizeWorkspaceRelativePath` |
| `isInsideRoot` | `isPathInsideRoot`（lexical；与 path-access 一致） |
| `assertRealPathInsideRoot` | `assertRealPathInsideRoot` |
| `readContainedRegularFile` | `readContainedRegularFile` |
| `readContainedRegularFileBounded` | `readContainedRegularFileBounded` |
| `ensureContainedDirectory` | `ensureContainedDirectory` |
| `resolveRegisteredRoot` | `resolveRegisteredWorkspaceRoot` |

接口刻意保持约 6–12 个方法：无 catalog、无 git、无 lesson 生成、无 agent conversation。

### 2. 依赖方向

```
tools / agent  →  workspace-host  →  path-access
                                  →  teaching-workspace-paths
                                  →  teaching-workspace-access
```

**禁止** `workspace-host` 反向导入：

- `agent-loop` / `ai/agent-loop`
- `teaching-turn-coordinator`
- `learning-session-ledger`
- `teaching-ipc-gateway`
- `renderer`
- `electron`

本切片**不**强制把 `teaching-workspace.ts` 或现有 tools 改接到 port；纯模块 + 测试即可，后续按触达消费。

### 3. 可选 import / 方向门

`pnpm run check:workspace-host-imports` → `node scripts/check-workspace-host-imports.mjs`：

- 扫描 `src/main/workspace-host/**` 源文本中的 `import` / `require` / `from '…'` 目标；
- 命中禁止子串则 **exit 1**（fail-closed）；
- 干净则 **exit 0**；
- 支持 `--self-test` 合成违规样本核验检测器本身。

**明确不进入** Blocking CI required jobs（与 ADR-0075 的 `check:module-size` 同类：可选本地 / 后续可选 workflow）。

### 4. 不变量

- path containment 语义**不得**因本端口变弱；端口只委托，不改写 policy。
- Settlement sole-writer（TeachingTurnCoordinator / host）、`expectedRevision`、`toolsReplayed: false` **不动**。
- 文件仍是教学真相源；本端口不把 SQLite / agent run 提升为 teaching authority。
- **无**默认 shell / MCP marketplace / YOLO / always-approve。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/workspace-host.unit.test.ts
node scripts/check-workspace-host-imports.mjs
# 可选：node scripts/check-workspace-host-imports.mjs --self-test
```

## 明确不包含 / non-claims

- **不是** `teaching-workspace.ts` / ledger / coordinator 巨石 peel 或拆分（见 ADR-0075 peel 纪律）。
- **不是** settlement 写入路径迁移。
- **不是** 完整 monorepo packages 拆分或 eslint mega-config 边界图。
- **不是** 第二套 FS 抽象 / 重写 path-access 安全语义。
- **不是** headless stdio 产品面（S-07 residual）。
- **不** 把 `check:workspace-host-imports` 加入 Blocking CI required jobs。
- **不** 引入 shell 工具、YOLO、MCP marketplace、默认 remote telemetry。

## 后续 residual（非本切片）

1. 按触达把 workspace 读/写 tools 的依赖改为 `WorkspaceHostPort`（仍委托同一 containment）。
2. 可选把 import 门挂到 prepush 旁路或非 required workflow。
3. Headless / composition-root 产品协议见 S-07，不由本端口授权。

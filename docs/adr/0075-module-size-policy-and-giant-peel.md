# ADR-0075：模块尺寸政策与巨石按触达 peel

- **状态：** 已实施（ADOPTION S-03 政策切片；peel 残差仍开放）
- **日期：** 2026-07-21
- **范围：** 正式化 TypeScript 生产模块行数目标、放宽与历史巨石 peel 纪律；提供 **warning-only** 本地/可选检查脚本。**本 ADR 不做任何巨石拆分。**
- **相关：** [AGENTS.md §5](../../AGENTS.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0046](0046-teaching-footprint-ladder.md)、[ADOPTION S-03](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `docs/adr/0075-module-size-policy-and-giant-peel.md`（本文件）
  - `scripts/check-module-size.mjs`
  - `package.json` → `check:module-size`
  - `AGENTS.md` §5 摘要 + 本 ADR 指针
  - `CONTRIBUTING.md` 轻量交叉引用

## 背景

AGENTS.md 第 5 节已摘要模块尺寸目标，但缺少可机读 ADR 与可选报告脚本。历史巨石（`teaching-workspace`、`learning-session-ledger`、`teaching-turn-coordinator` 等）行数已远超目标；若一次性三线大搬家，极易破坏 settlement sole-writer、ledger 权威与 IPC 合同。

S-03 本切片只做 **政策正式化 + 非阻断报告**，明确 **不** peel 巨石、**不** 把尺寸阈值塞进 Blocking CI。

## 决定

### 1. 阈值（与 AGENTS.md §5 对齐）

| 级别 | 行数（物理行，含空行与注释；**不含** `*.test.ts`） | 含义 |
| --- | --- | --- |
| **目标** | 新/触达 TS 模块尽量 **&lt; 500–800** | 超过 ~800 优先开新模块，不继续塞「最大文件垃圾桶」 |
| **软告警** | **&gt; 800** | `check:module-size` 打印 soft warning |
| **高告警** | **&gt; 1000** | 高优先级 warning；新模块不应跨过此线 |
| **放宽** | 历史或不可避免复杂度可到 **&lt; 1000** | 须在 PR 说明或相关 ADR 写清边界 |
| **legacy-giant** | 文档化历史巨石（见下表） | 允许继续存在；**仅**在触达时 peel；默认与 STRICT 下均 **不** 因体积失败（仍打印 warning） |

扫描范围：`src/**/*.ts`，排除 `*.test.ts`、`tests/`、`node_modules`、`ref_project` 及常见构建产物目录。

### 2. 历史巨石清单（文档快照，会漂移）

以下行数为 **本 ADR 撰写时** `scripts/check-module-size.mjs` 风格物理行计数；合并后会漂移，**不**当作冻结契约。

| 路径 | 约行数（2026-07-21） | 标签 |
| --- | --- | --- |
| `src/main/teaching-workspace.ts` | ~2991 | legacy-giant |
| `src/main/learning-session-ledger.ts` | ~2657 | legacy-giant |
| `src/main/teaching-turn-coordinator.ts` | ~2369 | legacy-giant |
| `src/renderer/src/app-shell/appStore.ts` | ~2189 | legacy-giant |
| `src/shared/teaching-events.ts` | ~1750 | legacy-giant |
| `src/main/agent-conversation-session-tree.ts` | ~1352 | legacy-giant |
| `src/main/agent-conversation-session-audit.ts` | ~1279 | legacy-giant |
| `src/main/teaching-agent-conversations.ts` | ~1152 | legacy-giant |
| `src/renderer/src/agent-conversation-state.ts` | ~1110 | legacy-giant |
| `src/main/teaching-config-resolver.ts` | ~985 | 触达优先；接近 1000 |
| `src/main/ai/agent-loop.ts` | ~907 | 触达优先；软告警带 |

脚本内 `LEGACY_GIANTS` allowlist 与上表 **&gt;1000** 条目对齐；allowlist 更新随 peel 或新发现巨石在 PR 中维护，不要求本 ADR 每次改行数。

### 3. Peel 纪律（残差，非本切片实施）

1. **仅按触达 peel**：改到某巨石时再拆出边界清晰的旁路模块；禁止「对齐上游」驱动的三线并行大搬家（尤其 `teaching-workspace` + `learning-session-ledger` + `teaching-turn-coordinator` 同时重写）。
2. **保留权威入口**：
   - settlement sole-writer 仍为 TeachingTurnCoordinator / host（ADR-0023）；
   - LearningSessionLedger 仍为教学会话权威；
   - 不得借 peel 把 outcome settlement 写路径拆成多 writer。
3. **先 warning、后结构**：尺寸检查默认只告警；peel PR 必须带定向 unit / 相关 `check:teaching-evidence` / IPC 合同检查（按改哪测哪）。
4. **模块目标尺寸**：新抽出模块仍遵守 &lt;500–800 目标；不要把一个 3000 行文件切成两个 1500 行文件却不清晰边界。

### 4. 可选检查脚本（warning-only 默认）

`pnpm run check:module-size` → `node scripts/check-module-size.mjs`：

| 模式 | 行为 | exit |
| --- | --- | --- |
| **默认** | 列出 &gt;800 / &gt;1000 / legacy-giant；打印摘要 | **0**（永不因尺寸失败） |
| `MODULE_SIZE_STRICT=1` | 任一 **非** allowlist 文件 **&gt;1000** | **1**；allowlist 巨石仍只 warning |

**明确不进入** `.github/workflows/blocking-ci.yml` 的 required jobs；不加入 `check:security` / `check:prepush` 默认链。本地或可选 workflow 可自行调用。

### 5. 与 Footprint Ladder / FeatureRegistry 的关系

- **正交：** ADR-0046 Footprint Ladder 管 **能力扩张面**（skill / host / gated tool / MCP 远期 / core tool 最后）；本 ADR 管 **源码模块物理尺寸与 peel 节奏**。
- 缩小文件 **不** 授权扩大 tool/MCP/shell 面；扩大能力仍走 Footprint Ladder 与 TOOL_CONTRACT。
- FeatureRegistry / TeachingCommand 闭集纪律不变。

## 已实施范围与验证入口

```powershell
node scripts/check-module-size.mjs
# 期望：exit 0，stderr/stdout 含巨石与 >800 告警
```

可选严格模式（仅本地/专项，非 Blocking CI）：

```powershell
$env:MODULE_SIZE_STRICT='1'; node scripts/check-module-size.mjs
```

## 不变量

- 默认 `check:module-size` **exit 0**；尺寸不得成为 Blocking CI 失败原因。
- 新/触达代码以 &lt;500–800 为目标；跨过 1000 须有 PR/ADR 说明，且不得静默进入 allowlist 以外的 STRICT 失败路径。
- Peel 不得破坏 sole-writer、ledger 权威、`expectedRevision`、`toolsReplayed: false`。
- 本 ADR **不** 修改任何生产模块实现。

## 明确不包含 / non-claims

- **不是** 巨石 peel / 拆分实施（S-03 peel 残差；另立 PR 与必要时补充 ADR）。
- **不是** import boundary / host port 图（S-02）。
- **不是** eslint complexity 大规则集或覆盖率替代领域门禁。
- **不是** 把 `check:module-size` 加入 blocking-ci required jobs。
- **不** 引入 YOLO / shell / MCP marketplace / 默认 remote telemetry。
- **不** 改 EventBus/timeline、AgentRun 状态机或 LearningSessionLedger 权威模型。

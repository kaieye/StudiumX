# ADR-0074：Blocking CI fan-in（skip=fail）与 worktree / format 轻门

- **状态：** 已实施（ADOPTION S-06）
- **日期：** 2026-07-21
- **范围：** 在既有 domain 并行 jobs 之上增加 **required fan-in**；CI/本地可用的 **clean-worktree porcelain**；**诚实的轻量 format 子集**（无 Prettier/Biome 全仓配置）。
- **相关：** [ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0053](0053-agents-md-security-suite-and-testing-doctrine.md)、[ADR-0054](0054-actions-sha-pin-dependabot-osv-fail-open.md)、[docs/testing.md](../testing.md)、[ADOPTION S-06](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `.github/workflows/blocking-ci.yml`（`blocking-required` fan-in）
  - `scripts/check-ci-results.mjs`
  - `scripts/check-clean-worktree.mjs`
  - `scripts/check-format-subset.mjs`
  - `scripts/check-blocking-ci.mjs`（扩展断言）
  - `package.json` → `check:ci-results` / `check:clean-worktree` / `check:format`
  - 本 ADR

## 背景

Blocking CI 已有三个并行 domain job（`typecheck`、`security-privacy`、`teaching-evidence-p0`），但 **没有 fan-in**：

1. GitHub branch protection 若只勾多个 job，**skipped / cancelled** 在部分配置下可能被误读为“可合并”，与 product 期望的 **skip=fail** 不一致。
2. 缺少 checkout 后的 **clean worktree** 约束，CI 步骤静默改写工作区时不易发现。
3. 仓库 **尚无** Prettier/Biome 全仓配置；贸然引入会制造 mega-diff。仍需要一个 **诚实、小范围** 的 format 子集门，避免“零格式门”的空洞。

S-06 要求 **叠在** domain 门之上，**永不替换** teaching / privacy / security 检查。

## 决定

### 1. Required fan-in job：`blocking-required`（skip=fail）

| 项 | 约定 |
| --- | --- |
| Job id | `blocking-required` |
| `if` | `always()` — 依赖 job 失败/跳过/取消时 **仍运行** |
| `needs` | `[typecheck, security-privacy, teaching-evidence-p0]` |
| 聚合 | `NEEDS_JSON=${{ toJSON(needs) }}` → `node scripts/check-ci-results.mjs` |
| 语义 | **任一 required job 的 `result !== 'success'` → fan-in exit 1**（含 `skipped`、`cancelled`、`failure`、缺失） |
| Branch protection | 应以 **`blocking-required`** 为 required check（domain jobs 仍应存在且并行；不因 fan-in 而删掉） |

Domain jobs **保持** 独立并行；**禁止** 把 typecheck/security/teaching-evidence 折成单一 mega job。

### 2. Clean worktree porcelain

`scripts/check-clean-worktree.mjs`：

- 运行 `git status --porcelain`
- 有任何输出 → exit 1
- 可选本地跳过：`ALLOW_DIRTY_WORKTREE=1`（**默认严格**；CI 不得设置该跳过）
- 挂在 fan-in job checkout 之后

### 3. Light format subset（诚实范围）

`scripts/check-format-subset.mjs` + `pnpm run check:format`：

- **不做** 全仓 Prettier/Biome 引入与 reformat
- 仅对 **小 allowlist** 检查：LF only、无行尾空白、文件以 newline 结尾
- 初始 allowlist 示例：`src/shared/build-identity.ts`、`src/shared/features.ts`、本切片新增/触达的 check 脚本、`blocking-ci.yml`
- **Full Prettier（或等价工具）= TBD**；本门 **不是** 格式覆盖率证明

### 4. 本地脚本与门禁自检

| Script | 用途 |
| --- | --- |
| `pnpm run check:ci-results` | 聚合器；本地 `--self-test` 覆盖 skip/cancel/failure/missing |
| `pnpm run check:clean-worktree` | porcelain 干净性 |
| `pnpm run check:format` | format 子集 |
| `pnpm run check:blocking-ci` | 断言 workflow fan-in + package scripts + 既有 domain / host 接线 |

### 5. Actions pin 与 Node

- 继续使用既有 **commit SHA pin**（ADR-0054）；本切片 **不** 升级 Actions 主版本
- Node 保持 `22.x`；fan-in 可用 checkout + setup-node，**不** 强制 `pnpm install`（纯脚本零 deps）

## 已实施范围与验证入口

```powershell
node scripts/check-ci-results.mjs --self-test
node scripts/check-format-subset.mjs
node scripts/check-blocking-ci.mjs
# 工作区若有未提交改动会失败——实现过程中属预期；CI checkout 后应干净
node scripts/check-clean-worktree.mjs
```

## 不变量

1. **Domain gates 仍是 P0**，fan-in **只聚合结果**，不替代 `check:security` / teaching-evidence / typecheck。
2. **skip=fail**：`skipped` 与 `cancelled` 与 `failure` 同等失败。
3. **无 YOLO / always-approve / shell product path / MCP marketplace / 默认 remote telemetry**。
4. Actions SHA pin 与 Node 22.x 保持。
5. Format 门保持 **子集诚实**；不得伪装成全仓 prettier 完成。

## 明确不包含 / non-claims

- **不是** 全量 e2e、release-audit、或把 soft reminder 塞进 required set。
- **不是** 全仓 Prettier/Biome 配置 + mega-diff reformat。
- **不是** 用覆盖率或泛型 lint **替换** teaching / privacy / security 领域门禁。
- **不是** 改 settlement sole-writer、ledger 权威、AgentRun 状态机、或 product runtime TS 行为。
- **不是** 自动扩 Blocking CI 到巨型 suite；扩展仍须谨慎、另立 ADR/ADOPTION 切片。

# ADR 治理重构 — 最终验收报告

> 交付日期：2026 治理批次收口。范围：`docs/adr/**` 语义保持型治理重构，
> 非架构变更 / 非产品政策变更。所有 ADR 编号与文件路径保持稳定，未删除、未合并。

## 1. 交付物

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| 结构检查 + 索引生成脚本 | `scripts/check-adr.mjs` | ✅ 0 errors |
| 机器维护单行索引 | `docs/adr/INDEX.md` | ✅ 171 行（每 ADR 一行） |
| 导航 README | `docs/adr/README.md` | ✅ 74 行（≤120 预算） |
| 统一元数据 | 全部 171 ADR | ✅ `决策状态/实施状态/日期/范围/取代/被取代/相关/证据` |
| 证据附录 | `docs/adr/evidence/` | ✅ 20 个文件 |
| 运维 runbook | `docs/runbooks/c4p6-closeout-runbook.md` | ✅ 1 个文件 |
| 契约测试 | 3 个文件 | ✅ 18/18 passed |

## 2. 统计对比

| 指标 | 迁移前（HEAD） | 迁移后（工作区） | 变化 |
| --- | --- | --- | --- |
| ADR 文件数 | 171 | 171 | 0 |
| ADR 总行数 | 15,132 | 13,201 | **−1,931** |
| 结构错误 | — | **0** | — |
| 元数据警告 | 77 文件缺统一字段 | **0** | 全部清除 |
| >150 行警告 | 5 个文件 | **0**（长度说明豁免 3 个） | 清除 |
| 坏链接 | 若干 | **0** | 已修（含 0172/0173 的 `../mindmap/design.md` → 纯文本） |
| 契约测试 | 18 | 18 | 通过 |

## 3. 处理类型分布

- **元数据标准化（全量）**：171/171 — 统一 8 字段元数据，`状态` → `决策状态`+`实施状态`+`实施说明`。
- **COMPRESS / SPLIT-EVIDENCE（重点文件）**：
  - 0004、0019、0020、0035、0096、0124、0126、0127、0128、0129、0130、0131、0170、0171
  - 证据移入 `docs/adr/evidence/ADR-NNNN.md`（20 个）；运维步骤移入 `docs/runbooks/`。
- **KEEP（语义不可压缩）**：0121（契约锁定）、0122（契约锁定 + 长度说明）、0130（residual 诚实政策本体 + 长度说明）、0124（六闸 + P2 边界，契约锁定）。
- **SUPERSEDED-STUB / CONFLICT / BROKEN-REFERENCE**：无新增；既有 supersession 关系如实填入 `取代/被取代` 元数据。

## 4. Supersession 变化（如实记录，未伪造）

| ADR | 取代 | 被取代 |
| --- | --- | --- |
| 0103 | 无 | 部分被 ADR-0171（run-budget stop reason 政策） |
| 0126 | 无 | 部分被 ADR-0131（默认写模型） |
| 0131 | 部分 ADR-0126（默认写模型） | 无 |
| 0139 | 无 | 部分被 ADR-0141 |
| 0140 | 无 | 部分被 ADR-0141/0142 |
| 0152 | 无 | 部分被 ADR-0153 |
| 0153 | 部分 ADR-0152 | 无 |
| 0127/0128/0132/0137/0138/0141/0145 等 | 既有关系 | 保持 |

其余 ADR 未伪造 supersession（`取代：无` / `被取代：无`）。

## 5. 明确未改变的架构边界（硬性约束复核）

以下产品不可变边界在重构后逐条复核，**未削弱**：

- 文件 / LearningSession ledger 是教学决策事实源（0167 双平面）✅
- TeachingTurnCoordinator / host settlement sole-writer + `expectedRevision` ✅
- fork 保持 `toolsReplayed: false` ✅
- effect lattice / approval / workspace trust / 路径围栏 / sandbox ✅
- 禁止 YOLO / DangerFullAccess / always-approve ✅
- MCP secret/token 永不进 public DTO / renderer / Doctor / bundle ✅
- MCP Settings 产品面 = list/editor/import/OAuth（ADR-0142 设计 non-claim）✅
- 无默认 remote telemetry ✅
- SQLite/FTS/向量不作面向用户产品搜索权威 ✅
- 无自动 memory/dream/静默 learner-profile 修改/自动 skill 创建 ✅
- 持续 Agent 运行 / 资源边界 / 取消 / context governance（0171）✅

**无任何 ADR 从 Proposed 被改写为 Implemented**（7 个 Proposed 全部保持 proposed/not_started）。

## 6. 契约测试影响

- `tests/unit/usage-ledger-adr.unit.test.ts`：1 处断言迁移（`**状态：**` → `**决策状态：**` + `**实施说明：**`），保护意图不变。
- `tests/unit/improvements-adoption-closeout.unit.test.ts`：1 处断言迁移（`状态.*已采纳` → `决策状态.*accepted` + `实施说明.*已采纳`），保护意图不变。
- `tests/unit/database-pr-gates.unit.test.ts`：未改动。
- 三者均 18/18 passed。

## 7. 执行的检查命令与结果

```bash
node scripts/check-adr.mjs          # 171 files, 0 errors, 15 warnings（全部为 >120 行长度预算）
node scripts/check-adr.mjs --strict # exit 0（元数据完整）
node scripts/check-adr.mjs --index  # INDEX.md 再生成
pnpm exec vitest run --project unit \
  tests/unit/usage-ledger-adr.unit.test.ts \
  tests/unit/database-pr-gates.unit.test.ts \
  tests/unit/improvements-adoption-closeout.unit.test.ts
# → Test Files 3 passed, Tests 18 passed
```

## 8. git diff --stat（ADR 相关）

`174 files changed, 2106 insertions(+), 4334 deletions(-)`（docs/adr/**、docs/runbooks/**、scripts/check-adr.mjs、2 个契约测试；不含用户未提交 WIP：mindmap/redline/fonts/src 改动）。

## 9. 未解决冲突 / 停止条件

- 无 authority 冲突触发停止。
- 无 ADR 与代码矛盾无法判断。
- 全部实施状态可从文件正文 / 代码路径判定，未依赖猜测。
- 无删除改变安全意义的案例。
- 用户未提交修改（0057/0075/0127/0141/0142/0145/README 等）均已保留语义并最小合并。

## 10. 遗留说明（非阻塞）

- 15 个 >120 行长度警告：为复杂 ADR（0124/0129/0130/0131/0114/0118/0153/0170/0096 等），符合「复杂 ≤120，>150 需说明理由」预算精神；3 个 >150 文件已附 `> **长度说明：**` 并获 check 豁免。
- ADR-0068/0069 编号缺口为历史既有（不补号、不重编）。

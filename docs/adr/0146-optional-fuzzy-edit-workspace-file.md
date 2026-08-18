# ADR-0146：可选 fuzzy `edit_workspace_file`（LiveAgent Phase B）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** **已实施**（2026-07-24）：`edit-match.ts` + `workspace-edit.ts` `edit_workspace_file`（peel 自 `workspace.ts`，ADR-0075） + TOOL_CONTRACT / effect-policy / registry；unit `edit-match.unit.test.ts`
- **日期：** 2026-07-24
- **范围：** 为教学 agent 提供**可选**局部编辑工具（`edit_workspace_file` 或等价注册名）：多级匹配（Exact → EOL/BOM → 行尾空白 → 缩进统一）+ 向模型回报 `matchStrategy`；**同一** path 围栏、`write-policy`、三态审批、write-rewind journal 路径。**禁止** 用 Shell / `apply_patch` **作为本编辑工具的替代产品路径**（工作区命令 shell 另见 ADR-0152/0153，不在本 ADR 范围）。
- **取代：** 无
- **被取代：** 无
- **相关：** LiveAgent 历史研究清单（已结项） §3.1 / Phase B、[docs/tools/TOOL_CONTRACT.md](../tools/TOOL_CONTRACT.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0048](0048-tool-contract-and-write-policy.md)、[ADR-0049](0049-write-rewind-journal.md)、[ADR-0121](0121-improvements-adoption-closeout.md)、[ADR-0143](0143-context-file-touch-ledger.md)、`AGENTS.md`、`SECURITY.md`
- **证据：** `src/main/ai/tools/edit-match.ts`（或同级 pure matcher）；workspace 工具 registry；`docs/tools/TOOL_CONTRACT.md` + `check:tool-contract`；与既有 write-policy / write-rewind / path 围栏接线

## 1. 背景

全量 `write_workspace_file` 对大 lesson / 源文件成本高且易偏。LiveAgent 以多级 fuzzy 匹配做局部替换并向模型回报策略，降低「旧片段对不齐」失败率。

StudiumX 必须在**不**把 Shell / apply_patch 当作本局部编辑工具产品面的前提下，把 `edit_workspace_file` 放进既有 **effect lattice + write-policy + 三态审批 + write-rewind journal**，并登记 TOOL_CONTRACT。工作区命令能力见 ADR-0152/0153，与本 ADR 正交。

## 2. 决策

### 2.1 匹配阶梯（闭集，顺序固定）

| 阶 | 策略 | 意图 |
| --- | --- | --- |
| 1 | **Exact** | 字节/字面精确匹配 old_string |
| 2 | **EOL/BOM** | 规范化换行与可选 BOM 后再匹配 |
| 3 | **Trailing whitespace** | 行尾空白容错后再匹配 |
| 4 | **Indent-unified** | 统一缩进视图匹配；命中后 **按文件真实缩进重渲染** 再写入 |

- 任一层唯一命中即采用该层；**多命中 / 零命中** → fail-closed，**禁止**静默写错位置。
- 成功结果须向模型/tool outcome 暴露 **`matchStrategy`**（枚举上述阶名），便于自检与审计。

### 2.2 安全与合同（与 write 同级）

| 规则 | 说明 |
| --- | --- |
| **Effect** | `workspace_write`（或 TOOL_CONTRACT 明确登记的等价级）；**未知工具仍 privileged fail-closed** |
| **Path 围栏** | 相对 workspace；绝对路径 / `..` 越界 **deny**；与既有 workspace containment 一致 |
| **Write-policy** | 同一 `write-policy.ts` 决策层（deny > ask > allow）；**三态审批**，禁止 YOLO / always-approve 标签 |
| **Write-rewind** | 首次触达路径须写入 pre-image journal（ADR-0049）；journal 失败 **不得** 静默跳过 durable 路径的既有失败语义 |
| **File-touch ledger** | 成功完成后记入 ADR-0143 ledger（modified 粘性）；失败/拒绝不记 |
| **注册** | 必须进 registry + TOOL_CONTRACT + `check:tool-contract`；漂移 fail |

### 2.3 红线

1. **禁止** ShellTool、OS sandbox 产品声明、`apply_patch` / 任意 diff 应用为**产品路径**。
2. **禁止** 用 fuzzy 匹配绕过 path 围栏、write-policy 或审批。
3. **禁止** 把 edit 结果当 teaching evidence / settlement 输入。
4. 无默认 remote telemetry；无 FTS 产品搜索；无 product `autoDrain: true`；fork `toolsReplayed: true` **禁止**。

## 3. 实现形状（设计目标；未实施）

```text
src/main/ai/tools/edit-match.ts     # pure multi-pass matcher + matchStrategy
# registry entry: edit_workspace_file (name final in implement PR)
# wire: write-policy, permission resolve, write-rewind journal, path fence
docs/tools/TOOL_CONTRACT.md         # effect / annotations / result budget
# tests: Exact / EOL-BOM / trailing-ws / indent-unified; multi-match deny;
#        wrong-match no write; rewind restore; tool-contract drift
```

验收已由本 ADR 的实现落点和目标测试闭环。

## 4. 与既有 ADR 的关系

| 文档 | 关系 |
| --- | --- |
| ADR-0048 / TOOL_CONTRACT | **合同基线**；本 ADR 增加可选 edit 工具登记义务 |
| ADR-0049 | edit 成功写路径须 **兼容** write-rewind first-touch |
| ADR-0024 / effect lattice | 不旁路 dispatcher / 审批 |
| ADR-0143 | 成功 edit 计入 file-touch（modified） |
| ADR-0121 | 四源结项后开放项须新 ADR；本条为 LiveAgent Phase B 写路径项 |
| Phase C/D | **不** 由本 ADR 授权（Busy phase UI、Pin/FTS 等） |

## 5. 非目标

- 不引入 apply_patch / multi-file batch edit 产品工具。
- 不实施 Phase C Busy 贯通或 Phase D 项。
- 不默认打开「无审批整文件模糊替换」。

## 6. 一句话

**可选多级 fuzzy 局部 edit：Exact→EOL/BOM→行尾空白→缩进统一；回报 matchStrategy；同 path 围栏、write-policy、三态审批与 write-rewind；永不 Shell/apply_patch。**
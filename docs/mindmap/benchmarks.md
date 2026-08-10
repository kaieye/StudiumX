# M0 基准：文档矩阵与 XMind fixture 矩阵

- **状态：** M0 基线规格（2026-08-09）
- **关联：** [studiumx-mind-map-plan.md](studiumx-mind-map-plan.md)（§8 M0、§10 验收、§11 测试）、[ADR-0173](../adr/0173-mind-map-schema-v2-and-revisioned-repository.md)、[m0-baseline.md](m0-baseline.md)

> 本文定义 10 / 100 / 500 / 2000 节点基准文档矩阵与 XMind fixture 矩阵，供 M0 建立基准与后续性能/互通验收。具体测得的数值在 M0 基准机上确认后回填，本文现阶段只固定**矩阵规格与验收目标**。

## 1. 基准文档矩阵

| 级别 | 节点数 | 用途 | 推荐形态 | 验收目标（默认，具体以基准机为准） |
| --- | --- | --- | --- | --- |
| S | 10 | 交互冒烟、命令/undo 单元基座 | 3 层、每分支 2–3 子节点（见 `fixtures/doc-10-nodes.v1.json`） | 打开/布局无感知；任意命令秒级回放 |
| M | 100 | 日常图、键盘建图验收 | 4–5 层、每分支 3–5 子节点，含折叠 | 仅用键盘可创建/编辑/移动/折叠/删除；可撤销/重做 |
| L | 500 | 常规大图性能基线 | 5–7 层、每分支 3–6 子节点，含折叠与部分 element | 打开与自动布局无可感知长阻塞；平移缩放接近 60fps |
| XL | 2000 | 压力图 | 7–10 层、每分支 3–8 子节点，含折叠/多 sheet element | 可完成打开、搜索、折叠与定位，不崩溃 |

补充约定：

- 每个级别文档在 `src/shared/mindmap/domain/` 或测试 fixture 目录内以**生成器**（确定性 seed）与**静态快照**双轨维护：静态快照用于 golden 对比，生成器用于 property test 随机命令序列。
- 单个结构命令**不遍历无关 Sheet**（对应 ADR-0173 §2.3 active sheet 显式入命令上下文）。
- 布局与导出可取消；超大输入使用明确的局部技术边界与错误，不伪装成 provider quota。

## 2. XMind fixture 矩阵

| 类别 | 覆盖点 | 期望报告类别 | 备注 |
| --- | --- | --- | --- |
| 多版本 | XMind 2020+ `content.json` 结构；不同 `structureClass` 与 `children.attached` 变体 | `preserved`/`approximated` | 至少覆盖 right / balanced / map / down / up |
| 样式 | 节点/线条/主题样式、`theme` | `approximated`（映射到 v2 等价）或 `dropped`（无法表达时逐项报告） | 禁止静默丢失 |
| 关系线 | `relationships`（带标签连线） | `approximated`（映射 v2 relationship）或 `dropped` | 引用稳定 node id |
| 概要 | `summaries`（连续同级总结） | `approximated`（映射 v2 summary）或 `dropped` | 引用范围 id |
| 外框/标注 | boundary / callout / freeTopic | `approximated` 或 `dropped` | 按 M3 能力落地情况 |
| 附件 | image / attachment / 缩略图 | `warnings` + `dropped`（未迁移时）或 `approximated`（迁移到工作区 asset 后） | 附件迁移、路径围栏、大小上限 |
| 标记/标签/链接/任务 | `markers` / `labels` / `href` / `task` | `approximated`（映射 v2 有限集合）或 `dropped`（逐项计数报告） | 见 `fixtures/xmind-content-unsupported-fields.json` |
| 未知字段 | 任意未识别 JSON 字段 | `dropped`（逐项列出）或 `preserved`（经 `interop.xmind.extensions` 限量保存） | 有限大小、无可执行语义 |
| 损坏 ZIP | 非 ZIP、缺 `content.json`、JSON 损坏、ZIP slip/bomb | `warnings` + 结构化错误 | 不越界、不执行内容、不留下半成品 |
| 空/极简 | 空树、单 sheet、缺 `structureClass` | `preserved`（前向默认） | `xmind-content-basic.json` 为代表性样本 |

## 3. 兼容性报告契约

每次导入/导出返回报告，类别固定为 `preserved / approximated / dropped / warnings`（规划 §5.6、ADR-0173 §2.4）：

- `preserved`：完整保留；
- `approximated`：转换为 StudiumX 等价能力；
- `dropped`：无法表达，**逐项列出字段/元素数量与原因**；
- `warnings`：损坏附件、未知结构、超限内容。

禁止静默丢字段：任何未保留字段必须进入 `dropped` 并在报告中可见。

## 4. 测量维度

| 维度 | 度量 | 目标 |
| --- | --- | --- |
| 打开 | 文件读取 + 校验 + 首帧布局耗时 | S/M < 100ms；L < 400ms；XL < 2s（基准机确认） |
| 布局 | 自动布局总耗时、增量布局命中率 | L 无可感知长阻塞；XL 可取消 |
| 交互 | 平移/缩放帧率、选择/折叠延迟 | L 接近 60fps；XL 不崩溃 |
| 命令 | 单命令不遍历无关 Sheet；undo/redo 往返正确 | property test 全绿 |
| 互通 | round-trip 保真报告、损坏输入不越界 | 报告可解释、无半成品 |
| 内存 | 峰值堆内存、节点数 vs 内存 | XL 不 OOM（基准机确认） |

### 4.1 M1 100 节点连续建图回归

`tests/unit/mind-map-benchmark.unit.test.ts` 中的 100 节点回归从静态
`doc-100-nodes.v2.json` fixture 的根节点开始，按确定性 preorder 连续重放 99 个
`topic.insert` 命令，再执行一次纯布局，并验证：

- 命令序列还原完整 100 节点树，布局结果与静态 fixture 一致且确定；
- 连续输入以一个 `mergeKey` 形成单个 undo 单元，undo/redo 往返恢复原图；
- `AbortSignal` 在命令边界和布局前协作式检查，取消后不再执行剩余命令，也不启动布局；
- 只记录基准机日志，不设置机器相关硬阈值，不引入默认运行时 quota。

该回归通过独立的 `pnpm run check:mindmap-benchmark` 运行；不会把 100/500/2000
节点性能测量塞进日常 `check:mindmap`，避免让默认 CI 变成重型 benchmark。

## 5. 已提交的代表性 fixture

矩阵规格对应的确定性 fixture 已随 M0 基线提交，统一位于
[`benchmarks/fixtures/`](benchmarks/fixtures/)：

- `doc-10-nodes.v1.json`、`doc-10-nodes.v2.json`、`doc-100-nodes.v2.json`、
  `doc-500-nodes.v2.json`、`doc-2000-nodes.v2.json` — 10 / 100 / 500 / 2,000 节点
  文档快照；
- `xmind-content-basic.json`、`xmind-content-empty.json`、
  `xmind-content-{right,balanced,map,down,up,multi-sheet}.json` — 基础树、空树、
  结构方向与多 Sheet 变体；
- `xmind-content-{styles,relationships,summaries,attachments,unknown-fields}.json`
  与 `xmind-content-unsupported-fields.json` — 样式、关系、概要、附件、未知字段及
  组合兼容性样本；
- `xmind-corrupt-{not-a-zip,empty,missing-content,invalid-json,truncated}.xmind` —
  非 ZIP、缺少 `content.json`、损坏 JSON 与截断归档样本。

上述文件由 [`generate-benchmark-fixtures.mjs`](benchmarks/fixtures/generate-benchmark-fixtures.mjs)
以固定 seed 生成；`doc-10-nodes.v1.json` 与
`xmind-content-unsupported-fields.json` 为人工维护的代表性样本。fixture 的存在不等于
性能目标已经实测达标：打开/布局/交互等数值仍须在 M0 基准机上记录，且不应把机器相关
阈值写成默认运行时 quota。

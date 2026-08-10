# M0 基准 fixtures 说明

本目录存放 M0 基准文档与 XMind fixture（见 [`docs/mindmap/benchmarks.md`](../benchmarks.md) 与
规划 §8 M0 / §10.3 / §11）。所有 fixtures 由
[`generate-benchmark-fixtures.mjs`](generate-benchmark-fixtures.mjs) 确定性生成（seed 固定），
可随时重新生成：

```bash
node docs/mindmap/benchmarks/fixtures/generate-benchmark-fixtures.mjs
```

重新生成会覆盖下列由脚本产出的文件；`xmind-content-unsupported-fields.json` 与
`doc-10-nodes.v1.json` 为人工维护的代表性样本，脚本不覆盖。

---

## 一、v2 基准文档矩阵

| 文件 | 节点数 | 层级 | 折叠 | 元素 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `doc-10-nodes.v2.json` | 10 | 3 层 | 否 | 无 | 交互冒烟、命令/undo 单元基座（v2 版本） |
| `doc-100-nodes.v2.json` | 100 | 4–5 层 | 是 | 无 | 日常图、键盘建图与撤销/重做基线 |
| `doc-500-nodes.v2.json` | 500 | 5–7 层 | 是 | 关系/概要/外框/标注/自由主题 | 常规大图性能基线 |
| `doc-2000-nodes.v2.json` | 2000（Sheet1=1900 + Sheet2=100） | 7–10 层 | 是 | 两张 Sheet 均含元素 | 压力图、多 Sheet 打开/搜索/折叠/定位 |

每份文档均满足 `mindMapDocumentV2Schema`，且通过 `validateMindMapDocumentV2` 的
不变量校验（id 唯一、引用稳定、无环、元素引用存在）。

### 预期行为

- 10：打开/布局无感知；任意命令秒级回放。
- 100：仅键盘可创建/编辑/移动/折叠/删除；可撤销/重做。
- 500：打开与自动布局无可感知长阻塞；平移缩放接近 60fps。
- 2000：可完成打开、搜索、折叠与定位，不崩溃；单个结构命令不遍历无关 Sheet。

---

## 二、XMind `content.json` fixtures

| 文件 | 覆盖点 | 预期报告类别 |
| --- | --- | --- |
| `xmind-content-basic.json` | 极简单 sheet、`children.attached`、`structureClass` 可前向默认 | `preserved` |
| `xmind-content-right.json` | `org.xmind.ui.logic.right` | `preserved` |
| `xmind-content-balanced.json` | `org.xmind.ui.logic.balanced` | `preserved` |
| `xmind-content-map.json` | `org.xmind.ui.logic.map` | `preserved` |
| `xmind-content-down.json` | `org.xmind.ui.logic.down` | `preserved` |
| `xmind-content-up.json` | `org.xmind.ui.logic.up` | `preserved` |
| `xmind-content-styles.json` | 主题、节点/线条样式 | `approximated`（映射到 v2 等价）或 `dropped`（逐项报告） |
| `xmind-content-relationships.json` | `relationships`（带标签连线） | `approximated`（映射 v2 relationship）或 `dropped` |
| `xmind-content-summaries.json` | `summaries`（连续同级总结） | `approximated`（映射 v2 summary）或 `dropped` |
| `xmind-content-attachments.json` | `image` / `attachment` | `warnings` + `dropped`（未迁移）或 `approximated`（迁移到工作区 asset） |
| `xmind-content-unknown-fields.json` | 任意未识别 JSON 字段 | `dropped`（逐项列出）或 `preserved`（受限 extension bag） |
| `xmind-content-unsupported-fields.json` | markers/labels/href/task/附件/relationship/summary 组合 | `approximated` / `dropped` 逐项计数报告 |
| `xmind-content-empty.json` | 空树、单 sheet、缺 `structureClass` | `preserved`（前向默认） |
| `xmind-content-multi-sheet.json` | 多 Sheet、不同 `structureClass` | `preserved` |

### 预期行为

- 基础树与多版本结构转换不崩溃，`structureClass` 缺失时前向默认 `right`。
- 样式/关系/概要/附件/未知字段不得静默丢失：必须进入 `approximated` 或 `dropped`,
  并在兼容性报告中可见。
- 附件迁移需遵循路径围栏与大小上限。

---

## 三、损坏 ZIP fixtures

| 文件 | 生成方式 | 预期行为 |
| --- | --- | --- |
| `xmind-corrupt-not-a-zip.xmind` | 写入纯文本 `"this is not a zip archive at all"` 的真实字节 | `parseXmindZip` 抛 `Not a valid .xmind ZIP archive`，不越界 |
| `xmind-corrupt-empty.xmind` | 0 字节空文件 | 同上（非 ZIP 路径） |
| `xmind-corrupt-missing-content.xmind` | `zipSync({ 'metadata.json': '{}' })` 生成的真实 ZIP，缺 `content.json` | 抛 `.xmind archive is missing content.json` |
| `xmind-corrupt-invalid-json.xmind` | `zipSync({ 'content.json': 'not json at all' })` 生成的真实 ZIP | 抛 `content.json is not valid JSON` |
| `xmind-corrupt-truncated.xmind` | 用 `zipSync` 生成合法 ZIP 后截断末尾 24 字节的真实文件 | 抛 `Not a valid .xmind ZIP archive`，不越界 |

所有损坏文件均为真实文件字节（不是内存 mock），加载时应返回结构化错误而不得崩溃、
越界或留下半成品。

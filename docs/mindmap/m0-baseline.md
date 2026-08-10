# M0 基线：当前思维导图实现盘点与缺陷清单

- **状态：** M0 基线记录（2026-08-09）
- **关联：** [studiumx-mind-map-plan.md](studiumx-mind-map-plan.md)（§1.1、§8 M0、§13）、[ADR-0172](../adr/0172-mind-map-and-ai-assist.md)、[ADR-0173](../adr/0173-mind-map-schema-v2-and-revisioned-repository.md)、[design.md](design.md)

> 本文基于对仓库现有 mindmap 代码的**如实盘点**，不写生产代码。目标是固定「现状缺陷与导入丢失项」，供 M0 退出条件与 M1 垂直切片验收。

## 1. 盘点范围

| 代码位置 | 现状 |
| --- | --- |
| `src/shared/mindmap/mind-map-types.ts` | schema v1：`MindMapNode`（id/title/note/collapsed/structureClass/children）、`MindMapSheet`、`MindMapDocument`（无 revision） |
| `src/shared/mindmap/mind-map-schema.ts` | 与 v1 类型一一对应的 Zod schema |
| `src/shared/mindmap/xmind-converter.ts` | `.xmind` `content.json` ↔ v1 文档双向转换，未知字段忽略 |
| `src/main/mindmap/mind-map-store.ts` | 工作区 `mindmaps/<id>.json` durable 写（temp+rename），`update` 无条件覆盖、无 revision |
| `src/main/mindmap/mind-map-ipc-commands.ts` | IPC 精确 envelope parser，`updateMindMap` 无 `expectedRevision` |
| `src/main/mindmap/mind-map-generation.ts` | `generateMindMap` 复用 provider 基建，**无取消信号/无 governor 接线** |
| `src/main/mindmap/xmind-file.ts` | fflate 解压/压缩，仅读 `content.json`，未知 ZIP 条目忽略，无安全预算 |
| `src/renderer/src/views/mindmap/mind-map-view-store.ts` | zustand store，直接 mutate + debounced 异步保存，无 command/undo |
| `src/renderer/src/views/mindmap/MindMapView.tsx` / `MindMapCanvas.tsx` / `MindMapAiPanel.tsx` | 画布、Sheet 标签、AI 面板；`activeSheetIndex` 为局部 state |

## 2. 当前交互缺陷

### 2.1 AI「取消」只改前端状态，未真正取消 provider 请求（P0）

- `MindMapAiPanel.tsx` 的取消按钮执行 `useMindMapViewStore.setState({ generating: false })`，仅隐藏 loading。
- `mind-map-view-store.ts` 的 `generate` 也没有取消意图：`generateMindMap` IPC 无 cancel 通道入参，主进程 `generateMindMap` 未接 `AgentRunResourceGovernor` / cancel 通道（`mind-map-generation.ts` 注释即承认「本切片没有 signal/governor 输入」）。
- `mindMapStreamChunk` / `mindMapStreamStatus` 事件已注册但渲染器**未消费**：`streamText` 在 `generate` 开始时被设为 prompt，后续从不接收 chunk。流式预览当前是「假流式」。
- 影响：用户点「取消」后 provider 请求继续占用资源、可能仍在落盘；与规划 §5.7「取消必须真正传播到主进程/provider，不只是隐藏 loading」冲突。

### 2.2 多 Sheet 操作耦合：命令只看第一张 / 误改全部 Sheet（P0）

- `MindMapView.tsx` 用 `useState(0)` 保存 `activeSheetIndex`，画布只渲染 `document.sheets[safeSheetIndex]`。
- 但 `mind-map-view-store.ts` 的节点命令（`updateNode` / `addChild` / `addSibling` / `toggleCollapse` / `collapseAll` / `expandAll`）都执行 `doc.sheets.map(...)`，即**同时遍历/修改所有 Sheet**，而非仅 active sheet：
  - `deleteNode` 对根节点的占位处理硬编码 `current.sheets[0]?.root`；
  - `collapseAll`/`expandAll` 无条件作用于所有 sheet；
  - 若两个 sheet 存在相同 node id，编辑会跨 sheet 误改。
- 影响：active sheet 未进入命令上下文，Sheet 间状态耦合；与规划 §12「多 Sheet/并发保存丢数据 → active sheet 显式入命令上下文」与 M1 修复项一致。

### 2.3 无 undo/redo（P0）

- 仓库无任何 undo/redo 栈；所有编辑是直接 mutate + debounced 保存，无法撤销。
- 直接影响「连续建图可逆」的产品地板与 M1 退出条件。

### 2.4 无 command reducer / 旁路写入（P0）

- 所有编辑直接改 zustand state 后 `schedulePersist()` 异步保存，未经过统一 command 入口。
- `renameDocument` / `newSheet` / `generate` 各自直接构造 `next` 文档并调 `updateMindMap`，无树 invariant 校验、无 transaction、无 inverse。
- 影响：行为漂移、无法统一 undo/审计，且与规划 §13「所有新交互以统一 command 为入口」冲突。

### 2.5 无 revision / 冲突处理（P0）

- `updateMindMap` payload 无 `expectedRevision`；store `update` 无条件覆盖并只做 `updatedAt` 单调 stamp。
- 多窗口/并发保存时 last-write-wins，静默丢数据；与规划 §6.1「冲突时不做 last-write-wins」冲突。

### 2.6 其他交互缺口（非 P0，延续自 plan §1.1）

- 缩放不以指针为中心；无适应画布/实际大小/框选/导航面板/仅显示分支。
- 文本不参与测量；无稳定增量布局、碰撞处理、手动位置、紧凑布局、布局动画、大图虚拟化。
- 画布交互无键盘优先建图（`Tab`/`Enter` 仅存在于 design 描述，未完整落地为 command）。
- Sheet 无重命名/复制/删除/排序、无每 Sheet 独立视口与样式。

## 3. 导入丢失项清单（静默忽略）

当前 `.xmind` 导入 `readXmindFile → parseXmindZip → xmindContentToDocument`，**所有不支持字段被静默忽略且不报告**。已确认丢失项：

| 类别 | 字段 / 元素 | 现状 |
| --- | --- | --- |
| 标记 | `topic.marker` / markers | 未映射，静默丢失 |
| 标签 | `topic.labels` | 未映射，静默丢失 |
| 链接 | `topic.href` / links | 未映射，静默丢失 |
| 任务状态 | `topic.task` / priority / 待办 | 未映射，静默丢失 |
| 样式 | 节点/线条/主题样式（`styles`、`theme`） | 未映射，静默丢失 |
| 结构元素 | relationship / boundary / summary / callout / freeTopic | 未映射，静默丢失 |
| 附件 | image / attachment / 缩略图 | 未读取、未迁移，静默丢失 |
| 未知字段 | 任意未在 `topicToNode`/`nodeToTopic` 中处理的字段 | 静默忽略（`xmind-converter.ts` 只读 id/title/note/collapsed/structureClass/children.attached） |
| ZIP 条目 | `content.json` 之外的条目 | `parseXmindZip` 容忍并忽略，无 extension bag |
| 导出 | v1 文档中不存在的上述能力 | 导出回 `.xmind` 时同样静默丢失 |

**安全预算缺口**：`xmind-file.ts` 无 ZIP slip / ZIP bomb / 路径穿越 / 条目数 / 解压体积上限；无临时目录 staging + durable commit；无 MIME/扩展名双重校验；兼容性报告完全不存在。

> 注：这些静默忽略行为在 ADR-0172 §3 与 design.md §11 中曾被列为非目标，现由 [ADR-0173](../adr/0173-mind-map-schema-v2-and-revisioned-repository.md) §2.4 正式 supersede——导入/导出必须返回 `preserved / approximated / dropped / warnings` 报告，禁止静默丢字段。

## 4. 建议立即启动的第一个工程切片

按规划 §13 与 §8 M0，建议第一个垂直切片为：

> **schema v2 + revisioned repository + command reducer + undo/redo + Tab/Enter 键盘建图**

该切片同时解决数据模型、保存可靠性、统一命令入口与核心键盘编辑体验，是后续拖拽、样式、结构元素、AI diff 与来源连接的共同地基。切片内必须包含 domain（schema v2 + command/inverse + 迁移）、UI（键盘建图 + undo/redo 入口）、持久化（revision CAS store）与测试闭环，避免只堆按钮。

具体验收（对应 M1 退出条件子集）：

- [ ] v1 → v2 单向迁移可重复、幂等，失败保留原文件；
- [ ] `updateMindMap` 带 `expectedRevision`，冲突返回 `stale` 且不静默覆盖；
- [ ] 所有编辑入口走统一 command reducer，树 invariant 校验通过才落盘；
- [ ] 任意编辑可 undo/redo；批量操作以 transaction 全成或全不成；
- [ ] `Tab` 新增子主题、`Enter` 新增同级主题、`Shift+Tab` 减少缩进可连续使用；
- [ ] 节点/element 命令显式携带 sheet id，仅作用于 active sheet（修复 §2.2）；
- [ ] 切换文档/关闭窗口/导出前强制 flush，携带最新 `expectedRevision`。

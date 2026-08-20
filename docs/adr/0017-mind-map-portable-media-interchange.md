# ADR-0017：思维导图可迁移媒体交换

- **状态：** accepted
- **日期：** 2026-08-19
- **领域：** mindmap / persistence

## 背景

思维导图节点和画布元素可以引用图片，但工作区 canonical JSON 只保存媒体元数据。
直接发送原文件或导出为可编辑 Markdown / OPML 时，若只保存路径，接收方会得到失效引用，且
跨工作区复制还可能发生 asset ID 冲突。

## 决定

- 工作区 `mindmaps/<id>.json` 继续 metadata-only；媒体字节只在 `mindmap-assets/` 由
  `MindMapAssetStore` 物化，不能成为教学权威或第二写入路径。
- 显式 `.sxmind` 导出使用版本化单文件 envelope，内嵌受大小限制的 base64 媒体；导入时
  始终生成新的 asset ID，并重写节点/图片引用。
- Markdown / OPML 保持开放、可编辑正文格式；媒体写入正文旁的 `<file>.assets/` sidecar，
  manifest 保存位置、尺寸、哈希和可恢复的图片布局/节点引用。
- 导入边界拒绝路径穿越、符号链接、非 UTF-8、重复/未知引用及超出文件、媒体数量或字节预算
  的输入；哈希/尺寸校验失败时不发布文档。
- 媒体物化或后续 document persistence 失败时回滚本次写入的媒体和临时导入文档；导出采用
  原子写入，重复无媒体导出以空 manifest 失效旧 sidecar 引用。

## 边界与后果

- 迁移保证的是显式导出/导入，不改变自动同步、教学 Evidence、Outcome 或 LearningSession
  的权威关系。
- Markdown / OPML 的 sidecar 是 StudiumX 扩展；其他编辑器仍可打开正文，但可能忽略媒体元数据。
- 新增交换版本必须显式迁移并保留严格解析、预算和回滚边界。

## 实施锚点

- [Portable envelope](../../src/shared/mindmap/portable.ts)
- [Interchange boundary](../../src/main/mindmap/mind-map-interchange.ts)
- [Asset store](../../src/main/mindmap/mind-map-assets.ts)

# ADR-0016：思维导图 Repository 与 AI 数据边界

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** mindmap

## 背景

思维导图是用户可编辑的独立内容，并支持 AI 辅助生成。多窗口编辑、schema 迁移和 AI 资料读取要求单一 repository、revision 冲突语义与清晰的数据边界。

## 决定

- 原生思维导图文档由主进程 repository 作为单一写入入口；工作区 `mindmaps/<id>.json` 是 canonical 用户内容。
- 更新必须携带 `expectedRevision`，冲突显式返回；repository 负责 schema 校验、可重复迁移与 atomic durable write。
- renderer、导入器与 AI 生成都提交受限 command / document，不直接写文件或绕过 revision。
- AI 生成复用现有 provider、取消、资源与错误边界；输出必须通过 schema 验证，只作为用户草稿。
- 资料 grounding 仅在用户本次请求明确提及受限工作区 Markdown 路径时读取；使用 path fence、symlink 拒绝与字节/文件数上限，正文不进入日志或 canonical 导图。

## 边界与后果

- 思维导图不是 LearningSession、Evidence、Outcome 或 learner-profile authority；AI 结果不产生教学 settlement。
- 不复制第三方专有代码、素材或文件格式；导入导出限于原生或开放边界。
- 不为导图引入默认 telemetry、远程同步、FTS、向量搜索或第二 provider 通道。
- 改变 repository writer、revision 或 AI workspace-reading 边界需要新的 ADR。

## 实施锚点

- [Mind map store](../../src/main/mindmap/mind-map-store.ts)
- [Mind map shared model](../../src/shared/mindmap/)
- [安全边界](../../SECURITY.md)

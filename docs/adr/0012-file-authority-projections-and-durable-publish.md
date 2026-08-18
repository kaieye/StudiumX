# ADR-0012：文件权威、可重建投影与 Durable Publish

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** persistence

## 背景

工作区文件承载教学与用户内容，SQLite 提供查询和聚合。两者若同时可写同一事实，会产生分裂权威；直接覆盖文件又可能在崩溃时留下截断或半发布状态。

## 决定

- 对声明为 file-authoritative 的领域，工作区 durable 文件是 canonical；SQLite、catalog 与搜索视图只保存可重建 projection。
- durable publish 采用同目录临时文件、刷写与原子 rename 的 pathname-first 边界；发布完成前不暴露半写文件。
- canonical 写入成功而 projection 更新失败时，返回可诊断的 partial/reconcile 状态；不得回滚或伪装 canonical 写入失败。
- projection schema、迁移和删除必须能从 canonical 数据重新构建，不能成为唯一副本。
- 不使用 SQLite FTS 或向量库提供面向用户的产品搜索面；重开需要独立 disposable index 与新的 ADR。

## 边界与后果

- 并非所有数据库表都是 projection；每个领域必须明确自己的 authority 与 writer。
- durable publish 降低部分写入风险，但不宣称跨多个文件或数据库的全局事务。
- 数据库 PR 流程与验证清单由 [CONTRIBUTING](../../CONTRIBUTING.md) 维护，不进入 ADR。
- 改变某领域的 canonical store 或引入双写权威需要新的 ADR。

## 实施锚点

- [Durable file publisher](../../src/main/persistence/durable-file.ts)
- [贡献与数据库门禁](../../CONTRIBUTING.md)
- [安全边界](../../SECURITY.md)

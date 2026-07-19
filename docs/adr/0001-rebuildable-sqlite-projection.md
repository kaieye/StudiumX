# ADR-0001：将 SQLite 限定为可重建的本地数据投影

- **状态：** 已实施
- **范围：** C-1
- **证据提交：** `d9de382` (`feat(data): add rebuildable SQLite analytics index`)

## 决定

引入 `studiumx-index.sqlite` 作为本地分析与查询的 **可重建 projection**，而不是业务事实来源。索引记录 source checksum / migration 状态；当索引缺失、损坏、schema 不支持或发现 source drift 时，可以隔离或重建索引，业务读取回退到 canonical JSON、JSONL 和 Markdown。

## 已落地范围与验证入口

提交 `d9de382` 新增 `src/main/local-data-index/` 的 index 与 schema migration，实现启动接入和分析侧的可选 adapter / 文件扫描回退。验证代码位于 `tests/unit/local-data-index.unit.test.ts` 与 `tests/integration/teaching-analytics.integration.test.ts`，覆盖 migration、损坏隔离、source drift 和回退读取等场景。

## 不包含

- SQLite 不替代详情读取、canonical 文件写入或提交成功依据。
- FTS、全文查询面、隐私授权和额外数据暴露均未实施；见[本地数据待办](../local-data-todo.md)。

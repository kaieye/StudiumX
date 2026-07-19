# ADR-0001：将 SQLite 限定为可重建的本地数据投影

- **状态：** 已实施；no-FTS 政策已采纳
- **范围：** C-1 可重建 SQLite analytics projection 及其 no-FTS 边界
- **证据提交：** `d9de382` (`feat(data): add rebuildable SQLite analytics index`)

## 决定

引入 `studiumx-index.sqlite` 作为本地分析的 **可重建 projection**，而不是业务事实来源。索引记录 source checksum / migration 状态；当索引缺失、损坏、schema 不支持或发现 source drift 时，可以隔离或重建索引，业务读取回退到 canonical JSON、JSONL 和 Markdown。

同时采纳 **no-FTS** 政策：C-1 不授权任何查询或搜索功能。现有 SQLite projection 只可用于既有 analytics 的可选读取 adapter，不能转化为 searchable/query-facing corpus、用户可见搜索或查询结果来源。

## 已落地范围与验证入口

提交 `d9de382` 新增 `src/main/local-data-index/` 的 index 与 schema migration，实现启动接入和分析侧的可选 adapter / 文件扫描回退。验证代码位于 `tests/unit/local-data-index.unit.test.ts` 与 `tests/integration/teaching-analytics.integration.test.ts`，覆盖 migration、损坏隔离、source drift 和回退读取等场景。

## no-FTS 边界

以下能力**未实施且未获授权**：

- FTS、全文检索、用户可见搜索、跨域检索，以及任何 C-1 query feature；
- metadata aggregate preview 或其他 metadata 查询预览；
- 新的 query API、IPC、preload API、renderer route 或查询 UI；
- 为搜索而新增、复制或转换的 searchable/query-facing corpus，或为此修改 canonical schema、文件布局或写入时序。

不得把下列数据或能够还原它们的派生文本纳入 FTS/query 语料、tokenisation 或 query-facing projection：prompt、会话 turn content、tool payload、secret、provider/request identifier、file path、raw Memory content。UI、API、错误、日志和 audit 也不得因查询返回或记录 snippet、highlight、relevance score、path、canonical identifier、content 或 checksum/hash；不得扩展 audit/ledger/provenance 以记录查询原文、结果详情或敏感 locator。

canonical JSON、Markdown、JSONL/segments、Memory records、immutable record 及其既有读取语义仍是事实来源。SQLite projection、summary projection 和 analytics aggregate 均为可丢弃、可隔离并从 canonical source 重建的派生数据；它们不得成为可见性或授权裁决、详情读取、留存、删除或脱敏的依据。

## 重新开启条件

本决定关闭原 C-1 FTS/query design gate；它不是待办，也不表示任何查询实现已经完成。只有新的产品/隐私提案同时提供**经验证的用户任务**，并先完成**狭窄、metadata-first 的审查**，才可重新讨论此方向。该审查必须从最小、受控、非内容 metadata 开始；不得默认采纳自由文本 tag、敏感内容或任何查询/API/IPC 实现。审查或提案本身不构成实现授权。

## 不包含

- SQLite 不替代详情读取、canonical 文件写入或提交成功依据。
- 现有 projection 的 currentness、canonical fallback、schema migration、source fingerprint 和损坏隔离仍仅服务于可重建 analytics 边界，不代表搜索能力已经实现。

# ADR-0007：新持久化用户历史必须先经脱敏

- **状态：** 已实施
- **范围：** C-7
- **证据提交：** `a302814` (`feat(data): redact persisted user input history`)

## 决定

所有新的 conversation / history projection 在持久化前经过 typed sanitizer：仅含 secret 的内容不写入，混合自然语言会脱敏，并保留 sanitized parent proof。archive、history 与 SQLite index consumer 复用该安全边界。

## 已落地范围与验证入口

`a302814` 引入 `src/shared/agent-persisted-history.ts` 的 sanitizer，并接入 `src/main/agent-conversation-archive.ts`、`src/main/agent-conversation-history.ts` 与 `src/main/local-data-index/index.ts`。验证入口包括 `tests/unit/agent-persisted-history.unit.test.ts`、`tests/unit/agent-secret-redaction.unit.test.ts` 和 `tests/unit/agent-conversation-legacy-nonmutating.unit.test.ts`。

## 不包含

不会新增独立 raw history JSONL，也不会扫描、删除或重写已有 raw artifact。历史敏感数据的清理或处置需要独立安全流程。

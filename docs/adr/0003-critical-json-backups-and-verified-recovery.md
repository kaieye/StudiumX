# ADR-0003：关键 JSON 使用 `.bak` 备份与已验证恢复

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** 对 settings、workspace registry 与 workspace index 等关键 JSON，在 durable replace 路径维护 `.bak` 并在读取时进行 verified recovery。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0004](0004-shared-durable-publish-and-partial-consumer-migration.md)
- **证据：** `src/main/persistence/durable-file.ts`、`tests/unit/durable-file.unit.test.ts`、`tests/unit/teaching-durable-state.unit.test.ts`、`tests/unit/teaching-memory-catalog.unit.test.ts`；提交 `ca73537`

## 决定

对 settings、workspace registry 和 workspace index 等关键 JSON，在 durable replace 路径中维护 `.bak`，读取时进行 verified recovery。恢复只在 canonical 文件不可读或不满足验证条件时参与；可读 canonical 文件不会被静默覆盖，`.bak` 也不成为唯一事实副本。

## 已落地范围与验证入口

`ca73537` 在 `src/main/persistence/durable-file.ts`、settings、workspace 和 Memory record 相关写入路径接入该语义。验证入口包括 `tests/unit/durable-file.unit.test.ts`、`tests/unit/teaching-durable-state.unit.test.ts` 和 `tests/unit/teaching-memory-catalog.unit.test.ts`。

## 不包含

该决定不建立通用历史版本系统，不改变 canonical schema，也不授权以回滚或备份处理其他类别的事实文件。

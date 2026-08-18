# ADR-0033：Teaching Config 乐观并发（expectedFingerprint CAS）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** 配置写路径以 `write(expectedFingerprint, next)` 做比较并投影；冲突时不 apply，secret path patch 拒绝。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0025](0025-teaching-config-resolver-secret-free-layers.md)、[ADR-0032](0032-conservative-parallel-read-tools.md)
- **证据：** `src/shared/teaching-types/config-optimistic-write.ts`、`src/main/config-optimistic-writer.ts`、`scripts/check-config-optimistic-concurrency.mjs`、`tests/unit/config-optimistic-writer.unit.test.ts`；提交 `e39313a`、merge `fe648a9`

## 决定

配置写路径采用乐观并发：调用方提交 `expectedFingerprint`（来自 `fingerprintTeachingConfig` / `ResolvedTeachingConfig.fingerprint`）与 next overlay。

纯核 `compareAndProjectConfigWrite`：

- fingerprint 不匹配 → `fingerprint_mismatch`，**不** apply
- 匹配 → 将 next 合入指定 layer 后 re-resolve，返回新 fingerprint
- 可检测的 secret path patch → 拒绝

可选 `ConfigOptimisticStore` 适配器描述 read + writeAtomic 边界；不在本 ADR 中改写全部 settings UI。

## 已实施范围与验证入口

- `src/shared/teaching-types/config-optimistic-write.ts`
- `src/main/config-optimistic-writer.ts`
- `scripts/check-config-optimistic-concurrency.mjs`

```powershell
pnpm run check:config-optimistic-concurrency
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/config-optimistic-writer.unit.test.ts
```

## 不变量

- 冲突必须对调用方可见，禁止静默覆盖。
- fingerprint 表面 secret-free（继承 ADR-0025）。
- 不得把 apiKey 等 secret 写入 resolved snapshot / fingerprint 材料。

## 不包含

- 不实现完整文件 watcher daemon。
- 不改变 secret 加密存储机制。
- 不授权跨进程 multi-writer 事务。

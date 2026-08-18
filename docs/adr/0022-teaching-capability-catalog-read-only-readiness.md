# ADR-0022：TeachingCapabilityCatalog 只读就绪快照

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-20
- **范围：** `TeachingCapabilityCatalog.snapshot()` 从既有 registry / settings 派生可用性的只读就绪投影（available/disabled/unconfigured/denied/degraded）。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0013](0013-budgeted-provenance-aware-teaching-context.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0046](0046-teaching-footprint-ladder.md)
- **证据：** `src/main/teaching-capability-catalog.ts`、`scripts/check-teaching-capability-catalog.mjs`、`tests/unit/teaching-capability-catalog.unit.test.ts`；提交 `262c2b9`、merge `cd33836`

## 决定

`TeachingCapabilityCatalog.snapshot()` 从既有 registry / settings 派生只读就绪视图。每项状态为 available | disabled | unconfigured | denied | degraded，并带原因与 freshness。Planner / context 装配只应消费 promptEligible / available 能力；disabled 与 unconfigured 不得进入 prompt。

Catalog 是投影而非第二执行授权面：执行前仍由 effect policy / 既有 capability policy 复核。TTL 缓存；探测失败降级为 degraded，不抛垮教学闭环。

## 已实施范围与验证入口

- `src/main/teaching-capability-catalog.ts`
- `scripts/check-teaching-capability-catalog.mjs`

```powershell
pnpm run check:teaching-capability-catalog
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-capability-catalog.unit.test.ts
```

## 不变量

- Catalog 不写 provider 密钥，不建立第二 skill/provider registry。
- 失败可降级；不得用过期 available 掩盖真实 unconfigured。
- prompt 注入必须以 catalog 就绪与执行策略双重门禁为准。

## 不包含

- 不授权第二 LLM provider 产品路径或通用 skill marketplace。
- 不把 catalog 状态当作 tool dispatch 的唯一授权。
- 不替换 settings secret storage 边界（见既有 settings checks）。

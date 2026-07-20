# ADR-0022：TeachingCapabilityCatalog 只读就绪快照

- **状态：** 已实施（P1-5；合入 main `cd33836` / feature `262c2b9`）
- **范围：** provider / search / skill 等能力的 readiness 只读投影
- **证据提交：** `262c2b9`、merge `cd33836`

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

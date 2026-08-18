# ADR-0013：按可信来源和预算装配教学上下文与资源 grounding

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-19
- **范围：** `TeachingContextAssembler` / `ResourceGrounder` 装配有来源、受预算限制的 typed context；隐私安全 `ContextProjectionReport` 与 multi-adapter grounding。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0012](0012-deterministic-next-teaching-step-planner.md)、[ADR-0014](0014-learner-safe-teaching-turn-presentation.md)、[ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md)
- **证据：** `tests/unit/teaching-context-assembler.unit.test.ts`、`tests/unit/context-projection-report.unit.test.ts`、`tests/unit/resource-grounder-deepen.unit.test.ts`；提交 `0f4caa9`、`d4fe782`、`3966e0d`、`2a00286`、`768d7d6`、`7c83525`

## 决定

教学 prompt / turn 所需上下文由 `TeachingContextAssembler` 装配为有来源、受预算限制的 typed context。资源选择由 `ResourceGrounder` 生成明确 grounding 或 `resource_gap`；不得把任意工作区文本、provider payload 或隐式检索结果拼入 prompt 后再声称其可信。

ContextAssembler 只消费允许的描述符和事实 projection，并对条目、字节或 token 预算进行确定性截断。每个可用资源保留 provenance；缺失、超限或不可信资源以显式 exclusion / gap 表达，而不是静默回退到无来源内容。

### P1-6：Context ProjectionReport

装配与 request-context 投影必须产出隐私安全的 `ContextProjectionReport`：记录 included / omitted / truncation / budget / provenance 与确定性 fingerprint。**报告永不携带** raw prompt 文本、learner answers、provider payloads 或完整绝对路径。Fingerprint 由 redacted 事实派生（sha256），不得由 raw prompt 派生。

### P1-8：Multi-adapter ResourceGrounder

统一 `GroundingSourceAdapter` 缝：workspace adapter 标记 `trust: trusted_workspace` 并带 digest / useFor / freshness；external URL/search 薄包装标记 `external_untrusted`，仅包装调用方已提供的内容，**不 fetch、不写入 workspace**。跨 adapter 确定性 merge 与 dedupe；dead-ref / unsafe URL 变为 typed exclusion。

## 已实施范围与验证入口

`0f4caa9` 引入 assembler、grounder 与 shared context/grounding types，`d4fe782` 合入主线。P1-6/P1-8 在既有缝上加深报告与 multi-adapter，不依赖将所有 App 入口切换到同一编排器。

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-context-assembler.unit.test.ts
pnpm exec vitest run --project integration tests/integration/teaching-context-assembler.integration.test.ts
node scripts/check-teaching-context-assembler.mjs
node scripts/check-teaching-resource-grounding.mjs
pnpm run check:context-projection-report
pnpm run check:resource-grounder
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/context-projection-report.unit.test.ts tests/unit/resource-grounder-deepen.unit.test.ts
```

## 不变量

- context 中的每项教学事实和资源都有可检查 provenance，且必须来自 allowlist。
- 预算截断不会改变 canonical outcome / Evidence，也不会以省略内容伪造完整 grounding。
- 不存在合格资源时返回 `resource_gap` 或显式 exclusion，而非发明来源。
- ProjectionReport 与 GroundingPack 均不得含 learner / assessment / transcript / provider payload。
- External adapters 不写 workspace、不以隐式网络检索替代 trusted_workspace 来源。
- 装配器不拥有 Learning record writer、工具 effect 或 UI 乐观状态。

## 不包含

- 本 ADR 不授权向量库、第二 provider、复杂 RAG、MCP 或隐式网络检索产品路径。
- 本 ADR 不定义能力 catalog（见 ADR-0022）或完整资源推荐系统。
- 本 ADR 不替代 outcome settlement、planner 或 learner presentation 的领域边界。
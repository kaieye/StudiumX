# ADR-0013：按可信来源和预算装配教学上下文与资源 grounding

- **状态：** 已实施（最小 ContextAssembler / ResourceGrounder 与定向自动化；不代表 P1 深化完成）
- **范围：** `TeachingContextAssembler`、最小 `ResourceGrounder`、trusted descriptor、provenance allowlist、预算与 resource-gap
- **证据提交：** `0f4caa9`、`d4fe782`

## 决定

教学 prompt / turn 所需上下文由 `TeachingContextAssembler` 装配为有来源、受预算限制的 typed context。资源选择由最小 `ResourceGrounder` 生成明确 grounding 或 `resource_gap`；不得把任意工作区文本、provider payload 或隐式检索结果拼入 prompt 后再声称其可信。

ContextAssembler 只消费允许的描述符和事实 projection，并对条目、字节或 token 预算进行确定性截断。每个可用资源保留 provenance；缺失、超限或不可信资源以显式 exclusion / gap 表达，而不是静默回退到无来源内容。

## 已实施范围与验证入口

`0f4caa9` 引入 assembler、grounder 与 shared context/grounding types，`d4fe782` 合入主线。当前模块可由 coordinator/测试装配消费；该实施不依赖将所有 App 入口切换到同一编排器。

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-context-assembler.unit.test.ts
pnpm exec vitest run --project integration tests/integration/teaching-context-assembler.integration.test.ts
node scripts/check-teaching-context-assembler.mjs
node scripts/check-teaching-resource-grounding.mjs
```

## 不变量

- context 中的每项教学事实和资源都有可检查 provenance，且必须来自 allowlist。
- 预算截断不会改变 canonical outcome / Evidence，也不会以省略内容伪造完整 grounding。
- 不存在合格资源时返回 `resource_gap` 或显式 exclusion，而非发明来源。
- 装配器不拥有 Learning record writer、工具 effect 或 UI 乐观状态。

## 不包含

- 本 ADR 不授权向量库、第二 provider、复杂 RAG、MCP 或隐式网络检索。
- 本 ADR 不定义 P1 的 Context Projection Report、能力 catalog 或完整资源推荐系统。
- 本 ADR 不替代 outcome settlement、planner 或 learner presentation 的领域边界。

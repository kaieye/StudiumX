# ADR-0015：使用封闭的 Canonical Teaching Event Protocol 传递教学运行事件

- **状态：** 已实施（协议、event bus 与定向自动化；不代表 P1 runtime / CI 全部完成）
- **范围：** `TeachingEventEnvelope`、schema version 1、封闭 payload、event bus、legacy adapter 边界
- **证据提交：** `cef8f86`、`fbc0b63`、`5f5cd32`

## 决定

教学运行事件通过版本化、封闭的 `TeachingEventEnvelope` 传递，而不是复用未受约束的 Agent 文本消息或 renderer 私有状态。每个 event 具有明确 identity、类型、payload 与 durability 语义；未知类型或不符合 schema 的 payload 必须被拒绝，而不是作为兼容性 fallback 静默解释。

协议与 learner presentation 分离：事件表达运行时事实，presentation 决定学习者如何安全地看到这些事实。legacy 输入只能经显式 adapter 映射到 canonical event，不能成为第二份 canonical protocol。

## 已实施范围与验证入口

`cef8f86` 引入 canonical teaching events / event bus，`fbc0b63` 及其后的 authority hardening 收紧协议。coordinator 等消费方可以依赖该协议，但本 ADR 不把当前 coordinator 的生产接线或 blocking CI 作为已完成范围。

```powershell
pnpm exec vitest run --project unit tests/unit/teaching-events.unit.test.ts tests/unit/teaching-turn-event-bus.unit.test.ts
pnpm exec vitest run --project integration tests/integration/teaching-event-protocol-core.integration.test.ts
```

## 不变量

- schemaVersion、event identity 和 payload kind 是协议的一部分；未知或错配输入保守失败。
- event replay / transport 不改变 canonical Evidence、Outcome 或 Learning record 的 authority。
- legacy adapter 只能单向映射受支持的旧形态，不能扩张 canonical payload。
- 事件总线不拥有 presentation redaction、effect policy 或 durable domain writer。

## 不包含

- 本 ADR 不实现计划中的 Typed Tool Dispatcher、显式 Agent run 状态机或 effect policy。
- 本 ADR 不声称存在计划点名的 `check-teaching-event-replay.mjs`；当前回放语义由 event-bus 自动化覆盖。
- 本 ADR 不声明 `TeachingTurnCoordinator` 已成为默认生产编排路径，亦不声明 blocking CI 已配置。

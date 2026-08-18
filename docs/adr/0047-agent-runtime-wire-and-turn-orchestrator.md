# ADR-0047：Agent runtime wire and teaching-turn orchestrator

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** 封闭集合 `AgentRuntimeEvent` wire model 与纯 `AgentRuntimeStatus` 聚合构建器，以及注入式 `TeachingTurnOrchestrator` 的可见/合成 turn 编排。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0015](0015-canonical-teaching-event-protocol.md)、[ADR-0021](0021-agent-run-state-machine-separate-from-session.md)、[ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)
- **证据：** `src/shared/protocol/agent-runtime-wire.ts`、`src/main/ai/agent-runtime-status.ts`、`src/main/ai/teaching-turn-orchestrator.ts`、`tests/unit/teaching-turn-orchestrator.unit.test.ts`、`tests/unit/agent-runtime-status.unit.test.ts`

## Decision
Add a closed-set `AgentRuntimeEvent` wire model and a pure `AgentRuntimeStatus` aggregation builder. Add `TeachingTurnOrchestrator` as a thin, injectable sequence of build-context → agent-loop → finalize hooks for visible and synthetic turns.

## Non-claims and invariants
- `TeachingEvent*` remains the stronger teaching protocol and is independent of runtime events.
- The orchestrator does not write ledger outcomes or settle evidence; `TeachingTurnCoordinator` remains the sole writer.
- Synthetic turns can alter/skip presentation work, but capability checks, effects, and human approval are still enforced by the supplied hooks.
- Runtime wire serialization is transport-only and carries no durability or authority semantics.

## Integration points
Wire events may be emitted by `AgentEventBus`/IPC adapters without replacing the existing `AgentRealtimeEvent` contract. Consumers can adopt the serializer incrementally. Inject `TeachingTurnCoordinator`-backed finalization when integrating the orchestrator.

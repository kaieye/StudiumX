# ADR-0043: Agent runtime wire and teaching-turn orchestrator

## Decision
Add a closed-set `AgentRuntimeEvent` wire model and a pure `AgentRuntimeStatus` aggregation builder. Add `TeachingTurnOrchestrator` as a thin, injectable sequence of build-context → agent-loop → finalize hooks for visible and synthetic turns.

## Non-claims and invariants
- `TeachingEvent*` remains the stronger teaching protocol and is independent of runtime events.
- The orchestrator does not write ledger outcomes or settle evidence; `TeachingTurnCoordinator` remains the sole writer.
- Synthetic turns can alter/skip presentation work, but capability checks, effects, and human approval are still enforced by the supplied hooks.
- Runtime wire serialization is transport-only and carries no durability or authority semantics.

## Integration points
Wire events may be emitted by `AgentEventBus`/IPC adapters without replacing the existing `AgentRealtimeEvent` contract. Consumers can adopt the serializer incrementally. Inject `TeachingTurnCoordinator`-backed finalization when integrating the orchestrator.

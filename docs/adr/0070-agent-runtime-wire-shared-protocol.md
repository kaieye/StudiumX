# ADR-0070：Agent runtime wire 迁入 shared/protocol

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施
- **日期：** 2026-07-21
- **范围：** ADOPTION S-01（Phase 2 main structure）— 将纯 transport/wire 类型与序列化从 `src/main/ai` 迁到 `src/shared/protocol/*`，main 路径仅兼容 re-export
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0047](0047-agent-runtime-wire-and-turn-orchestrator.md)、[ADOPTION S-01](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/protocol/agent-runtime-wire.ts`（canonical types + pure serializers）
  - `src/shared/protocol/index.ts`（protocol 公共 re-export 面）
  - `src/main/ai/agent-runtime-wire.ts`（兼容 re-export only）
  - `tests/unit/agent-runtime-wire.unit.test.ts`（从 shared/protocol 导入）

## 背景

ADR-0047 落地了 closed-set `AgentRuntimeEvent` wire 与纯序列化，但实现落在 `src/main/ai/agent-runtime-wire.ts`。Phase 2 结构线（S-01）要求 transport/wire 类型有独立 home，避免 renderer / 共享层误依赖 main 实现路径，并为后续协议类型集中提供目录约定。

模块本身无业务逻辑：闭集 kind、JSON clone 序列化、shape 校验；无 Electron、无 FS、无 settlement 导入。

## 决策

1. **Canonical home：** `src/shared/protocol/agent-runtime-wire.ts` 持有 `AgentRuntimeEventKind` / `AgentRuntimeEvent` / `AgentRuntimeEventInput` 与 `agentRuntimeEventToWire` / `agentRuntimeEventFromWire`（及既有 alias）。
2. **Public surface：** `src/shared/protocol/index.ts` re-export 上述符号，作为 protocol 入口。
3. **兼容层：** `src/main/ai/agent-runtime-wire.ts` 仅 `export * from '../../shared/protocol/agent-runtime-wire'`，不破坏既有 main 路径 import。
4. **测试：** unit 优先从 `src/shared/protocol` 导入；main re-export 路径仍应可解析。

## 不变量 / Non-claims

- **Settlement 不进 protocol：** learning-session ledger、outcome settlement、`TeachingTurnCoordinator` sole-writer 路径与类型 **不** 迁入 `src/shared/protocol`。
- **非 TeachingEvent 大迁移：** 不把 `teaching-events.ts` / IPC 合同 bulk 搬进 protocol；本切片仅 agent-runtime-wire。
- **非 monorepo package split：** 不新建 workspace package；仍是 repo 内 `src/shared/protocol/*` 目录约定。
- Runtime wire 仍为 **transport-only**：无 durability / authority 语义（延续 ADR-0047）。
- Renderer 仍不得 deep-import main 实现；shared/protocol 是合法共享边界。
- 无 YOLO / shell marketplace / 默认远程 telemetry 变化。

## 验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/agent-runtime-wire.unit.test.ts
```

## Residual

- `TeachingEvent*` / 大块 IPC contract 仍在既有 shared 或 main 路径；是否逐步迁入 `src/shared/protocol/*` 为可选后续 residual，须独立 ADR。
- 生产路径若仍仅从 main re-export 导入，可逐步改为 `src/shared/protocol`；兼容 re-export 保留至无消费者。

## ADOPTION 措辞建议（勿直接改 ADOPTION.md）

- S-01：agent-runtime-wire → `src/shared/protocol/*` + main 兼容 re-export + ADR-0070 → **本切片完成**
- TeachingEvent / full IPC mass-move → **未做**（residual，非本切片）

# ADR-0040：TeachingSessionProtocol 进程内会话门面

- **状态：** 已实施（ZCode 借鉴 Phase A）
- **范围：** 稳定内部会话协议 create/resume/send/cancel/compact/fork/steer/checkpoint/usage
- **证据路径：** `src/shared/teaching-types/teaching-session-protocol.ts`、`src/main/ai/teaching-session-runtime.ts`

## 决定

引入 **TeachingSessionProtocol** 作为教学 agent 会话的稳定内部契约，并用进程内 facade（`createTeachingSessionRuntime`）适配既有 conversation + agent-run 机制。

这是 **in-process boundary**，不是远程 RPC、不是第二 agent 产品面、也不授权 main/host/runtime 物理拆进程。Renderer 仍可使用细粒度 `teach:*` IPC；新调用方应优先依赖协议方法集。

可选能力（compact / fork / steer / checkpoint）在 host 未接线时返回明确的 not-wired 结果或抛错，避免把 stub 伪装成成功。

## 已实施范围与验证入口

- `src/shared/teaching-types/teaching-session-protocol.ts`
- `src/main/ai/teaching-session-runtime.ts`
- `tests/unit/teaching-session-protocol.unit.test.ts`

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-session-protocol.unit.test.ts
```

## 不变量

- protocolVersion = 1；create/send/cancel/usage 必须可被 host 实现。
- facade 不得另起一套 agent loop 或绕过 AgentRunStore / conversation runtime。
- steer/compact 未接线时不得回报成功执行。

## 不包含

- 不授权 SSH/Docker/WSL 远程会话矩阵。
- 不把协议直接暴露为无鉴权网络 RPC。
- 不替换 LearningSession ledger / outcome settlement 权威。

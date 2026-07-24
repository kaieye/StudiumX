# ADR-0144：Ask 权威截止时间戳与超时落定

- **状态：** **已实施**（2026-07-23；Phase A item 2 — Ask deadline）
- **日期：** 2026-07-23
- **范围：** `ask` 工具与 `ask-pending` 的权威 deadline、超时结算、UI 同源倒计时；**不**扩展到 write / privileged / turn-review 自动批准
- **相关：** `docs/improvements/liveagent-worth-learning.md` §2.2、`docs/tools/TOOL_CONTRACT.md`（`ask`）、`AGENTS.md` 产品地板、effect lattice

## 1. 决策

1. **权威 deadline：** Host 在 ask 参数信封上盖 **`__deadlineAt`**（ISO-8601）。同一 pending ask 在 main / renderer / 重连表面共享该戳；**有效已有戳不得被替换**（单调权威）。
2. **默认窗口：** 未注入 `timeoutMs` 时默认 **5 分钟**（`DEFAULT_ASK_TIMEOUT_MS`），并夹在安全上下限内。
3. **超时落定：** 仅结算 **ask** 答案 → 每题 **recommended 选项**；若无标记，则 **第一项**（解析时亦将第一项规范为 recommended）。
4. **取消：** 用户取消 / stream abort → **reject / Abort**，不伪造选择。
5. **红线：** 超时 **禁止** 自动放行 `workspace_write` / `external_write` / `privileged` / turn-review（纯策略 `askTimeoutMayAutoApprove` + 无写入审批路径挂接）。
6. **UI：** 参数完整（含 questions + 有效 deadline）后 Ask 卡片展示剩余时间；deadline 缺失时不倒计时，不阻断答题。

## 2. 落点

| 层 | 模块 |
| --- | --- |
| 纯策略 | `src/shared/ask-deadline.ts` |
| Pending + 定时器 | `src/main/ai/ask-pending.ts` |
| 工具 handler 盖戳 / 再发布 | `src/main/ai/tools/ask.ts`、`teaching-conversation-runtime.ts` `publishWaiting` |
| 类型 | `AskOption.recommended`；`PendingAsk.deadlineAt` |
| Renderer | `parseAskToolCall` / AskCard 倒计时 |

## 3. 明确不声明

- 不超时自动批准任何写 / privileged / turn-review 门禁
- 不引入 YOLO / always-approve
- 不把 deadline 当 teaching evidence SoT
- 不实现 file ledger / compaction / files-touched UI

## 4. 验收

- 单测：deadline 权威/单调、超时 → recommended/first、cancel → abort、`askTimeoutMayAutoApprove` 仅 `ask`
- UI：完整参数时可见剩余时间

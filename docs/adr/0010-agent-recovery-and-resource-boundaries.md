# ADR-0010：Agent 恢复与资源边界

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** agent-recovery

## 背景

Provider 错误、上下文溢出、超时和本地资源压力需要一致的恢复语义。若重试自动重复 effect，或把本地限制伪装成 provider quota / 学习成功，会破坏可审计性与用户控制。

## 决定

- provider 错误映射为稳定、可诊断的分类；仅明确可重试且未产生不可重复 effect 的失败允许受控重试。
- 上下文压力优先通过压缩、续接与用户可取消的运行处理；恢复保留 run/turn identity 与已确认的 tool outcome。
- recovery 不自动重放工具、外部写入或 settlement；fork 持续标记 `toolsReplayed: false`。
- 模型上下文上限、工具超时和工具输出截断是局部技术边界；部署 emergency fuse 或用户显式预算必须可审计且保持高位。
- 资源边界触发只报告 `resource_limit` 或 `suspended` 等真实状态，不冒充 provider quota、正常完成或学习成功。

## 边界与后果

- retry、continuation 与 resume 不能绕过 approval、effect policy 或 settlement sole-writer。
- 不引入不透明、低位、默认的累计 token、调用次数、迭代次数或运行时长配额。
- 对不可判定是否产生 effect 的失败采取保守停止与显式恢复。
- 改变自动重试或资源中止语义需要新的 ADR。

## 实施锚点

- [Provider recovery taxonomy](../../src/shared/provider-recovery.ts)
- [Agent run resource policy](../../src/main/ai/agent-run-resource-policy.ts)
- [Agent recovery 检查](../../scripts/check-agent-run-recovery.mjs)

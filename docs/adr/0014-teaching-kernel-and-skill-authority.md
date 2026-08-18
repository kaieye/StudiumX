# ADR-0014：Teaching Kernel 与 Skill 权威边界

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** teaching-kernel

## 背景

内置 Teaching Kernel 提供稳定教学语义，Skill 提供可组合的方法与资源。若 Skill 能改写核心规则、直接提交教学事实或静默自创建，就会形成不可审计的第二教学系统。

## 决定

- Teaching Kernel 定义不可由 Skill 覆盖的教学协议、Evidence 与 settlement 边界；Skill 只能在显式 capability 内提供方法、模板和受限资源。
- Skill manifest、来源与版本必须可识别；加载失败或不兼容时显式不可用，不伪装为 kernel 能力。
- Skill 调用沿用 Agent run、tool effect、approval、上下文与取消边界，不建立独立执行器或写入通道。
- Skill 输出是建议或工具输入，不是 Evidence、Outcome、learner profile 或 durable teaching fact。
- 不自动创建、安装或修改 Skill；涉及用户内容或持久化的变化必须由用户明确发起。

## 边界与后果

- 复习调度、题型和 UI continuity 属于产品实现，不由本 ADR 固化。
- Kernel 可演进，但不能通过 Skill 配置绕过 teaching authority 与 settlement sole-writer。
- 第三方 Skill 资源按不可信内容处理，并受 scope 与大小限制。
- 改变 Kernel/Skill 权威方向或允许 Skill 写教学事实需要新的 ADR。

## 实施锚点

- [Core teaching kernel](../../src/main/skill-library/core-teaching-kernel.ts)
- [Skill library](../../src/main/skill-library/)
- [安全边界](../../SECURITY.md)

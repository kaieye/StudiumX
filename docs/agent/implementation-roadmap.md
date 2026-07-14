# Agent 能力实施路线图

本文只列尚未完成的工作。阶段完成并通过验证后，直接删除对应章节；实现记录和提交信息由 Git 历史保存。

## Phase 10：SDK/provider hooks

状态：未开始。

目标：为不同 provider/SDK 提供统一、可测试的运行 hook，而不把 provider 特例散落到 agent loop 和 UI。

范围：

- 定义请求开始、首 token、usage、retry、rate limit、provider stop reason、取消和错误的规范化 hook。
- 把 hook 输出接入预算、诊断和 durable lifecycle；缺失 usage 时保持明确的 unknown 语义。
- provider 特有 metadata 必须经过大小限制、隐私过滤和兼容性归一化。
- 使用 fake provider/SDK 覆盖乱序、重复回调、取消竞争、部分 usage 和重试场景。

验收：

- agent loop 只依赖稳定 hook contract，不读取 SDK 私有对象。
- 相同事件重复到达不会重复计费、重复结束 run 或破坏 transcript。
- UI 与审计层能区分本地估算、provider 报告值和未知值。

## 跨阶段风险

- provider metadata 可能扩大敏感信息落盘范围，redaction 需要先于持久化。
- 新增 provider 持久化格式需要版本、上限、完整性校验和迁移策略。

## 推荐顺序

1. Phase 10 可按 provider 需求独立切片，但不得绕过既有持久化和预算接口。

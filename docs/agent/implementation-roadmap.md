# Agent 能力实施路线图

本文只列尚未完成的工作。阶段完成并通过验证后，直接删除对应章节；实现记录和提交信息由 Git 历史保存。

## Phase 9：Session tree 与分支生命周期

状态：未开始。

目标：把当前线性 conversation 历史扩展为可解释的 session tree，支持 branch / fork / replay / open。

范围：

- 定义 session、branch、head、fork point、replay source 和 open state 的稳定标识与关系。
- 明确 fork 后共享历史与新增 turn 的存储方式，避免复制大型 artifact。
- replay 默认只重建输入和审计上下文，不自动重放有副作用的工具。
- branch 删除、归档、恢复和并发写入遵守引用完整性与权限边界。
- UI 能选择和打开 branch，并清楚区分原始 turn、replay 结果和恢复提示。

验收：

- 从任意允许的历史点 fork 后，原 branch 保持不变，新 branch 有独立 head。
- replay 不会静默执行写工具，也不会把 archived retrieval 当作原始用户输入。
- session tree 在重启、索引重建和 artifact 清理后仍保持引用一致。

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

- session tree 引入 branch、head 和 replay source 后，必须明确它们与既有 conversation、checkpoint 和索引的权威性及重建方向。
- replay 和恢复可能触碰有副作用的工具结果，默认必须停在人工确认边界。
- provider metadata 可能扩大敏感信息落盘范围，redaction 需要先于持久化。
- 新增 branch 或 provider 持久化格式都需要版本、上限、完整性校验和迁移策略。

## 推荐顺序

1. 先完成 Phase 9 的 session tree 与分支生命周期。
2. Phase 10 可按 provider 需求独立切片，但不得绕过既有持久化和预算接口。

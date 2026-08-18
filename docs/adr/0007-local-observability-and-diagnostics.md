# ADR-0007：本地可观测性、诊断与脱敏

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** observability

## 背景

运行诊断需要跨事件、usage 与 crash 信息定位问题，但可观测数据不能成为第二教学账本，也不能默认把学习内容或凭据上传到远端。

## 决定

- `UsageLedger` 是 usage observability 的 canonical 本地记录；SQLite usage 表与聚合视图是可重建 projection。
- Doctor 与 workspace inspector 是只读诊断面，不修复、不写配置，也不执行工具。
- 日志、trace、usage 与 crash 元数据使用 allowlist 和稳定 correlation；不得包含 secret/token、raw reasoning、完整 learner content 或不必要的绝对路径。
- support bundle 必须由用户显式发起并在导出前脱敏；默认不启用 remote telemetry、phone-home 或后台上传。
- observability 数据不得成为 LearningSession、Evidence、Outcome、learner profile 或 settlement authority。

## 边界与后果

- 本地 analytics 可以支持产品内学习反馈，但不因此获得教学写入权威。
- projection 丢失允许从本地 canonical 记录重建；重建不能修改教学事实。
- 远程上传能力必须有独立同意、清晰目的与新的安全审查。
- 诊断的“健康”不等于学习结果或工具 effect 成功。

## 实施锚点

- [UsageLedger](../../src/main/usage-ledger.ts)
- [TeachingDoctor](../../src/main/teaching-doctor.ts)
- [Support bundle](../../src/main/support-bundle.ts)

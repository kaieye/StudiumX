# ADR-0011：学习规划权威边界

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** study-planning

## 背景

任务、计时与复习规划需要持久化，也会引用教学进度；若规划存储反向成为 Evidence 或下一步教学权威，就会把用户安排与实际学习结果混为一谈。

## 决定

- 学习规划由独立 durable store 保存稳定 identity、revision 与用户可编辑状态；写入使用乐观并发而非 last-write-wins。
- 规划可以读取 canonical 教学事实形成建议或快照，但不得写 LearningSession、Evidence、Outcome 或 learner profile。
- timer、提醒、排序、完成状态与复习安排是用户规划状态，不是掌握证明。
- cold start 与投影重建从规划的 canonical durable data 恢复；SQLite 或 UI cache 不成为规划写入权威。
- 系统电源、通知与后台能力只影响调度可用性，不改变已保存计划或教学事实。

## 边界与后果

- 规划快照可作为经定义的同步用户状态，但同步不得反向改写教学事实。
- “任务完成”与“学习结果 established”保持分离。
- planner 建议可以重算，用户确认后的 durable 计划保持 revision 语义。
- 改变规划与教学 authority 的方向需要新的 ADR。

## 实施锚点

- [Study planning durable store](../../src/main/study-planning-durable-store.ts)
- [Study planning IPC](../../src/main/study-planning-ipc.ts)
- [Planning authority 合同测试](../../tests/unit/study-planning-v1-authority-cold-start.unit.test.ts)

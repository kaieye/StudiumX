# Agent 能力实施进度

本文只记录尚未完成的切片。完成项在验证通过后从本文件删除；提交信息和详细验证结果由 Git 历史保存。

## 当前队列

| 切片 | 状态 | 下一交付物 | 主要依赖 |
| --- | --- | --- | --- |
| Phase 8：会话 checkpoint、归档检索与 artifact 生命周期 | 未开始 | 可重建索引、显式有界检索、保留与清理策略 | 现有运行与 conversation 持久化边界 |
| Phase 9：session tree 与分支生命周期 | 未开始 | branch / fork / durable replay / open | Phase 8 的索引和引用完整性 |
| Phase 10：SDK/provider hooks | 未开始 | 统一 hook contract 与 fake-provider 测试 | 现有持久化与预算接口 |

## 当前进行中

无。

## 阻塞

无。

## 跨切片待决策

- 会话/历史 checkpoint 的范围、创建时机和恢复权限；不得与现有 `AgentRunCheckpoint` 混淆。
- archived-history 索引使用可重建文件索引还是独立数据库。
- session fork 是共享不可变历史引用，还是复制小型 turn metadata。
- provider hook 的最小稳定字段，以及 provider 私有 metadata 的保留上限。

## 更新规则

1. 开始切片时，只把对应状态改为“进行中”，并在“当前进行中”记录本次唯一交付物和验收命令。
2. 部分完成时，只保留尚未满足的验收项；不要写已完成流水。
3. 切片完成并验证后，从本文件删除对应行和相关待决策项，并同步删除路线图与专题文档中的完成内容。
4. 阻塞项必须写明阻塞原因、已经尝试的动作和解除阻塞所需输入。
5. 不在本文件保存 commit hash、长验证输出或已完成能力清单。

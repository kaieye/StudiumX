# Agent 能力建设文档索引

本目录用于在存在尚未完成的 agent runtime 工作时，维护实施约束和执行模板。当前没有待实施的 agent runtime 切片；已经落地的能力、验证记录和提交信息请通过 Git 历史追溯。

## 文档结构

- [AI 执行 Prompt](ai-execution-prompt.md)：新增未完成切片后，用于实施单个切片的通用模板。

## 维护规则

1. 只有明确、有价值且尚未满足的目标、验收标准、风险或开放问题才保留在本目录。
2. 出现新切片时，按需创建路线图、进度或专题文档，并在本索引中添加链接。
3. 一个切片完成并验证后，从相关文档删除对应内容；文档只剩标题、空状态或重复信息时，直接删除并清理链接。
4. 提交 hash、详细验证输出和实现历史交给 Git 保存。
5. 不把运行 checkpoint、workspace checkpoint 与会话/历史 checkpoint 混为一谈。

## 设计原则

1. 原始 conversation turns 是对话事实来源；发送投影、摘要和检索结果不能静默改写原始历史。
2. archived retrieval 默认不注入 provider history，必须显式触发、受预算限制并可审计。
3. learner memory、conversation compaction 和 archived retrieval 保持独立的写入与读取策略。
4. 子 agent 与恢复流程默认最小权限，不能借恢复、回放或检索扩大工具权限。
5. 自动清理、恢复和 provider hook 都必须幂等、可解释并有测试保护。

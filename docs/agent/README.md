# Agent 能力建设文档索引

本目录只维护尚未完成的 agent runtime 工作。已经落地的能力、验证记录和提交信息不在这里重复保存，需要追溯时使用 Git 历史。

## 当前范围

- SDK/provider hooks 与统一运行诊断。

## 文档结构

- [实施路线图](implementation-roadmap.md)：仅列出未完成阶段、依赖和验收标准。
- [实施进度](progress.md)：仅记录当前进行中、未开始或阻塞的切片。
- [状态、持久化与记忆边界](state-persistence-and-memory.md)：未完成持久化工作的约束、方案和开放问题。
- [AI 执行 Prompt](ai-execution-prompt.md)：实施单个未完成切片时使用的通用模板。

## 维护规则

1. 文档只保留尚未满足的目标、验收标准、风险和开放问题。
2. 一个切片完成并验证后，从路线图、进度和专题文档中删除对应内容，不新增“已完成”章节。
3. 提交 hash、详细验证输出和实现历史交给 Git 保存。
4. 新发现的后续工作只有在明确不属于当前切片时才加入文档。
5. 不把运行 checkpoint、workspace checkpoint 与会话/历史 checkpoint 混为一谈。

## 设计原则

1. 原始 conversation turns 是对话事实来源；发送投影、摘要和检索结果不能静默改写原始历史。
2. archived retrieval 默认不注入 provider history，必须显式触发、受预算限制并可审计。
3. learner memory、conversation compaction 和 archived retrieval 保持独立的写入与读取策略。
4. 子 agent 与恢复流程默认最小权限，不能借恢复、回放或检索扩大工具权限。
5. 自动清理、恢复和 provider hook 都必须幂等、可解释并有测试保护。

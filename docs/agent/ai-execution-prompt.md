# AI 执行 Prompt

把下面模板交给 AI，可以让它按当前文档体系继续实现 agent 能力。每次只填一个阶段或一个清晰切片，不要一次要求完成所有 Phase。

## 通用模板

```text
你在 D:\project\StudiumX 工作。

先阅读这些文档：
- docs/agent/README.md
- docs/agent/progress.md
- docs/agent/implementation-roadmap.md
- docs/agent/runtime-baseline.md
- 与本阶段直接相关的专题文档：<列出 1-3 个>

目标：
完成 <Phase 编号和名称>：<一句话写清本次要交付什么>。

范围：
- 只实现本阶段，不顺手做后续 Phase。
- 优先沿用当前代码结构和项目测试框架。
- 可以参考 ref_project，但不要照搬大块实现；按 StudiumX 当前 TypeScript/Electron runtime 落地。
- 如果需要调研，可以派只读子 agent；如果需要代码改动，必须明确文件范围，避免互相覆盖。
- 工作区可能已有别人留下的脏改动；不要回滚、覆盖或提交无关文件。
- 不要把无关格式化、重命名、清理混进本次提交。

非目标：
- <明确写出 2-5 条本次不做的内容>

验收标准：
- <列出 3-6 条可验证结果>
- 新增或更新必要测试。
- 运行相关测试、类型检查或 lint；如果无法运行，说明原因。
- 更新 docs/agent/progress.md，把已完成项、commit、验证结果和剩余风险写清楚。
- 如 roadmap 状态发生变化，同步更新 docs/agent/implementation-roadmap.md 的 Phase 状态。

提交要求：
- 只 stage 本阶段相关文件。
- 不提交已有无关脏改动。
- commit message 使用：<建议 commit message>

完成后回复：
- 改了哪些文件
- 实现了哪些能力
- 运行了哪些验证
- commit hash
- 剩余风险和下一步建议
```

## 推荐填写方式

### Phase 0 示例

```text
你在 D:\project\StudiumX 工作。

先阅读这些文档：
- docs/agent/README.md
- docs/agent/progress.md
- docs/agent/implementation-roadmap.md
- docs/agent/runtime-baseline.md

目标：
完成 Phase 0：基线测试与诊断。

范围：
- 为 ToolRegistry 增加注册、覆盖、handlerMap 测试。
- 为 runAgentLoop 增加 fake provider 测试，覆盖无工具、单工具、多工具、工具错误、最大迭代、取消。
- 为 web_search / web_fetch 当前输出补最小结构测试，优先固定现状。
- 不改变生产行为，除非为了让代码更可测试且保持兼容。

非目标：
- 不实现 context hygiene。
- 不重构搜索 provider。
- 不实现子 agent。
- 不改 UI。

验收标准：
- 当前 agent loop 和 tool registry 行为有自动化测试保护。
- 测试能在本地命令中运行。
- docs/agent/progress.md 标记 Phase 0 完成，并记录验证命令和 commit。

提交要求：
- 只 stage 测试和必要的最小生产代码改动。
- 不提交已有无关脏改动。
- commit message 使用：test(agent): cover current loop and tool registry
```

### Phase 2 示例

```text
你在 D:\project\StudiumX 工作。

先阅读这些文档：
- docs/agent/README.md
- docs/agent/progress.md
- docs/agent/implementation-roadmap.md
- docs/agent/context-compression.md
- docs/agent/state-persistence-and-memory.md

目标：
完成 Phase 2：发送前 context hygiene。

范围：
- 新增 ContextEstimator。
- 新增 RequestHistoryHygiene。
- 在发给 provider 前清理长 tool result，但不改持久化 transcript。
- 保留最近工具结果，旧结果压成 digest。
- 增加 context estimate 和 hygiene 相关事件或诊断，先用最小可观测实现。

非目标：
- 不做 LLM 摘要压缩。
- 不做 child agent。
- 不重构搜索 provider。
- 不做 UI 大改。

验收标准：
- 大 tool result 不再完整重复发送给 provider。
- 最近工具结果仍完整保留。
- 持久化 conversation 不被 hygiene 改写。
- 覆盖 CJK/ASCII 估算、长 tool result、累计预算、tool call/result 配对的测试。
- docs/agent/progress.md 标记 Phase 2 完成，并记录验证命令和 commit。

提交要求：
- 只 stage 本阶段相关文件。
- 不提交已有无关脏改动。
- commit message 使用：feat(context): add send-time history hygiene
```

## 执行规则

每个 AI 任务结束时都必须更新 [progress.md](progress.md)。如果只完成部分内容，状态写“部分完成”，并列出未完成项，不要把 Phase 标成完成。

状态定义：

- 未开始：没有代码或测试落地。
- 进行中：已有部分实现或测试，但验收标准未全部满足。
- 已完成：代码、测试、文档进度和 commit 都完成。
- 阻塞：连续尝试后无法推进，必须说明阻塞原因和需要的输入。


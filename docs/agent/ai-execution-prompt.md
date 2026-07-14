# AI 执行 Prompt

把下面模板交给 AI，可以让它按当前文档体系继续实现 agent 能力。每次只填一个阶段或一个清晰切片，不要一次要求完成所有 Phase。

## 通用模板

```text
你在 D:\project\StudiumX 工作。

先阅读这些文档：
- docs/agent/README.md
- docs/agent/progress.md
- docs/agent/implementation-roadmap.md
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

已完成 Phase 的示例和对应临时设计稿已清理。继续实施时，使用上面的通用模板，并只引用当前仍存在的专题文档；目前主要是 [state-persistence-and-memory.md](state-persistence-and-memory.md)。

## 执行规则

每个 AI 任务结束时都必须更新 [progress.md](progress.md)。如果只完成部分内容，状态写“部分完成”，并列出未完成项，不要把 Phase 标成完成。

状态定义：

- 未开始：没有代码或测试落地。
- 进行中：已有部分实现或测试，但验收标准未全部满足。
- 已完成：代码、测试、文档进度和 commit 都完成。
- 阻塞：连续尝试后无法推进，必须说明阻塞原因和需要的输入。


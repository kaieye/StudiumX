# Agent 能力实施路线图

本文只列尚未完成的工作。阶段完成并通过验证后，直接删除对应章节；实现记录和提交信息由 Git 历史保存。

## Phase 7：Pending stream staging

状态：未开始。

目标：在父 turn 尚未写入最终 conversation 前，持久化足够的进行中证据，使进程崩溃后能够解释本轮输入、已确认事件和未完成状态。

范围：

- 为用户输入、运行关联、最后 durable event sequence 和必要的 provider/tool 边界设计 staging record。
- staging 写入与现有 run lifecycle checkpoint、operation journal、conversation save 保持幂等。
- 最终 turn 保存成功后原子地结算或删除 staging；失败或启动恢复时不得产生重复 turn。
- 启动恢复要区分可继续展示的已确认内容、需要人工确认的副作用和不可恢复的流式片段。
- 补充崩溃点、重复启动、取消、权限等待和最终保存失败测试。

非目标：

- 不承诺逐 token 无损恢复。
- 不在本阶段实现会话 branch/fork 或 archived-history 搜索。

验收：

- 崩溃后的父 run 不再只有状态记录而缺少可解释的输入/输出证据。
- recovery 不会重复执行工具、重复追加 turn 或自动提交未确认的 assistant 文本。
- staging 文件有路径包含校验、大小上限、schema 版本和损坏数据隔离。

## Phase 8：会话 checkpoint、归档检索与 artifact 生命周期

状态：未开始。

目标：让历史快照和归档内容可以受控检索，并为长期存储提供清理、保留和隐私边界。

范围：

- 定义会话/历史 checkpoint；不要复用或混淆现有的单次运行 `AgentRunCheckpoint`。
- 为 conversation turns、session sidecar、tool-result artifact 和 child-transcript artifact 建立可重建索引。
- 提供显式 archived-history 查询 API，返回有界摘要和稳定引用，不默认注入 provider history。
- 定义 artifact 保留期、孤儿检测、重复内容处理、删除审计和索引重建流程。
- 在写入摘要、transcript、索引字段前统一执行 secret redaction，并测试敏感值不会落盘。
- 为损坏索引、缺失 artifact、hash 不匹配、超预算检索和重复清理补测试。

验收：

- 用户或上层 runtime 可以按 conversation、时间和 artifact 类型显式检索历史。
- 删除或重建索引不改变原始 conversation turns，也不会让 learner memory 自动吸收归档内容。
- 清理流程可 dry-run、可审计、幂等，并且不会删除仍被有效引用的 artifact。

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

- staging、checkpoint、索引和 branch 同时引入多个事实来源，必须明确每类数据的权威性和重建方向。
- replay、恢复和清理都可能触碰有副作用的工具结果，默认必须停在人工确认边界。
- archived retrieval 与 provider metadata 可能扩大敏感信息落盘范围，redaction 需要先于持久化。
- 索引和 artifact 会持续增长，所有新格式都需要版本、上限、完整性校验和迁移策略。

## 推荐顺序

1. 先完成 Phase 7，补齐父 turn 崩溃恢复证据。
2. 再完成 Phase 8，为后续 session tree 提供稳定索引和存储生命周期。
3. Phase 9 依赖 Phase 8 的引用与索引边界。
4. Phase 10 可在 Phase 7 之后按 provider 需求独立切片，但不得绕过既有持久化和预算接口。

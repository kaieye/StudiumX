# ADR-0171：连续 Agent 运行与上下文治理

- **决策状态：** accepted
- **实施状态：** partial
- **日期：** 2026-08-05
- **范围：** 区分上下文窗口治理、局部操作边界、语义活性守卫、emergency fuse、用户显式预算与部署/组织策略；避免把不透明的内部累计计数误称为 provider quota，同时保留必要的资源边界与可解释的停止语义。
- **取代：** 部分 [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)（共享 run budget 政策）、[ADR-0103](0103-agent-loop-budget-reason-peel.md)（run-budget stop reason 政策）、[ADR-0145](0145-compaction-pressure-single-flight.md)（全局硬 run budget 优先规则）中的**绝对化**表述。
- **被取代：** 无
- **相关：** [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0064](0064-context-compactor-cutpoints-and-reduction-guard.md)、[ADR-0145](0145-compaction-pressure-single-flight.md)、[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md)、[ADR-0168](0168-pi-compatible-explicit-skill-invocation.md)
- **证据：** 实现状态见 §4；迁移要求见 §5；相关代码路径：`src/main/ai/provider-adapter/invocation.ts`、`src/main/teaching-agent-conversations.ts`（或等价课程生成 governor）、host-owned resource policy snapshot 接线。

## 背景与问题边界

运行时同时面对几类不同问题：

1. **context geometry**：当前 provider 请求是否能装入模型的上下文窗口（输入、工具定义、输出预留与 provider framing 共同满足请求合同）。
2. **局部操作边界**：单次 provider 调用、单次工具执行、单次 compaction 或单个外部写操作的 timeout、retry、输出大小和安全边界。
3. **语义活性**：工具调用是否重复且无进展，provider retry 是否耗尽，compaction 是否反复失败，恢复是否已失去安全的 durable 前提。
4. **资源边界**：用户、部署者或组织可能有意设置一次任务、一次运行、一个工作区或一个租户的成本、时长、调用次数或其他资源上限。

这些问题不能被一个无语义的 `totalTokens`、`maxIterations` 或 `maxToolCalls` 字段混成一种「预算」。尤其反对：将应用内部累计计数作为默认、低位、不可解释的全局停机阀，并把触发结果展示成「provider token quota exhausted」。

**本 ADR 不把这种反对扩大为禁止一切 run-level 资源边界。** 资源边界是否合理取决于来源、是否透明、作用范围、触发后的语义和是否影响教学权威；不同层必须在配置、审计、错误码和用户文案中保持可区分。

## 决定

### 1. 资源边界分层

运行时按以下层次解释和应用边界。实现可以在内部共用计数器，但对外必须保留来源、范围、触发原因和结果语义。

**A. Context geometry（上下文几何）** — provider 请求的可装入性约束，不是学习预算。请求是否 fit 至少应按 `projected input messages + tool definitions/schemas + provider-required framing allowance + model-specific output reserve <= effective context window` 估算；不确定窗口或 framing 时保守估算并在 projection report / 本地诊断记录估算来源。接近窗口可 compaction；明确 overflow 可一次有界 overflow recovery。context geometry 失败返回 `context_overflow` / `context_unrecoverable` 或等价错误，不能伪装成 `provider_quota`，也不能宣称学习成功。

**B. 局部操作边界** — 只约束对应操作，不自动升级为整个学习 run 的失败或预算耗尽：单次 provider transport 调用的 timeout 与有界 retry；单次工具执行 timeout、输出截断、重复调用检测和路径围栏；单次 compaction 摘要的 timeout、采样尝试和失败 cooldown；外部写入、privileged 操作、approval/effect lattice 与工作区信任边界；provider 声明的单次输出上限、真实 quota/billing/authentication 错误。触发后必须保留结构化结果和可解释原因；是否继续由模型、host 或用户按相应能力和审批规则决定，不能通过旁路自动改变工具能力。

**C. 语义活性守卫** — 可保留防止无意义或不安全循环的 guard：同一工具调用模式持续重复且无进展；provider transport retry 已耗尽；compaction 对同一 source/projection digest 反复无法降低请求；operation 的前置 revision、审批状态或 durable identity 已失效；某一工作流分支违反明确的状态机转移条件。活性守卫必须基于可审计的语义事实（`no_progress`、`retry_exhausted`、`context_unrecoverable`、`stale_revision`、`suspended`），而不是隐藏阈值；允许在新的输入、状态实质变化或显式用户动作后重新评估。

**D. 默认高位 emergency fuse** — 为应对失控循环、资源泄漏、provider/工具实现异常或宿主机保护，可保留一个**高位、默认不应在正常学习路径触发**的 emergency fuse。它可按累计 token、调用次数、时长、iterations 或系统资源计数，但必须：由部署或运行时安全策略明确声明，默认值远高于正常交互合理范围；触发事实、计数范围、阈值和时间窗可审计；触发结果是 `resource_limit` 或 `suspended`（不是 `budget_exhausted`、provider quota，也不是学习完成）；不得写入或伪造 LearningSession Evidence、Outcome、等级、XP 或 settlement 成功事实；不得跳过取消、审批、effect lattice、路径围栏、`expectedRevision` 或 settlement sole-writer；对正在执行的 provider/tool/compaction 传播取消，使不确定 operation 进入人工复核或安全中断；恢复不能自动重放工具或自动重发原 provider 请求。emergency fuse 是宿主保护与 fail-safe，不是产品学习额度，不应被用作正常 UX 中的「本轮 token 预算」。

**E. 用户显式资源预算** — 用户可以明确为一个任务、run、goal、导出、批处理或其他业务操作设置资源预算（token/cost、provider calls、tool calls、duration 或 turns）。该预算是**显式的业务约束**，不应隐藏在普通默认配置中，且必须：在设置或启动动作中清楚展示适用范围、计数口径、是否包含子任务和触发后的行为；使用 `resource_limit` / `suspended` 或等价可解释状态，而不是 provider quota 或学习成功；不把「达到用户预算」写入 canonical teaching Evidence/Outcome，除非用户随后通过正常学习流程完成并提交了独立的、有证据的教学结算；不改变教学 authority（文件 / LearningSession ledger 仍是教学决策事实源）；不允许 fork、恢复或 continuation 绕过原预算、审批或 revision 条件；明确区分「用户主动结束/暂停」与 provider 真正的 billing/quota 错误。显式预算可以是硬上限或软提醒；不能被重新命名成无法解释的内部 `AgentRunBudget`，也不能默认为所有学习运行启用低位硬阈值。

**F. 部署 / 组织策略** — 部署者、组织管理员或租户可以为成本、并发、运行时长、provider calls、工具调用、队列容量等设置策略边界。该层与用户预算分开记录：组织策略可以覆盖或收紧用户可选范围，但必须在运行启动时可发现；触发后返回 `resource_limit` / `suspended` 并标明是 deployment/organization policy；不得将组织策略错误映射为 provider quota、模型能力限制或学习成功；应优先在新任务启动、排队或安全暂停点生效；对已经进行的工具/外部写操作仍须遵循取消、审批和 settlement 规则；支持管理员审计和用户可理解的恢复路径，但不允许恢复时自动重放工具。同一运行同时存在多个边界时，应报告实际触发的最具体来源，并保留嵌套边界的审计记录；不得只显示一个笼统的「budget exceeded」。

### 2. 普通 compaction、overflow recovery 与 logical request

- **同一已授权 logical request 内：** 普通阈值 compaction 可以在已经获得授权、尚未完成的同一 logical provider request 内自动执行（替换 provider projection、重新计算 request-fit、继续发送该 logical request），不需要用户额外输入，也不等同于创建新的 canonical learner turn。它必须：只改变 provider projection，不改变文件 / LearningSession ledger 的教学 authority；不重放已经完成的 agent turn 或工具；不重新取得已经消费的工具执行权，不复用已失效的 approval；当前 logical request 的身份、取消状态、`expectedRevision` 前提和 source/projection digest 仍然有效；若新的 projection 仍不 fit，进入明确的 context error，而不是无界继续压缩。
- **logical request 完成、取消或中断之后：** host 不得因为 compaction、summary、checkpoint 或旧内存状态自动新建 canonical learner turn、重新发起 provider 请求、重放已经执行的工具或外部写入、或把 summary 中的「已完成」叙述升级成 Evidence、Outcome 或 settlement。跨中断的继续必须来自用户显式新输入、用户确认的继续动作，或未来经过持久化验证的 host-owned continuation intent。任何新的 canonical 写入仍须经 `TeachingTurnCoordinator` / host 的 settlement sole-writer 路径和 `expectedRevision` CAS。
- **Overflow recovery：** 若 provider 明确返回 context overflow：移除本次失败请求对应的 provider projection → 使用更激进的 compaction / pressure ladder 重新计算 fit → 对同一 logical request 最多执行一次 compact-and-retry → 第二次仍 overflow 或请求仍不合法时返回 `context_unrecoverable` 或等价错误。`context overflow` 不得进入普通 transport retry；也不得因 compaction 摘要调用的内部尝试而隐式增加原请求的 overflow recovery 次数。

### 3. 嵌套 retry 与资源 accounting

运行时必须分别记录 logical request、provider transport attempt、transport retry、overflow recovery、compaction operation / summary attempt、tool operation attempt，且：每层有独立上限、错误分类和审计字段；一层的重试不得自动借用另一层的额度；`overflow recovery` 不计入 transport retry，但实际 provider 调用必须计入 usage/成本观测；compaction summary 的 retry 不得使原 logical request 无限重试；用户显式预算或部署策略如要计数，必须在产品文案中明确是按 logical request、实际 provider attempt、tool operation 或成本计量，不能笼统写「token quota」；预算触发后的停止状态必须仍为 `resource_limit` / `suspended`，并保留已完成与未完成 operation 的区分。

### 4. 取消、工具、审批与教学权威不变量

取消必须通过 `AbortSignal` 传播到 provider、tool、compaction 和相关局部操作；取消或超时不等于学习成功，也不自动产生新的 Evidence/Outcome。所有工具调用继续受到 capability policy、工作区信任、路径围栏、effect lattice 和 approval 约束；资源边界、compaction 或恢复不得绕过这些约束。

教学 authority 优先级不变：① 学习工作区文件和 LearningSession ledger 是 AI 教学决策事实源；② SQLite、AgentRun、compaction summary、projection report、同步副本和 usage 不是教学 authority；③ `TeachingTurnCoordinator` / host 是 outcome settlement 的唯一写入路径；④ IPC 或 host settlement 必须携带并校验 `expectedRevision`；⑤ fork / 恢复路径必须保持 `toolsReplayed:false`；⑥ 任一恢复、资源边界或 compaction 失败都不得自动重放工具历史、重建外部写入或伪造 settlement。

### 5. Continuation 与恢复

当前实现选择保守策略：启动恢复将 in-flight run 标记为 `interrupted`，把不确定 operation 交给人工复核，不自动重放工具，也不自动重发原 provider 请求；用户继续时通过新的显式输入或确认动作建立新的 logical request / canonical turn。若未来加入 host-owned continuation intent，至少必须持久化和验证：conversation / run identity；canonical base revision、turn identity 与最后 durable sequence；`expectedRevision`；canonical source digest、provider projection digest 与模型 / context-window identity；operation journal、idempotency key、tool-call ID 与已完成 `ToolOutcome`；cancellation / interruption 状态；approval 是否仍有效（默认不得自动复用，失效时必须重新请求）。任一绑定不匹配时必须 fail closed；恢复只允许继续尚未完成且仍满足 capability、approval、effect、revision 和资源策略的操作，绝不重放已完成工具。

### 6. 文案、状态与可观测性

usage 可以继续作为本地、脱敏的分析与成本观察事实，但不能仅凭 usage 推断学习成功、教学结论或 provider quota。用户可见状态至少应区分 `context_overflow` / `context_unrecoverable`（上下文几何失败）、`retry_exhausted`（局部 retry 耗尽）、`no_progress`（语义活性守卫）、`resource_limit`（用户显式预算 / 部署组织策略 / emergency fuse）、`suspended`（安全暂停）、`canceled` / `interrupted`（取消或中断）、provider 的真实 `quota` / `billing` / `authentication` 错误。`resource_limit` / `suspended`：不得渲染为「provider token quota exhausted」；不得被视为学习成功或自动生成 durable-success / budget fallback；必须显示触发层、计数口径（若适用）、已完成和未完成的范围以及可用恢复动作。

### 7. 对既有政策的取代范围

本 ADR 取代既有文档中把**所有**累计 token、provider/tool calls、duration 或 iterations 的 run-level 上限一律视为禁止、或把所有资源停止一律称为 provider quota 的**绝对化**表述。它不自动废除合理、透明且有明确语义的：用户显式任务 / goal / run 预算；部署者、组织或租户策略；高位 emergency fuse；provider 或工具的真实局部限制；语义活性守卫。它也不取代 settlement sole-writer、`expectedRevision`、`toolsReplayed:false`、effect lattice、审批、工作区信任、路径围栏、secret isolation 或 teaching authority 边界；若其他 ADR 对这些边界另有更具体规定，以更具体的安全、隐私、教学和 settlement 约束为准。

## 实施状态（partial）

本 ADR 标记为**需修订（部分实施）**：当前运行时已具备部分 context projection / compaction、局部 retry、取消与不自动恢复工具的能力，但完整资源分层、request-fit 合同、嵌套 retry accounting、统一 `resource_limit` / `suspended` 语义和所有部署策略接线不能仅凭文档宣称已完成。已实现的窄范围包括：直接课程生成为一次 action 创建 host-owned 根 governor 并分共享根账本子 lane（provider 明确报告的 `total_tokens` 才可触发 token 资源边界；component-only usage 仅本地可观测）；provider adapter 在每次实际网络 dispatch 之前调用 host-owned transport preflight（`provider_transport_attempts` 分账、一个 facade 语义请求只记一次 `logical_requests`）；用户显式预算有一个窄的持久化 Settings 产品面（默认关闭、用户主动开启、run-start 时从已验证 settings 生成 host-owned policy snapshot，启动 payload 不能提供或篡改 limits，命中后仍 `resource_limit` / `suspended`）；持久化 deployment/organization policy 有一个窄的主进程来源（`userData/studiumx-managed-config.json` 仅 `resourceGovernance.deploymentPolicy.limits` 被投影，每次新 run 启动读取并生成快照，renderer/workspace/prompt/Settings 不能写入，缺失/逃逸/超限/无效 JSON 均不创建 boundary，该文件不是 MDM/远程策略拉取/电话回传/密钥存储）；持久化 failed checkpoint 启动时只读投影 `resource_limit` / `suspended` / `retry_exhausted`（不创建 continuation intent、不重放工作）。可操作的 host-owned continuation intent 与其余迁移要求仍未完成。文档不得把「旧字段不再作为默认 stop」误写成「系统已经没有任何资源边界」，也不得把未接线的 host-owned continuation 或尚未覆盖的 provider 路径写成已实施事实。

## 迁移要求

1. 将 context geometry、局部操作边界、语义活性、emergency fuse、用户预算和部署策略建模为可区分的来源与错误结果。
2. 对 request-fit 记录 input、tool schema、framing allowance、output reserve、effective context window 及其估算来源。
3. 为 logical request、transport retry、overflow recovery、compaction summary attempt 和 tool operation 建立独立 accounting，避免嵌套 retry 形成隐藏调用。
4. 让 resource-limit 相关状态清楚区分用户预算、部署策略和 emergency fuse，并保证不写 teaching Evidence/Outcome，不伪造学习成功或 provider quota。
5. 保持正常 pre-send compaction 在同一已授权 logical request 内可自动继续；完成、取消、中断和恢复之后不得自动新建 canonical turn、重发 provider 或重放工具。
6. 保持 provider、tool、compaction 的取消传播，以及 capability policy、approval、effect lattice、路径围栏、`expectedRevision` 和 settlement sole-writer。
7. 对恢复建立 source/projection digest、operation idempotency、tool outcome 和审批失效的 fail-closed 验证；在未实现 host-owned continuation 时，启动恢复必须只中断/挂起并等待明确动作。
8. 为各类状态提供独立测试和文案：context error、retry exhausted、no progress、resource limit、suspended、canceled/interrupted 与真实 provider quota/billing/authentication。

## 验证

- 正常运行不会因为不透明、默认、低位的累计计数被误称为 provider quota 并静默结束。
- 用户显式预算、部署/组织策略和 emergency fuse 均可被单独配置、审计和解释，触发后显示 `resource_limit` 或 `suspended`，不显示学习成功。
- context-fit 估算包含 input、tools、framing 和 output reserve。
- 普通 pre-send compaction 可以在同一已授权 logical request 内继续发送；跨完成、取消、中断或恢复不会自动创建新的 canonical turn。
- overflow recovery、transport retry、compaction summary retry 和 tool retry 的 accounting 分离且有界。
- compaction 只改变 provider projection，不成为 Evidence、Outcome 或 settlement authority。
- 所有工具调用继续经过 approval、effect lattice、工作区信任和路径围栏；恢复保持 `toolsReplayed:false`。
- settlement 仍由 `TeachingTurnCoordinator` / host 唯一写入，并校验 `expectedRevision`。
- `resource_limit` / `suspended`、context error、provider quota、canceled/interrupted 和学习成功不会互相混淆。
- 本 ADR 的状态仍为「需修订/部分实施」，直到上述合同在实现、诊断和测试中得到对应证明。

## 非目标

- 不取消 provider 的真实上下文、输出、billing 或账户限制；不承诺无限 provider retry、无限 context-overflow recovery 或无限工具执行。
- 不把 SQLite、AgentRun、compaction summary、projection report、同步副本或 usage 升格为教学 authority。
- 不绕过审批、effect lattice、工作区信任、路径围栏、`expectedRevision` 或 settlement sole-writer。
- 不在取消、失败、资源限制、挂起或恢复时自动重放工具或重建外部写入。
- 不在本 ADR 中实现 host-owned continuation intent，也不以本文替代具体安全、隐私、provider 错误或 settlement ADR。

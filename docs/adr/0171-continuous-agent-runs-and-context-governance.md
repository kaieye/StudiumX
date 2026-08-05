# ADR-0171：连续 Agent 运行与上下文治理

- **状态：** 需修订（部分实施；本文是目标政策，不代表全部运行时能力已经完成迁移）
- **日期：** 2026-08-05
- **范围：** 区分上下文窗口治理、局部操作边界、语义活性守卫、emergency fuse、用户显式预算与部署/组织策略；避免把不透明的内部累计计数误称为 provider quota，同时保留必要的资源边界与可解释的停止语义。
- **相关：** [ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0064](0064-context-compactor-cutpoints-and-reduction-guard.md)、[ADR-0145](0145-compaction-pressure-single-flight.md)、[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0153](0153-codex-sandbox-dual-axis-and-agent-shell.md)、[ADR-0168](0168-pi-compatible-explicit-skill-invocation.md)。

## 1. 背景与问题边界

运行时同时面对几类不同问题：

1. **context geometry**：当前 provider 请求是否能装入模型的上下文窗口，以及输入、工具定义、输出预留和 provider framing 是否共同满足请求合同。
2. **局部操作边界**：单次 provider 调用、单次工具执行、单次 compaction 或单个外部写操作的 timeout、retry、输出大小和安全边界。
3. **语义活性**：工具调用是否重复且无进展，provider retry 是否已经耗尽，compaction 是否反复失败，或者恢复是否已经失去安全的 durable 前提。
4. **资源边界**：用户、部署者或组织可能有意设置一次任务、一次运行、一个工作区或一个租户的成本、时长、调用次数或其他资源上限。

这些问题不能被一个无语义的 `totalTokens`、`maxIterations` 或 `maxToolCalls` 字段混成一种“预算”。尤其应当反对以下做法：将应用内部累计计数作为默认、低位、不可解释的全局停机阀，并把触发结果展示成“provider token quota exhausted”。

**本 ADR 不再把这种反对意见扩大为禁止一切 run-level 资源边界。** 资源边界是否合理，取决于来源、是否透明、作用范围、触发后的语义和是否影响教学权威；不同层必须在配置、审计、错误码和用户文案中保持可区分。

参考 `D:\project\StudiumX-project\ref_project\grok-build-main` 的当前快照时，可以看到它既有 context compaction，也存在可选的 `max_turns`，以及用户显式 `/goal ... --budget N` 的 goal 预算。该参考项目不能被表述为“完全无预算”：它说明上下文治理与显式任务约束可以并存，但二者不是同一类限制。StudiumX 借鉴其上下文压力、preflight 和有界恢复思路，不照搬其 conversation persistence 或 authority 模型。

## 2. 决策

### 2.1 资源边界分层

运行时按以下层次解释和应用边界。实现可以在内部共用计数器，但对外必须保留来源、范围、触发原因和结果语义。

#### A. Context geometry（上下文几何）

这是 provider 请求的可装入性约束，不是学习预算。请求是否 fit 至少应按以下组成进行估算：

```text
projected input messages
+ tool definitions / schemas
+ provider-required framing and serialization allowance
+ model-specific output reserve
<= effective context window
```

其中：

- `projected input messages` 是当前 provider projection，而不是未经压缩的 canonical transcript；
- `tool definitions / schemas` 必须计入，不能只估算消息正文；
- `framing` 包括 provider、模型或 chat template 产生的额外包装开销；
- `output reserve` 是为本次响应保留的输入之外空间，至少应按 provider/model capability 使用配置值或保守默认值；
- 不确定窗口或 framing 时，应保守估算并在 projection report / 本地诊断中记录估算来源。

接近窗口时可以进行 compaction；明确 overflow 时可以进行一次有界的 overflow recovery。context geometry 失败应返回 `context_overflow`、`context_unrecoverable` 或等价的上下文错误，不能伪装成 `provider_quota`，也不能宣称学习成功。

#### B. 局部操作边界

以下边界只约束对应操作，不自动升级为整个学习 run 的失败或预算耗尽：

- 单次 provider transport 调用的 timeout 与有界 retry；
- 单次工具执行 timeout、输出截断、重复调用检测和路径围栏；
- 单次 compaction 摘要操作的 timeout、采样尝试和失败 cooldown；
- 外部写入、privileged 操作、approval/effect lattice 与工作区信任边界；
- provider 声明的单次输出上限、真实 quota/billing/authentication 错误。

局部边界触发后，必须保留结构化结果和可解释原因；是否继续由模型、host 或用户按相应能力和审批规则决定，不能通过旁路自动改变工具能力。

#### C. 语义活性守卫

可以保留防止无意义或不安全循环的 guard，例如：

- 同一工具调用模式持续重复且没有可观察进展；
- provider transport retry 已耗尽；
- compaction 对同一 source/projection digest 反复无法降低请求；
- operation 的前置 revision、审批状态或 durable identity 已失效；
- 某一工作流分支违反明确的状态机转移条件。

活性守卫必须基于可审计的语义事实，而不是单纯因为累计 token、calls、duration 或 iterations 达到一个隐藏阈值。它们应使用诸如 `no_progress`、`retry_exhausted`、`context_unrecoverable`、`stale_revision` 或 `suspended` 等结构化原因，并允许在新的输入、状态实质变化或显式用户动作后重新评估。

#### D. 默认高位 emergency fuse

为应对失控循环、资源泄漏、provider/工具实现异常或宿主机保护，可以保留一个**高位、默认不应在正常学习路径触发**的 emergency fuse。它可以按累计 token、调用次数、时长、iterations 或系统资源使用量计数，但必须满足：

- 由部署或运行时安全策略明确声明，默认值远高于正常交互的合理范围；
- 触发事实、计数范围、阈值和时间窗可审计；
- 触发结果是 `resource_limit` 或 `suspended`，不是 `budget_exhausted`、provider quota，也不是学习完成；
- 不得写入或伪造 LearningSession Evidence、Outcome、等级、XP 或 settlement 成功事实；
- 不得跳过取消、审批、effect lattice、路径围栏、`expectedRevision` 或 settlement sole-writer；
- 对正在执行的 provider/tool/compaction 传播取消，并使不确定 operation 进入人工复核或安全中断状态；
- 恢复不能自动重放工具或自动重发原 provider 请求。

emergency fuse 是宿主保护与 fail-safe，不是产品学习额度。它不应被用作正常 UX 中的“本轮 token 预算”。

#### E. 用户显式资源预算

用户可以明确为一个任务、run、goal、导出、批处理或其他业务操作设置资源预算，例如 token/cost、provider calls、tool calls、duration 或 turns。该预算是**显式的业务约束**，不应被隐藏在普通默认配置中，并且必须：

- 在设置或启动动作中清楚展示适用范围、计数口径、是否包含子任务和触发后的行为；
- 使用 `resource_limit`、`suspended` 或等价可解释状态，而不是 provider quota 或学习成功；
- 不把“达到用户预算”写入 canonical teaching Evidence/Outcome，除非用户随后通过正常学习流程完成并提交了独立的、有证据的教学结算；
- 不改变教学 authority：文件 / LearningSession ledger 仍是教学决策事实源；
- 不允许 fork、恢复或 continuation 绕过原预算、审批或 revision 条件；
- 明确区分“用户主动结束/暂停”与 provider 真正的 billing/quota 错误。

显式预算可以是硬上限，也可以是软提醒。无论哪种，都不能被重新命名成无法解释的内部 `AgentRunBudget`，更不能默认为所有学习运行启用低位硬阈值。

#### F. 部署 / 组织策略

部署者、组织管理员或租户可以为成本、并发、运行时长、provider calls、工具调用、队列容量或其他资源设置策略边界。该层与用户预算分开记录：

- 组织策略可以覆盖或收紧用户可选范围，但必须在运行启动时可发现；
- 触发后返回 `resource_limit` / `suspended`，并标明是 deployment/organization policy；
- 不得将组织策略错误映射为 provider quota、模型能力限制或学习成功；
- 应优先在新任务启动、排队或安全暂停点生效；对已经进行的工具/外部写操作仍须遵循取消、审批和 settlement 规则；
- 支持管理员审计和用户可理解的恢复路径，但不允许恢复时自动重放工具。

同一运行同时存在多个边界时，应报告实际触发的最具体来源，并保留嵌套边界的审计记录；不得只显示一个笼统的“budget exceeded”。

### 2.2 普通 compaction、overflow recovery 与 logical request

#### 2.2.1 同一已授权 logical request 内

普通阈值 compaction 可以在**已经获得授权、尚未完成的同一 logical provider request 内**自动执行：它替换 provider projection，重新计算 request-fit，然后继续发送该 logical request。此行为不需要用户额外输入，也不等同于创建新的 canonical learner turn。

它必须满足：

1. 只改变 provider projection，不改变文件 / LearningSession ledger 的教学 authority；
2. 不重放已经完成的 agent turn 或工具；
3. 不重新取得已经消费的工具执行权，不复用已失效的 approval；
4. 当前 logical request 的身份、取消状态、`expectedRevision` 前提和 source/projection digest 仍然有效；
5. 若新的 projection 仍不 fit，则进入明确的 context error，而不是无界继续压缩。

#### 2.2.2 logical request 完成、取消或中断之后

在一个 logical request 已完成、用户已取消、运行已中断、进程已恢复或原请求已进入 terminal/suspended 状态后，host 不得因为 compaction、summary、checkpoint 或旧内存状态自动：

- 新建 canonical learner turn；
- 重新发起 provider 请求；
- 重放已经执行的工具或外部写入；
- 把 summary 中的“已完成”叙述升级成 Evidence、Outcome 或 settlement。

跨中断的继续必须来自用户显式新输入、用户确认的继续动作，或未来经过持久化验证的 host-owned continuation intent。任何新的 canonical 写入仍须经 `TeachingTurnCoordinator` / host 的 settlement sole-writer 路径和 `expectedRevision` CAS。

#### 2.2.3 Overflow recovery

若 provider 明确返回 context overflow：

1. 移除本次失败请求对应的 provider projection；
2. 使用更激进的 compaction / pressure ladder 重新计算 fit；
3. 对同一 logical request 最多执行一次 compact-and-retry；
4. 第二次仍 overflow 或请求仍不合法时，返回 `context_unrecoverable` 或等价错误。

`context overflow` 不得进入普通 transport retry；也不得因为 compaction 摘要调用的内部尝试而隐式增加原请求的 overflow recovery 次数。

### 2.3 嵌套 retry 与资源 accounting

运行时必须分别记录以下计数，不得让嵌套层级互相伪装：

- **logical request**：一次已授权的 provider 语义请求；
- **provider transport attempt**：该请求的一次实际 transport 调用；
- **transport retry**：同一请求因明确可重试的瞬态错误进行的额外 transport attempt；
- **overflow recovery**：一次 compaction 后对原 logical request 的重新发送，最多一次；
- **compaction operation / summary attempt**：为生成 projection summary 的局部操作及其内部尝试；
- **tool operation attempt**：单个工具调用及其必要的局部重试。

必须满足：

1. 每层都有独立上限、错误分类和审计字段；
2. 一层的重试不得自动借用另一层的额度；
3. `overflow recovery` 不计入 transport retry，但实际 provider 调用必须计入 usage/成本观测；
4. compaction summary 的 retry 不得使原 logical request 无限重试；
5. 用户显式预算或部署策略如要计数，必须在产品文案中明确是按 logical request、实际 provider attempt、tool operation 或成本计量，不能笼统写“token quota”；
6. 预算触发后的停止状态必须仍为 `resource_limit` / `suspended`，并保留已完成与未完成 operation 的区分。

### 2.4 取消、工具、审批与教学权威不变量

取消必须通过 `AbortSignal` 传播到 provider、tool、compaction 和相关局部操作。取消或超时不等于学习成功，也不自动产生新的 Evidence/Outcome。

所有工具调用继续受到 capability policy、工作区信任、路径围栏、effect lattice 和 approval 约束。资源边界、compaction 或恢复不得绕过这些约束。

教学 authority 仍按以下优先级保持：

1. 学习工作区文件和 LearningSession ledger 是 AI 教学决策事实源；
2. SQLite、AgentRun、compaction summary、projection report、同步副本和 usage 不是教学 authority；
3. `TeachingTurnCoordinator` / host 是 outcome settlement 的唯一写入路径；
4. IPC 或 host settlement 必须携带并校验 `expectedRevision`；
5. fork / 恢复路径必须保持 `toolsReplayed:false`；
6. 任一恢复、资源边界或 compaction 失败都不得自动重放工具历史、重建外部写入或伪造 settlement。

### 2.5 Continuation 与恢复

当前实现可以选择保守策略：启动恢复将 in-flight run 标记为 `interrupted`，把不确定 operation 交给人工复核，不自动重放工具，也不自动重发原 provider 请求。用户继续时通过新的显式输入或确认动作建立新的 logical request / canonical turn。

若未来加入 host-owned continuation intent，至少必须持久化和验证：

- conversation / run identity；
- canonical base revision、turn identity 与最后 durable sequence；
- `expectedRevision`；
- canonical source digest、provider projection digest 与模型 / context-window identity；
- operation journal、idempotency key、tool-call ID 与已完成 `ToolOutcome`；
- cancellation / interruption 状态；
- approval 是否仍有效。审批默认不得自动复用，失效时必须重新请求。

任一绑定不匹配时必须 fail closed。恢复只允许继续尚未完成且仍满足 capability、approval、effect、revision 和资源策略的操作，绝不重放已完成工具。

### 2.6 文案、状态与可观测性

usage 可以继续作为本地、脱敏的分析与成本观察事实，但不能仅凭 usage 推断学习成功、教学结论或 provider quota。

用户可见状态至少应区分：

- `context_overflow` / `context_unrecoverable`：上下文几何失败；
- `retry_exhausted`：局部 retry 已耗尽；
- `no_progress`：语义活性守卫触发；
- `resource_limit`：用户显式预算或部署/组织策略或 emergency fuse 触发；
- `suspended`：运行被安全暂停，等待用户或管理员处理；
- `canceled` / `interrupted`：取消或运行中断；
- provider 的真实 `quota` / `billing` / `authentication` 错误。

`resource_limit` / `suspended`：

- 不得渲染为“provider token quota exhausted”；
- 不得被视为学习成功或自动生成 durable-success / budget fallback；
- 必须显示触发层、计数口径（若适用）、已完成和未完成的范围以及可用恢复动作。

### 2.7 参考项目的借鉴边界

对 `grok-build-main` 的复审结论是：其 compaction subsystem 以 context-window pressure 和 preflight overflow 为核心，并由 host 负责 persistence/replay/state commit；同时它存在可选的 `max_turns` 与显式 `/goal ... --budget N`。因此，本 ADR 采用以下有限借鉴：

- 借鉴 context geometry、工具 schema 计入、preflight overflow、pressure ladder 和嵌套局部 retry 的分层思想；
- 不把参考项目的 conversation compaction entry 或 summary persistence 当作 StudiumX 的教学 authority；
- 不把参考项目的可选 `max_turns` 或 `/goal --budget` 当作 provider quota；如 StudiumX 采用类似能力，必须归入用户显式预算或部署策略并按本 ADR 的资源状态处理；
- 不以“参考项目完全无预算”作为禁止 run-level 边界的理由。

## 3. 对既有政策的取代范围

本 ADR 取代既有文档中以下**绝对化**表述：把所有累计 token、provider/tool calls、duration 或 iterations 的 run-level 上限一律视为禁止，或把所有资源停止一律称为 provider quota。

本 ADR 不自动废除合理、透明且有明确语义的：

- 用户显式任务 / goal / run 预算；
- 部署者、组织或租户策略；
- 高位 emergency fuse；
- provider 或工具的真实局部限制；
- 语义活性守卫。

它也不取代 settlement sole-writer、`expectedRevision`、`toolsReplayed:false`、effect lattice、审批、工作区信任、路径围栏、secret isolation 或 teaching authority 边界。若其他 ADR 对这些边界另有更具体规定，应继续以更具体的安全、隐私、教学和 settlement 约束为准。

## 4. 实现状态与迁移要求

### 4.1 当前状态

本 ADR 标记为**需修订（部分实施）**，原因是当前运行时已经具备部分 context projection / compaction、局部 retry、取消与不自动恢复工具的能力，但本文涉及的完整资源分层、request-fit 合同、嵌套 retry accounting、统一 `resource_limit` / `suspended` 语义和所有部署策略接线不能仅凭文档宣称已完成。

已实现的窄范围证据包括：直接课程生成现在为一次 action 创建 host-owned 根 governor，并把工具研究与直接 provider 生成分到共享根账本的子 lane；首次结构化请求与单次紧凑重试累计其各自 provider 明确报告的 `total_tokens`，而子 lane 向父账本只转发新增 delta，避免累计读数重复计费或不同 lane 相互覆盖。仅 provider 明确报告的总 token 可触发该 token 资源边界；component-only usage 仍只用于本地可观测性。研究、直接请求或紧凑重试若触发 `resource_limit` / `suspended`，课程生成终止且不会发布本地 fallback 课程。

Provider adapter 现在还在**每次实际网络 dispatch 之前**调用 host-owned transport preflight。因首 token timeout 的非流式 fallback、provider 拒绝 tool/function 后的 no-tool retry，以及两者嵌套产生的后续 fetch，都会分别 claim `provider_transport_attempts`；一个 facade 语义请求仍只记一次 `logical_requests`。preflight 位于 adapter 的网络错误包装之外，因此触发 `AgentRunResourceBoundaryError` 时保持为 host `resource_limit` / `suspended`，不会被改写为 provider network error。端到端单元测试覆盖 2 次 timeout fallback、2 次 tool-rejection fallback、3 次嵌套 dispatch，以及限制为 1 时在第二次 fetch 前停止。

用户显式预算现已具备一个窄的持久化 Settings 产品面：默认关闭；用户必须主动开启，并为**新启动的单次 run**设置实际 provider transport dispatch、工具 operation attempts、墙钟时长和 provider 明确报告的 `total_tokens` 上限。主进程在每次 run 启动时从已验证的 settings 生成 host-owned policy snapshot，再注入既有 conversation 与直接课程生成路径；启动 payload 不能提供或篡改这些 limits。命中后仍是 `resource_limit` / `suspended`，不是 provider quota、学习完成或自动重放。该预算未改变 emergency fuse、审批/effect、`expectedRevision`、settlement 或 teaching authority。
持久化 deployment/organization policy 现有一个窄的主进程来源：可选的、受限路径和大小的 `userData/studiumx-managed-config.json` 中仅 `resourceGovernance.deploymentPolicy.limits` 会被投影为部署策略。它在**每次新 run 启动**时读取并生成快照，不能由 renderer IPC、工作区、提示词或 Settings 写入；只保留已验证的 meter、正安全整数 limit、scope 与截断后的公开 `auditId`，其余字段（包括任何误放入的 secret）不会进入 policy/audit DTO。缺失、路径逃逸、非普通文件、超限、无效 JSON 或没有有效 limit 时均不创建 deployment boundary。该本地 managed 文件不是 MDM、远程策略拉取、电话回传或密钥存储功能；它只提供相对于 renderer 与工作区输入的持久化 host-owned 接线。

对于持久化的 failed checkpoint，启动时现在会只读投影 `resource_limit`、`suspended` 与 `retry_exhausted`：UI 保留资源层、计量、已用/上限和作用域（若有），并明确说明没有创建 canonical conversation settlement、不会重放 provider 或工具工作，用户必须开始新的明确回合。该投影不是 continuation intent，不改变 checkpoint 状态机、approval/effect、operation accounting 或 settlement sole-writer；它只补足重启后的可解释性。

这仍不表示完整 durable terminal UX 或所有 provider 路径均已完成治理迁移：可操作的 host-owned continuation intent，以及本文其余迁移要求仍未完成。managed deployment policy 仅是持久化主进程来源与 run-start snapshot；它不使该文件成为教学 authority，也不提供自动恢复、自动工具重放或管理员远程管理。

文档不得把“旧字段不再作为默认 stop”误写成“系统已经没有任何资源边界”，也不得把未接线的 host-owned continuation 或尚未覆盖的 provider 路径写成已实施事实。

### 4.2 迁移要求

1. 将 context geometry、局部操作边界、语义活性、emergency fuse、用户预算和部署策略建模为可区分的来源与错误结果。
2. 对 request-fit 记录 input、tool schema、framing allowance、output reserve、effective context window 及其估算来源。
3. 为 logical request、transport retry、overflow recovery、compaction summary attempt 和 tool operation 建立独立 accounting，避免嵌套 retry 形成隐藏调用。
4. 让 resource-limit 相关状态清楚区分用户预算、部署策略和 emergency fuse，并保证不写 teaching Evidence/Outcome，不伪造学习成功或 provider quota。
5. 保持正常 pre-send compaction 在同一已授权 logical request 内可自动继续；完成、取消、中断和恢复之后不得自动新建 canonical turn、重发 provider 或重放工具。
6. 保持 provider、tool、compaction 的取消传播，以及 capability policy、approval、effect lattice、路径围栏、`expectedRevision` 和 settlement sole-writer。
7. 对恢复建立 source/projection digest、operation idempotency、tool outcome 和审批失效的 fail-closed 验证；在未实现 host-owned continuation 时，启动恢复必须只中断/挂起并等待明确动作。
8. 为各类状态提供独立测试和文案：context error、retry exhausted、no progress、resource limit、suspended、canceled/interrupted 与真实 provider quota/billing/authentication。

## 5. 验收标准

- 正常运行不会因为一个不透明、默认、低位的累计计数被误称为 provider quota 并静默结束。
- 用户显式预算、部署/组织策略和 emergency fuse 均可被单独配置、审计和解释，触发后显示 `resource_limit` 或 `suspended`，不显示学习成功。
- context-fit 估算包含 input、tools、framing 和 output reserve。
- 普通 pre-send compaction 可以在同一已授权 logical request 内继续发送；跨完成、取消、中断或恢复不会自动创建新的 canonical turn。
- overflow recovery、transport retry、compaction summary retry 和 tool retry 的 accounting 分离且有界。
- compaction 只改变 provider projection，不成为 Evidence、Outcome 或 settlement authority。
- 所有工具调用继续经过 approval、effect lattice、工作区信任和路径围栏；恢复保持 `toolsReplayed:false`。
- settlement 仍由 `TeachingTurnCoordinator` / host 唯一写入，并校验 `expectedRevision`。
- `resource_limit` / `suspended`、context error、provider quota、canceled/interrupted 和学习成功不会互相混淆。
- 本 ADR 的状态仍为“需修订/部分实施”，直到上述合同在实现、诊断和测试中得到对应证明。

## 6. 非目标

- 不取消 provider 的真实上下文、输出、billing 或账户限制；
- 不承诺无限 provider retry、无限 context-overflow recovery 或无限工具执行；
- 不把 SQLite、AgentRun、compaction summary、projection report、同步副本或 usage 升格为教学 authority；
- 不绕过审批、effect lattice、工作区信任、路径围栏、`expectedRevision` 或 settlement sole-writer；
- 不在取消、失败、资源限制、挂起或恢复时自动重放工具或重建外部写入；
- 不在本 ADR 中实现 host-owned continuation intent，也不以本文替代具体安全、隐私、provider 错误或 settlement ADR。


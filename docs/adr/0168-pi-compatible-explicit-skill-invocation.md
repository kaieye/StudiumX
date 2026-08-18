# ADR-0168：Pi 兼容的显式 Skill 调用

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已采纳（2026-08-01）
- **日期：** 2026-08-01
- **范围：** 用户显式 `/skill:<id> [args]` 调用的解析、主进程展开、审计投影和 renderer 菜单语义
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0163](0163-teaching-capability-selection-and-plan-preview.md)、[ADR-0164](0164-unified-teaching-chain-and-skill-admission.md)、[ADR-0167](0167-teaching-authority-and-syncable-user-state.md)
- **证据：** `src/shared/explicit-skill-invocation.ts`、`src/main/explicit-skill-invocation.ts`（parser/resolver）、`src/main/teaching-conversation-runtime.ts`（overlay 注入）；测试见本 ADR「验证」节。

## 决定

1. 显式 `/skill:<canonical-id>` 是**本轮用户授权的 instruction overlay**。在 teaching mode，它总在本轮动态 user message 中注入经验证的完整 Skill body，且不受 planner 的 `active_now` 筛选；planner、ledger、outcome settlement 与 formal teaching authority 不变。
2. 第一阶段仅支持一条位于输入开头的 invocation。`/a /b` 的旧多前缀语义不被解释为多个全文注入。旧 `/id [args]` 仅作为 compatibility parser，最迟于 **2026-12-31** 移除；菜单和新写入一律使用 `/skill:<id>`。
3. 解析、catalog 查找、验证读取、frontmatter 剥离和展开全部在 main process 进行。renderer 只能提交原始 input，不能提交路径或 body。
4. 为避免本地绝对路径进入 provider prompt，使用稳定虚拟位置 `skill://<id>/SKILL.md` 和 base `skill://<id>/`。这是 pi **语义兼容**而非绝对路径的字节级兼容；相对资源只可经既有 `read_skill_resource`，并继续受 root containment、symlink、`read` effect 和 capability policy 约束。
5. 单 body 硬上限为 48,000 UTF-16 code units，超限 fail-closed，不截断、不调用 LLM、不执行工具或 settlement。不得以累计 agent-run token 预算阻断已验证 invocation；运行时迁移要求见 [ADR-0171](0171-continuous-agent-runs-and-context-governance.md)。
6. 已应用 invocation 使用不可变 digest、字符数、canonical id、args 和时间作为 conversation metadata。raw user input 继续是历史 user turn；full body、真实 file path/baseDir 和 secret 不进入 public DTO、doctor、support bundle 或同步 payload。fork/replay 使用原历史 raw input 并在新的实际执行前重新解析；fork 永远保持 `toolsReplayed:false`。
7. `disable-model-invocation: true`（若存在于 Skill frontmatter）只影响未来自动 discovery，不影响用户显式调用。本 ADR 不引入自动 discovery。
8. applied/rejected/failed 状态均由 host-authoritative resolver 产生。renderer 仅展示脱敏 evidence；卡片不代表 tool execution、teaching evidence 或教学计划变更。

## 后果

- ADR-0151 的 stage-scoped body rule 继续适用于 planner-managed bodies；本 ADR 的 explicit overlay 是唯一、单轮、用户发起的例外。
- 稳定 system prefix 不包含 explicit body，因此不破坏 prompt-cache identity。
- streaming steer/follow-up 不支持 Skill expansion：以 `/skill:` 开头的 steer/follow-up 必须返回明确 rejection，直到单独 ADR 扩展其持久化语义。

## 验证

- parser/resolver golden tests；未知、读取失败、空正文、超限和 legacy parsing 的 fail-closed tests；
- runtime test 证明 overlay 进入 provider user message 而不被 active-stage filter 删除；
- renderer tests 覆盖 Tab only-complete、Enter complete-and-submit 和 evidence card；
- `typecheck`、security、tool contract、teaching evidence 与 IPC gates。

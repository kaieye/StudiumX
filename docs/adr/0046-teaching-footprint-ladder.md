# ADR-0046：Teaching Capability Footprint Ladder

- **状态：** 已采纳
- **日期：** 2026-07-20
- **范围：** Teaching capability 的产品级扩张顺序、临时对话工具边界，以及 TeachingCommand 的单源消费
- **相关：** [ADR-0014](0014-learner-safe-teaching-turn-presentation.md)、[ADR-0022](0022-teaching-capability-catalog-read-only-readiness.md)、[ADR-0024](0024-typed-tool-dispatcher-effect-policy.md)、[ADR-0032](0032-conservative-parallel-read-tools.md)、[ADR-0044](0044-teaching-prompt-cache-contract.md)、Hermes×Reasonix §1.2（已结项）

## 背景

Teaching 能力可以通过 skill、宿主命令、受 gating 的 tool、MCP 或新的 core model tool 暴露。它们的成本、权限和 prompt/schema 面积不同：越靠近模型 core，越容易把一次性的产品能力变成每轮、每个 provider 都要携带并付费的公共表面。

因此，能力扩张需要一个产品级 Footprint Ladder，而不是每次需求都直接新增 model tool。该阶梯也必须与现有的 effect policy、CapabilityCatalog、learner-safe presentation 和只读工具约束相容。

## 决策

Teaching capability 按以下 **1→5** 顺序评估和实施；只有前一阶不能合理满足产品需求时，才进入后一阶。第 5 阶是最后手段，因为 core model tool 会扩大模型 schema、权限审查面和 provider 成本。

| 阶 | 形态 | Teaching 例子 | 约束 |
| --- | --- | --- | --- |
| 1 | 渐进 skill 资源 | `read_skill_resource` | 优先通过已加载 skill 的声明资源提供只读知识；不得借资源读取绕过路径、manifest 或 capability 校验。 |
| 2 | Host/IPC 命令（不是 model tool） | 导入课程、打开 inspector | 由宿主/UI 处理确定性产品动作；不把命令伪装成模型可调用工具，也不因此开放 shell 或诊断控制。 |
| 3 | capability-gated tool + readiness | 仅在配置了 web provider 且 readiness 通过时暴露 search | 只有就绪能力进入该轮 schema；仍受 typed effect policy、参数校验和 fail-closed 约束。 |
| 4 | 可选 MCP（用户 opt-in） | 用户配置的外部 MCP tools | 见 [ADR-0127](0127-user-configurable-mcp-design-gate.md)/[0128](0128-user-configurable-mcp-implementation.md)：默认 off、无 marketplace；临时与教学 **同样**可注入；不能把 MCP 当无门禁扩张路径。 |
| 5 | core model tool | `generate_lesson`、`ask`、workspace read/write | 仅在 1–4 无法满足且另有明确 design gate/ADR 批准时新增；逐工具评估 provider 成本、权限、审计和 schema footprint。 |

### 临时对话与教学对话的差距（仅限教学文件生成）

**修订（2026-07-22，与 [ADR-0127](0127-user-configurable-mcp-design-gate.md) / [ADR-0128](0128-user-configurable-mcp-implementation.md) 对齐）：**

产品要求临时 chat 与 teaching chat **不要**维持「大面积 schema 严格子集」。两者的 **tool 表面差距仅限教学文件生成 / 教学产物落盘**，其余用户已启用的能力（含 **用户配置 MCP**、web 工具、workspace 读写审批路径等）应对齐。

```
temporary-chat tools ≈ teaching-chat tools \ { 教学产物写工具 }
```

| 对齐 | 说明 |
| --- | --- |
| **应对齐** | 用户 opt-in MCP、已有 readiness 的 external 工具、workspace 工具门禁、effect lattice、审批 UX |
| **应排除（临时）** | `generate_lesson` 及专用于 Lesson/Course/正式 learning record 产物生成的 model tools；临时对话 **不是** LearningSession settlement 写口 |
| **仍禁止** | shell / marketplace / YOLO / 诊断控制面；临时 **不得**获得 teaching 也没有的超集能力 |

历史表述「temporary-chat schema ⊂ teaching-chat schema」**废止为产品主约束**；若实现仍对临时做额外收窄，须有独立产品理由并开 ADR，不得默认裁 MCP。

“复用实现”仍不等于“无门禁”：对齐的是 **可用集合**，不是绕过 effect / path containment / 同意门。

### Plan-mode 是未来 overlay，不是平行阶梯

如果未来需要“备课只读”或类似 plan-mode 能力，它只能作为叠加在 Footprint Ladder 之上的、明确 fail-closed 的模式 overlay：marker 放在 user turn，禁止 writer，并沿用已有的能力 readiness/effect policy。不得另起一套与 ladder 平行的模式命名或工具目录来替代阶梯，也不得把 plan-mode 的存在解释为当前新增 capability 的授权。

### 并行只读保持 ADR-0032

只读工具的有界并行仍由 [ADR-0032](0032-conservative-parallel-read-tools.md) 负责。本文不重定义 parallel-read 调度、并发上限、失败语义或 effect 分类；Footprint Ladder 只决定能力应先以哪种产品形态出现。write/privileged tool 不因进入 ladder 而获得并行资格。

### TeachingCommand 单源

教学 composer 的 slash 命令保持封闭 union，并由 `src/shared/teaching-command.ts` 的 `TEACHING_COMMANDS` 作为唯一 catalog。解析、发现、执行策略查找、composer/UI 以及帮助/文档展示都从该表派生；不得在 renderer、help 文档或其他 shared module 维护重复的命令、label、description 或 alias 表。`listTeachingCommandsForHelp()` 是帮助/UI 的显式读取入口，但不创建第二份数据。

该边界也意味着：**用户自定义 Markdown slash 命令不在范围内**。Markdown/skill 文档可以提供说明和渐进资源，但不能声明新的 `/command`、改变 TeachingCommand union，或把文档内容变成任意 tool dispatch。需要新增教学 slash 命令时，必须修改单一 registry、补齐 policy/tests，并按现有架构审查，而不是读取用户 Markdown 动态扩展目录。

## 后果

### 正面

- 将能力扩张从“新增一个 tool”改为可审计的产品决策，优先扩大边缘能力而不是 core schema。
- 临时对话不会成为隐性权限升级路径；teaching chat 仍是更大的、但受治理的集合。
- command composer、parser、resolver、UI 和帮助文档不会因重复 catalog 而漂移。
- 保留 ADR-0032 的并行只读边界，避免本 ADR 误授权 write/privileged 并发。

### 成本与限制

- 某些看似简单的能力需要先设计 host/IPC 或 readiness gate，而不能直接暴露给模型。
- MCP 和新的 core tool 默认延期，必须承担额外的安全、成本和 schema 证据。
- 用户不能通过 Markdown 自定义教学 slash；命令变更必须经过代码、测试和架构边界审查。

## 非目标 / 不授权

- 不新增 shell、terminal、diagnostics、debug、generic agent-control 或任意代码执行能力。
- 不扩充现有 TeachingCommand catalog；本 ADR 只规定其单源消费方式。
- 不把临时 chat 变成 teaching chat 的**超集**（不得比 teaching 多 tool / 多写权威）；**允许**与 teaching 对齐，仅排除教学产物写工具（见上节；ADR-0128）。
- 不批准当前实现 plan-mode；它只是未来可能的 overlay。
- 不改变 ADR-0032 的并行只读实现或任何现有 tool effect policy。
- 不允许用户 Markdown、skill 文案或模型自由文本动态注册 slash 命令或工具。

## 验证入口

- `tests/unit/teaching-command.unit.test.ts`：验证封闭 catalog、解析/发现、执行 gating，以及帮助/UI 入口与 `TEACHING_COMMANDS` 的单源关系。
- `src/shared/teaching-command.ts`：`TEACHING_COMMANDS`、`listTeachingCommandsForHelp()`、parser/discovery/resolver 的唯一实现入口。
- 新增第 4 或第 5 阶能力时，必须另行提供 capability/readiness、effect-policy、成本/权限和失败语义的测试与 ADR/design gate 证据。


> **2026-07-23 补记：** 表中「禁 marketplace」指 **不作为默认 footprint / 授权旁路**；MCP marketplace **main foundation** 见 ADR-0140，**Settings 无市场 UI** 见 ADR-0142。勿将本表读成「永久删除 store」。

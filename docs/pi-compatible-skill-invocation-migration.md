# Pi 兼容的显式 Skill 调用迁移设计

- **状态：** 已由 [ADR-0168](adr/0168-pi-compatible-explicit-skill-invocation.md) 采纳并实施（2026-08-01）
- **创建日期：** 2026-08-01
- **参考实现：** `ref_project/pi`，Git 提交 `cee5ff7520d8828bed9955ef00419e995d1f91e0`（2026-07-26）
- **目标：** 让 StudiumX 中用户从 `/` 菜单明确选择一个 Skill 时，拥有与 pi 等价的显式调用语义：**菜单选择产生可执行的 slash invocation；提交 invocation 后读取该 `SKILL.md`；把去掉 frontmatter 的完整正文包装为 `<skill>` 块，并与用户任务一起进入该轮 LLM user message；聊天记录显示可展开的 Skill 调用证据。**
- **非目标：** 本文不授权实现，不改变 settlement sole-writer、LearningSession ledger 的教学事实权威、effect lattice、工具审批、run budget、MCP 信任边界或默认 shell 关闭策略。

> 本文定义的是“显式用户调用 Skill”的兼容路径，而不是把 pi 的任意 agent/runtime 行为整体移植进 StudiumX。第 0 阶段 ADR gate 已由 ADR-0168 完成；实现仍必须遵守 ADR-0044、ADR-0151、ADR-0163、ADR-0164 的既有边界。

---

## 1. 问题与期望行为

### 1.1 当前问题

当前 StudiumX 的 `/` Skill 菜单更接近“输入补全”：选中某项后，输入框仅变成 `/skill-id `。只有随后发送消息时，renderer 才把从前缀推断出的 `skillIds` 交给 host；host 再由编排器决定该 Skill 是否是当前阶段的 `active_now` body。结果是：

1. 用户选择时没有发生可见调用；
2. 菜单中可见的 Skill 不保证能被教学编排器加载；
3. 发送后没有显示“哪个 Skill 实际被注入、哪个被拒绝/延后”；
4. 在教学模式中，个人 Skill 或非当前阶段 Skill 常被过滤，用户会合理地认为“选了但没用”。

现有关键路径：

```text
SkillSlashMenu.pick()
  -> textarea value = `/skill:${skill.id} `
  -> App 提交时计算 skillIds
  -> agentChatStream IPC
  -> mergeSelectedSkillIds()
  -> planSkillOrchestration()
  -> skillIdsForBodyLoad()
  -> filterSkillReferencesToActiveBodies()
  -> composeTeachingUserTurn()
```

### 1.2 目标交互（与 pi 对齐）

以下交互应成为兼容模式的规范行为：

```text
用户输入 /
  -> 看到已安装 Skill 菜单
  -> 方向键选择 / Enter 确认
  -> 编辑器得到 /skill:<canonical-name> [可选参数]
  -> Enter 提交（Tab 仅补全、不提交）
  -> host 读取对应 SKILL.md
  -> 去掉 YAML frontmatter
  -> 组装 <skill name="…" location="…">完整正文</skill>
  -> 追加用户参数/任务
  -> 作为该轮 user message 发给模型
  -> 对话中显示可折叠 [skill] <name> 证据项
```

期望样例：

```text
输入：/skill:learning-assessor 根据我刚才的答案判断薄弱点

实际发送给模型的 user message（StudiumX 使用 ADR-0168 规定的私有虚拟位置，而非泄露绝对路径）：
<skill name="learning-assessor" location="skill://learning-assessor/SKILL.md">
References are relative to skill://learning-assessor/.

# Skill 正文（已去 frontmatter）
...
</skill>

根据我刚才的答案判断薄弱点
```

仅输入并发送 `/skill:learning-assessor` 也是有效调用：模型收到完整 Skill body，且没有额外用户任务文本。这是 pi 的行为，必须保留。

---

## 2. pi 的参考语义（必须逐项兼容）

### 2.1 发现、metadata 与自动渐进式披露

pi 从 Skill 根目录读取 `SKILL.md` frontmatter，得到：

```ts
type Skill = {
  name: string
  description: string
  filePath: string
  baseDir: string
  disableModelInvocation: boolean
}
```

对于未设置 `disable-model-invocation: true` 的 Skill，pi 只将以下索引放入 system prompt：

```xml
<available_skills>
  <skill>
    <name>...</name>
    <description>...</description>
    <location>absolute-path-to-SKILL.md</location>
  </skill>
</available_skills>
```

模型任务匹配时自行通过 read 工具读取文件。这是 **metadata → 按需读取正文** 的自动渐进式披露。

参考文件：

- `ref_project/pi/packages/coding-agent/src/core/skills.ts`
  - `loadSkills()` / `loadSkillsFromDir()`
  - `formatSkillsForPrompt()`
- `ref_project/pi/packages/coding-agent/src/core/agent-session.ts`
  - system prompt 重建时加入 `formatSkillsForPrompt()`

### 2.2 显式调用不依赖模型自行读取

pi 另为每个 Skill 注册 slash command：

```text
/skill:<skill.name>
```

Skill 设置 `disable-model-invocation: true` 时，只禁止自动 metadata discovery；**不禁止显式 `/skill:name` 调用**。

参考：

- `ref_project/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
  - `createBaseAutocompleteProvider()`

### 2.3 autocomplete 的提交语义

pi 的组合 autocomplete 行为：

| 操作 | 结果 |
| --- | --- |
| Tab 选择 slash item | 仅补全为 `/skill:name `，继续编辑 |
| Enter 选择 slash item | 补全为 `/skill:name `，随后继续 submit |
| 鼠标/键盘发送已补全的文本 | 调用 `AgentSession.prompt()` |

参考：

- `ref_project/pi/packages/tui/src/autocomplete.ts`：`CombinedAutocompleteProvider.applyCompletion()`
- `ref_project/pi/packages/tui/src/components/editor.ts`：slash autocomplete confirm 后 fall through to submit

### 2.4 Pi 参考正文展开语义

pi 的 `AgentSession._expandSkillCommand(text)`：

1. 只匹配开头为 `/skill:` 的文本；
2. 取 command name 与第一个空格后的 args；
3. 从当前 resource loader 的 Skill 表中以 name 精确查找；
4. 同步读取 `skill.filePath`；
5. `stripFrontmatter(content).trim()`；
6. 生成：

```xml
<skill name="{name}" location="{filePath}">
References are relative to {baseDir}.

{body}
</skill>
```

7. 有 args 时加两个换行后追加 args；没有 args 时只发送 `<skill>` 块；
8. 读文件失败时记录扩展错误并保留原始文本，不伪造成功。

参考：

- `ref_project/pi/packages/coding-agent/src/core/agent-session.ts`
  - `_expandSkillCommand()`
  - `prompt()`、`steer()`、`followUp()`

### 2.5 对话可见证据

pi 会从持久化 user message 解析 `<skill>` 块，并渲染一个默认折叠的条目：

```text
[skill] learning-assessor (expand to view)
```

展开后查看完整 body；若 invocation 带 args，普通用户任务仍单独显示。该显示是**证据与可解释性**，不改变 prompt。

参考：

- `ref_project/pi/packages/coding-agent/src/core/agent-session.ts`
  - `parseSkillBlock()`
- `ref_project/pi/packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts`

---

## 3. StudiumX 的目标兼容合同

### 3.1 Slash 语法：采用 pi 规范，保留旧语法的迁移期适配

目标 canonical syntax：

```text
/skill:<skill-id> [user task]
```

示例：

```text
/skill:learning-assessor 评估我对二分查找的理解
/skill:teach
/skill:my-personal-pack 帮我完成这件事
```

迁移期可解析旧语法：

```text
/learning-assessor 评估我对二分查找的理解
```

但 renderer 菜单、持久化 invocation、聊天显示、测试夹具和文档都应以 `/skill:<id>` 为唯一输出格式。旧格式只作为受限 compatibility parser，设定删除版本/日期后移除。

### 3.2 显式 invocation 的优先级

对于本轮输入，显式 `/skill:<id>` 的语义必须是：

> “用户要求本轮将该 Skill body 直接提供给模型。”

这不是“建议 planner 在某个未来阶段可能使用它”，也不是“仅作为 metadata 供模型猜测”。因此下列现有行为不能再吞掉显式调用：

- 仅因 Skill 不在当前 orchestration stage 就不加载；
- 仅因其不是 `active_now` 就静默删除；
- 菜单显示但 host 无结果、UI 无解释。

但这一优先级**不等于**授权该 Skill 改写教学权威或绕过安全边界；第 5 节定义不可绕过项。

### 3.3 单 Skill invocation：第一期采用 Pi 语义兼容

第一期支持单一开头 invocation：

```text
/skill:<id>
/skill:<id> <args>
```

输入中未识别的 `/skill:<id>`：保留文本并按普通消息处理，或返回明确的、用户可理解的“Skill 不存在/未安装”本地错误。选择其中一种并以 ADR 固化；不得静默地显示成功。

读取失败：返回明确错误，不运行一个缺少 Skill body 的“降级成功”回合。

### 3.4 多 Skill：不属于 pi parity 第一阶段

现有 StudiumX 支持连续前缀：

```text
/a /b task
```

而 pi 的 `_expandSkillCommand()` 只明确展开一个开头 `/skill:name`。为保持“完全像 pi”的第一期验收，先不将多个显式 Skill 一次性全文注入。

后续若要保留多 Skill：必须单独设计：

- 固定的 invocation 顺序；
- 每个 body 的边界与来源；
- 聚合 prompt hard budget；
- UI 中每个 body 的折叠证据；
- 一条失败时是 fail-whole-turn 还是 partial；
- 对 teaching authority / 编排 plan 的关系。

不得在 pi parity 实施过程中偷偷把旧的 `/a /b` 语义当作多个全文注入。

---

## 4. 建议的目标架构

### 4.1 端到端流程

```text
Renderer textarea
  / + 菜单发现
  -> 选择得到 /skill:<id>
  -> Enter 提交 / Tab 仅补全

Renderer command parser
  -> 产生原始 userInput（保留用户输入原文）
  -> 不将展开后的 body 放到 renderer IPC payload

Main IPC gateway
  -> 严格校验 payload / expectedRevision
  -> TeachingConversationRuntime

ExplicitSkillInvocationResolver（新增，main-only）
  -> parse leading /skill:<id>
  -> 从本地 SkillLibrary 查 manifest + SKILL.md
  -> 验证安装/路径/大小/编码/前置安全规则
  -> strip frontmatter
  -> 构造 InvocationEvidence 与 expandedUserText

Prompt composer
  -> stable system prefix（保持缓存契约）
  -> 既有教学 kernel / 动态编排上下文（按 ADR 决定最终关系）
  -> 显式 <skill>...</skill> + args 的 user message

Conversation persistence/presentation
  -> 持久化实际发送的 expanded user content 或等价不可变 Invocation record
  -> 投影出可折叠 SkillInvocation evidence

LLM / tools / settlement
  -> 既有 ToolRegistry、effect lattice、approval、ToolOutcome、TeachingTurnCoordinator
```

### 4.2 新的核心数据模型

不要让 renderer 传 `filePath` 或 Skill 正文。renderer 只可传原始文本和（如需要）受限的 skill id。主进程从已安装本地 catalog 解析路径。

建议新增 shared/main-only 交界类型：

```ts
export type ExplicitSkillInvocation = {
  syntax: 'pi_compatible_v1'
  requestedToken: string           // 例如 skill:learning-assessor
  skillId: string                  // canonical catalog id
  displayName: string
  filePath: string                 // 仅 main/persistence 内部，禁止 public DTO / Doctor
  baseDir: string                  // 仅 main/persistence 内部
  bodySha256: string               // 诊断/审计可用；不可用作教学 authority
  bodyChars: number
  invokedAt: string
  args?: string
}

export type ResolvedExplicitSkillInvocation = {
  invocation: ExplicitSkillInvocation
  expandedUserText: string
}
```

如果 public conversation projection 需要显示它，必须使用脱敏 DTO：

```ts
export type SkillInvocationPresentation = {
  skillId: string
  displayName: string
  args?: string
  bodyChars: number
  bodyTruncated: boolean
  state: 'applied' | 'rejected' | 'failed'
  reason?: 'not_installed' | 'read_failed' | 'budget_exceeded' | 'not_allowed'
}
```

**禁止**在 public DTO、Doctor、support bundle 或远程同步 payload 中暴露 `filePath`、`baseDir`、完整 body、token/secret 或任意未经脱敏的本地内容。

### 4.3 解析器与展开器

建议新增一个纯 parser 和一个 main-only resolver：

```ts
parseExplicitSkillInvocation(input: string):
  | { kind: 'none' }
  | { kind: 'candidate'; skillId: string; args: string }
  | { kind: 'invalid'; reason: 'malformed' }

resolveExplicitSkillInvocation({ input, skillLibrary, policy, budget }): Promise<
  | { ok: true; expandedUserText: string; presentation: SkillInvocationPresentation }
  | { ok: false; error: ExplicitSkillInvocationError; presentation: SkillInvocationPresentation }
>
```

`expandedUserText` 采用 ADR-0168 固定的 Pi **语义兼容**包装格式：

```text
<skill name="{canonicalName}" location="skill://{canonicalId}/SKILL.md">
References are relative to skill://{canonicalId}/.

{stripFrontmatter(body).trim()}
</skill>

{args}
```

ADR-0168 已选择安全等价方案：绝不将绝对 `filePath` 或 `baseDir` 发送给 provider。相对资源只能通过现有、受控的 `read_skill_resource` 工具解析；因此这不是绝对路径的字节级 parity。

### 4.4 读取相对文件

pi 在 `<skill>` 中告诉模型相对路径的 baseDir，并依赖其 read 工具。StudiumX 不得因兼容而给模型新增未批准的任意文件读取能力。

迁移必须复用或扩展现有受控 `read_skill_resource` 工具：

- path 必须限定在当前已解析 Skill 的 `baseDir`；
- 不能通过 `..`、symlink 或绝对路径逃逸；
- 工具仍属于 `read` effect；
- tool result 仍受 TOOL_CONTRACT 及 result budget 约束；
- 无 `tools.enabled` 时，模型只可使用已注入 body，不可静默读更多文件。

这与 pi 的“正文可按需继续读”在功能上相当，但不放松 StudiumX 的路径围栏。

---

## 5. 与 StudiumX 产品地板的兼容规则

此处是实现的硬约束，不是可选优化。

### 5.1 教学事实权威不转移

显式 Skill invocation 是用户本轮请求的上下文，不是教学事实来源。它不得：

- 直接写 LearningSession ledger；
- 成为 learning progress、答题表现、下一步教学计划的 canonical evidence；
- 绕过 `TeachingTurnCoordinator` / host 的 settlement sole-writer；
- 让 Skill 本文自行声明或提升教学 authority。

### 5.2 工具与审批不变

Skill body 只能影响模型的自然语言指令，不能改变：

- ToolRegistry；
- effect lattice：`read` / `workspace_write` / `external_write` / `privileged`；
- approval policy；
- 路径围栏；
- `expectedRevision`；
- ToolOutcome / settlement 机制。

禁止通过 Skill 内容引入 YOLO、always approve、shell escalation 或绕过审批的通道。

### 5.3 无默认 shell 与无默认 remote telemetry

显式 invocation 不可：

- 在 `tools.enabled` 关闭时执行 shell；
- 暗中上传 Skill body、调用记录、路径或内容；
- 把 body 放入默认远程 telemetry；
- 放宽 support bundle / Doctor 脱敏策略。

### 5.4 Prompt 预算仍必须是硬约束

pi 的实现可直接全文注入；StudiumX 不能因此移除已有硬预算。

ADR-0168 已选择以下策略：

| 方案 | 与 pi 的相似度 | 风险 |
| --- | --- | --- |
| A. 单 Skill body 允许全文、仅受一个足够大的硬上限 | 最高 | 超大 Skill 造成上下文/成本失控 |
| B. 全文直到 hard cap，超限时本地报错且不启动回合 | 高，fail-closed | 大 Skill 不能调用，需要用户缩减 |
| C. 自动截断并继续 | 较低 | 用户以为“完整调用”但正文不完整 |

为了满足“完全像 pi”，推荐 **B**：将正文完整注入，超过明确 hard cap 则返回本地错误，绝不静默截断。动态 body、历史消息和 tool results 的既有预算仍适用。

### 5.5 教学编排的关系必须显式决策

当前 ADR-0151/0163 模型中，非 kernel full body 仅允许当前 `active_now` 阶段进入教学 turn。pi-compatible 显式 invocation 与此冲突。

ADR-0168 已选择以下模型：

1. **Override 模型（推荐给“完全像 pi”）：** 显式调用是用户授权的 invocation overlay，本轮总会注入 body；planner 仍只负责计划展示与后续行为，不能删除该 body。
2. **Reject 模型：** 对教学模式禁止显式 pi-style invocation，只在 temporary mode 支持。此方案不满足本提案目标。
3. **Dual confirmation 模型：** 用户选中后显示编排预览，确认后才注入。这不是 pi parity，不应作为第一期。

若采用 Override 模型，必须明确：该 body 是 **用户指令上下文**，不是 formal teaching authority；planner 的任何教学决策仍只能依据 ledger/workspace evidence。

---

## 6. 分阶段迁移计划

### 阶段 0：Architecture / ADR gate（必须先完成）

**交付：** 新 ADR，或更新 ADR-0044、ADR-0151、ADR-0163、ADR-0164，并更新 `docs/adr/README.md`。

ADR 必须回答：

1. teaching mode 中 explicit invocation 是否采用 Override 模型；
2. 是否传绝对路径给模型，还是使用虚拟路径；
3. 超预算是拒绝还是截断；
4. `disable-model-invocation` 是否引入，以及它对显式调用的含义；
5. 已解析 body 的持久化策略：保存 expanded text、保存不可变 snapshot、还是保存 digest + 可重建 reference；
6. conversation fork / replay 时是否重读当前文件，还是重放历史 snapshot；
7. path/secret/privacy DTO 边界；
8. 旧 `/id` 语法的弃用窗口。

**未完成 ADR gate 前，不可实现正文直接注入。**

### 阶段 1：纯解析与本地 resolver（无 UI 行为变化）

新增：

- `parseExplicitSkillInvocation()` unit tests；
- `resolveExplicitSkillInvocation()` unit tests；
- frontmatter strip、未知 skill、未安装、读失败、空 body、超限、路径逃逸、重复空白参数测试；
- 与 pi fixture 的 golden tests。

验收：

```text
/skill:test explain this
```

解析后生成的 `<skill>` 结构、换行、args 拼接与 pi test 中的语义相同。

### 阶段 2：主进程 prompt 接线与持久化证据

在 `TeachingConversationRuntime` 的构造 user message 前调用 resolver：

```text
raw userInput
  -> explicit resolver
  -> expanded user text
  -> ChatMessage(role=user)
```

要求：

- renderer 不可伪造 body/path；
- IPC schema 仍要求 `expectedBranchRevision`；
- invocation 解析、读取、预算失败均在 LLM 调用前失败；
- 失败不写 teaching outcome、不执行工具、不产生“完成”状态；
- streaming `steer` / `follow-up` 的行为也必须有对应展开语义，或第一期明确拒绝并给出错误；
- fork/replay 保持原 invocation 的可审计性，且不得让 `toolsReplayed` 变为 true。

### 阶段 3：Renderer 菜单改为 pi 语法与键盘语义

修改方向：

- `SkillSlashMenu` 输出 `/skill:${id} `；
- Tab：仅填充并保持编辑；
- Enter：选中菜单项时填充后提交；
- 鼠标选择：必须明确设计为“仅填充”还是“填充并提交”；推荐与 Tab 一样仅填充，避免误发无参数 invocation；
- 未输入任务而 Enter 调用时，允许发送单独的 Skill invocation；
- 显示调用前的轻量状态，不要宣称“已执行工具”或“已改变教学计划”。

### 阶段 4：对话证据卡与可展开正文

新增 renderer projection：

```text
[skill] learning-assessor
展开：显示调用参数、body（或受权限限制的安全展示）、是否完整、大小、解析时间
```

展示规则：

- 卡片代表实际应用的 invocation，不能仅依据用户原始 `/skill:` 文本推断；
- resolver 失败时显示 rejected/failed，不伪装成功；
- card 不能泄漏 secret 或受保护本地路径；
- 用户消息中的 args 与 Skill body 分开显示；
- 要有无障碍 `aria-expanded`、键盘操作和长正文滚动/裁剪策略。

### 阶段 5：自动渐进式披露（可选，晚于显式 parity）

如果要实现 pi 的自动 skill discovery：

1. 将安全的 name/description/location index 放入稳定 system prefix；
2. 引导模型在任务匹配时调用 `read_skill_resource`；
3. `disable-model-invocation` 的 Skill 不进入索引；
4. 对模型 read 的 Skill 也显示 provenance，但必须与“用户显式调用”视觉区分；
5. 不得因为模型 read 了 Skill 就改变其 formal teaching authority。

此阶段不应与阶段 1–4 合并，以免难以判断体验/权限/预算问题的来源。

### 阶段 6：移除旧的隐式 slash 编排路径

在迁移期 telemetry-free 的本地诊断和测试确认后：

- 去掉 `/id` 作为主输出；
- 删除 `leadingSkillIdSequence()` 作为隐式 prompt-body 选择来源，或把它严格限制为 legacy parser；
- 将多 Skill 编排搬到显式 Capability Picker / orchestration plan，而不是让一串裸 slash 命令兼任两种含义；
- 更新用户文档、i18n、测试与 ADR。

---

## 7. 建议的文件级改动地图

下列是后续实施的起点，不代表可以跳过代码探索后直接批量修改。

| 区域 | 现有文件 | 预计改动 |
| --- | --- | --- |
| Slash parser | `src/shared/skill-command.ts` | 加 `/skill:<id>` parser；保留旧 parser 的限期兼容层；不要在 shared DTO 中暴露路径/body。 |
| 菜单 | `src/renderer/src/skills/SkillSlashMenu.tsx` | canonical 菜单 value 改为 `/skill:<id> `；实现 Enter/Tab 差异。 |
| Composer | `src/renderer/src/App.tsx` | 只传 raw input / canonical selection；移除“菜单可见即正式可用”的误导。 |
| IPC | `src/shared/teaching-types/system-api.ts`、`src/main/teaching-ipc-commands.ts` | 保持严格 key allow-list；只有确有必要才调整 payload。 |
| 主进程解析 | **新增小模块**，如 `src/main/explicit-skill-invocation.ts` | parser/resolver、frontmatter strip、文件验证、预算、错误映射。 |
| Skill Library | `src/main/skill-library.ts` | 提供按 id 解析的受控读取 API；不要让 renderer 控制路径。 |
| Runtime | `src/main/teaching-conversation-runtime.ts` | 在构造 user ChatMessage 前处理显式 invocation；不能改 settlement 入口。 |
| Prompt | `src/main/teaching-conversation-prompt.ts` | 明确 explicit body 与 kernel / dynamic plan tail 的顺序和预算边界。 |
| 受控读取工具 | `src/main/ai/tools/skill-resource.ts` | 保持 Skill-root 路径围栏，支持相对引用。 |
| 对话投影 | agent conversation presentation / renderer turn components | 新增 applied/rejected SkillInvocation evidence card。 |
| 文档 | `docs/adr/*`、`docs/adr/README.md` | ADR gate 批准后同步修改。 |

模块尺寸政策：新增 resolver/presentation 模块应保持深模块、单一职责，避免把更多逻辑继续塞入 `teaching-conversation-runtime.ts`、`teaching-conversation-prompt.ts` 或 `App.tsx`。

---

## 8. 测试与验收矩阵

### 8.1 与 pi 的兼容测试

使用 pi 语义的 fixture，不依赖真实模型 API：

| 场景 | 输入 | 断言 |
| --- | --- | --- |
| 基本调用 | `/skill:test explain this` | user message 含 `<skill name="test" …>`、完整 body、`explain this`。 |
| 无参数 | `/skill:test` | 仅有完整 `<skill>` body，仍启动一轮。 |
| 忽略 frontmatter | `/skill:test` | YAML frontmatter 不出现在 body。 |
| relative path 提示 | `/skill:test` | body 开头含 pi-compatible `References are relative to …`。 |
| `disable-model-invocation` | `/skill:manual-only x` | 显式调用成功；自动索引不包含它。 |
| 未知 Skill | `/skill:missing x` | 本地 reject 或原样普通消息，必须符合 ADR 选择且可见。 |
| 读取失败 | `/skill:broken` | 不调用 LLM、不伪造成功、不写 outcome。 |
| Tab | `/` + Tab 选择 | 仅补全，不发送。 |
| Enter | `/` + Enter 选择 | 补全并发送 invocation。 |
| 证据卡 | 成功调用 | 对话出现折叠 `[skill]` item，可展开。 |

### 8.2 StudiumX 不变量测试

至少运行/扩展以下类别：

- `pnpm typecheck`
- `pnpm run check:security`
- `pnpm run check:tool-contract`
- `pnpm run check:teaching-evidence`
- `pnpm run check:teaching-ipc-contract`
- 相关 unit tests：Skill parser、runtime、prompt cache、orchestration、IPC、renderer

必须新增的专门断言：

1. explicit Skill text 不改变 ToolRegistry / effects / approval；
2. `tools.enabled=false` 时没有 shell 或隐式文件读取；
3. 读取 Skill 相对资源不能越过 Skill root；
4. public DTO、Doctor、support bundle 不含 `filePath`、`baseDir`、secret；
5. invocation 失败不写 settlement；
6. invocation 后 fork 仍保持 `toolsReplayed: false`；
7. `expectedRevision` 校验不被绕过；
8. prompt hard budget 超限是 ADR 指定的明确结果；
9. Teaching Kernel 仍缺失时 fail closed；
10. Skill 不可凭正文自称已完成课程/已保存学习记录，仍需真实 ToolOutcome 和 coordinator settlement。

---

## 9. 人工验收脚本

### 9.1 显式单 Skill

1. 安装一个有明显指令的测试 Skill，例如要求回答中包含一个唯一标记；
2. 在 teaching composer 输入 `/`；
3. 确认菜单显示 `/skill:<id>`；
4. 按 Tab：确认只补全、不发送；
5. 补充任务并发送；
6. 确认聊天记录出现 `[skill] <id>`；
7. 展开确认正文与实际 `SKILL.md` 一致（frontmatter 除外）；
8. 确认模型行为反映该唯一标记；
9. 确认不存在未审批的工具执行。

### 9.2 无参数直接调用

1. 输入 `/`；
2. 用 Enter 选择一个 Skill；
3. 确认该 invocation 直接提交；
4. 确认对话显示 `[skill]`；
5. 确认模型收到 body 而不是空消息。

### 9.3 错误可解释性

分别模拟：Skill 卸载、文件被删除、body 超硬限制、相对路径越界。每种情况都应显示失败原因，且不出现“Skill 已应用”的成功卡片。

---

## 10. 决策记录与风险清单

### 10.1 不能在实现时临时决定的问题

- 是否允许 teaching mode 中 personal Skill 的显式全文 injection；
- 绝对路径是否进入模型上下文；
- body snapshot/replay 与文件随时间变化的语义；
- full body 超限时的 fail-closed 策略；
- direct invocation 与现有 orchestration plan 的显示顺序；
- user 能否在同一轮 explicit invoke 多个 Skill；
- Skill body 是否显示给用户、显示到何种程度；
- `disable-model-invocation` 如何存储在现有 catalog/manifest 中。

### 10.2 主要风险及控制

| 风险 | 控制措施 |
| --- | --- |
| 任意个人 Skill 影响教学决策 | 显式区分“用户指令上下文”与 teaching authority；ADR 定义 override 边界；settlement 不变。 |
| 超大 body 占满上下文 | 单 Skill hard cap + fail-closed；不静默截断。 |
| 路径泄漏 | main-only path；public DTO 脱敏；必要时采用虚拟 URI。 |
| Skill 内相对文件绕过路径围栏 | 仅用受控 `read_skill_resource`，root containment + symlink 防护。 |
| UI 显示“已选”但 host 未应用 | evidence card 仅来自 resolver 成功结果。 |
| 历史 replay 因 Skill 文件更新而变化 | ADR 规定 immutable snapshot/digest/reload policy；测试 fork/replay。 |
| 破坏 prompt cache | explicit body 只放动态 user message，不污染稳定 system prefix。 |
| 破坏现有多 skill planner | 第一期单 Skill pi parity；多 Skill 后续独立设计。 |

---

## 11. 完成定义（Definition of Done）

“已完成 pi-compatible explicit Skill invocation”仅当以下全部满足：

- [ ] ADR gate 已批准并链接至 `docs/adr/README.md`；
- [ ] `/` 菜单输出 `/skill:<id>`；
- [ ] Tab/Enter 行为与本文第 2.3 节一致；
- [ ] `/skill:<id> [args]` 能在 main process 读取并展开完整 `SKILL.md`；
- [ ] 展开格式、frontmatter strip、args 拼接与 pi 语义一致；
- [ ] 显式调用不再被“非当前 `active_now`”规则静默删除（若 ADR 采用 Override 模型）；
- [ ] 成功/拒绝/失败都具有聊天内可见证据；
- [ ] Skill 相对资源读取仍受路径围栏和 effect lattice 约束；
- [ ] 预算、privacy、IPC revision、settlement、fork invariants 均有自动化测试；
- [ ] `pnpm typecheck` 及改动范围的 required domain gates 通过；
- [ ] 未引入默认 shell、YOLO/always-approve、远程 telemetry 或真实模型 API CI。

---

## 12. 实施时的简明执行顺序

```text
1. ADR gate：确定 override / 路径 / body budget / replay 语义
2. 写 resolver 的红灯测试（pi golden fixtures）
3. 实现 main-only parser + resolver
4. 接入 runtime 的 user message 组装
5. 接入 invocation persistence/presentation
6. 改 renderer slash 菜单（/skill:、Tab/Enter）
7. 做安全、tool contract、teaching evidence、IPC、fork 回归
8. 最后才考虑自动 discovery 与多 Skill
```

这份顺序的核心是：**先让“用户明确选中一个 Skill → 该 Skill 正文确实进入这一轮 user message → 用户在聊天中能看到证据”成立，再扩展自动发现和多 Skill 编排。**


## 9. 实施记录（2026-08-01）

- 第 0 阶段 ADR gate 已完成：见 ADR-0168。
- renderer slash 菜单现在只输出 `/skill:<id> `；Tab 仅补全，Enter 补全后提交。旧 `/id` 仅保留兼容解析至 **2026-12-31**。
- main process 从已验证安装包读取 `SKILL.md`，剥离 frontmatter，并将完整正文注入动态 user message；位置使用 `skill://<id>/SKILL.md`，不向 provider、public DTO 或 evidence 暴露真实本地路径。
- 未安装、读取失败、空正文和正文超过 48,000 UTF-16 code units 的调用 fail-closed；不会调用 provider、工具或 settlement。失败/拒绝也会以脱敏 metadata 附着到 raw user turn，供聊天内折叠 evidence 显示。
- `steer` / `follow-up` 中以 `/skill:` 开头的文本被明确拒绝；该场景不排队、不触发 provider。
- 这是 Pi **语义兼容**而非绝对路径字节级兼容。完整 body 永不显示在 evidence 中，且不会成为 teaching authority、ledger evidence 或 settlement 写入授权。

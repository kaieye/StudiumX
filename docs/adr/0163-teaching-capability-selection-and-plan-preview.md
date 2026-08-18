# ADR-0163：教学能力选择面、计划预览与本地评估

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-27
- **范围：** 定义正式教学链路中 capability 选择的心智与入口：host-owned intent presets、受治理 raw capability、只读 plan preview、严格 IPC、builtin skill 治理、本地可同意导出的 counts-only 评估。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0156](0156-skill-orchestration-conversation-continuity.md)、[ADR-0164](0164-unified-teaching-chain-and-skill-admission.md)
- **证据：** `tests/unit/skill-capability-picker.unit.test.tsx`、`tests/unit/skill-orchestration-preview.unit.test.ts`、`tests/unit/teaching-ipc-commands.unit.test.ts`、`tests/unit/teaching-ipc-gateway.unit.test.ts`、`tests/unit/support-bundle.unit.test.ts`；`src/renderer/src/skills/SkillCapabilityPicker.tsx`、host `builtin-skill-orchestration-policy.ts`。

## 背景

普通 composer 需要把「教学 Kernel + 受治理 capability」的选择心智与自由拼装多个独立教学 Prompt 的市场式心智区分开。Kernel 始终启用且不占可选槽；用户选择能力时，planner 应给出可解释的计划预览，而预览本身不得写任何教学权威。

## 决定

### 1. 用户选择语义

- Teaching Kernel（`teach`）始终启用，不显示为普通可选 chip。
- 普通 composer 先呈现 host-owned intent presets；受平台治理且 admitted 的 raw capability 只作为高级能力设置。最多 8 项仅是 IPC 防御 ceiling，绝不构成「可自由拼装八个教学策略」的产品承诺。
- leading `/skill-id` 仍可作为高级入口；slash 与 chips 合并、normalize、dedupe，且只接受 host eligibility projection 允许进入该入口的 capability，不能静默丢弃选择。
- planner 对每个 selected skill 给出 `active_now` / `scheduled_later` / `advisory_only` / `excluded` / `blocked` 与理由；host 自动补齐的预声明依赖单独显示，不能伪装成用户选择。

### 2. Preview 与 IPC

`previewSkillOrchestration` 与真实 turn 共用 host input assembly 和纯 `plan(...)`。它可读取 prior continuity state，但**永不写入或推进** stage cursor；失败降级为 `preview_unavailable`，不阻塞 composer。

IPC 命令与 gateway 严格验证 object shape、revision、boolean/string/preset 与 skill id；`../escape` 等不安全 id 拒绝；raw selection 上限 8，normalize/dedupe 后再规划；保留 `expectedRevision` 并拒绝 active duplicate stream id；已 settlement 的 retry 允许走正常新请求；event → session set 负责安全 cleanup，不建立旁路写入权威。

### 3. 展示面

`SkillCapabilityPicker` 在两个 composer 路径提供教学内核状态、intent preset、受治理 capability 的高级选择器和计划预览；active/later/advisory/blocked/excluded 分组及理由；dialog semantics、键盘 Escape、focus restore 与 live region。picker 仅改变 capability selection，不授予工具权限，不绕过 effect lattice 或三态审批；personal/custom 文件可在资源面管理，但不自动进入正式教学链路。

**展示面限定（[ADR-0165](0165-teaching-capability-trigger-surface-deferral.md)）：** 显式「教学意图与能力设置」触发按钮已从两个 composer 工具栏注释下线，输入框上方「教学内核已启用」chip 已移除；picker 逻辑保留、slash 入口仍可用，其余 UX 行为由 `tests/unit/skill-capability-picker.unit.test.tsx` 经 harness 继续覆盖。

### 4. 本地评估

每个 executable plan 在经验证的当前阶段正文加载后记录 bounded、strict-normalized、counts-only fact：stage kind / skill count / selection counts、decision counts、Kernel/dynamic prompt input 与 truncation counts、artifact gate checked/passed/failed 与聚合 pass rate、是否含 Elicit/authority-status/next-step echo、`userOverrideStatus: 'not_supported'`。产品当前没有 gate override 路径，因此汇总明确输出 `overrideSupported:false`、`overrideCount:0`。

诊断存于 workspace-local bounded ring，symlink-safe、损坏 fail-soft；只用于 Doctor/support 可观测，不是 planning/settlement 输入。preview 始终 counts-only，不含 prompt/body/objective/path/secret/learner Evidence；export 必须 `consent.accepted === true` 且 `sectionsAllowed` 包含该 section；无自动上传、无默认 remote telemetry/phone-home。

## 不变量

- Preview 不参与 prompt assembly；selection/stage/non-kernel body 变化不改变 stable prefix；经验证的 app-shipped Teaching Kernel 全文进入 stable prefix。
- Planner/preview/diagnostics 不写 ledger/outcome，不创建 Evidence，不执行工具。
- `TeachingTurnCoordinator` / host 仍是 settlement sole-writer；`expectedRevision` 与 `toolsReplayed:false` 不变。

## 后果

用户获得 intent-first 的受治理能力选择、可解释计划与无障碍预览；维护者获得本地、可同意导出的 counts-only 评估。planner 纯度、文件/ledger 权威、Evidence 边界、settlement sole-writer 与工具审批均未改变，也未引入新的教学权威或远程外发。

## 验证

```bash
pnpm typecheck
pnpm run check:security
pnpm run check:skill-library
pnpm run check:teaching-ipc-contract
pnpm run check:teaching-evidence
pnpm run check:blocking-ci
pnpm exec vitest run --project unit \
  tests/unit/skill-capability-picker.unit.test.tsx \
  tests/unit/skill-orchestration-preview.unit.test.ts \
  tests/unit/teaching-ipc-commands.unit.test.ts \
  tests/unit/teaching-ipc-gateway.unit.test.ts \
  tests/unit/support-bundle.unit.test.ts
```

## 非目标

- 不把 8 项选择上限或 raw capability 拼装包装成自由组合教学策略的产品承诺。
- 不授予 capability 选择任何工具、effect 或审批权限。
- 不让 preview/diagnostics 写 ledger、创建 Evidence、推进 stage cursor 或执行工具。
- 不改变 Kernel exactly-one、host admission、settlement sole-writer、`expectedRevision`、`toolsReplayed:false` 或无默认远程外发。
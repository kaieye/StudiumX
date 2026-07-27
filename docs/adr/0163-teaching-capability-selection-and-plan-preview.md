# ADR-0163：教学能力选择面、计划预览与本地评估

- **状态：** **已实施**（2026-07-27；ADR-0151 Phase 4–6 closeout）
- **范围：** 多选 capability chips、host-owned presets、只读 plan preview、严格 IPC、builtin skill 治理、本地评估与同意式 support export
- **关联：** [ADR-0044](0044-teaching-prompt-cache-contract.md)、[ADR-0151](0151-teaching-kernel-and-skill-orchestration.md)、[ADR-0156](0156-skill-orchestration-conversation-continuity.md)

## 1. 用户选择语义

- Teaching Kernel（`teach`）始终启用，不显示为普通可选 chip。
- 用户可在两个 composer 路径中多选最多 8 个 capability，也可使用少量 host-owned intent presets。
- 既有 leading `/skill-id` 语法继续有效；slash 与 chips 合并、normalize、dedupe，不能静默丢弃选择。
- planner 对每个 selected skill 给出 `active_now` / `scheduled_later` / `advisory_only` / `excluded` / `blocked` 与理由；host 自动补齐的预声明依赖单独显示，不能伪装成用户选择。

## 2. Preview 与 IPC

`previewSkillOrchestration` 与真实 turn 共用 host input assembly 和纯 `plan(...)`。它可读取 prior continuity state，但**永不写入或推进** stage cursor；失败降级为 `preview_unavailable`，不阻塞 composer。

IPC 命令与 gateway：

- 严格验证 object shape、revision、boolean/string/preset 和 skill id；`../escape` 等不安全 id 拒绝；
- raw selection 上限 8，normalize/dedupe 后再规划；
- 保留 `expectedRevision` 并拒绝 active duplicate stream id；已 settlement 的 retry 允许走正常新请求；
- event → session set 负责安全 cleanup，不建立旁路写入权威。

## 3. Renderer UX

`SkillCapabilityPicker` 在两个 composer 路径提供：

- chips、preset toggle、展开选择器和计划预览；
- active/later/advisory/blocked/excluded 分组及理由；
- dialog semantics、键盘 Escape、focus restore 与 live region；
- picker 仅改变 capability selection，不授予工具权限，不绕过 effect lattice 或三态审批。

## 4. Builtin skill 治理

15 个 builtin `SKILL.md` 均声明 role、stages、consumes、produces、artifact scope、dependencies、completion gate 与 non-responsibilities。

- host `builtin-skill-orchestration-policy.ts` 仍是唯一 trust authority；Markdown 冲突视为文档缺陷，不会提权。
- `course-designer` 收敛为兼容路由；`learning-assessor` 拆清 authoring / elicitation / interpretation hint，rubric 与参考答案不是 Evidence；`teaching-resource-generator` 只做资源 producer，不判定 mastery。
- `teaching-site` 保留 workflow router/legacy 兼容语义。
- manifest 继续 strict v1；schema v2 延期并要求单独 ADR。

## 5. Phase 6 本地评估

每个 executable plan 在经验证的当前阶段正文加载后记录 bounded、strict-normalized、counts-only fact：

- current stage kind 与 skill count、stage selection counts；
- decision counts、conflict exclusion diagnostic；
- Kernel/dynamic prompt input、included、budget 与 truncation counts；
- artifact gate checked/passed/failed 与聚合 pass rate；
- teaching plan 是否含 Elicit、authority evidence-status echo、next-step-action echo；
- `userOverrideStatus: 'not_supported'`。

产品当前没有 gate override 路径，因此汇总明确输出 `overrideSupported:false`、`overrideCount:0`，绝不伪造 override frequency。

诊断存于 workspace-local bounded ring，symlink-safe、损坏 fail-soft；只用于 Doctor/support 可观测，不是 planning/settlement 输入。聚合结果可进入 `skill_orchestration` support-bundle section：

- preview 始终 counts-only，明确不含 prompt/body/objective/path/secret/learner Evidence；
- export 必须 `consent.accepted === true` 且 `sectionsAllowed` 包含该 section；
- 无自动上传、无默认 remote telemetry/phone-home。

## 6. Prompt-cache 与 authority 不变量

- Preview 不参与 prompt assembly；selection/stage/non-kernel body 变化不改变 stable prefix。
- 经验证的 app-shipped Teaching Kernel 全文进入 stable prefix；详情以修订后的 ADR-0044 为准。
- Planner/preview/diagnostics 不写 ledger/outcome，不创建 Evidence，不执行工具。
- `TeachingTurnCoordinator` / host 仍是 settlement sole-writer；`expectedRevision` 与 `toolsReplayed:false` 不变。

## 7. 验证入口

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

## 8. 一句话

**用户获得“能力多选 + 可解释计划 + 无障碍预览”，维护者获得本地、可同意导出的 counts-only 评估；但 planner 纯度、文件/ledger 权威、Evidence 边界、settlement sole-writer 和工具审批均未改变。**

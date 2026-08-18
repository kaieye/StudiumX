# ADR-0114：Teaching-turn review last-bundle product IPC + Settings load/save

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-09 residual — durable last-bundle 闭集 product IPC + Settings 演示往返）
- **日期：** 2026-07-21
- **范围：** 闭集 product IPC 读写 last durable review snapshot（userData 缓存）；Settings「加载上次 / 保存当前为上次（演示）」；**不** auto-apply；**不** skill install / memory write / settlement；**不** 把 last-bundle 提升为 teaching SoT
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)、[ADR-0092](0092-managed-config-fs-loader.md)、[ADR-0097](0097-teaching-turn-review-settings-ui.md)、[ADR-0109](0109-teaching-turn-review-post-approve-handoff.md)、[ADR-0110](0110-teaching-turn-review-handoff-ipc.md)、[ADR-0111](0111-teaching-turn-review-settings-handoff-ui.md)、[ADR-0113](0113-teaching-turn-review-last-bundle-store.md)（pure + FS）、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-types/teaching-turn-review-ipc.ts`（get/save payload + result）
  - `src/shared/teaching-types/system-api.ts` / `src/shared/teaching-ipc-contract.ts`
  - `src/main/teaching-turn-review-last-bundle-ipc.ts`（mapper）
  - `src/main/teaching-ipc-commands.ts`（`parseGetTeachingTurnReviewLastBundlePayload` / `parseSaveTeachingTurnReviewLastBundlePayload`）
  - `src/main/teaching-ipc-gateway.ts`（channel 注册；`app.getPath('userData')` 作 root）
  - `src/preload/index.ts`（whitelist）
  - `src/renderer/src/views/settings/sections/TeachingTurnReviewSettingsSection.tsx`（Load / Save）
  - `src/renderer/src/i18n/locales/en-US.json` / `zh-CN.json`（`review.loadLast*` / `review.saveLast*`）
  - `src/shared/teaching-turn-review-last-bundle.ts` / `src/main/teaching-turn-review-last-bundle-fs.ts`（ADR-0113）
  - `tests/unit/teaching-turn-review-last-bundle-ipc.unit.test.ts`
  - `tests/unit/teaching-turn-review-settings-section.unit.test.tsx`
  - 本 ADR

## 背景

S-09 已交付候选 / finalize / 人批投影 / IPC / Settings / handoff / last-bundle pure+FS（ADR-0113）。仍缺**产品闭集 IPC + Settings 演示往返**，使 renderer 可：

1. **只读 get** 最近一次 durable review snapshot（userData 缓存）；
2. **fail-closed save** 当前本地 bundle（+ 可选 decision + source）为 last snapshot；
3. 在 Settings 中 Load → **project only**、Save → **cache only**。

产品地板：

- last-bundle 是**可重建投影缓存**，不是 teaching / settlement 真相源。
- **永不 auto-apply**（load 与 save 之后均不得 apply / install skill / write memory）。
- 根为 Electron `userData`（ADR-0113 caller-root 模型），**不是** 工作区。

## 决定

### 1. Invoke channels（闭集，两 channel）

| TeachingSystemApi | Channel | 行为 |
| --- | --- | --- |
| `getTeachingTurnReviewLastBundle` | `teach:get-teaching-turn-review-last-bundle` | 读 userData last-bundle → `{ ok: true, snapshot \| null }` 或 `{ ok: false, reason }` |
| `saveTeachingTurnReviewLastBundle` | `teach:save-teaching-turn-review-last-bundle` | fail-closed payload → pure snapshot → FS write → `{ ok: true }` 或 `{ ok: false, reason }` |

Main mapper（`teaching-turn-review-last-bundle-ipc.ts`）：

- get：`loadTeachingTurnReviewLastBundleFromRoot({ rootPath })`；缺失 / 无效 → `snapshot: null`（仍 `ok: true`）；IO/根不可用 → `ok: false`。
- save：`toTeachingTurnReviewLastBundleSnapshot({ bundle, decision?, source ?? 'unknown' })` → `saveTeachingTurnReviewLastBundleToRoot`。

**从不**调用 installSkill / createMemory / settlement / coordinator / auto-apply。

Gateway root：`app.getPath('userData')`（与既有 app-data / crash-marker 模式一致；本切片**不**强制扩展 `GatewayContext`）。

### 2. Payload / result 形状

```ts
// get: empty / no payload only
type GetTeachingTurnReviewLastBundleResult =
  | { ok: true; snapshot: TeachingTurnReviewLastBundleSnapshot | null }
  | { ok: false; reason: string }

// save: exact keys only
type SaveTeachingTurnReviewLastBundlePayload = {
  bundle: TeachingTurnReviewBundle
  decision?: TeachingTurnReviewHumanDecision
  source?: 'settings_demo' | 'manual' | 'unknown'  // product subset; not finalize_hook
}

type SaveTeachingTurnReviewLastBundleResult =
  | { ok: true }
  | { ok: false; reason: string }
```

Parser 规则（fail-closed）：

| Channel | 规则 |
| --- | --- |
| get | `undefined` / `null` / `{}` 可接受；**拒绝**任何非空键（含 `autoApply`） |
| save | 允许键闭集：`bundle` \| `decision?` \| `source?`；**要求** `bundle`；`source` ∈ `settings_demo\|manual\|unknown`；复用 ADR-0087 bundle/decision 解析；**拒绝**未知键 / `finalize_hook` / auto-apply 形字段 |

### 3. Settings UI（ADR-0097 / 0111 扩展）

| 控件 | testid | 行为 |
| --- | --- | --- |
| Load last durable bundle | `review-load-last` | get IPC → 有 snapshot 则 `projectTeachingTurnReview(bundle[, decision])` → 既有候选 / handoff 展示；无 snapshot → 状态文案 empty |
| Save current as last (demo) | `review-save-last` | 仅当本地 `bundle` 存在；`source: 'settings_demo'`；可选非 pending 本地决策作为 `decision`；**不** apply |
| Status line | `review-last-bundle-status` | 成功 / empty / 说明「projected only / not applied」 |

不变量：

- Load **只投影**，不 submit decide、不 navigate consent、不 install。
- Save **只写缓存**，不触发 apply、不改 settlement。
- **无 Apply 按钮**（与 ADR-0111 一致）。
- i18n `review.loadLast*` / `review.saveLast*`（en-US + zh-CN）；文案强调 durable cache only。

### 4. 权威边界

| 层 | 权威？ |
| --- | --- |
| 工作区 teaching 文件 / LearningSessionLedger / settlement | **是** |
| userData last-bundle JSON（经本 IPC） | **否** — 可重建缓存 |
| Settings 本地投影 / handoff 展示 | **否** — 只读 UI |

### 5. 明确不包含 / non-claims

- **不** auto-apply（load 或 save 之后）。
- **不** skill install / memory write / learner-profile patch / dream phase。
- **不** finalize_hook 自动 save 产品接线（仍 residual；IPC source 子集刻意排除 `finalize_hook`）。
- **不** 改 settlement / coordinator / `expectedRevision` / `toolsReplayed`。
- **不** 改 tool-policy merge（ADR-0112 / 0115）。
- **不** YOLO / always-approve / 默认 shell / MCP marketplace。
- **不** 编辑 ADOPTION.md 优先级表。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-last-bundle-ipc.unit.test.ts `
  tests/unit/teaching-turn-review-settings-section.unit.test.tsx `
  tests/unit/teaching-turn-review-last-bundle.unit.test.ts `
  tests/unit/teaching-turn-review-last-bundle-fs.unit.test.ts `
  tests/unit/teaching-turn-review-ipc.unit.test.ts `
  tests/unit/teaching-turn-review-handoff-ipc.unit.test.ts
```

覆盖：

- get parser：empty ok；unknown keys reject
- save parser：bundle + optional decision/source；reject autoApply / finalize_hook / missing bundle
- mapper：save→get round-trip；empty root → ok:false；missing file → snapshot null
- 序列化无 auto-apply 形字段
- Settings：load → project（含 decision）；load empty 状态；save `settings_demo`；无 Apply

## 后续 residual（非本切片）

1. 产品 finalize_hook 可选 save wire（默认 off；仍不得 auto-apply；若暴露 IPC source 须另议）。
2. 真实 consent 动作导航（memory / skill-pack authoring / lesson follow-up）仍走既有产品路径。
3. 任何 auto-apply 均须**新建 ADR**，默认否决。

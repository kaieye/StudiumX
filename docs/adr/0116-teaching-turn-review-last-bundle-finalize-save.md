# ADR-0116：Teaching-turn review finalize hook 可选 save last-bundle

- **状态：** 已实施（ADOPTION S-09 residual — finalize_hook → durable last-bundle product wire；默认 off；fail-soft；无 auto-apply）
- **日期：** 2026-07-21
- **范围：** composition-edge 工厂：返回 `TeachingTurnReviewFinalizeHook`，在 opt-in 时将 finalize 后的 review bundle 以 `source: 'finalize_hook'` 写入 caller-root last-bundle 缓存；**不** settlement SoT；**不** auto-apply；**不** 新 IPC / Settings Apply / 强制 coordinator 接线
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)、[ADR-0097](0097-teaching-turn-review-settings-ui.md)、[ADR-0113](0113-teaching-turn-review-last-bundle-store.md)、[ADR-0114](0114-teaching-turn-review-last-bundle-ipc.md)、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/teaching-turn-review-last-bundle-finalize-hook.ts`（新）
  - `src/main/teaching-turn-review-last-bundle-fs.ts` / `src/shared/teaching-turn-review-last-bundle.ts`（ADR-0113）
  - `src/main/ai/teaching-turn-orchestrator.ts`（ADR-0080 hook 面；本切片不改 orchestrator 本体）
  - `tests/unit/teaching-turn-review-last-bundle-finalize-hook.unit.test.ts`
  - `tests/unit/teaching-turn-orchestrator.unit.test.ts`（可选 factory 接线用例）
  - 本 ADR

## 背景

S-09 已交付候选 / finalize hook 面 / 人批投影 / IPC / Settings demo / handoff / last-bundle pure+FS（ADR-0113）/ product IPC+Settings 往返（ADR-0114）。仍缺一层**可选** live 接线：

- finalize 完成后 → 将当轮 review bundle **可选** 落为 durable last-bundle 缓存；
- 默认 **off**（产品未 opt-in 时零 FS I/O）；
- **永不** auto-apply；**不**写 skills / learner-profile / settlement / memory；
- product IPC save 的 source 子集仍为 `settings_demo|manual|unknown`（ADR-0114）——`finalize_hook` 仅允许 main-side hook 路径使用。

`createTeachingTurnOrchestrator` 当前主要为 composition-edge / 测试使用；本切片交付**可复用工厂**，产品在组装 orchestrator 时自行 `enabled: true` + `rootPath` 传入 `onTeachingTurnReview`。**不**强制改 coordinator / 发明完整 product host。

## 决定

### 1. 工厂：`src/main/teaching-turn-review-last-bundle-finalize-hook.ts`

| 符号 | 作用 |
| --- | --- |
| `CreateSaveTeachingTurnReviewLastBundleFinalizeHookOptions` | `{ rootPath; enabled?; relativePath? }` |
| `createSaveTeachingTurnReviewLastBundleFinalizeHook` | → `TeachingTurnReviewFinalizeHook` |

行为：

| 条件 | 结果 |
| --- | --- |
| `enabled !== true` | 返回 no-op hook（零 FS I/O） |
| `enabled === true` 但 `rootPath` 空/空白 | 返回 no-op（fail-soft；不抛） |
| `enabled === true` + 有效 root | `toTeachingTurnReviewLastBundleSnapshot({ bundle, source: 'finalize_hook' })` → `saveTeachingTurnReviewLastBundleToRoot` |
| save 失败 / pure 校验失败 / IO 异常 | catch 后 `return`；**永不**向外 throw |

不变量：

- source **固定** `'finalize_hook'`（不用 `settings_demo`）。
- **不**传 `decision`（finalize 时尚无人批）。
- **不**根据 `mode` 改写 snapshot 内容（bundle 已由 orchestrator/pure 规则 mode-aware；snapshot 无 mode 字段）。
- pure `to*` 内已 `assertReviewNotAutoApplied`；本工厂不发明 apply 路径。
- 与 ADR-0080 一致：hook 错误不得回滚 finalize / settlement。

### 2. 权威与 IPC 边界

| 层 | 权威？ |
| --- | --- |
| 工作区 teaching 文件 / LearningSessionLedger / settlement | **是**（既有 sole-writer） |
| userData last-bundle（经本 hook 写入） | **否** — 可重建投影缓存 |
| product IPC save source allowlist | **仍排除** `finalize_hook`（ADR-0114）；main hook 可写该 source |

### 3. 明确不包含 / non-goals

- **不** auto-apply / skill install / memory write / learner-profile patch / dream phase。
- **不** 新 IPC channel / preload / Settings Apply 按钮 / Granular UI。
- **不** 强制 coordinator / TeachingTurnCoordinator 产品接线；仅工厂 + 测试 + ADR。
- **不** 把 last-bundle 提升为 teaching / settlement SoT。
- **不** 改 settlement / `expectedRevision` / `toolsReplayed`。
- **不** YOLO / always-approve / 默认 shell / MCP marketplace。
- **不** 编辑 ADOPTION.md 优先级表。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-last-bundle-finalize-hook.unit.test.ts `
  tests/unit/teaching-turn-orchestrator.unit.test.ts `
  tests/unit/teaching-turn-review-last-bundle-fs.unit.test.ts
```

覆盖：

- `enabled` false / undefined → 无文件
- `enabled` true + 有效 root → loadable snapshot；`source: finalize_hook`；bundle round-trip
- `enabled` true + 空 root / save 失败路径 → 不抛
- 落盘 JSON 无 `decision` / auto-apply 形键
- orchestrator 可选接线：factory 作 `onTeachingTurnReview` 后文件存在

## 后续 residual（非本切片）

1. 真实 product composition host 选择 `enabled` + `userData` root 并传入 orchestrator（仍可选）。
2. 真实 consent 动作导航（memory / skill-pack authoring / lesson follow-up）仍走既有产品路径。
3. 任何 auto-apply 均须**新建 ADR**，默认否决。
4. 若将来 product IPC 需暴露 `finalize_hook` source，须另议并更新 ADR-0114 allowlist（默认否）。
# ADR-0113：Teaching-turn review last-bundle durable 投影缓存（caller-root FS）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-09 residual — durable last snapshot pure DTO + contained FS）
- **日期：** 2026-07-21
- **范围：** 纯序列化/校验 DTO + main 侧 **调用方供给绝对根**（典型 Electron `userData`）下 contained/bounded 读写 last review bundle 快照；**不** settlement SoT；**不** auto-apply；**不**本切片 IPC / Settings / gateway
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0077](0077-teaching-turn-review-candidates.md)、[ADR-0080](0080-teaching-turn-review-finalize-wire.md)、[ADR-0085](0085-teaching-turn-review-human-approve-projection.md)、[ADR-0087](0087-teaching-turn-review-human-approve-ipc.md)、[ADR-0092](0092-managed-config-fs-loader.md)、[ADR-0097](0097-teaching-turn-review-settings-ui.md)、[ADR-0109](0109-teaching-turn-review-post-approve-handoff.md)、[ADR-0110](0110-teaching-turn-review-handoff-ipc.md)、[ADR-0111](0111-teaching-turn-review-settings-handoff-ui.md)、[ADOPTION S-09](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/shared/teaching-turn-review-last-bundle.ts`（新）
  - `src/shared/teaching-turn-review.ts`（re-export）
  - `src/main/teaching-turn-review-last-bundle-fs.ts`（新）
  - `tests/unit/teaching-turn-review-last-bundle.unit.test.ts`
  - `tests/unit/teaching-turn-review-last-bundle-fs.unit.test.ts`
  - 本 ADR

## 背景

S-09 已交付候选 / finalize hook / 人批投影 / IPC / Settings demo / handoff pure+IPC+UI。仍缺一层**可选** durable「最近一次 review bundle 快照」——用于重启后只读回放 / 诊断，**不是** teaching authority，也**不是** settlement 真相源。

产品地板：

- 文件是教学真相源；本 last-bundle 是**可重建投影缓存**。
- **默认不 auto-apply**；保存内容仅为 bundle + 可选 human decision 元数据。
- 根在调用方 root（userData），**不**落在不可信 workspace（对齐 ADR-0092 managed-config FS）。

## 决定

### 1. 纯模块：`src/shared/teaching-turn-review-last-bundle.ts`

自 `teaching-turn-review.ts` re-export，保持单入口发现性（与 ADR-0085 / 0109 同模式）。

| 符号 | 作用 |
| --- | --- |
| `TeachingTurnReviewLastBundleSnapshot` | `{ version: 1, savedAt, source, bundle, decision? }` |
| `TeachingTurnReviewLastBundleSource` | `'finalize_hook' \| 'settings_demo' \| 'manual' \| 'unknown'` |
| `parseTeachingTurnReviewLastBundleSnapshot` | fail-closed pure parse from unknown |
| `toTeachingTurnReviewLastBundleSnapshot` | serialize + normalize；始终 `assertReviewNotAutoApplied` |
| `MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS` | 256_000 |
| `MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES` | 8（与 IPC soft cap 对齐） |
| `MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_DECISIONS` | 8 |

不变量：

- `version` 必须为 `1`。
- 每个 candidate `requiresHumanApproval: true`；已知 kinds only。
- `to*` 与 `parse*` 均调用 `assertReviewNotAutoApplied(bundle)`。
- 拒绝 raw 上的 `autoApply` / `applyPlan` / `skillFileContent` / `profilePatch` 等字段。
- `decision` 可选；存在时轻量 fail-closed 校验 action ∈ approve|reject|defer；note 经 `sanitizeDecisionNote`。
- **从不**携带可执行 apply plan / skill 文件体 / profile patch。

### 2. Main FS：`src/main/teaching-turn-review-last-bundle-fs.ts`

镜像 managed-config-fs（ADR-0092）风格：

| 导出 | 含义 |
| --- | --- |
| `DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH` | `'studiumx-teaching-turn-review-last-bundle.json'` |
| `TEACHING_TURN_REVIEW_LAST_BUNDLE_MAX_BYTES` | `256 * 1024` |
| `loadTeachingTurnReviewLastBundleFromRoot` | contained/bounded 读 → snapshot \| null |
| `saveTeachingTurnReviewLastBundleToRoot` | 校验后 temp+rename 写 → `{ ok: true } \| { ok: false, reason }` |
| `normalizeTeachingTurnReviewLastBundleRelativePath` | 拒 `..` / 绝对 / 盘符 |

路径与根模型：

- **根：** 调用方供给的绝对（或 cwd 相对）路径，典型 Electron `userData`；**不是** 工作区根。
- 相对路径规范化 + `isLexicallyInsideRoot` 后调用 `readContainedRegularFileBounded`（读）/ `ensureContainedDirectory` + temp rename（写）。

Fail-closed 语义：

| 情况 | load | save |
| --- | --- | --- |
| 根空 / 相对路径非法 / 逃逸 | `null` | `{ ok: false }` |
| 文件缺失 / 非普通文件 / symlink / contained 失败 | `null` | — |
| 超 bounded 上限 / JSON 非法 / parse 失败 | `null` | — |
| snapshot 未通过 pure parse | — | `{ ok: false }` |
| 写入 IO 失败 | — | `{ ok: false }` |

Save 前 **重新** `parseTeachingTurnReviewLastBundleSnapshot`（defense in depth）。Load **从不** auto-apply。

### 3. 权威与非权威边界

| 层 | 权威？ |
| --- | --- |
| 工作区 teaching 文件 / LearningSessionLedger / settlement | **是**（既有 sole-writer） |
| last-bundle JSON 在 userData | **否** — 可重建投影缓存；可删可丢 |
| human decision 字段 | 仅元数据；**不是** apply plan |

### 4. 明确不包含 / non-claims（本切片）

- **不** Electron IPC / preload / gateway / Settings 接线（sibling residual）。
- **不** finalize_hook 产品自动 save 接线（residual）。
- **不** auto-apply / skill install / memory write / learner-profile patch。
- **不** 改 settlement / coordinator / `expectedRevision` / `toolsReplayed`。
- **不** 把 last-bundle 提升为 teaching SoT 或 outcome authority。
- **不** YOLO / always-approve。
- **不** 编辑 ADOPTION.md 优先级表。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-turn-review-last-bundle.unit.test.ts `
  tests/unit/teaching-turn-review-last-bundle-fs.unit.test.ts
```

覆盖：

- pure to*/parse* round-trip；version/source 门禁
- auto-apply 形字段 / missing requiresHumanApproval fail-closed
- candidates soft cap
- FS round-trip；missing/invalid/escape/oversize → null
- save invalid → ok:false 且不落盘
- overwrite last-write-wins 缓存语义
- 序列化无 auto-apply 形字段

## 后续 residual（非本切片）

1. IPC / Settings consumer：读写 last-bundle（须独立 ADR 或本切片接线 sibling）。
2. 产品 finalize_hook 可选 save wire（默认 off；仍不得 auto-apply）。
3. 真实 consent 动作导航（memory / skill-pack authoring / lesson follow-up）仍走既有产品路径。
4. 任何 auto-apply 均须**新建 ADR**，默认否决。

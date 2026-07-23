# Code Arch Improve — full-repo coverage tracker

**Revision at start:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` (read-only verdict; implement only admitted candidates)
**Vocabulary:** module / interface / depth / seam / adapter / leverage / locality
**Policy:** AGENTS.md product floor, ADR-0075, settlement sole-writer, effect lattice, no YOLO/shell
**Status:** **COMPLETE** — 18/18 slices closed with skill verdict **Good enough — 0 candidates** each; **0** open admitted candidates; **0** implementations required.

---

## 1. Goal deliverable (what this doc answers)

| 目标要求 | 本文件结论 |
| --- | --- |
| 整库做一次 `$code-arch-improve` | 是：`src/main` + `src/shared` + `src/renderer` + `src/preload` + `scripts` 门禁均入 slice |
| 每片 ~≤10k LOC（可诚实超标/抽样） | 18 片；超 10k 的为逻辑一体 cutover/residual（S08/S10/S14–S16）或抽样（S09/S18） |
| 子代理并行（≤6） | 尝试过；多数 spawn 仅收到 generic shell（blocked-no-brief）。**可靠路径 = 主线程审查**；S02/S03/S05/S06 有子代理成功/半成功记录 |
| 每部分反复 skill 直到 **0 候选** | 每片 ≥1 次完整 skill pass；首 pass 即 **0 候选** → 按 skill 停止规则结束（无 admitted 则不实现、不自动二轮） |
| 记录探索量 / 明确不需再完善量 | 见 §3–§4 |

**Skill 成功定义（原文）：** *no architecture change recommended / 0 candidates = success.* 尺寸 alone ≠ candidate（ADR-0075）。

---

## 2. Population (approx production JS/TS)

| Area | Files | Lines (current count) |
| --- | ---: | ---: |
| src/main | 247 | ~77,967 |
| src/renderer | 178 | ~58,965 |
| src/shared | 146 | ~34,656 |
| src/preload | 2 | ~264 |
| **src total** | **573** | **~171,852** |
| scripts | 243 | ~28,046 |
| tests (seam-only; not product architecture surface) | 427 | ~117,744 |

---

## 3. Slice table (all closed)

| ID | Scope | Est. / examined | Passes | Status | Report |
| --- | --- | ---: | ---: | --- | --- |
| S01 | Giants: teaching-workspace, learning-session-ledger, teaching-turn-coordinator(+host) | ~8.4k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S01-review.md` |
| S02 | Agent conversation cluster | ~7.0k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S02-agent-conv.md` |
| S03 | Teaching IPC / doctor / support / capability | ~5.2k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S03-review.md` |
| S04 | Outcome + config + catalogs | ~5.0k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S04-review.md` |
| S05 | Main AI loop / run lifecycle | ~6.7k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S05-ai-loop.md` |
| S06 | AI context / delegation / search / provider / lesson | ~6.9k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S06-ai-context.md` |
| S07 | main/ai/tools/** | ~7.5k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S07-review.md` |
| S08 | main/mcp + shared/mcp | ~11.0k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S08-review.md` |
| S09 | Main remaining (residual bucket) | **~10.5k deep of ~22–24.5k** | 1 | **good_enough · 0 cand** (honest sample) | `out/code-arch-reviews/S09-review.md` |
| S10 | Shared teaching types + events + settings | ~12.8k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S10-review.md` |
| S11 | Shared study-planning | ~9.1k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S11-review.md` |
| S12 | Shared lesson-style-themes + remaining shared | ~8.7k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S12-review.md` |
| S13 | Renderer workbench A (timer/office/music/immersive) | ~6.5k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S13-review.md` |
| S14 | Renderer workbench B (schedule/recurrence/analytics/sheets) | ~11.1k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S14-review.md` |
| S15 | Renderer study-space | ~18.7k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S15-review.md` |
| S16 | Renderer settings + pet + app-shell + residual | ~22.7k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S16-review.md` |
| S17 | Preload + entry glue | ~0.3k | 1 | **good_enough · 0 cand** | `out/code-arch-reviews/S17-review.md` |
| S18 | Scripts gates (`check-*` inventory sample) | **~11.5k of ~28k scripts** | 1 | **good_enough · 0 cand** (honest sample) | `out/code-arch-reviews/S18-review.md` |

---

## 4. Aggregate metrics (verified from reports)

Sum of per-slice `approx_lines_examined` (S01–S18, including short S02/S05/S06 reports):

| Metric | Value |
| --- | --- |
| **Lines deeply examined (skill passes)** | **~169,666** |
| **Slices with final 0-candidate close** | **18 / 18** |
| **Admitted candidates (open)** | **0** |
| **Implemented candidates** | **0** |
| **Re-review after implement outstanding** | **0** |
| **Architecture change recommended** | **None** (every slice: Good enough) |

### Coverage interpretation

| Population | How covered |
| --- | --- |
| Full `src/**` production TS (~172k) | Assigned into S01–S17; residual main in S09; residual renderer in S16; study-space S15; workbench S13–S14; shared S10–S12 |
| `scripts/**` (~28k) | S18: **151 `check-*` gates (~11.5k)** inventory + largest-gate sample; fixtures treated as CI adapters not product authority |
| `tests/**` | Not a product architecture surface; units used as **test-surface evidence** inside slices |

### Explicit "no further architecture improvement needed now"

**~169.7k LOC** of skill-examined product/script-gate surface closed with **0 candidates**.  
Unsampled residual within S09 (~12–14k light peripheral main) and non-gate script fixtures (~16k) inherit **negative evidence** (stable peripherals / CI fixtures; no dual thrash hotspot) and are **not** open architecture debt under skill gates — reopen only on the signals listed in those reports.

### Fitness Watch only (not candidates)

| Area | Note |
| --- | --- |
| Dirty timer/phase WIP | `useStudySession`, shared timer-plan/phase sheets — product WIP; S11/S15 **Watch** |
| Dirty provider SSE / learning-analytics | Out of architecture admit path this revision |

---

## 5. Pass log

| Time (local) | Slice | Agent | Result |
| --- | --- | --- | --- |
| 2026-07-23 wave1 | S02 | slice_s02_agent_conv | good_enough, 0 candidates |
| 2026-07-23 wave1 | S05 | slice_s05_ai_loop | good_enough, 0 candidates |
| 2026-07-23 wave1 | S06 | slice_s06_ai_context | good_enough, 0 candidates |
| 2026-07-23 wave1 | S01/S03/S04 | * | BLOCKED — role shell without brief; re-dispatch |
| 2026-07-23 main | S01 | /root | good_enough, 0 candidates |
| 2026-07-23 wave2 | S03 | /root/rev_s03 | good_enough, 0 candidates |
| 2026-07-23 main | S04–S18 | /root (main-thread) | good_enough, 0 candidates each (S09/S18 sampled) |

---

## 6. Method notes

1. **Read-only** until a candidate is admitted; none admitted → **0 production architecture edits** under this goal.
2. **Subagents:** prefer `fork_turns=none`, self-contained brief, report path under `out/code-arch-reviews/`. When spawn fails, main thread continues (same skill gates).
3. **Stopping rule:** skill §5 — 0 candidates = stop that slice; do not thrash for a fourth candidate or auto-implement.
4. **Reopen global review only if:** new revision + hotspot thrash, dual-authority regression, YOLO/shell/MCP marketplace half-surface, or settlement sole-writer breach.

---

## 7. Bottom line

- **Explored:** full planned src + scripts-gate surface across **18 slices**.
- **Deeply examined:** **~170k lines** (sum of slice metrics).
- **Explicitly good enough / 0 candidates:** **all 18 slices** → **no architecture candidates remain open**; no implement/re-run queue.
- Living reports: `out/code-arch-reviews/S01`…`S18*.md`.

---
name: teaching-site
description: Use this skill as the main entry point whenever the user wants to build, plan, or evolve an interactive teaching website / course microsite / workshop landing page — from a blank slate, from existing course materials, or any state in between. Triggers on broad phrases like "做課程網站", "做教學網頁", "做工作坊網站", "把講義變網頁", "course microsite", "workshop site", "interactive lesson page", "multi-day curriculum website", "做一套課程". This skill is the router for the whole teaching-site pipeline (outline → content → SPA → interactions → visuals → corporate / ebook) and dispatches to the 10 specialised sub-skills as needed. Prefer this when the user's request is broad or unclear about which stage they're at — sub-skills (e.g. `course-ebook-publishing`) are still triggerable directly for stage-specific requests.
---

# Teaching Site — Main Entry Point

> **Schema authority**: all primitive field names (unit / concept / prompt / task / material / quiz / faq / illustration) and the canonical project layout come from [`_shared/domain-primitives.md`](../_shared/domain-primitives.md). When dispatching to any sub-skill, expect the agent to consult that file first.
>
> **Filename convention (English-first)**: all generated files use English names (`course-package/`, `day{n}/outline.md`, `materials/`, etc.). Trigger phrases users say in chat may stay Chinese, but anything written to disk is English. See `_shared/domain-primitives.md` §0 for the full mapping.
>
> **Reference implementation**: `d:/GitHub/ai-workshop/` is the production reference (4-day workshop, 4125-line index.html, 1728-line course-data.js). Use it as visual + render-pattern reference; do not copy course-specific content from it.

This is the **top-level skill** for producing an interactive teaching website. It coordinates 10 specialised sub-skills covering every stage from blank-slate outline to delivered PDF ebook.

## When This Skill vs. a Sub-Skill

- **Use this skill** (`teaching-site`) when:
  - The user's request is broad ("做一套課程網站", "我想做工作坊").
  - You're starting from scratch and don't know where to begin.
  - The user is jumping between stages and needs orchestration.
  - You need to check cross-artifact consistency after a change.

- **Use a sub-skill directly** when:
  - The user names the artifact ("做電子書" → `course-ebook-publishing`).
  - You're already deep into one stage and don't need pipeline overview.
  - Another skill is dispatching here for a focused subtask.

Both paths converge — sub-skills can be reached either by direct trigger or via this skill's dispatch.

## The Production Pipeline

A teaching site is built in five **core** layers, with two optional **derivative** layers at the end:

```
[Stage 1] outline (.md)
    ↓ produces: meta, day list, unit skeleton, learning goals, shared scenario
[Stage 2] content authoring (.md / .csv / .yaml)
    ↓ produces: lecture notes, sample materials, quiz items, optional prompt templates
[Stage 3] SPA conversion (.js + .html)
    ↓ produces: course-data.js (data) + index.html (renderers), local serve setup
[Stage 4] interactions (.js + .css inside index.html)
    ↓ produces: progress persistence, sidebar/scrollspy, theme, RWD, quiz UX
[Stage 5] visual assets (.png / .svg / scraping scripts)
    ↓ produces: illustrations, screenshots, QR codes, maps
    ▼
─── site is now feature-complete ─── (optional derivatives below)
    ▼
[Stage 5b] Corporate Edition branch   ← optional, parallel to ebook
    ↓ produces: corporate-editions/ folder, condensed units, inlined COURSE, asset fallback chain
[Stage 6]  Ebook Publishing            ← optional, ALWAYS after site is stable
    ↓ produces: dist/{name}.pdf + .docx via single composed master.md
```

Stages 1–5 are usually traversed in order, but users often jump back (add a unit → must update outline AND course-data.js AND any related visual). Catching these back-references is this skill's main value-add.

**Stages 5b and 6 are downstream consumers** of the finished site. They read but never modify the canonical site. Do not invoke them while Stages 1–5 are still in flux — the rework cost is high.

## Sub-Skill Dispatch Table

Invoke the matching sub-skill via your agent's skill activation mechanism (Claude Code: `Skill` tool, Codex: `skill` tool, Antigravity / Gemini CLI: `activate_skill`) when the matching stage is active:

| Stage | Sub-skill | Trigger phrases |
|---|---|---|
| 1 | `course-outline-design` | "規劃課程", "課程大綱", "幾天怎麼排", "學習目標" |
| 2 | `course-content-authoring` | "寫講義", "補素材", "出測驗題", "提示詞範本" |
| 3 | `static-spa-conversion` | "做成網頁", "轉成 SPA", "course-data.js", "render 函式" |
| 4 | `static-spa-interactions` | "加進度勾選", "響應式", "暗色模式", "縮放", "scrollspy" |
| 5 | `web-visual-assets` | "插圖", "工具截圖", "QR", "講師卡", "地圖" |
| 5b | `course-corporate-edition` | "企業包班", "濃縮版", "客製化", "壓縮成一天" |
| 6 | `course-ebook-publishing` | "做電子書", "產 PDF", "印給學員", "DOCX 交付" |
| ╳ | `web-visual-verification` | "驗證網頁", "RWD 驗證", "Playwright 測試", "截圖比對" |
| ╳ | `web-content-audit` | "盤點內容", "稽核資產", "找缺圖", "三處同步檢查" |
| ╳ | `teaching-site-design-system` | "視覺風格", "設計系統", "色票", "字體", "玻璃卡片" |

The last three (marked ╳) are **cross-cutting** — not tied to a stage. The first two (verification / audit) are the safety net for runtime behaviour and cross-file references. The third (design-system) is the visual authority every stage reads from.

## Stage 1 Gate (Hard Rule — read before any dispatch)

Before dispatching to ANY stage (including 2–6, 5b, and the cross-cutting skills), confirm Stage 1 deliverables exist on disk:

- [ ] An overview file (e.g. `overview.md`) with populated `對象` / `總時數` / `每日主題` fields — not just a heading.
- [ ] At least one per-day outline file (e.g. `day1/outline.md`) listing unit IDs and learning goals.

> Shared scenario (`shared-scenario.md`) is **optional** — it's a downstream decision handled by `course-outline-design`'s Completion Gate, not an entry requirement here.

**If either of the two is missing or only a stub:** do NOT dispatch downstream, even if the user explicitly named a later stage ("做電子書", "幫我寫 quiz"). Dispatch to `course-outline-design` first and tell the user:

> 「我看到還沒有完整的課程綱要 — 直接跳到 Stage N 會讓後面每改一次 outline 就連動多個檔案重做。先用 `course-outline-design` 把 outline 鎖定，大概 10 分鐘決策，省下後續數小時 rework。」

### Stage 1 Override Policy (3-bullet escape hatch)

If the user explicitly insists on skipping the gate ("我知道，先做就好", "skip the outline, just do X"), proceed under these conditions:

1. Ask them to paste **3 bullets in chat** before any downstream action:
   - **對象**：一句話描述學員是誰 + 先備知識
   - **總時數 + 每日時段**：例如「2 天 × 6 小時」
   - **每日主題**：Day 1 / Day 2 / ... 各一行
2. Save those 3 bullets **verbatim** into a stub `overview.md` (mark it `<!-- stub created via Stage 1 Gate override on YYYY-MM-DD -->`) before dispatching to the requested stage.
3. If the user refuses even the 3-bullet stub, fall back to the strict path — refuse the override and dispatch to `course-outline-design`.

The stub is the audit trail: future sessions reading this site can immediately see Stage 1 was bypassed and recover context.

## Stage 2 Gate (Hard Rule — read before dispatching to Stage 3+)

After Stage 1 Gate passes, before dispatching to Stage 3 (`static-spa-conversion`), Stage 5b, or Stage 6, confirm Stage 2 deliverables exist on disk:

- [ ] Each `day{n}/content.md` exists (one per Day listed in `overview.md`).
- [ ] Each `content.md` contains a `## u-{id}` section for **every unit ID** declared in the matching `day{n}/outline.md` — not just one.
- [ ] Each unit section has substance: at least one of (a) lecture script ≥ ~10 lines, (b) `任務 (tasks)` list, (c) `素材需求` references. Heading-only units fail.
- [ ] Each unit section declares `**圖片需求 (illustrations)**` listing 1–3 entries with filename + brief spec — see Stage 5 Image Coverage Floor below.

**If any item fails:** do NOT dispatch to Stage 3+, even if the user explicitly named a later stage. Dispatch to `course-content-authoring` first and tell the user:

> 「outline 在，但 Day {n} 的 `content.md` {缺/空殼/單元 u-{id} 沒寫}。直接做網頁會生出薄薄的殼 — 學員看到的只是標題清單，沒有實質教學內容。先用 `course-content-authoring` 把每個單元的 lecture / tasks / 圖片需求補完，比之後重做整套網頁省好幾倍時間。」

### Stage 2 Override Policy (thin-demo escape hatch)

If the user explicitly insists on a thin demo ("先做殼就好", "我只要 demo 給客戶看版型", "skip content"), proceed under these conditions:

1. State explicitly in chat what they're trading away: thin demo will have unit titles only, no lecture body, placeholder `<div>` instead of illustrations, tasks as empty checkboxes.
2. Mark every affected `day{n}/content.md` (create as stub if missing) with header comment `<!-- thin-demo stub: Stage 2 bypassed on YYYY-MM-DD — re-enter course-content-authoring before any real student sees this -->`.
3. When generating `course-data.js`, set `__thinDemo: true` on each affected unit so the SPA renders a "本單元尚未填內容" badge — students who somehow land on a demo build can see it's not real.

Without all three, do not proceed. Refuse and dispatch to `course-content-authoring`.

## Stage 5 Image Coverage Floor (Hard Rule — applies before declaring "site feature-complete")

A site that ships with only a cover image and bare text feels skeletal — learners disengage in the first scroll. Before declaring Stages 1–5 done (and therefore eligible for Stage 5b / 6 dispatch), confirm:

- [ ] Every unit in `course-data.js` has an `illustrations[]` array with **1–3 entries**. (The legacy single `illustration: 'foo.png'` field counts as 1; treat it as `illustrations: [{ name: 'foo.png', kind: 'hero' }]` for this check.)
- [ ] At least one entry per unit resolves to an existing file under `assets/` (the others may still be SVG fallback stubs while Stage 5 is mid-flight).
- [ ] If a unit genuinely needs no illustration (rare — e.g. a 5-min administrative slot, a quiz-only unit), record an explicit waiver: `illustrations: [{ kind: 'waived', reason: '...' }]`. Silence does not pass.
- [ ] `assets/illustrations/` (or your project's equivalent) contains the cover **plus** the per-unit images — not just the cover.

**If unmet:** dispatch to `web-visual-assets` and tell the user:

> 「目前有 N 個單元沒插圖（或全站只有封面）。學員一打開會覺得內容很空、像草稿。建議先用 `web-visual-assets` 跑一輪批次生圖（每單元 1–3 張，搭配 PNG-first / SVG-fallback），再進入電子書／企業包班分支 — 否則 PDF 一印出來就是大片留白。」

This floor is checked **after** Stage 4 finishes (interactivity wired) and **before** dispatching to Stage 5b or 6. Stage 5b / 6 inherit whatever images exist; if you skip the floor, the corporate brochure and the PDF ebook will both ship empty.

## How to Detect the Current Stage

After Stage 1 Gate AND Stage 2 Gate pass, look for these signals to pick the right downstream stage:

- **Outline `.md` exists, but `day{n}/content.md` is missing or thin** → Stage 2 (`course-content-authoring`). Skipping to Stage 3 is gated — see Stage 2 Gate above.
- **Content `.md` complete, but no `course-data.js`** → Stage 3 (`static-spa-conversion`).
- **`course-data.js` exists, but `index.html` has no renderers / no local serve** → Stage 3.
- **SPA renders, but progress isn't persisted / no responsive / no theme** → Stage 4.
- **Site works but has placeholder `<div>` for images / 404 thumbnails / units missing illustrations** → Stage 5 (`web-visual-assets`).
- **Site appears feature-complete but Stage 5 Image Coverage Floor not met** → Stage 5 first; do NOT dispatch 5b/6 yet.
- **Site is feature-complete (all gates + floor pass), user mentions corporate / in-house / shorter version** → Stage 5b.
- **Site is feature-complete (all gates + floor pass), user wants a printed / archived / shareable file** → Stage 6.

Ambiguous? Ask one short question, then dispatch. Don't try to do all stages at once — the cross-stage rework cost is high.

## Operating Principles

1. **Never skip stages forward.** Don't generate Stage 3 SPA from a half-baked Stage 1 outline — the structural mismatches multiply. If the user wants to skip, say so explicitly.

2. **Always trace back-references.** When the user modifies a downstream artifact (e.g. "add unit u-6 to day 2"), update upstream (`outline.md`) AND downstream (`course-data.js`, related visuals) in the same change. Half-updated sites accumulate technical debt very fast.

3. **Course-specific knowledge belongs to the user's content, not to a skill.** The sub-skills are intentionally agnostic to the *topic* of the course (AI workshop / cooking class / accounting training — same pipeline). If a sub-skill seems to be hardcoding domain examples, that's a smell.

4. **Verification commands are part of the deliverable.** When dispatching to Stage 3+, remind the user how to verify (`npm run serve`, then visit `http://localhost:3000`). Static sites often fail silently when opened with `file://` (localStorage blocked).

## Reference Files (Read When Needed)

When you need deeper detail than this entry point provides, read the appropriate reference:

- **`references/consistency-checklists.md`** — Read after every stage transition. Contains the full per-stage cross-artifact checklist (what to verify after Stage 1, 2, 3, ... 6, 5b). Catches "I changed X but forgot to update Y" bugs.

- **`references/scenarios.md`** — Read when the user's intent is ambiguous. Contains a dozen typical user prompts ("我有講義 .md 了", "客戶要濃縮版 + PDF") mapped to the exact sub-skill dispatch flow.

- **`references/troubleshooting.md`** — Read when something is reported broken. Maps symptoms ("素材連結 404", "進度勾選跑掉", "PDF 沒頁碼") to the most likely sub-skill / audit / verification path.

- **`references/design-rationale.md`** — Read when explaining the skill architecture itself, or when deciding whether a new feature deserves its own sub-skill vs. fitting into an existing one. Captures *why* the pipeline is shaped this way.

## What This Skill Does NOT Do

- Does not write any code itself — always dispatches to a sub-skill.
- Does not pick a CSS framework or build tool — assumes vanilla HTML/JS by default (see `static-spa-conversion` for why).
- Does not decide the course topic, audience, or pedagogy — that's the user's domain.

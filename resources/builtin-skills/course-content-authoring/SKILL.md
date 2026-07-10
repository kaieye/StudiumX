---
name: course-content-authoring
description: Use this skill when an outline exists and you need to fill in the actual teaching content — lecture notes, sample materials (CSV / YAML / MD samples), quiz items, and any course-specific artifacts like prompt templates or worksheets. Triggers on phrases like "寫講義", "補素材", "出測驗題", "提示詞範本", "撰寫課程內容", "lecture notes", "course material", "quiz questions", "quiz authoring", "prompt templates". Always invoke AFTER `course-outline-design` is stable, BEFORE `static-spa-conversion`. This skill produces only the raw `.md`/`.csv`/`.yaml` artifacts — turning them into a website is the next stage's job.
---

# Course Content Authoring

> **Schema authority**: all primitive field names (unit / concept / prompt / task / material / quiz / faq / illustration) come from [`_shared/domain-primitives.md`](../_shared/domain-primitives.md). When this skill mentions a field, that file is the source of truth.
>
> **Filename convention (English-first)**: all generated files and directories use English names. The mapping from legacy Chinese names is in `_shared/domain-primitives.md` §0.

This skill produces the **teaching substance** of a course: the things a learner reads, copies, listens to, or works through. It anchors every artifact to the outline IDs from `course-outline-design`, so the next stage (SPA conversion) can wire them up mechanically.

## Deliverables (Standard Layout)

```
course-package/   (your project's content root)
├── day{n}/
│   ├── outline.md           ← from outline stage (do NOT edit here)
│   └── content.md           ← THIS skill writes: lecture script, prompts, exercises, references
├── shared-scenario.md            ← from outline stage
├── supporting-docs.md            ← THIS skill writes: FAQ, environment setup, pre-reading
└── materials/                  ← THIS skill writes: standalone learner artifacts
    ├── README.md             ← index of materials
    └── *.md, *.csv, *.yaml   ← samples, templates, datasets
```

## Material Types (Pick What Fits Your Course)

The example workshop uses these — they're **examples**, not requirements. Decide per course what makes sense:

| Type | Format | When to use |
|---|---|---|
| Lecture script | `.md` | Per-day teaching narrative, embedded in `content.md` |
| Sample document | `.md` | A "before" artifact learners will improve (e.g. an FAQ, a policy doc) |
| Tabular dataset | `.csv` (UTF-8 BOM!) | Practice data for AI processing exercises |
| Structured config | `.yaml` | When the exercise involves declarative configuration |
| PDF reference | `.pdf` | Official documents (laws, regulations) — usually external sources |
| Prompt template | `.md` block | Domain-specific reusable prompts (this course uses **RTFC** framework, others may not — adapt to your course's pedagogy) |
| Quiz items | inline in `content.md` or separate | Pre-test, post-test, comprehension checks |
| Worksheets | `.md` | Fill-in templates learners complete |

> **About prompt templates**: This skill is **agnostic** to which prompt framework you use. RTFC (Role / Task / Format / Context) was used in the original workshop, but if your course teaches a different framework (e.g. CRISPE, COSTAR, plain examples), use that. Don't force RTFC into a course where it doesn't fit. The framework is *part of the course content*, not a property of this skill.

## CSV Trap (Easy to Miss)

When generating CSV files that will be opened in Excel by non-developer learners, **prepend a UTF-8 BOM** (`﻿`):

```js
const content = '﻿' + headerRow + '\n' + dataRows.join('\n');
```

Without it, Excel on Windows mis-detects encoding and shows mojibake. Learners will think the file is broken. This bug was found late in the example workshop — bake it in from the start.

## Anchor Everything to Outline IDs

Every artifact you produce must trace to a unit ID. Use this header pattern in lecture notes:

```markdown
## u-3: {Unit title from outline.md}

**對應任務**: d2-u3-t1, d2-u3-t2
**對應素材**: 客訴處理SOP.md, FAQ官方版.md
**圖片需求 (illustrations)**:
- `day2-u3-hero.png` — hero / 主視覺：{學員角色} 在 {情境} 操作的場景圖（AI 生圖）
- `day2-u3-flow.svg` — 概念流程：{步驟 A → B → C}（手繪 SVG，含中文標籤）
- `day2-u3-example.png` — 結果範例截圖（選填）

{lecture content here}
```

Why: the SPA conversion stage will read these markers to auto-link tasks, materials, content, **and visual asset slots**. If you skip them, the SPA author has to re-read everything to figure out the wiring, and Stage 5 (`web-visual-assets`) has no spec to generate against — you end up with a site that has only a cover image.

## Task IDs Are Forever

When writing task descriptions inside `content.md`, assign each task a stable ID (e.g. `d2-u3-t1`). These IDs will become **localStorage keys** in the deployed website. Three rules:

1. **Never rename** a published task ID. Students' progress is keyed to it.
2. **Never reuse** a deleted task ID. If you remove a task, the ID retires permanently.
3. **Two formats coexist** in practice (`d{n}-u{m}-t{k}` and `day{n}-u{m}-t{k}`). Pick one for new content; don't mix.

## Quiz Item Discipline

If the course has a quiz, write items numbered sequentially (`q1`, `q2`, ...). Be aware these numbers will leak into multiple places once on the SPA:

- The quiz array itself
- A `qIndexToDay()`-style helper that maps each item to its source chapter (so wrong answers can link back)
- Hardcoded strings in the SPA: `"結訓測驗（N題）"`, score display `— / N`, passing threshold `s >= K`

**Renumber-safe authoring**: think of the quiz as **append-only**. If you delete `q3`, leave the slot empty in your draft and renumber only at the very last stable moment, with a checklist of all the places to update.

## Hidden Materials Pattern

Some materials are **for instructors only** (answer keys, pre/post-test scoring) or **conditional** (only shown if a feature flag is on). Mark them explicitly in `materials/README.md`:

```markdown
| 素材 | 對象 | 備註 |
|---|---|---|
| 員工差勤辦法.md | 學員 | Day 2 公開素材 |
| 結訓測驗解答.md | 講師 | 不要納入 SPA materials[]，僅講師端使用 |
```

The SPA conversion stage will read this column and exclude instructor-only items.

## Anti-Patterns

- **Writing content before outline is locked** — every back-edit cascades to multiple files.
- **Embedding prompt frameworks the course doesn't actually teach** — if your course doesn't use RTFC, don't force-fit it just because the example template has it.
- **Quiz items without source-chapter mapping** — when a learner gets one wrong, they need to know *where to review*. Tag every quiz item with the unit it came from.
- **Long flat material list with no instructor / learner distinction** — by Day 4 the instructor doesn't know which file is what.
- **Forgetting CSV BOM** — see above.

## Completion Gate (Hard Rule — must pass before hand-off)

Before declaring "content draft complete" and suggesting `static-spa-conversion`, every item below must have a **written artefact** in the corresponding `.md` file (not just a verbal "yes"). Walk the user through them; if an artefact is thin or missing, ask one clarifying question and finish it before moving on.

1. **Per-day `content.md` exists** for every Day declared in `overview.md` `每日主題` table. A Day file with only the title heading fails — it must contain unit sections.
2. **Every outline unit ID has a matching `## u-{id}` section** in its day's `content.md`. Run a quick diff: list of unit IDs in `day{n}/outline.md` must be a subset of `## u-` headings in `day{n}/content.md`. Missing sections fail the gate.
3. **Every unit section has substance** — at least one of: lecture script ≥ ~10 lines, `**對應任務**` listing real task IDs, `**對應素材**` listing real material filenames. A unit that only has a heading + `TODO` placeholder fails.
4. **Every unit section declares `**圖片需求 (illustrations)**`** with 1–3 entries. Each entry must specify (a) filename stem (e.g. `day2-u3-hero.png`), (b) image kind (`hero` / `diagram` / `screenshot` / `scene`), (c) one-line spec for the visual asset author. Units that genuinely need no image must declare a single waiver line: `- waived: {reason, e.g. 5-min admin slot}`. Silence does not pass.
5. **Quiz items (if applicable) tagged with `sourceUnit`** — every `q*` item points to a real unit ID so wrong answers can route students back to the source chapter. Untagged items fail.
6. **`materials/README.md` exists** with the material index, distinguishing 學員 vs 講師 columns (see Hidden Materials Pattern above).

If the user pushes "可以了，先轉成網頁" before all items have written artefacts, refuse politely:

> 「Stage 2 還有 N 個單元沒寫實質內容（或沒設圖片需求）。直接進 Stage 3 會生出薄殼網頁，學員看到只有標題 + 沒插圖。先把第 X 項補上，大概 Y 分鐘，比之後重做網頁省好幾倍。」

If the user explicitly demands a thin demo (與 `teaching-site` Stage 2 Override Policy 相同條件)：依照 orchestrator 文件的三步驟（標 stub 註解、設 `__thinDemo: true`、明確告知學員顯示效果）才放行，不要在 Stage 2 內部偷偷放水。

## Hand-off

When this stage finishes (Completion Gate passed), you should have:

- Per-day `content.md` filled in, every outline unit ID covered by a `## u-{id}` section
- Each unit section: lecture script + tasks + materials refs + `圖片需求 (illustrations)` 1–3 entries
- All material files in `materials/` with an index README distinguishing 學員 / 講師 items
- Quiz draft (if applicable) numbered `q1..qN` with `sourceUnit` source-chapter tags
- Every artifact traceable to an outline unit ID

Tell the user: "content draft complete. Next stage (`static-spa-conversion`) will convert this into `course-data.js` + `index.html`, including an `illustrations: []` array per unit derived from your `圖片需求` blocks. After Stage 3/4, `web-visual-assets` will fulfil those slots — your spec lines become its prompt input. Don't change unit IDs or task IDs from this point — they'll become localStorage keys."

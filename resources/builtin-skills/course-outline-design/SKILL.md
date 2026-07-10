---
name: course-outline-design
description: Use this skill when starting a new course / workshop / training program and you need to design its outline before any lecture content is written. Triggers on phrases like "規劃課程", "課程大綱", "幾天怎麼排", "學習目標", "workshop outline", "syllabus design", "course outline", "learning objectives", "課程總覽", or when the user has a topic and audience but no structure yet. This skill produces the skeleton (.md files) that all downstream stages — content authoring, SPA conversion, visual assets — depend on. Always invoke this BEFORE jumping into writing lecture notes or building a site.
---

# Course Outline Design

> **Schema authority**: all primitive field names (unit / concept / prompt / task / material / quiz / faq / illustration) come from [`_shared/domain-primitives.md`](../_shared/domain-primitives.md). When this skill mentions a field, that file is the source of truth.
>
> **Filename convention (English-first)**: all generated files and directories use English names. The mapping from legacy Chinese names is in `_shared/domain-primitives.md` §0.

This skill produces the **structural skeleton** of a course: how many days, what each day's theme is, what each unit teaches, what the shared running scenario is, and what the meta (hours, classroom, schedule) looks like. It does not write lecture content — that's `course-content-authoring`'s job.

## When to Invoke

- User says "I want to run a workshop on X" but no structure exists yet.
- User has scattered notes and wants to organise them into a course.
- User wants to revise an existing outline (add/remove a unit, change day allocation).

## Deliverables

A standard outline produces these files. Adapt paths to the user's project, but keep the **role of each file** distinct — that separation is what enables downstream sub-skills to work.

```
course-package/   (or your preferred root)
├── overview.md         ← top-level meta + day list + shared scenario summary
├── shared-scenario.md     ← the persistent scenario / fictitious company / characters used across days
├── supporting-docs.md     ← optional: FAQ, pre-reading, environment setup
└── day{n}/
    └── outline.md     ← per-day outline: theme, units, learning goals, hours
```

> The filenames here are Chinese because that's the project convention this skill emerged from. Use whatever language fits the project, but **keep the file roles separate**. Merging `overview.md` into each Day's outline is a common mistake — it makes meta updates require N edits.

## The Five Decisions You Must Pin Down

Before drafting any file, get these answered (ask the user, one at a time if needed):

1. **Audience + prerequisite knowledge** — determines depth of every concept later.
2. **Total contact hours + day count** — e.g. 4 days × 6 hours, or 1 day × 8 hours. This drives the unit count.
3. **Shared scenario** — every good workshop has a recurring fictional case (a company, a character, a dataset) that ties units together. Pin this **before** designing units, because the scenario will leak into every unit's example.
4. **Learning outcome verbs** — what should the learner be able to *do* by end of each day? Use action verbs (`use`, `build`, `evaluate`), not knowledge verbs (`understand`, `know`).
5. **Assessment shape** — pre-test / post-test / quiz / portfolio? This affects whether you reserve a unit slot for it.

## File-by-File Template

### `overview.md` (overview)

```markdown
# {Course title}

## 基本資訊
- **對象**: {audience}
- **總時數**: {total hours} ({days} 天 × {hours/day})
- **上課時間**: {schedule, e.g. 每週三 14:00–17:00}
- **教室**: {location + mapUrl if physical}
- **講師**: {instructor}

## 課程目標
{3–5 outcome statements using action verbs}

## 每日主題
| Day | 主題 | 核心產出 |
|---|---|---|
| Day 1 | ... | ... |
| Day 2 | ... | ... |
...

## 共用案例
{1-paragraph summary of the persistent scenario; full details in shared-scenario.md}
```

### `day{n}/outline.md` (per-day)

```markdown
# Day {n}: {day theme}

## 學習目標 (action verbs!)
- 能夠 {do X}
- 能夠 {do Y}

## 時程
| 時段 | 單元 | 重點 |
|---|---|---|
| 14:00–14:50 | u-1 {unit title} | ... |
| 15:00–15:50 | u-2 ... | ... |
...

## 單元細部
### u-1: {title}
- **學習目標**: ...
- **任務 (tasks)**: 條列學員實作項目
- **素材需求**: 條列此單元需要的素材檔（給 content-authoring 階段填）
```

### `shared-scenario.md`

A 1–2 page document describing the recurring fictional context. Include:
- Company / character names (use placeholder names that won't be mistaken for real entities)
- The core problem the course will solve for them
- Data shape examples (column names, file types) — these will be reused as quiz items and prompt examples

## Anti-Patterns to Avoid

- **"等內容寫完再回來補大綱"** — outline must be stable before content authoring, because content authors anchor every unit to the outline's IDs.
- **Unit titles that are noun-only** (e.g. "提示詞") — bad, because the title doesn't tell you what the learner *does*. Prefer verb-based titles ("撰寫一份結構化提示詞").
- **No shared scenario** — without it, every unit's example is one-off, and learners can't see how techniques compound.
- **Hour totals that don't add up** — the meta says "6 hours/day" but the time table only fills 4.5 hours. Always sum the time table and reconcile.

## Completion Gate (Hard Rule — must pass before hand-off)

Before declaring "outline locked" and suggesting `course-content-authoring`, every item below must have a **written artefact** (not just a verbal "yes"). Walk the user through them one at a time; if an answer is vague, ask one clarifying question before moving on.

1. **Audience + prerequisite** — recorded in `overview.md` `對象` field as a concrete sentence (e.g. "行政部門人員，能用 Excel 但沒寫過程式"). Generic "新手" is not enough.
2. **Total hours + day count** — `總時數` populated AND `每日主題` table has exactly that many day rows. Sum the time tables in each `day{n}/outline.md` and confirm it equals the daily hours.
3. **Shared scenario (optional, but must be explicitly decided)** — either:
   - `shared-scenario.md` exists with named company/character + core problem + 1–2 example data shapes; OR
   - `overview.md` contains an explicit one-line note: `本課無共用案例，每單元獨立舉例`.

   Silence does not pass — you must ask and record one of the two outcomes.
4. **Learning outcome verbs** — every day's `學習目標` uses **action verbs** (`use`, `build`, `evaluate`, `design`, `compare`). Knowledge verbs (`understand`, `know`, `learn about`) fail the gate — ask the user to rephrase.
5. **Assessment shape** — explicitly recorded in `overview.md` (e.g. "pre-test 5 題 / post-test 10 題 / 每日 quiz 3 題") OR explicitly waived with a one-line note ("本課無評量，採作品集驗收"). Silence does not pass.

If the user pushes "可以了，先開始寫內容" before all 5 items have written artefacts, refuse politely:

> 「Stage 1 沒鎖好，後面 content/SPA/visual 任一階段改 outline 就要連動多檔重做。先把第 N 項補上，大概 X 分鐘，之後省下的不只這些。」

### Decision-time Defaults (ask, don't assume)

When the user genuinely doesn't know an answer, **do not propose templates or fill in placeholder defaults** — ask one short direct question and wait for their answer. Looping on a wrong assumption is more expensive than one extra round-trip.

- **Audience unknown** → ask directly: 「這堂課是為誰開的？是哪個部門 / 哪種角色的學員，他們現在會什麼、不會什麼？」 Wait for a concrete answer before moving to item 2.
- **Hours / days unknown** → ask directly: 「總時數和每日時段怎麼安排？例如『2 天 × 6 小時』或『每週三 14:00–17:00 共 4 週』。」 Do NOT propose 1d×6h / 2d×6h / 4d×6h templates — the user's calendar drives this, not our guess.
- **Shared scenario undecided** → ask directly: 「這套課程要不要設一個貫穿全程的虛構案例（例如一家公司、一個角色，讓所有單元的例子都圍繞它）？要的話我們一起設定；不要的話就在 `overview.md` 寫『本課無共用案例』然後跳過第 3 項。」 Accept either answer without pushing for a scenario.

The principle: this skill stays decisive by **routing on clear answers**, not by **assuming on silence**.

## Hand-off to Next Stage

Only after the Completion Gate passes, the user should have:
- A complete set of outline `.md` files
- A clear unit ID convention (e.g. `d{n}-u{m}`) that the content-authoring stage will use
- A pinned shared scenario

Tell the user: "outline is locked. From this point, changing day count or unit IDs has cascading cost — let me know before you do." Then suggest invoking `course-content-authoring` next.

## Revision Flow (if user wants to change an existing outline)

1. **Diff what's changing** — list every affected unit ID.
2. **Check if Stage 3+ already exists** (`course-data.js` present?). If yes, warn that downstream files need parallel updates and remember to flag this when handing back to `teaching-site`.
3. **Update files in this order**: `overview.md` (meta) → affected `day{n}/outline.md` → `shared-scenario.md` (if scenario changed).
4. **Never rename a unit ID** once content has been written for it. Mark deprecated, add a new one with a fresh ID.

---
name: static-spa-conversion
description: Use this skill when you have structured course content (or any chapter-based dataset) in markdown form and need to turn it into a working interactive website — without picking a framework, without a build step. Triggers on phrases like "做成網頁", "轉成 SPA", "course-data.js", "render 函式", "把講義變網頁", "static site from markdown", "vanilla JS site", "no-framework site", "single-page app from markdown". The output is a vanilla HTML + JS single-page app that opens with `npx serve` and persists state in localStorage. Always invoke AFTER `course-content-authoring` (content stable), BEFORE `static-spa-interactions` (this skill produces the scaffold; interactions adorn it).
---

# Static SPA Conversion

> **Schema authority**: all `window.COURSE` field names come from [`_shared/domain-primitives.md`](../_shared/domain-primitives.md). When the schema example below diverges from that file, that file wins.
>
> **Starter templates** (copy these, don't re-derive):
>
> - [`templates/index.html`](templates/index.html) — scaffold shell with render pipeline skeleton
> - [`templates/course-data.template.js`](templates/course-data.template.js) — empty schema example with TODO markers for every primitive
> - [`../teaching-site-design-system/templates/tokens.css`](../teaching-site-design-system/templates/tokens.css) — paste into `<style>` block, or copy as `style.css` next to `index.html`
>
> **Reference implementation**: `d:/GitHub/ai-workshop/index.html` (4125 lines, fully populated). Use as visual + render-pattern reference; do not copy course-specific content from it.
>
> **Filename convention (English-first)**: `course-package/`, `day{n}/outline.md`, `day{n}/content.md`, `materials/`, `overview.md`. Legacy Chinese names (`完整課程包/`, `課程大綱.md`, `教學素材/`, etc.) are deprecated — see `_shared/domain-primitives.md` §0 for full mapping.

This skill turns chapter-based markdown content into a working single-page app. The architectural commitments are deliberate and worth understanding before you start.

## The Three Architectural Commitments

1. **Vanilla HTML + JS, no framework, no bundler.** No React, no Vite, no TypeScript build. Why: course websites have multi-year lifespans and are often handed to non-developer instructors. A `.html` you can open and edit beats a `node_modules` graveyard every time. Also: the content is the value, not the tech.

2. **Data and rendering live in different files.** A `course-data.js` holds *everything the course is* as a single JS object (`window.COURSE`). An `index.html` holds *how the course is shown*. Instructors editing tomorrow's lesson never need to touch HTML.

3. **localStorage for persistence, no backend.** Progress, theme, zoom — all client-side. Easier hosting, no privacy headaches. The cost: state is per-browser. Accept it.

## Standard File Layout

```
project-root/
├── index.html              ← the single SPA (CSS + JS inline; ~3000 lines is normal)
├── course-data.js          ← window.COURSE = { ... }
├── instructor-data.js      ← optional: window.INSTRUCTOR (if scraped/external)
├── tools-data.js           ← optional: window.TOOLS (if showcasing tools)
├── package.json            ← just `{"scripts": {"serve": "npx serve ."}}` and scraping tooling
├── assets/                 ← images, illustrations
└── course-package/             ← markdown source (read-only from SPA's perspective)
    └── materials/           ← files linked from the SPA via getMaterialUrl()
```

`index.html` includes data files via plain `<script src="course-data.js"></script>` — no module imports, no fetch. The browser loads them in order, populating `window.COURSE` before `init()` runs.

## The `window.COURSE` Schema

The single most important artifact. Design it carefully — every render function depends on it. Standard shape:

```js
window.COURSE = {
  meta: {                              // top-level course metadata
    title: '...',
    audience: '...',
    hoursTotal: 24,
    days: [                            // index drives sidebar chapter list
      { id: 'day1', title: 'Day 1: ...', hours: 6, schedule: '...' },
      ...
    ],
    classroom: { name: '...', mapUrl: '...' }
  },
  sharedCase: { /* persistent fictional scenario */ },
  day1: {
    hero: { title, lead, illustration },
    units: [
      {
        id: 'u-1',                     // stable, never renamed
        title: '...',
        timeRange: '14:00–14:50',
        goals: [...],                  // learning outcomes
        tasks: [                       // ← these IDs are localStorage keys
          { id: 'd1-u1-t1', text: '...', done: false }
        ],
        prompts: [                     // optional: copyable templates
          { id: '...', title: '...', body: '...' }
        ],
        materials: [                   // optional: per-unit material refs
          { id: '...', name: '...', type: 'PDF 文件' }
        ],
        illustrations: [               // 1–3 entries, see Stage 5 Coverage Floor
          { name: 'day1-u1-hero.png',  kind: 'hero',    alt: '...', spec: '...' },
          { name: 'day1-u1-flow.svg',  kind: 'diagram', alt: '...', spec: '...' }
        ]
        // legacy single `illustration: 'day1-u1.png'` still accepted; treat as
        // illustrations: [{ name, kind: 'hero' }] and migrate when convenient
      },
      ...
    ]
  },
  day2: { /* same shape */ },
  ...
  materials: [                         // cross-day material index for the "all materials" tab
    { id: 'm-1', name: '...', type: '...', desc: '...' }
  ],
  quiz: [                              // optional: end-of-course assessment
    { id: 'q1', question: '...', options: [...], answer: 0, sourceUnit: 'day1.u-2' }
  ]
};
```

## The Render Pipeline

`index.html` is one big `<script>` at the bottom. Its shape:

```js
// 1. Utilities (top, ~50 lines)
const el = (tag, attrs, children) => { /* tiny DOM helper */ };
const store = {
  load() { /* read localStorage */ },
  save(state) { /* write localStorage */ },
  reset() { /* clear */ }
};

// 2. Render functions, each takes data → returns/appends DOM
function renderOverview(meta) { ... }
function renderSharedCase(case_) { ... }
function renderDay(day) { ... }
function renderUnit(unit, dayId) { ... }
function renderMaterials(materials) { ... }
function renderToolbox(tools) { ... }    // optional
function renderQuiz(quiz) { ... }        // optional

// 3. Sidebar + scrollspy + theme — see static-spa-interactions

// 4. Entry point
function init() {
  renderOverview(window.COURSE.meta);
  renderSharedCase(window.COURSE.sharedCase);
  for (const dayKey of ['day1', 'day2', 'day3', 'day4']) {
    renderDay(window.COURSE[dayKey]);
  }
  renderMaterials(window.COURSE.materials);
  renderQuiz(window.COURSE.quiz);
  // ... then interactivity wiring (see static-spa-interactions)
}
document.addEventListener('DOMContentLoaded', init);
```

Keep each render function pure: it receives data, it produces DOM. No reading from globals beyond its parameter. This makes adding a new section trivial.

## The Material URL Router (`getMaterialUrl`)

The trickiest piece. The SPA needs to map a material's `name` and `type` to a real URL on disk. The router lives near the top of the script section:

```js
function getMaterialUrl(name, type) {
  const base = 'course-package/materials';
  if (type === 'PDF 文件') {
    // PDFs trigger download instead of inline view
    if (name.includes('員工差勤')) return `${base}/pdf/員工差勤辦法.pdf`;
    if (name.includes('客訴SOP')) return `${base}/pdf/客訴處理SOP.pdf`;
    // ... one rule per PDF
    return null;  // unknown PDF → caller hides the link
  }
  // Other types open in new tab
  if (name.includes('FAQ')) return `${base}/FAQ官方版.md`;
  if (name.includes('差勤')) return `${base}/員工差勤辦法.md`;
  // ...
}
```

**The three-place sync rule** — when adding a material, update all of:
1. Drop the file into `course-package/materials/`
2. Add an entry to `course-data.js:materials[]` (and any unit's `materials[]`)
3. Add the `name.includes(...)` rule to `getMaterialUrl()`

Forgetting any one breaks the link. Consider adding a CI check that diffs filesystem vs. data vs. router.

## The Task ID Lifecycle

```js
// Save
function toggleTask(taskId) {
  const state = store.load();
  state.tasks[taskId] = !state.tasks[taskId];
  store.save(state);
  // re-render checkbox only, not whole page
}

// Load on render
function renderTask(task) {
  const state = store.load();
  const checked = !!state.tasks[task.id];
  return el('label', {}, [
    el('input', { type: 'checkbox', checked, onchange: () => toggleTask(task.id) }),
    task.text
  ]);
}
```

**Never change `task.id` once published.** The localStorage key `tasks[task.id]` is what survives across visits. Renaming wipes progress for every student.

## Local Development

```powershell
# Required: file:// blocks localStorage in Chrome — always serve via HTTP
npx serve .
# → http://localhost:3000
```

Add this to `package.json`:

```json
{
  "scripts": {
    "serve": "npx serve ."
  }
}
```

Mention this prominently in any README. Double-clicking `index.html` produces a confusing "my progress doesn't save" bug that wastes hours.

## Migration: Markdown → course-data.js

When porting an existing `.md` outline + content to `course-data.js`:

1. Parse the outline first to get the day/unit skeleton.
2. For each unit's content `.md`, extract `tasks`, `prompts`, `materials` references using grep-style passes (look for the marker patterns from `course-content-authoring`).
3. Generate `course-data.js` as one big object literal. Don't try to make it pretty programmatically — let prettier/eslint format it, or just leave it as-is.
4. Manually review: every unit ID in markdown should exist in `course-data.js`; the day count and hours should match `meta`.

## When This Skill Hands Off

Tell the user:
- "SPA scaffold is live. Run `npm run serve` and open http://localhost:3000."
- "Next: invoke `static-spa-interactions` for progress persistence, sidebar, theme, RWD."
- "Don't rename `course-data.js` paths or task IDs from this point — students' localStorage depends on them."

---
name: course-corporate-edition
description: Use this skill when an existing multi-day public-class teaching site needs to be condensed and re-packaged for a corporate in-house training — typically a half-day or one-day intensive (e.g. 4-day public class → 6-hour corporate). Triggers on phrases like "企業包班", "濃縮版", "客製化課程", "corporate edition", "intensive version", "in-house training", "single-file deliverable", "客戶端課程", "壓縮成一天", or when the user wants a single-folder zippable deliverable for a client. This skill builds on top of an existing site — picking units, condensing time allocation, embedding data into a single HTML, setting up asset fallback chains, and producing an offline-ready package.
---

# Course Corporate Edition

> **Schema authority**: all `window.COURSE` field names come from [`_shared/domain-primitives.md`](../_shared/domain-primitives.md).
>
> **Filename convention (English-first)**: corporate editions live under `corporate-editions/{client}_{hours}h/`. Per-edition folders use `materials/`, `assets/`, `index.html`, `README.md`. Legacy Chinese names (`企業包班/`, `教學素材/`) are deprecated.

This skill takes an existing public-class teaching site and produces a **corporate edition**: shorter, brand-customisable, single-folder deliverable.

## When to Invoke

- User has a finished public-class site (e.g. 4 days × 6h) and needs a 1-day version for a client.
- User wants to clone an existing corporate edition for a new client with different branding.
- User wants the deliverable to be **a single folder** the client's IT can zip and host themselves.

## The Two Architectural Shifts

The corporate edition makes two deliberate departures from the public-class architecture:

### Shift 1: Single-file SPA (inline `window.COURSE`)

Public class: `index.html` + `course-data.js` (separate file).
Corporate: `course-data` is **inlined** as `<script>window.COURSE = { ... }</script>` inside `index.html`.

**Why**: corporate clients zip and host the folder themselves. One file is one less moving part. Also: `file://` double-click works (no separate JS fetch issues).

**Cost**: editing the data requires touching HTML. Acceptable because corporate editions ship and don't get edited again.

### Shift 2: Asset fallback chain

Corporate edition has its own `assets/` folder, but **falls back to the public-class `assets/`** for anything not overridden:

```
corporate-editions/client_6h/
├── index.html              ← inline COURSE
├── assets/                 ← corporate-specific overrides (logo, customised hero)
└── materials/              ← curated subset (~11 files vs. public's ~30)
                              ↓ falls back to
project-root/assets/         ← public class's full asset library
project-root/course-package/materials/  ← public class's full material library
```

Implementation: every asset reference tries the corporate path first; on 404, it tries the public-class path. The bundled ebook builder does the same in its compose layer:

```js
const ASSET_ROOTS = [
  path.join(CORP_DIR, 'assets'),
  path.join(PUBLIC_ROOT, 'assets'),
];
async function findAsset(filename) {
  for (const root of ASSET_ROOTS) {
    try { await fs.access(path.join(root, filename)); return path.join(root, filename); }
    catch { /* try next */ }
  }
  return null;
}
```

**Why**: you'd duplicate 200+ MB of illustrations across every client edition otherwise. Override only what changes (brand, hero), share everything else.

## Folder Convention

```
project-root/
├── (all public-class files)
├── corporate-editions/
│   ├── clientA_6h/                     ← Generic edition (fictional case, sellable to many clients)
│   │   ├── index.html
│   │   ├── README.md                   ← shipping / HR onboarding notes
│   │   ├── assets/                     ← edition-specific overrides
│   │   └── materials/                  ← edition-specific curated materials
│   └── clientB_condensed/              ← Real-client custom edition
│       └── (same shape)
└── assets/                              ← public-class full asset library (fallback target)
```

> **Generic vs custom edition**: the generic edition uses a fictional company name (e.g. "GreenField Select") as the running case — sellable to multiple clients. Custom editions replace the case with real client data only on demand.

## Condensing Strategy (24h → 6h)

Picking which units to keep is the hardest part. Heuristic:

1. **Drop units about general concepts** (e.g. "AI 的歷史", "Prompt 基礎") — corporate audiences want to see immediate ROI, not foundations.
2. **Keep units with concrete deliverables** — the corporate measure of success is "what did we walk out with". Aim for 7–8 takeaway artifacts.
3. **Compress shared scenario** — public class has multiple recurring brands; corporate gets one (the most relatable to the client's industry).
4. **Merge similar units** — two related units in the public class often become one combined unit (e.g. "撰寫提示詞" + "建立 Gem" → "Gem 封裝實戰").
5. **Restructure time**: public class is "Day-based"; corporate is usually "Morning / Afternoon" (e.g. AM 3h + PM 3h with 1h lunch). Adjust `window.COURSE.day1.title` accordingly (`"Day1: 上午"`, `"Day2: 下午"`).

## Unit-Picking Worksheet

When planning the condensed version, fill in a table like this:

| Corporate Unit | Borrowed From | Time | Why kept |
|---|---|---|---|
| 1.1 開場 + 自我盤點 | (new) | 25 min | Anchor for the day |
| 1.2 Gem 概念 + 多平台文案 | public Day 1 u2-u4 | 95 min | Highest ROI, concrete output |
| 1.3 NotebookLM × Gem 整合 | public Day 3 u1 | 25 min | Differentiator |
| ... | ... | ... | ... |

This table becomes the source of truth when wiring up the corporate `index.html` — every unit must trace back.

## Branding Customisation Variables

Pull all client-specific text into a single block at the top of inlined COURSE:

```js
window.COURSE = {
  meta: {
    title: '電商團隊 AI 即戰力',
    audience: '3–30 人企業內訓',
    client: '景笙顧問',           // ← swap per client
    hours: 6,
    schedule: '09:00–16:00',
    classroom: '客戶端（由企業指定，實體 / 線上同步皆可）',
  },
  // ...
};
```

Cloning for a new client: copy the folder, search-replace the client name, swap branded assets in `assets/`.

## Single-Folder Deliverable Check

Before sending to a client, verify the folder is truly self-contained:

```js
// scripts/verify-corp-self-contained.mjs
// Walk the folder, parse every src/href, ensure no path goes outside this folder
// EXCEPT for the documented public-class fallback paths.
```

If a stray `../assets/foo.png` slips in, the client's IT will see broken images after unzipping.

## Companion Verification Scripts

The example workshop ships these — adapt for any new corporate edition:

| Script | What it checks |
|---|---|
| `scripts/verify-corp-{name}.mjs` | Playwright: load, screenshot at multiple viewports, sidebar/scrollspy/progress |
| `scripts/verify-corp-{name}-404.mjs` | Crawl every asset, confirm none 404 |
| `scripts/audit-corp-{name}-content.mjs` | Diff inlined COURSE vs source markdown to catch drift |
| `scripts/diagnose-corp-{name}-{topic}.mjs` | Per-issue diagnostic (DOM zone, day visibility) |

The pattern: one verify script per concern, all under `scripts/` with the `corp-{name}` prefix.

## Anti-Patterns

- **Duplicating the whole assets folder** — defeats the point of the fallback chain.
- **Editing the public-class site to "make it work" for the corporate version** — keep them decoupled. The corporate edition reads from public-class assets read-only.
- **Hardcoding the client's actual data in the generic edition** — keep the generic edition with a fictional case; only customise on demand.
- **Forgetting `file://` constraints** — corporate clients double-click `index.html`. Avoid `fetch()` of local JSON, avoid features that need a real HTTP server (localStorage works fine).

## Hand-off

When this skill finishes:
- A new folder under `corporate-editions/{client}_{hours}h/` is ready to zip.
- `README.md` inside explains startup (double-click), HR notes, and a course summary.
- Verify scripts pass.

If the client also wants a printed PDF / DOCX deliverable, that's `course-ebook-publishing`'s job — invoke that next.

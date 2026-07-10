---
name: web-content-audit
description: Use this skill when you need to verify cross-file data/asset consistency in a content-driven site — not "does it render?" (that's `web-visual-verification`) but "do the data, files, and references all line up?". Triggers on phrases like "盤點內容", "稽核資產", "對照 course-data 跟 markdown", "找缺圖", "task ID 有沒有重複", "quiz 編號 vs 硬編碼總數", "audit", "content audit", "content drift", "asset coverage", "three-way sync check", "cross-file consistency", "find missing illustrations", "資料一致性檢查", "找出該補插圖的地方", or any moment when the user senses divergence between source files and deployed data. Output is a human-readable markdown report, not a pass/fail. Pair with `web-visual-verification` for full pre-release coverage.
---

# Web Content Audit

> **Schema authority**: cross-file consistency rules (3-place sync for materials, task ID stability, quiz renumber trap) are codified in [`_shared/domain-primitives.md`](../_shared/domain-primitives.md) §13. Audit scripts in this skill operationalise those rules.
>
> **Filename convention (English-first)**: audit reports land under `data/audit-*.md`; scripts under `scripts/audit-*.mjs`.

This skill produces **audit scripts** that read source files and deployed data, compare them, and emit a human-readable report. The goal is not to gatekeep deployment (that's verification's job) — it's to surface drift that humans should review.

## When to Invoke

- Before a major content release (catch outline ↔ course-data ↔ visuals drift before students see it).
- After adding/removing units / materials / quiz items (re-check the three-place sync rule).
- Before handing off a corporate edition to a client (confirm the condensed COURSE matches its source).
- When the user senses "something's off" but can't see a runtime bug — audit is for the invisible drift.
- When planning the next iteration (e.g. "which sections need new illustrations?").

**Do NOT invoke** when the question is "does the page render correctly?" — that's `web-visual-verification`.

## Audit vs Verify — Operating Mode Difference

| Trait | Audit | Verify |
|---|---|---|
| Output | Markdown report (human reads) | Pass/fail (CI gates) |
| Tools | File reads, regex, JSON diffs, optionally Playwright | Playwright + asserts |
| Failure mode | Always exits 0; report tells human what's worth fixing | Exits non-zero on bad state |
| When run | Manually, at milestones | On every PR / pre-deploy |
| Mental model | "Show me what's drifted" | "Don't let this regress" |

If your script ends with `assert.*` or `process.exit(1)`, it's not an audit — move it to `web-visual-verification`.

## The Five Audit Categories

### Audit 1: Cross-Artifact Reference Resolution

The classic teaching-site bug: `course-data.js:materials[]` references a file the disk doesn't have, or `getMaterialUrl()` is missing a rule.

```js
// scripts/audit-material-references.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

// Read course-data.js (via vm or regex extract)
const COURSE = await loadCourse('./course-data.js');

const report = ['# Material reference audit\n'];
for (const m of COURSE.materials) {
  // 1. Does the file router know about it?
  const routerCovers = await checkRouterCoverage(m.name);
  // 2. Does the actual file exist?
  const fileExists = await checkFileExists(m);
  // 3. Is it referenced in any unit's materials[]?
  const referencedInUnit = findReferencingUnits(COURSE, m.id);

  if (!routerCovers || !fileExists || referencedInUnit.length === 0) {
    report.push(`## ⚠️ ${m.id}: ${m.name}`);
    report.push(`- Router: ${routerCovers ? '✅' : '❌'}`);
    report.push(`- File: ${fileExists ? '✅' : '❌'}`);
    report.push(`- Referenced in units: ${referencedInUnit.join(', ') || '❌ NONE'}`);
  }
}
await fs.writeFile('data/audit-materials.md', report.join('\n'));
```

The output goes to `data/audit-*.md`; the human opens it and decides what to fix.

### Audit 2: Asset Coverage / Gap Analysis

"Which sections still have no illustration?" — guide future work, don't fail anything.

```js
// scripts/audit-illustrations.mjs
// Walks every .chapter / .accordion-content; counts text length, image count, list density
// For each section: if (textLength > 500 && imageCount === 0) → candidate for illustration
// Output: data/illustration-audit.md (a markdown list with section titles + screenshots)
```

This may use Playwright for screenshots (capture mode — no assertions) but the **product is the gap list**, not the screenshots. Don't conflate this with `web-visual-verification`'s `capture-*.mjs` which has no analytical output.

### Audit 3: Inlined Data ↔ Source Drift (Corporate Edition)

When `window.COURSE` is inlined in `index.html` (corporate edition), it can drift from the source files it was condensed from. Audit the diff:

```js
// scripts/audit-corp-content.mjs
const inlined = await loadCourseFromIndexHtml('corporate-editions/client_6h/index.html');
const source = await loadSourceMarkdown('course-package/');

const report = ['# Corporate edition content audit\n'];

// Compare meta
report.push(`## Meta`);
report.push(diff(inlined.meta, source.meta));

// Per-unit: deliverables / prompts / tasks count
for (const day of ['day1', 'day2']) {
  for (const unit of inlined[day].units) {
    report.push(`## ${unit.id}: ${unit.title}`);
    report.push(`- Prompts: ${unit.prompts?.length || 0}`);
    report.push(`- Tasks: ${unit.tasks?.length || 0}`);
    report.push(`- Materials: ${unit.materials?.length || 0}`);
  }
}
await fs.writeFile('data/audit-corp-content.md', report.join('\n'));
```

The example workshop's `audit-corp-6h-content.mjs` does exactly this — produces a markdown dump for the instructor to skim before each corporate session.

### Audit 4: ID Stability & Reuse

`task.id`, `quiz.id`, `unit.id` are stable contracts (localStorage keys, internal references). Audit them:

```js
// scripts/audit-id-stability.mjs
// 1. Collect all task IDs across course-data.js — check no duplicates
// 2. Read git log for course-data.js — flag any task ID that was renamed (not just deleted)
// 3. Cross-check quiz[N].sourceUnit references actual unit IDs
// 4. Cross-check materials[].id appears in at least one unit's materials[]
```

This is the audit that catches "we accidentally renamed `d2-u3-t1` to `d2-u3-task1`" — silent localStorage-progress-wipe across all students.

### Audit 5: Produced Artifact Inspection

When the pipeline produces a binary deliverable (DOCX, PDF, zip), audit its inner structure to catch broken builds early.

```js
// scripts/inspect-docx-images.mjs
import JSZip from 'jszip';
const zip = await JSZip.loadAsync(await readFile('dist/ebook.docx'));
const images = Object.keys(zip.files).filter(f => f.startsWith('word/media/'));
console.log(`📷 內嵌圖片：${images.length} 張`);
for (const f of images) {
  const size = zip.files[f]._data?.uncompressedSize || 0;
  console.log(`   ${f}  ${(size / 1024).toFixed(1)} KB`);
}
```

If you expect ~30 images and the DOCX has 3, something in the build went wrong silently. This is faster than opening Word and scrolling.

## Output Convention

```
data/
├── audit-materials.md            ← Audit 1
├── audit-illustrations.md         ← Audit 2 (gap analysis)
├── audit/section-*.png            ←   ↳ supporting screenshots
├── audit-corp-content.md          ← Audit 3
├── audit-id-stability.md          ← Audit 4
└── audit-ebook-inspection.txt     ← Audit 5
```

All audit outputs are **versionable markdown** (or JSON). Commit them at release milestones; the diff between releases tells you "what content actually changed".

## Format the Report for Human Skimming

Auditors will skim, not read. Structure for skimming:

```markdown
# {Audit name} — {timestamp}

## Summary
- ✅ 24 of 30 materials fully wired
- ⚠️ 4 materials missing router rules
- ❌ 2 materials referenced but file missing

## ⚠️ Warnings (need attention but not blocking)
...

## ❌ Errors (likely broken in production)
...

## ℹ️ Notes (FYI)
...
```

Lead with the summary and emoji-prefix every section. The audit's job is to be the world's most efficient code review.

## The "Three-Place Sync" Audit (Critical for Teaching Sites)

The pattern from `static-spa-conversion`: every material must appear in (1) filesystem, (2) `course-data.js:materials[]`, (3) `getMaterialUrl()` router. Audit script:

```js
const fsFiles = new Set(await fs.readdir('course-package/materials/'));
const dataMaterials = new Set(COURSE.materials.map(m => routerNameToFile(m.name)));
const routerCoverage = extractRouterRules(indexHtmlContent);

const inFsNotInData = [...fsFiles].filter(f => !dataMaterials.has(f));
const inDataNotInFs = [...dataMaterials].filter(f => !fsFiles.has(f));
const inDataNotInRouter = [...dataMaterials].filter(f => !routerCoverage.has(f));

// Emit a 3-column markdown table showing each file's coverage in each of the three places.
```

This single script catches 90% of "the material link is broken" bugs.

## Audit Doesn't Block — It Informs

The strongest discipline: **audit scripts always exit 0**, even when they find problems. Why:

- Audits run regularly; you don't want CI red because of a known "we'll fix in next release" issue.
- Audits surface judgement calls (e.g. "section has no illustration — is that intentional?") that automation shouldn't decide.
- A failing audit feels like a verify; humans then treat audits as gates and the report falls into "didn't read it" hell.

If an issue MUST block release, promote it to a verify script (`web-visual-verification`) with `assert.*`. Audits inform; verifies gate.

## When to Audit (Cadence)

| Trigger | Audits to run |
|---|---|
| Adding/removing a unit | id-stability, material-references |
| Adding a material file | material-references (esp. the three-place sync) |
| Renumbering quiz | id-stability + manual check of hardcoded `(N題)` strings |
| Before corporate edition handoff | corp-content (inline ↔ source) + material-references |
| Before publishing ebook | inspect-docx-images / inspect-pdf-pagecount |
| Quarterly maintenance | illustrations (gap analysis) → plan next content cycle |

## Anti-Patterns

- **Audit scripts with `assert.*` / non-zero exits** — that's a verify, not an audit. Move it.
- **Audit reports that nobody reads** — keep them short, lead with summary counts, use emojis aggressively for scanability.
- **One audit doing five jobs** — split. `audit-materials.mjs` and `audit-illustrations.mjs` produce different reports to different folders for different decisions.
- **Running audits in CI as if they were verifies** — they become noise, get muted, become useless. Run on demand or at release milestones.
- **No timestamp / version in the report** — when comparing two audit runs, you need to know which is newer.

## Hand-off

When this skill finishes:
- A set of `audit-*.mjs` (and supporting `inspect-*.mjs`) scripts is in `scripts/`.
- Their outputs land in `data/audit-*.md` (or `.json` for tooling consumption).
- A README section in the project explains "how to read an audit report" (link to the convention above).
- The user knows to run audits at release milestones, not on every commit.

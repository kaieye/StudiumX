---
name: web-visual-assets
description: Use this skill when a content-complete website has missing/placeholder images and needs visual assets — scenario illustrations, tool screenshots, instructor cards, conceptual diagrams, classroom location maps, QR codes. Triggers on phrases like "插圖", "工具截圖", "QR", "講師卡", "地圖", "示意圖", "Playwright 爬蟲", "AI 生圖", "visual assets", "screenshots", "illustrations", "QR codes", "instructor cards". This skill covers the four asset sources (scraping, AI generation, hand-drawn SVG, generated codes), the PNG-first + SVG-fallback render pattern, and verification scripts. Usually invoked AFTER interactions are wired (so missing images are visible), but can be invoked earlier if assets are pre-planned.
---

# Web Visual Assets

> **Schema authority**: the `Illustration` primitive shape (`{name, kind, alt, spec}` and `{kind: 'waived', reason}`) and the per-unit `illustrations[]` Coverage Floor are defined in [`_shared/domain-primitives.md`](../_shared/domain-primitives.md) §11.

This skill produces the **visual layer** of a teaching site. Four asset sources cover virtually every need, each with different tradeoffs.

## Asset Source Decision Tree

```
What do you need?
├── Screenshot of a real product/website     → Source 1: Playwright scraping
├── A conceptual scene (workflow, metaphor)  → Source 2: AI image generation
├── A simple diagram (boxes, arrows, labels) → Source 3: Hand-drawn SVG
└── A scannable code / functional artifact   → Source 4: Code generator (QRCode, etc.)
```

## Source 1: Playwright Scraping

Use for screenshots of tools, websites, profile cards. The example workshop scrapes 6 AI tool homepages and a YouTube instructor channel.

### Standard headless flow

```js
// scripts/scrape-tools.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: `data/tools/${id}.png`, fullPage: false });
await browser.close();
```

### When anti-bot blocks you (CDP mode)

Some sites (Cloudflare, modern OpenAI properties) detect headless Chromium and block. Workaround: connect to a **real Chrome** via CDP:

```powershell
# scripts/start-cdp-chrome.ps1
Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222', '--user-data-dir=C:\tmp\cdp-profile'
```

```js
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = (await browser.contexts()[0].pages())[0];
// ... drive an existing real-browser session
```

Run with `--cdp --pause` flags so the human can complete any CAPTCHA, then press Enter to continue.

### Subset-merge pattern (don't overwrite siblings)

When re-scraping one item out of many, **merge** with existing data instead of overwriting:

```js
async function writeMerged(jsonPath, updates) {
  const existing = JSON.parse(await fs.readFile(jsonPath, 'utf8').catch(() => '{}'));
  await fs.writeFile(jsonPath, JSON.stringify({ ...existing, ...updates }, null, 2));
}
```

CLI: `node scrape-tools.mjs --ids codex,notebooklm` only touches those two.

### YouTube channel quirks

- The channel page is a SPA. URL query strings like `?sort=p&view=0` are **stripped**. Sort client-side after fetching the latest N videos.
- Virtual scrolling **strips `src`** from out-of-view `<img>`. Derive thumbnail URLs from `videoId`: `https://img.youtube.com/vi/{videoId}/hqdefault.jpg`. Don't rely on DOM `src`.

## Source 2: AI Image Generation

Use for scenario illustrations, day heroes, conceptual scenes. The example workshop uses Gemini's image generation; any text-to-image API works.

### Prompt design rules

1. **Specify a consistent visual style** across the whole course (e.g. "flat illustration, soft pastel palette, no text, no people"). Inconsistent illustrations look amateurish.
2. **Avoid faces and brand logos** — AI image generators struggle with both and produce uncanny results.
3. **Store prompts** alongside the images:

```
assets/illustrations/
├── day1-token-prediction.png
├── day1-token-prediction.prompt.md   ← regenerate-ready prompt
└── ...
```

This lets you regenerate at higher quality later or tweak style.

### PNG + SVG fallback render

AI generation occasionally fails (rate limits, content filters, model issues). Pair every AI PNG with a **hand-drawn SVG fallback** at the same path stem:

```js
function renderIllustration(name) {
  const img = el('img', { src: `assets/illustrations/${name}.png`, alt: '' });
  img.onerror = () => { img.src = `assets/illustrations/${name}.svg`; img.onerror = null; };
  return img;
}
```

The browser tries PNG; on 404 swaps to SVG. The fallback ships even if you never use it — defensive against link rot.

## Source 3: Hand-drawn SVG

Use for diagrams that benefit from precise control: arrows between named boxes, step-by-step flows, labelled UI mockups, the classroom map.

Hand-coded SVG (or exported from Figma/Excalidraw) is preferable to AI for:
- Text labels (AI can't reliably render Chinese text inside images)
- Arrow + box flows (AI gets layout wrong)
- Anything that needs to update when course details change

Style hint: wrap in a translucent container + `drop-shadow` filter to match the site's overall aesthetic, even if the SVG itself is line-art.

## Source 4: Generated Codes (QR)

```js
import QRCode from 'qrcode';
await QRCode.toFile('assets/qr/workshop-url.png', 'https://your-workshop.example/', {
  width: 512,
  margin: 1,
  color: { dark: '#000000', light: '#FFFFFF' }
});
```

For dark-themed sites, generate a **dark-on-white** code, not white-on-dark — most QR scanners require dark foreground on light background.

## Asset Folder Convention

```
assets/
├── tools/             ← Source 1: scraped tool/product screenshots
├── illustrations/     ← Source 2 (PNG) + Source 3 (SVG fallback)
├── scenarios/         ← Source 2: per-unit scene illustrations
├── cases/             ← Source 2: shared case visuals
├── characters/        ← Source 2: persona portraits
├── qr/                ← Source 4: QR codes
└── maps/              ← Source 1 (screenshot) or Source 3 (SVG)
```

## Wiring Assets into the SPA

In `course-data.js`, every unit carries an `illustrations[]` array (1–3 entries) populated from the `圖片需求` blocks written in Stage 2:

```js
{
  id: 'u-3',
  title: '...',
  illustrations: [
    { name: 'day1-u3-hero.png',    kind: 'hero',       alt: '...', spec: '...' },
    { name: 'day1-u3-flow.svg',    kind: 'diagram',    alt: '...', spec: '...' },
    { name: 'day1-u3-example.png', kind: 'screenshot', alt: '...', spec: '...' }  // optional 3rd
  ],
  // ...
}
```

`renderUnit` iterates `unit.illustrations` and calls `renderIllustration(entry)`, which handles PNG-first / SVG-fallback per entry. Render hero first (above the fold), then diagram, then screenshot — in that order.

**Legacy single-`illustration` field**: older `course-data.js` files use `illustration: 'foo.png'` (single string). Treat it as `illustrations: [{ name: 'foo.png', kind: 'hero' }]` and migrate to the array form when convenient. Don't rely on the legacy shape for new sites.

## Coverage Floor (Hard Rule — 1–3 illustrations per unit)

A teaching site that ships with only a cover image looks like an unfinished draft — Stage 5 must hit a minimum coverage before declaring the site feature-complete:

- [ ] **Every unit** in `course-data.js` has `illustrations.length >= 1` (and `<= 3`).
- [ ] At least one entry per unit has a real file under `assets/` (PNG or SVG). Pure-stub units (`{ kind: 'placeholder' }` everywhere) fail.
- [ ] Genuine no-image units carry an explicit waiver: `illustrations: [{ kind: 'waived', reason: '...' }]`. Silence — i.e. an empty array — fails the floor.
- [ ] Cover image (`assets/cover.png` or equivalent) exists in addition to per-unit images. Cover does NOT count toward any unit's 1–3 quota.

When the floor is unmet, the site cannot be declared "feature-complete" and Stages 5b / 6 must NOT be dispatched yet — see `teaching-site/SKILL.md` Stage 5 Image Coverage Floor for the orchestrator-level enforcement.

### Batch-generation pattern (recommended)

Don't generate images one unit at a time. Build a manifest from `course-data.js` and run a batch:

```js
// scripts/generate-illustrations.mjs
const manifest = [];
for (const dayKey of ['day1', 'day2', 'day3', 'day4']) {
  for (const unit of window.COURSE[dayKey].units) {
    for (const ill of (unit.illustrations || [])) {
      if (ill.kind === 'waived') continue;
      manifest.push({ name: ill.name, prompt: ill.spec, kind: ill.kind });
    }
  }
}
// → feed manifest to AI image API in parallel batches of 4–6
```

Why batch: style consistency. Single-unit ad-hoc generation drifts. A batch with the same style prefix produces a coherent visual system.

## Verification

Two verification concerns, each with its own skill:

- **"Do referenced assets exist on disk?"** (cross-file reference check) → invoke `web-content-audit`. Its Audit 1 (Cross-Artifact Reference Resolution) and the asset coverage audit cover this exactly.
- **"Do assets actually render in the browser without 404s?"** (runtime check) → invoke `web-visual-verification`. A multi-viewport verify script that collects `console.error` will surface broken `<img>` requests automatically.

Run **both** before each deployment. The audit catches references to files that don't exist; the verify catches assets that exist but are mis-pathed in the rendered HTML. They fail in different ways and need different scripts.

## Anti-Patterns

- **Generating images one-by-one without style consistency** — write the style spec once, paste it as prefix for every prompt.
- **AI-generated text in images** — almost always broken; use SVG for any image that needs accurate text.
- **No SVG fallback for AI PNGs** — when the PNG link breaks (file deletion, rename mistake), the site shows broken-image icons; SVG fallback degrades gracefully.
- **Storing screenshots without a re-scrape script** — six months later someone wants fresh screenshots and there's no record of how the originals were taken.

## Hand-off

Tell the user: "visual assets in place. Run `node scripts/verify-assets.mjs` to confirm nothing's missing. The site is now feature-complete. Next stage (`course-ebook-publishing`) can turn the same content into a PDF/DOCX deliverable — invoke that only when the web version is stable."

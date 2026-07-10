---
name: web-visual-verification
description: Use this skill whenever you need to verify that a web UI actually works the way it's supposed to — clicking through flows, asserting state, catching console errors, taking screenshots across multiple viewports for visual review. Triggers on phrases like "驗證網頁", "verify the site", "Playwright tests", "visual regression", "RWD verification", "screenshot comparison", "responsive check", "console error check", "看看手機版有沒有壞", "視覺驗證", "Playwright 測試", "截圖比對", "RWD 驗證", "驗 sidebar", "看 console 有沒有錯", or any post-change moment where the user wants to know "did I break anything?". This is the runtime-behaviour verifier — use `web-content-audit` instead if the question is about file/data consistency rather than rendered behaviour.
---

# Web Visual Verification

> **Schema authority**: when verifying that data renders correctly, the source-of-truth field names come from [`_shared/domain-primitives.md`](../_shared/domain-primitives.md). E.g. asserting `unit.illustrations.length >= 1` matches §11's Coverage Floor.
>
> **Reference implementation**: `d:/GitHub/ai-workshop/scripts/verify-*.mjs` for production verify-script patterns (multi-viewport, console-error capture, screenshot-on-fail).

This skill produces **Playwright-based runtime verification scripts** that drive the actual rendered site and answer "does it behave correctly?". The skill emerged from a teaching-website project but applies to any static or dynamic web UI.

## When to Invoke

- After any interaction-layer change (Stage 4 interactions, sidebar logic, theme, zoom).
- After any visual asset change (Stage 5 — illustrations, screenshots).
- After any layout / CSS change ("the sidebar collapsed weirdly", "the modal lost its backdrop").
- Before tagging a release or handing off a corporate edition.
- When the user asks "did that change break anything else?".

**Do NOT invoke** for file/data consistency checks (use `web-content-audit`).

## The Four Script Roles — Use the Right One

Every Playwright script in this skill has **exactly one** of these jobs. Mixing roles produces unmaintainable scripts.

| Role | Prefix | Has assertions? | Outputs | When to use |
|---|---|---|---|---|
| **Verify** | `verify-*.mjs` | Yes (`assert.*`) | Pass/fail + screenshots | Default — runtime regression check |
| **Capture** | `capture-*.mjs` | No | Screenshots only | Need visual evidence without judgement (design review, change log) |
| **Diagnose** | `diagnose-*.mjs` | No (but logs heavily) | Console dump + DOM tree + screenshots | When a verify failed and you need to figure out why |
| **Probe** | `check-*.mjs`, `find-*.mjs` | Targeted, often ad-hoc | Console output | Quick CLI: "does this string appear?", "where is element X?" |

**The discipline**: a verify script must fail loudly. A capture script must never fail (it's just evidence). A diagnose script is exploratory. A probe is a one-liner replacement for browser devtools.

## Skeleton: Multi-Viewport Verify Script

This is the workhorse pattern. Adapt for any UX flow.

```js
// scripts/verify-mobile.mjs
import { chromium, devices } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCREENSHOT_DIR = resolve(ROOT, 'data', 'mobile-verify');
const URL = process.env.URL || 'http://localhost:3000/';

const PROFILES = [
  { id: 'iphone-se',  device: devices['iPhone SE'] },
  { id: 'iphone-13',  device: devices['iPhone 13'] },
  { id: 'ipad-mini',  device: devices['iPad Mini'] },
  { id: 'desktop',    device: { viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0' } },
];

async function verifyProfile(browser, profile) {
  const ctx = await browser.newContext({ ...profile.device, locale: 'zh-TW' });
  const page = await ctx.newPage();

  // === CRITICAL: collect runtime errors ===
  const errors = [];
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('section.chapter', { timeout: 10000 });

  // === Per-profile assertions go here ===
  const isMobile = (profile.device.viewport?.width ?? 1280) <= 768;
  // Example: assert horizontal overflow doesn't exist
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, `${profile.id}: 水平溢出`);

  // Screenshot at key states
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, `${profile.id}-home.png`), fullPage: false });

  // === Fail if any console errors collected ===
  assert.equal(errors.length, 0, `${profile.id} console errors:\n${errors.join('\n')}`);
  await ctx.close();
}

const browser = await chromium.launch({ headless: true });
try {
  for (const p of PROFILES) await verifyProfile(browser, p);
  console.log('✅ All profiles passed');
} finally { await browser.close(); }
```

## Reusable Assertions (Copy When Adding New Verify Scripts)

### Horizontal overflow (the most common layout bug)

```js
const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
assert.ok(overflow.scrollWidth <= overflow.innerWidth, `水平溢出 ${overflow.scrollWidth} > ${overflow.innerWidth}`);
```

### Window scroll actually works (catches `overflow-x: hidden` implicit lock)

```js
await page.evaluate(() => window.scrollTo(0, 1500));
const y = await page.evaluate(() => window.scrollY);
assert.ok(y > 0, 'window 無法捲動（檢查 ancestor 是否有 overflow:hidden）');
```

### Sidebar overlay behaviour (mobile)

```js
if (isMobile) {
  // Default: sidebar hidden
  const before = await page.locator('.sidebar').boundingBox();
  assert.ok(!before || before.x < 0, 'sidebar should be off-screen by default on mobile');

  // Open via hamburger
  await page.locator('.menu-toggle').click();
  await page.waitForTimeout(400);  // animation
  const after = await page.locator('.sidebar').boundingBox();
  assert.ok(after && after.x >= 0, 'sidebar should slide in after toggle');

  // Backdrop click closes
  await page.locator('.sidebar-backdrop').click();
  await page.waitForTimeout(400);
}
```

### localStorage round-trip (progress persistence)

```js
await page.locator('input[type=checkbox]').first().check();
await page.reload();
await page.waitForSelector('input[type=checkbox]');
const checked = await page.locator('input[type=checkbox]').first().isChecked();
assert.equal(checked, true, '勾選未持久化（檢查 localStorage key 與 file:// 限制）');
```

### Content zoom isolated to `.content` (not sidebar)

```js
const sidebarRect = await page.locator('.sidebar').boundingBox();
// Trigger zoom in
await page.evaluate(() => document.documentElement.style.setProperty('--content-zoom', '1.35'));
await page.waitForTimeout(100);
const sidebarRectAfter = await page.locator('.sidebar').boundingBox();
assert.equal(sidebarRect.width, sidebarRectAfter.width, 'sidebar should not be affected by zoom');
```

## NetworkIdle vs domcontentloaded — Choose Carefully

| `waitUntil:` | When to use |
|---|---|
| `'domcontentloaded'` | DOM exists but JS may still be running. Fast. Use when verifying static content or when you `waitForSelector` afterward anyway. |
| `'networkidle'` | All XHR/fetch quiet for 500ms. Use when site depends on data loaded post-DOMContentLoaded (e.g. `course-data.js` injected COURSE renders units). Slower but robust. |
| `'load'` | Only the document's `load` event. Often misleading — async data may still be pending. Avoid for SPAs. |

Default to `'networkidle'` for SPA verification; switch to `'domcontentloaded'` + explicit `waitForSelector` only if you hit timeouts.

## Screenshot Conventions

```
data/
├── mobile-verify/
│   ├── iphone-se-home.png
│   ├── iphone-se-sidebar-open.png
│   ├── iphone-13-home.png
│   └── desktop-home.png
├── toolbox-verify/
│   └── ...
└── design-audit/        ← capture-*.mjs goes here (no assertions, just evidence)
```

One folder per verify domain. Filename pattern: `{profile-id}-{state}.png`. Don't dump everything into `data/`.

## Diagnose Script Pattern (When Verify Fails)

A diagnose script does NOT assert — it gathers context. Output is a dump of DOM, console, computed styles, screenshots.

```js
// scripts/diagnose-day2-visibility.mjs
const html = await page.evaluate(() => {
  const day2 = document.querySelector('#day2');
  if (!day2) return 'NOT FOUND';
  return {
    boundingBox: day2.getBoundingClientRect().toJSON(),
    computedStyle: {
      display: getComputedStyle(day2).display,
      visibility: getComputedStyle(day2).visibility,
      opacity: getComputedStyle(day2).opacity,
      transform: getComputedStyle(day2).transform,
    },
    innerHTML: day2.innerHTML.slice(0, 500),
    childCount: day2.children.length,
  };
});
console.log(JSON.stringify(html, null, 2));
```

Run when a verify script reports "section.day2 not visible" — the diagnose gives you the actual `display: none` (or `transform: translateY(20px)` if fade-in observer didn't fire) within minutes.

## Probe Script Pattern (Ad-hoc CLI)

These are 20-line one-shot tools. Don't over-engineer.

```js
// scripts/check-text-absence.mjs "招生人數" "100 人"
const phrases = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ locale: 'zh-TW' })).newPage();
await page.goto(process.env.URL || 'http://localhost:3000/');
const body = await page.evaluate(() => document.body.innerText);
const found = phrases.filter(p => body.includes(p));
console.log(found.length ? `❌ Found: ${found.join(', ')}` : '✅ All absent');
await browser.close();
process.exit(found.length ? 1 : 0);
```

CLI args for the phrase list keeps it reusable. Don't wrap in a verify-* script.

## Anti-Patterns

- **Verify scripts without `assert.*`** — just a `console.log("ok")` is not a verify, it's a capture. Be honest about which role you're writing.
- **One mega-script that does everything** — verify-mobile.mjs that also runs audit-design and diagnose-day2. Each script has one job. Compose at the package.json level (`"verify:all": "verify-mobile && verify-toolbox && ..."`).
- **Ignoring `pageerror` / `console.error`** — silent JS errors will sail through every assertion if you don't listen for them. ALWAYS attach the two listeners and assert empty at end.
- **Hardcoded `localhost:3000`** — always honour `process.env.URL`. The same script needs to run against deployed URLs in CI.
- **`page.waitForTimeout(N)` without comment** — fine for animations (note why, e.g. "// 400ms slide-in animation"), bad as a "just wait and hope" tool. Prefer `waitForSelector` or `waitForFunction`.
- **Diagnose scripts that also assert** — the moment they fail mid-run you lose the context you came for. Diagnose = log everything, exit 0.

## CI Integration

```json
{
  "scripts": {
    "verify": "node scripts/verify-mobile.mjs && node scripts/verify-toolbox.mjs && node scripts/verify-instructor-card.mjs",
    "capture": "node scripts/capture-overview.mjs && node scripts/capture-all-zones.mjs"
  }
}
```

Run `verify` in CI (must pass); run `capture` manually before design reviews.

## Hand-off

When this skill finishes:
- A set of verify/capture/diagnose/probe scripts is in `scripts/`.
- Each has a one-line header comment explaining its role and a usage example.
- `npm run verify` runs the full verify suite.
- Screenshots organised under `data/{domain}-verify/`.

If anything failed and you don't know why → reach for the **diagnose** script you wrote alongside the verify. Don't add `console.log` to the verify itself.

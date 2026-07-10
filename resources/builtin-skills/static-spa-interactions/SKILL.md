---
name: static-spa-interactions
description: Use this skill when a vanilla static SPA scaffold exists and needs to feel like a polished product — progress persistence, sidebar + scrollspy navigation, dark/light theme, content zoom, responsive (mobile sidebar overlay), keyboard nav, fade-in entrances, toast notifications, iframe modal viewers, quiz scoring with section back-links. Triggers on phrases like "加進度勾選", "響應式", "暗色模式", "縮放", "scrollspy", "sidebar 收合", "手機版", "RWD", "dark mode", "progress tracking", "quiz UX", "interactive polish". Always invoke AFTER `static-spa-conversion` (renders working), as a standalone enhancement layer.
---

# Static SPA Interactions

> **Schema authority**: the `Task` primitive (id-as-localStorage-key rules) and the `QuizItem` primitive (storage of selected option) come from [`_shared/domain-primitives.md`](../_shared/domain-primitives.md) §8 and §10. localStorage schema lives in §8.
>
> **Reference implementation**: `d:/GitHub/ai-workshop/index.html:2900-3030` for `renderSidebar / setupScrollSpy / applyTheme / setupFadeIn` patterns.

This skill adds the **interaction layer** to a vanilla SPA: state, navigation, theme, responsiveness, accessibility. Each pattern below is a self-contained module that can be added independently.

> The patterns here are documented because they all hide subtle bugs that took real time to find in the example workshop. Read the **"Why"** notes carefully — they're not optional context.

## Pattern 1: localStorage Progress (Task Checkboxes + Quiz Answers)

```js
const STORAGE_KEY = 'your-app-progress-v1';   // version suffix lets you breaking-change later

const store = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { tasks: {}, quiz: {}, theme: 'light' };
    } catch { return { tasks: {}, quiz: {}, theme: 'light' }; }
  },
  save(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); },
  reset() { localStorage.removeItem(STORAGE_KEY); location.reload(); }
};
```

**Why a version suffix in the key**: when you later realise the schema needs to change, increment the suffix (`-v2`). Old keys remain harmless; new visitors get fresh state. Renaming the key wipes everyone — only do that intentionally.

**Why try/catch around JSON.parse**: a corrupted entry (e.g. user opened devtools and edited) will crash `init()` and break the whole page.

## Pattern 2: Sidebar — Two Modes, Don't Merge Them

The sidebar has **opposite default states** on desktop vs. mobile. Trying to express this with a single CSS class is the most common bug.

```css
:root { --sidebar-w: 280px; }

/* Desktop: sidebar visible by default */
.sidebar { position: fixed; left: 0; top: 0; width: var(--sidebar-w); height: 100vh; }
.main { margin-left: var(--sidebar-w); transition: margin-left .2s ease; }
.app.sidebar-closed .sidebar { transform: translateX(-100%); }
.app.sidebar-closed .main { margin-left: 0; }

@media (max-width: 768px) {
  /* Mobile: sidebar hidden by default */
  .sidebar { transform: translateX(-100%); }
  .main { margin-left: 0; }
  .app.sidebar-open .sidebar { transform: translateX(0); }
  .sidebar-backdrop { /* overlay shown only when sidebar-open */ }
}
```

```js
const mql = matchMedia('(max-width: 768px)');
function toggleSidebar() {
  if (mql.matches) document.querySelector('.app').classList.toggle('sidebar-open');
  else document.querySelector('.app').classList.toggle('sidebar-closed');
}
// On viewport crossing 768px, clear both classes so the new viewport's default takes over:
mql.addEventListener('change', () => {
  document.querySelector('.app').classList.remove('sidebar-open', 'sidebar-closed');
});
```

**Why two classes**: on desktop, "closed" means transformed-out; on mobile, "open" means transformed-in. Same class would have opposite CSS rules per viewport — unmaintainable.

**Why `position: fixed` not `sticky`**: any ancestor with `overflow: hidden` breaks sticky. fixed is immune. (Bonus: `overflow-x: hidden` implicitly forces `overflow-y: auto`, making the window non-scrollable — see Pattern 9.)

## Pattern 3: ScrollSpy (Auto-highlight Current Section in Sidebar)

```js
function setupScrollSpy() {
  const sections = document.querySelectorAll('[data-section-id]');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.dataset.sectionId;
        document.querySelectorAll('.sidebar-link').forEach(a => a.classList.toggle('active', a.dataset.target === id));
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
  sections.forEach(s => observer.observe(s));
}
```

**Why `rootMargin: '-30% 0px -60% 0px'`**: it creates a 10%-tall "active zone" in the upper third of the viewport. The section centred in that zone is considered "current". Pure `threshold` alone gives jittery results.

## Pattern 4: Theme Toggle (Dark / Light)

```js
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const s = store.load(); s.theme = theme; store.save(s);
}
applyTheme(store.load().theme);  // on load
```

CSS uses `[data-theme="dark"]` attribute selector on `:root`. No `prefers-color-scheme` fallback unless the user explicitly wants it — the toggle is the source of truth.

## Pattern 5: Content Zoom (Don't Apply to Sidebar!)

```css
:root { --content-zoom: 1; }
.content { zoom: var(--content-zoom); }
/* Sidebar is OUTSIDE .content — never inherits zoom */
```

```js
function applyZoom(value) {
  if (mql.matches) {
    // On mobile, kill the CSS variable so @media rules govern
    document.documentElement.style.removeProperty('--content-zoom');
  } else {
    document.documentElement.style.setProperty('--content-zoom', value);
  }
}
```

**Why never `html { zoom: X }`**: CSS `zoom` multiplies across descendants. If `html` is 1.35× and `.content` is 1.25×, the actual content is 1.6875×. Restrict zoom to **one** layer.

**Why kill zoom on mobile**: phones don't need to upscale, and the desktop's `1.35` would make text comically large. The `@media (max-width: 768px) :root { --content-zoom: 1 }` only applies if no inline style overrides it — so `removeProperty()` is necessary, not just setting it back to 1.

## Pattern 6: Accordion + Fade-in Entrance

```js
function setupFadeIn() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.15 });
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
}
```

```css
.fade-in { opacity: 0; transform: translateY(20px); transition: opacity .5s, transform .5s; }
.fade-in.visible { opacity: 1; transform: translateY(0); }
```

**Pitfall**: if the section uses `zoom` and IntersectionObserver gets confused about visibility, the `opacity: 0` element stays invisible forever. Use `@keyframes` instead of `opacity: 0 → 1` transitions when zoom is in play (the example workshop hit this and switched the Day hero numbers to keyframes).

## Pattern 7: Copy-to-Clipboard Buttons

```js
async function copyPrompt(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製');
  } catch {
    // Fallback for non-secure context (e.g. file://)
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    ta.remove();
    showToast('已複製');
  }
}
```

The fallback matters because the SPA might be opened from `file://` in some contexts (offline zip delivery) where `navigator.clipboard` is gated.

## Pattern 8: Toast (Minimal)

```js
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
}
```

## Pattern 9: Quiz with Source-Chapter Back-link

Each quiz item has a `sourceUnit` field from `course-content-authoring`. After submission, wrong-answer rows include a "去複習 →" link that scrolls to that unit:

```js
function gradeQuiz() {
  const state = store.load();
  const results = window.COURSE.quiz.map(q => ({
    q, given: state.quiz[q.id], correct: q.answer, isWrong: state.quiz[q.id] !== q.answer
  }));
  // Render with back-links for wrong ones; scroll behaviour:
  // document.querySelector(`[data-section-id="${q.sourceUnit}"]`).scrollIntoView({ behavior: 'smooth' });
}
```

**The N hardcoded places trap**: total question count appears in (1) section title (2) lead paragraph (3) score display "— / N" (4) "你答對 N 題" toast (5) passing threshold `s >= K`. When quiz count changes, audit all five. Consider computing from `window.COURSE.quiz.length` instead — most can be derived.

## Pattern 10: iframe Modal for Material Preview

Instead of opening materials in a new tab (loses progress context), embed them in a modal:

```js
function openViewer(url) {
  const modal = document.createElement('div'); modal.className = 'viewer-modal';
  modal.innerHTML = `<div class="viewer-backdrop"></div><div class="viewer-frame">
    <button class="viewer-close">×</button>
    <iframe src="${url}" loading="lazy"></iframe>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.viewer-close').onclick = () => modal.remove();
  modal.querySelector('.viewer-backdrop').onclick = () => modal.remove();
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', esc); }
  });
}
```

For PDFs that should download, **bypass the modal**: render `<a href="..." download>` directly so the browser triggers a save dialog. Markdown / HTML / TXT → modal; PDF → download. This branching belongs in `getMaterialUrl()`'s caller.

## Pattern 11: Body Scroll Lock When Modal Open

```js
function openViewer(url) { /* ... */ document.body.style.overflow = 'hidden'; }
function closeViewer() { document.body.style.overflow = ''; }
```

Without this, scrolling the modal scrolls the page underneath on macOS Safari.

## Verification

Don't bake verification scripts into this skill — they have their own dedicated skill. **After wiring any interaction pattern above, invoke `web-visual-verification`** to produce the matching verify script (verify-rwd / verify-progress / verify-quiz / verify-modal, etc.). That skill documents the four script roles (verify / capture / diagnose / probe), reusable assertions, and multi-viewport patterns.

The short version: every interaction pattern in this skill has a corresponding verify script. Don't ship interactions without one.

## Hand-off

Tell the user: "interaction layer complete. Open in browser, click around, then run the verify scripts. Next stage (`web-visual-assets`) fills in the artwork — your page probably has missing or placeholder images right now."

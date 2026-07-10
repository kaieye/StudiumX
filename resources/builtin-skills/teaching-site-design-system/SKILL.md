---
name: teaching-site-design-system
description: Use this skill whenever you're making visual / styling decisions on a teaching site or content-driven SPA — picking colors, fonts, badge styles, card layouts, hero treatments, dark mode tokens, or any "how should this look?" question. Triggers on phrases like "視覺風格", "設計系統", "色票", "字體", "暗色模式", "玻璃卡片", "提示詞徽章", "Day hero 怎麼設計", "design tokens", "design system", "color system", "glass cards", "typography", "look and feel", "視覺一致性", or any moment when the user evaluates aesthetics rather than behaviour. This is the cross-cutting visual authority — every stage (SPA, interactions, corporate edition, ebook) reads tokens from here so the brand stays coherent across formats.
---

# Teaching Site Design System

> **Token starter** (copy this, don't re-derive): [`templates/tokens.css`](templates/tokens.css) — full `:root` block + dark theme + signature components (day-hero, glass-card, prompt-card, task-list, learning-goal, concept, unit, material, table). Paste into the `<style>` block of `index.html` (vanilla SPA pattern) or use as external `style.css`.
>
> **Schema authority**: this skill defines visual tokens; data field names live in [`_shared/domain-primitives.md`](../_shared/domain-primitives.md). When styling a component, read that file to know the data shape you're rendering.
>
> **Reference implementation**: `d:/GitHub/ai-workshop/index.html:11-1700` — the full production CSS this skill's tokens were extracted from.

This skill defines the **visual layer** of a teaching site: color tokens, typography, geometry, components, dark mode strategy, and — critically — the **reasoning behind each decision**. The rationale matters more than the literal values; future sites can re-tune the values, but the *why* survives across projects.

## When to Invoke

- Setting up a new teaching site (read tokens before writing first CSS).
- Adding a new visual element (badge, card, hero) — check whether an existing pattern covers it before inventing.
- Tuning dark mode (which token to override, which not to).
- Producing a corporate edition or ebook (same tokens flow to print CSS).
- Reviewing visual consistency complaints ("it looks inconsistent here").

## The Foundational Decision: OKLCH, Not HEX/RGB

```css
:root {
  --bg:      oklch(99% 0.002 240);
  --surface: oklch(100% 0 0);
  --fg:      oklch(18% 0.012 250);
  --accent:  oklch(58% 0.18 255);
  --accent-2: oklch(66% 0.14 65);
}
```

**Why OKLCH** (not `#1a73e8` or `hsl(...)`):
1. **Perceptually uniform** — `oklch(60% ...)` and `oklch(70% ...)` look like an equal step apart; HSL doesn't (its 60→70 yellow jumps visually huge but blue barely changes).
2. **Predictable dark mode** — for each light token at `L=N%`, the dark equivalent is roughly `L=(100-N)%` with the same chroma+hue. Mechanical.
3. **`color-mix(in oklab, ...)` works natively** — e.g. soft accent tints (`color-mix(in oklab, var(--accent) 18%, transparent)`) compose cleanly, no manual rgba math.
4. **Modern browser support is fine** (Chrome 111+, Safari 15.4+, Firefox 113+). For a static teaching site this is acceptable.

If a stakeholder hands you brand colors as hex: convert once to OKLCH and never look back.

## Token Architecture (Two-Axis)

### Axis 1: Semantic Surface Tokens

```css
--bg              /* page background */
--surface         /* card / panel */
--surface-2       /* nested card / hover state */
--fg              /* primary text */
--muted           /* secondary text */
--muted-2         /* tertiary text / placeholder */
--border          /* default border */
--border-strong   /* emphasis border */
```

These are **structural** — they describe role in the layout, not color. Dark mode swaps the values; component CSS doesn't change.

### Axis 2: Accent Tokens (Dual Accent Strategy)

```css
--accent          /* primary action color — blue/violet typically */
--accent-soft     /* faint tint, for hover backgrounds, badges */
--accent-deep     /* high-contrast variant, for hover text */

--accent-2        /* secondary accent — orange/amber typically */
--accent-2-soft
--accent-2-deep
```

**Why two accents** (not one + grayscale): teaching sites have **two equally important attention paths**:
- **Action path** (`--accent`): "click me", "copy this", "navigate here" — typically cool color (blue).
- **Content path** (`--accent-2`): "look here, this is rich content" — Day hero numerals, PROMPT badges, callout backgrounds. Typically warm color (orange/amber).

Single-accent designs end up using grayscale for content emphasis, which makes everything feel like a button. Dual-accent separates "things you click" from "things you read carefully".

### Status Tokens

```css
--success, --success-soft   /* learning goals ✓, copy success */
--warning, --warning-soft   /* gotchas, optional warnings */
--danger,  --danger-soft    /* errors, destructive actions */
```

Always provide a `-soft` variant for backgrounds; the base is for text/icons.

## Typography: One Font Stack to Rule Them All

```css
--font-display: "Nunito", "jf-openhuninn-1.1", "jf-openhuninn",
                "Gen Jyuu Gothic", "Taipei Sans TC Beta",
                "PingFang TC", "Noto Sans TC",
                system-ui, sans-serif;

/* All four roles point to the same stack */
--font-body:  var(--font-display);
--font-serif: var(--font-display);
--font-mono:  var(--font-display);
```

**Why one stack for everything** on a Chinese-language teaching site:
1. Latin + 中文 混排在 90%+ 的段落都會出現。每換一種字體就會出現「字體斷裂感」。
2. The fallback chain handles bilingual rendering — Nunito for Latin glyphs, openhuninn for 中文.
3. Mono / serif variants are mostly used for *spacing / weight* effects, not actually different typefaces. Implement via `font-feature-settings`, `letter-spacing`, `font-weight` instead of swapping fonts.

Exception: ebook PDF for formal print may use a true serif (Source Han Serif) — that's the only place to break this rule.

## Geometry Tokens

```css
--r-sm: 6px;   /* buttons, small chips */
--r-md: 10px;  /* cards, panels */
--r-lg: 14px;  /* heroes, large containers */

--sidebar-w: 268px;
--header-h: 56px;
--content-max: 880px;     /* reading line length cap */

--shadow-lift:
  0 6px 18px -10px oklch(20% 0.02 250 / 0.18),
  0 2px 4px  -2px oklch(20% 0.02 250 / 0.06);
```

**Three radii is enough** — more produces visual chaos. Match radius to element scale: button → sm, card → md, hero → lg.

**`--content-max: 880px`** is deliberate — comfortable reading line length is ~60–75 CJK characters. Wider feels like documentation, narrower feels like mobile-stuck-on-desktop.

**Double-layered shadows** (`--shadow-lift`): one wide-soft + one tight-tighter. Single-layer shadows look digital; double-layer mimics physical card lift. Always negate the y-offset (`-10px`, `-2px`) so the shadow doesn't bleed below the element.

## Signature Components

### 1. Day Hero Numeral

```css
.day-hero-numeral {
  font-family: var(--font-serif);
  font-size: clamp(120px, 16vw, 200px);
  font-weight: 500;
  line-height: 0.85;
  letter-spacing: -0.05em;
  color: var(--accent-2);
  text-shadow: 0 1px 0 color-mix(in oklab, var(--accent-2) 18%, transparent);
}
.day-hero:hover .day-hero-numeral {
  color: var(--accent-deep);
  text-shadow:
    0 2px 0 color-mix(in oklab, var(--accent-2) 22%, transparent),
    0 18px 40px color-mix(in oklab, var(--accent) 22%, transparent);
}
```

**Why a giant numeral** instead of decorative SVG / illustration for Day headers: an abstract SVG looks like a placeholder ("they forgot to put a real image"). A 200px "D2" reads as **intentional, confident, navigational**. Specific > abstract.

**Why `clamp(120px, 16vw, 200px)`**: scales with viewport width but with floor and ceiling so it never feels broken on mobile (would be 120px) or absurd on 4K (capped at 200px).

**Why `@keyframes` fade-in, not `opacity: 0 → transition`**: if `IntersectionObserver` fails to fire (e.g. CSS `zoom` is in play, see `static-spa-interactions`), the numeral stays at `opacity: 0` forever. With `@keyframes`, the default state is visible; animation only "plays once if triggered".

### 2. PROMPT Block (Orange Badge + Dark Code)

```css
.prompt-block {
  background: oklch(15% 0.02 250);          /* always dark, even in light mode */
  color: oklch(92% 0.005 250);
  border-left: 4px solid var(--accent-2);
  padding: 14px 16px;
  border-radius: var(--r-md);
}
.prompt-block::before {
  content: 'PROMPT';
  display: inline-block;
  background: var(--accent-2);
  color: white;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-family: var(--font-mono);
  letter-spacing: 0.1em;
  margin-bottom: 8px;
}
```

**Why orange** (`--accent-2`) for PROMPT: blue (`--accent`) is reserved for "clickable / navigation". Orange marks "this is a recipe — read carefully and copy verbatim". Three months in, learners associate orange = prompt block automatically.

**Why dark background even in light mode**: code-y content reads as code-y. Switching light/dark would feel like the prompt is "less serious" in light mode.

### 3. Glass Card (`glass-card`)

```css
.glass-card {
  background: color-mix(in oklab, var(--surface) 60%, transparent);
  backdrop-filter: blur(12px) saturate(140%);
  border: 1px solid color-mix(in oklab, var(--border) 80%, transparent);
  border-radius: var(--r-md);
  padding: 16px 20px;
  box-shadow: var(--shadow-lift);
}
```

**Why translucent + backdrop-filter**: on a page with rich background (gradient, dotted pattern, illustrations), opaque cards feel heavy. Glass cards let content breathe, signal "this floats on top of the document".

**Caveat**: requires `backdrop-filter` browser support. Safari needs `-webkit-backdrop-filter` prefix. On unsupported browsers, the fallback is just the 60%-opacity color — degrades gracefully.

### 4. Task Checkbox (Three-State Visual)

```css
.task-checkbox {
  width: 18px; height: 18px;
  border: 1.5px solid var(--border-strong);
  border-radius: var(--r-sm);
  display: grid; place-items: center;
  transition: all 120ms ease;
}
.task-item:hover .task-checkbox { border-color: var(--accent); }
.task-item.done .task-checkbox {
  background: var(--success);
  border-color: var(--success);
}
.task-item.done .task-label { text-decoration: line-through; color: var(--muted); }
```

Three states: **default** (empty + strong border), **hover** (accent border, hint of intent), **done** (filled green + strikethrough). The hover state matters — without it, learners aren't sure the checkbox is clickable.

### 5. Goal Badge (Green ✓)

```css
.learning-goal::before {
  content: '✓';
  display: inline-block;
  width: 20px; height: 20px;
  background: var(--success-soft);
  color: var(--success);
  border-radius: 999px;
  text-align: center;
  line-height: 20px;
  margin-right: 8px;
  font-weight: bold;
}
```

Use the green-on-light-green disc consistently for "learning outcomes" / "you'll be able to ...". Don't reuse for "completed" — that's `task-checkbox`'s job. Green has **two distinct semantic uses** which must look different: goal (badge prefix) vs done (filled checkbox).

## Dark Mode Strategy

```css
:root { /* light tokens here */ }

[data-theme="dark"] {
  --bg:      oklch(16% 0.014 250);
  --surface: oklch(19.5% 0.014 250);
  --fg:      oklch(96% 0.005 250);
  --border:  oklch(28% 0.014 250);
  /* accents usually stay the same — accent-deep may flip to brighter */
  --accent-deep: oklch(72% 0.18 255);
}
```

**Use `[data-theme]` attribute, not `prefers-color-scheme`**: a manual toggle is the source of truth. Auto-following OS theme means the user can't decide per-site. The toggle reads/writes localStorage.

**What flips in dark mode**:
- ✅ All surface tokens (bg / surface / fg / muted / border)
- ✅ `accent-deep` (the high-contrast variant) — flip to a brighter L value
- ❌ Status colors (success / danger / warning) — these are semantic, keep their hue; the `-soft` variant naturally darkens because of the surface change
- ❌ `accent-2` — the dual-accent identity should survive dark mode (the orange brand stays orange)

**What stays the same**:
- All geometry tokens (radii, sidebar width, shadow definitions — though shadow opacity may need tuning)
- All component layouts and structure

The rule of thumb: **token values change, component CSS does not**. If you find yourself writing `[data-theme="dark"] .task-checkbox { ... }`, the abstraction has leaked — refactor the component to use tokens for the property that's varying.

## Cross-Format Token Reuse (Web → Ebook)

The ebook print CSS (`course-ebook-publishing`) **reads the same tokens**. Specifically:

```css
/* style-ebook.css (print only) */
@media print {
  :root {
    /* Override only what print needs differently */
    --bg: white;
    --surface: white;
    /* But colors of badges, prompts, headings stay the same */
  }
  .prompt-block { /* same .prompt-block style — looks identical to web */ }
  .learning-goal::before { /* same green disc */ }
}
```

**Why**: a learner who sees the web first, then opens the PDF handbook, should feel "same product". If web is orange-PROMPT and PDF is gray-PROMPT, the visual brand is shattered.

The corporate edition (`course-corporate-edition`) does the same — even with brand-customised assets, the design tokens remain.

## Three Decisions That Sound Small But Aren't

### Decision 1: `color-mix(in oklab, X 18%, transparent)` for soft tints

Don't hand-write `rgba(...)`. Use `color-mix` so tints derive from the source token:

```css
background: color-mix(in oklab, var(--accent-2) 18%, transparent);
```

When you eventually re-tune `--accent-2`, every tint follows. With manual rgba, you'd have 50 places to update.

### Decision 2: No grid system, just `--content-max`

Avoid bringing in a 12-column grid framework. For a teaching site with linear reading flow, `max-width: var(--content-max); margin: 0 auto` is enough. Columns appear locally via `grid-template-columns` inside specific components (figure grid, tool gallery) — but the page itself is a stream.

### Decision 3: Animation budget = "almost none"

Allowed:
- `fade-in` on scroll (one-time per element)
- Hover micro-interactions (color / shadow shift, 120–200ms)
- Sidebar slide (transform, 200ms)

NOT allowed:
- Page transitions between sections
- Decorative idle animations
- Anything > 400ms

Teaching content is dense; animation is a distraction tax. Spend the attention budget on content, not motion.

## Anti-Patterns

- **Inventing a new color for "this one section"** — pull from existing tokens or refactor to add a properly-named token. Drive-by hex values rot the system.
- **Using `--accent` for content-emphasis (like PROMPT badge)** — collapses the dual-accent semantic. Use `--accent-2`.
- **Different font for code blocks** — see typography section. Use the same stack with `font-weight` / `letter-spacing` for differentiation, or accept the visual cost.
- **Manually styling dark mode per component** — see dark mode section. If a component needs special dark-mode handling, the component is using a non-tokenised value somewhere.
- **Forgetting `-soft` variants** — every accent / status color needs a soft variant. Without it, designers reach for ad-hoc opacity values.

## Hand-off

When this skill is consumed by another skill (SPA / interactions / ebook / corporate):
- Reference `:root` tokens, never raw values.
- If you find yourself writing a literal `#...` hex or `rgb(...)`, you've broken the system — either it belongs as a new token, or you're recreating an existing one.
- New components should compose existing patterns (glass-card + prompt-block + task-list) before inventing.

The token file (the `:root { ... }` block) is the single source of truth. Print it on the wall. Re-tune values when the brand evolves, but never widen the token set casually.

# Troubleshooting — Symptom → Likely Skill Path

Map common reported symptoms to the sub-skill / audit / verification path most likely to resolve them.

## Symptom: "素材連結 404" / 學員點素材打不開

**Diagnosis**: Three-place sync was incomplete.

**Path**: `web-content-audit` (run material-references audit) → identify which of the three places is missing → patch:
- If file missing → put it in `course-package/materials/`
- If `course-data.js:materials[]` missing → `course-content-authoring`
- If `getMaterialUrl()` rule missing → `static-spa-conversion`

## Symptom: "進度勾選跑掉" / 我打勾的任務又變空

**Diagnosis**: Task ID was renamed (almost always). localStorage key for the old ID still exists but the new render uses a different ID.

**Path**:
1. `git log -p course-data.js | grep -i task` — find the renamed ID
2. Either revert the rename, OR migrate by retiring the old ID and educating users that progress restarts
3. Add a `web-content-audit` id-stability check to your CI to prevent regression

## Symptom: "結訓測驗分數顯示錯誤"

**Diagnosis**: Quiz item count changed but one of the 5 hardcoded "N題" strings wasn't updated.

**Path**: `course-content-authoring` — search `index.html` for all of:
- "結訓測驗（N 題）" in the section title
- "— / N" in the score display (usually 2 places)
- The toast message after submission
- The passing threshold `s >= K`

All 5 must match `window.COURSE.quiz.length`.

## Symptom: "手機版 sidebar 卡死 / 不能滾動 / 看不到漢堡鈕"

**Diagnosis**: Most likely the dual-class antipattern — someone merged `sidebar-closed` (desktop) and `sidebar-open` (mobile) into one class.

**Path**: `static-spa-interactions` — read the "Sidebar — Two Modes, Don't Merge Them" section. They MUST remain separate classes with opposite default states.

## Symptom: "window 不能滾動 / scrollY 永遠是 0 / topbar sticky 失效"

**Diagnosis**: An ancestor has `overflow-x: hidden` which implicitly sets `overflow-y: auto`, hijacking scrolling away from `window`.

**Path**: `static-spa-interactions` — see "Pattern 2 Why `position: fixed` not `sticky`" and the `overflow-x: hidden` trap. Move `overflow-x` to `body` or `html`, or use a different containment strategy.

## Symptom: "Day hero 數字消失 / 進場後不見了"

**Diagnosis**: `IntersectionObserver` didn't fire (often because `CSS zoom` is active and breaks the observer), and the fade-in used `opacity: 0` transition without a fallback.

**Path**: `teaching-site-design-system` — Day hero section. Switch from `opacity: 0 → transition` to `@keyframes`. Default state visible; animation just decorates.

## Symptom: "sidebar 跟著 zoom 一起放大"

**Diagnosis**: `zoom` was applied at `html` or `:root`, cascading to all descendants including sidebar.

**Path**: `static-spa-interactions` — Pattern 5 (Content Zoom). The `--content-zoom` variable must only be consumed by `.content`, never by ancestor `html`. Sidebar is outside `.content`.

## Symptom: "PDF 封面也有頁碼"

**Diagnosis**: `@page :first { margin: 0 }` not present, or Playwright `page.pdf()` is called without `displayHeaderFooter`.

**Path**: `course-ebook-publishing` — the "Cover page without page number" section. Both the CSS rule AND the `footerTemplate` configuration matter.

## Symptom: "DOCX 圖片很少 / 排版亂"

**Diagnosis**: pandoc raw-HTML support is partial. `<figure-grid>` and other custom layouts get dropped; images via markdown `![](path)` survive but custom HTML doesn't.

**Path**: `course-ebook-publishing` — DOCX section. Inspect with `inspect-docx-images.mjs` to count actual embedded images vs expected.

## Symptom: "企業包班版圖片有些 404"

**Diagnosis**: Asset fallback chain is broken — either the corporate `assets/` doesn't have the override AND the public-class `assets/` doesn't have it either.

**Path**: `course-corporate-edition` — verify the `ASSET_ROOTS` array iterates correctly. Run `web-content-audit` for asset coverage on the corporate folder.

## Symptom: "console 有錯誤但網站看起來正常"

**Diagnosis**: Verify script is missing `pageerror` / `console.error` listeners.

**Path**: `web-visual-verification` — every verify script must collect runtime errors and assert empty at end. The "Skeleton: Multi-Viewport Verify Script" section has the pattern.

## Symptom: "我不知道哪裡壞了，網站看起來怪怪的"

**Diagnosis**: Need broad diagnostic first, not targeted fix.

**Path**:
1. `web-visual-verification` multi-viewport — catches the obvious renders
2. `web-content-audit` — surfaces invisible drift
3. If both clean, ask user to be more specific ("can you point to a screenshot or a URL?")

## Symptom: "電子書跟網頁不一致 / 同一個東西長得不一樣"

**Diagnosis**: Design tokens diverged between web CSS and `style-ebook.css`. Likely the print CSS has overrides that shouldn't be there.

**Path**: `teaching-site-design-system` — Cross-Format Token Reuse section. The `@media print` block should only override surface tokens (white background) for print, NOT badge / prompt colors which must stay identical.

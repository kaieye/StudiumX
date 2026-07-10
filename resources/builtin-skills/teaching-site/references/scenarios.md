# Typical Session Patterns — User Prompt → Dispatch Flow

When the user's request is one of the patterns below, you already know which sub-skills to invoke in what order.

## Build From Scratch

**"幫我從零做一個 4 天工作坊網站"**
→ Stage 1 (`course-outline-design`) → Stage 2 (`course-content-authoring`) → Stage 3 (`static-spa-conversion`) → Stage 4 (`static-spa-interactions`) → Stage 5 (`web-visual-assets`).
- Pin design tokens before Stage 3 (`teaching-site-design-system`).
- Confirm scope at each stage boundary; don't auto-progress.

## Migrate Existing Markdown to Web

**"我有講義 .md 了，幫我做成網頁"**
→ Skip 1–2 (the markdown IS the outline+content). Go straight to Stage 3 (`static-spa-conversion`). Read existing `.md` files first to extract `meta` / `units` / `materials`. Then Stage 4 → 5 as normal.

## Incremental Changes

**"加一個新單元"**
→ Stage 1 update (add unit ID to outline) → Stage 2 (write its content) → Stage 3 (add to `course-data.js:units[]`) → `web-content-audit` to confirm three-place sync.

**"網站可以動了，但手機版很爛"**
→ Stage 4 (`static-spa-interactions`) only. Don't touch content or SPA structure. After: run `web-visual-verification` multi-viewport.

**"課程素材連結 404"**
→ This is the three-place sync bug. Invoke `web-content-audit` first to identify which place is missing; then patch in Stage 2 / 3 as the audit indicates.

**"插圖看起來不一致"**
→ `web-visual-assets` for asset-level regen, or `teaching-site-design-system` for the system-level decision (illustration style spec).

## Derivative Deliverables

**"幫我把公開班濃縮成企業包班 6 小時版"**
→ Stage 5b (`course-corporate-edition`). Pre-requisite: public-class site is feature-complete and stable. Output: a new `corporate-editions/{client}_{hours}h/` folder.

**"網站做完了，幫我印一份 PDF 給學員"**
→ Stage 6 (`course-ebook-publishing`). Verify site is stable first; if it's not, defer. Mention to user that the ebook is a derivative — site changes after this point require re-running the ebook build.

**"客戶要一份濃縮版 + 配套的 PDF"**
→ Stage 5b first (produce corporate folder), THEN Stage 6 (build ebook against the corporate folder). The ebook builder's `loadCourseFromIndexHtml()` works for both inline (corporate) and external (public) `course-data` sources.

## Verification / Audit

**"我剛改了 sidebar，要怎麼確認沒壞"**
→ `web-visual-verification` with multi-viewport profile (iPhone SE / 13 / iPad Mini / Desktop).

**"我刪了一個 unit，影響有多大"**
→ `web-content-audit`: id-stability audit + material-references audit. Both produce markdown reports. Read both before deciding which downstream files to patch.

**"網頁跟 PDF 看起來不一樣"**
→ `teaching-site-design-system`: cross-format token reuse section. The two formats must consume the same token file; if PDF diverges, the `style-ebook.css @media print` block has overrides that shouldn't be there.

## Visual Style Decisions

**"PROMPT 區塊要用什麼顏色"**
→ `teaching-site-design-system`. Specifically the "Why orange for PROMPT" rationale. Don't ad-hoc pick — read the dual-accent strategy first.

**"我想改字體"**
→ `teaching-site-design-system`. Read the "one font stack to rule them all" section before fragmenting the typography system.

## Ambiguous / Exploratory

**"我不知道從哪裡開始"**
→ Read `references/troubleshooting.md` to gauge user's current state. Likely Stage 1, but confirm with 1–2 clarifying questions about: existing materials? target audience? delivery format (web only / web+PDF / corporate)?

**"這個專案我之前做到一半，繼續"**
→ Inspect the file tree first. `課程包/` exists? Stage 1+. `course-data.js`? Stage 3+. `assets/illustrations/`? Stage 5+. `dist/*.pdf`? Stage 6 was done. Pick up at the **first incomplete stage**.

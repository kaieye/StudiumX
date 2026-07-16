import type { LessonSummary } from '../../../shared/teaching-types'
import { escapeAttr, escapeHtml } from './markup-compiler'

export type LessonNavLink = { href: string; label: string }

type LessonNav = {
  prev?: LessonNavLink
  next?: LessonNavLink
}

type LessonFrameBase = {
  title: string
  workspaceName: string
  lessonRelativePath: string
}

/**
 * Owns the stable static-document shell shared by generated lesson artifacts:
 * relative asset roots, navigation chrome, metadata embedding, and the shared
 * quiz/flashcard scripts. Content markup belongs to the caller/compiler.
 */
export function renderLessonDocument(opts: LessonFrameBase & {
  pageClass: string
  heroClass: string
  heroKickerClass: string
  lesson: LessonSummary
  durationMinutes: number
  objective: string
  body: string
  lessons?: LessonSummary[]
  glossaryAvailable: boolean
  footerLine: string
  metadata?: unknown
}): string {
  const assetBase = relativeAssetBase(opts.lessonRelativePath)
  const nav = deriveLessonNav(opts.lessons, opts.lesson.id)
  const metadata = opts.metadata === undefined
    ? ''
    : `\n  <script type="application/json" id="studiumx-lesson-metadata">${safeJsonScript(opts.metadata)}</script>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="StudiumX" />
  <title>${escapeHtml(opts.title)} · ${escapeHtml(opts.workspaceName)}</title>
  <link rel="stylesheet" href="${assetBase}assets/lesson.css" />
  <link rel="stylesheet" href="${assetBase}assets/flashcards.css" />
</head>
<body>
  <main class="${escapeAttr(opts.pageClass)}">
    <header class="${escapeAttr(opts.heroClass)}">
      <p class="${escapeAttr(opts.heroKickerClass)}">Lesson ${escapeHtml(opts.lesson.id)} · ${escapeHtml(String(opts.durationMinutes))} min</p>
      <h1>${escapeHtml(opts.title)}</h1>
      <p>${escapeHtml(opts.objective)}</p>
    </header>

${renderLessonTopNav({ assetBase, nav, glossaryAvailable: opts.glossaryAvailable })}

${opts.body}

${renderLessonFootNav(nav)}

    <footer>
      <p>${escapeHtml(opts.footerLine)}</p>
    </footer>
  </main>${metadata}
  <script src="${assetBase}assets/quiz.js"></script>
  <script src="${assetBase}assets/flashcards.js"></script>
</body>
</html>
`
}

export function renderReferenceDocument(opts: LessonFrameBase & {
  pageClass: string
  heroClass: string
  heroKickerClass: string
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  body: string
  glossaryAvailable: boolean
}): string {
  const assetBase = relativeAssetBase(opts.lessonRelativePath)
  const glossaryLink = opts.glossaryAvailable
    ? ` · <a href="${escapeAttr(`${assetBase}GLOSSARY.md`)}">Glossary</a>`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="StudiumX" />
  <title>${escapeHtml(opts.title)} Reference · ${escapeHtml(opts.workspaceName)}</title>
  <link rel="stylesheet" href="${assetBase}assets/lesson.css" />
</head>
<body>
  <main class="${escapeAttr(opts.pageClass)} reference-page">
    <header class="${escapeAttr(opts.heroClass)}">
      <p class="${escapeAttr(opts.heroKickerClass)}">Reference · Lesson ${escapeHtml(opts.lesson.id)}</p>
      <h1>${escapeHtml(opts.title)} 速查</h1>
      <p>${escapeHtml(opts.mission.title)}：${escapeHtml(opts.mission.excerpt)}</p>
    </header>
    <nav class="lesson-nav">
      <a href="${escapeAttr(`${assetBase}MISSION.md`)}">Mission</a>${glossaryLink} · <a href="${escapeAttr(`${assetBase}RESOURCES.md`)}">Resources</a>
    </nav>
    <section>
      ${opts.body}
    </section>
  </main>
</body>
</html>
`
}

export function relativeAssetBase(relativeLessonPath: string): string {
  const parts = relativeLessonPath.split('/').filter(Boolean)
  const depth = Math.max(0, parts.length - 1)
  return depth === 0 ? './' : '../'.repeat(depth)
}

function deriveLessonNav(lessons: LessonSummary[] | undefined, currentId: string): LessonNav {
  if (!lessons || lessons.length === 0) return {}
  const sorted = [...lessons].sort((a, b) => a.id.localeCompare(b.id))
  const index = sorted.findIndex((lesson) => lesson.id === currentId)
  if (index < 0) return {}
  const toLink = (lesson: LessonSummary): LessonNavLink => ({
    href: basename(lesson.relativePath),
    label: `Lesson ${lesson.id}`
  })
  return {
    prev: index > 0 ? toLink(sorted[index - 1]!) : undefined,
    next: index < sorted.length - 1 ? toLink(sorted[index + 1]!) : undefined
  }
}

function basename(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? relativePath
}

function renderLessonTopNav(opts: { assetBase: string; nav: LessonNav; glossaryAvailable: boolean }): string {
  const prev = opts.nav.prev
    ? `<a href="${escapeAttr(opts.nav.prev.href)}" class="lesson-nav-prev">← ${escapeHtml(opts.nav.prev.label)}</a>`
    : '<span class="lesson-nav-prev lesson-nav-placeholder">← 起点课</span>'
  const glossary = opts.glossaryAvailable
    ? ` · <a href="${escapeAttr(`${opts.assetBase}GLOSSARY.md`)}">Glossary</a>`
    : ''
  return `    <nav class="lesson-nav">
      ${prev}
      <span class="lesson-nav-sep">·</span><a href="${escapeAttr(`${opts.assetBase}MISSION.md`)}">Mission</a>${glossary} · <a href="${escapeAttr(`${opts.assetBase}RESOURCES.md`)}">Resources</a>
    </nav>`
}

function renderLessonFootNav(nav: LessonNav): string {
  const prev = nav.prev
    ? `<a href="${escapeAttr(nav.prev.href)}" class="lesson-nav-prev">← ${escapeHtml(nav.prev.label)}</a>`
    : '<span class="lesson-nav-prev lesson-nav-placeholder">已是第一课</span>'
  const next = nav.next
    ? `<a href="${escapeAttr(nav.next.href)}" class="lesson-nav-next">${escapeHtml(nav.next.label)} →</a>`
    : '<span class="lesson-nav-next lesson-nav-placeholder">下一课待生成 →</span>'
  return `    <nav class="lesson-nav lesson-nav--foot">
      ${prev}
      <span class="lesson-nav-sep">|</span>
      ${next}
    </nav>`
}

function safeJsonScript(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

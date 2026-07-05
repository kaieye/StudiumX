import type { LessonCalloutKind, LessonPlan, LessonQuizItem } from '../../shared/lesson-schema'
import type { LessonSummary, TeachingSettingsV1 } from '../../shared/teaching-types'

/**
 * Renders a validated LessonPlan into the same static HTML skeleton used by
 * the fallback template: shared `assets/lesson.css` + `assets/quiz.js` +
 * `assets/flashcards.js`, and an embedded metadata JSON script. Markdown in
 * section bodies is converted through a strict allowlist (no raw HTML),
 * including GFM-style tables.
 */

type LessonNavLink = { href: string; label: string }

type LessonNav = {
  prev?: LessonNavLink
  next?: LessonNavLink
}

/**
 * Derive prev/next lesson links from the workspace's lesson list. Lessons are
 * sorted by id ascending; the current lesson is matched by id. Links are
 * relative basenames (lessons share one directory).
 */
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

function renderLessonTopNav(opts: {
  assetBase: string
  nav: LessonNav
  glossaryAvailable: boolean
}): string {
  const { assetBase, nav, glossaryAvailable } = opts
  const prev = nav.prev ? `<a href="${escapeAttr(nav.prev.href)}" class="lesson-nav-prev">← ${escapeHtml(nav.prev.label)}</a>` : '<span class="lesson-nav-prev lesson-nav-placeholder">← 起点课</span>'
  const mission = `<a href="${escapeAttr(`${assetBase}MISSION.md`)}">Mission</a>`
  const glossary = glossaryAvailable
    ? ` · <a href="${escapeAttr(`${assetBase}GLOSSARY.md`)}">Glossary</a>`
    : ''
  const resources = ` · <a href="${escapeAttr(`${assetBase}RESOURCES.md`)}">Resources</a>`
  return `    <nav class="lesson-nav">
      ${prev}
      <span class="lesson-nav-sep">·</span>${mission}${glossary}${resources}
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

function renderCallout(callout: { kind: LessonCalloutKind; title?: string; body: string }): string {
  const title = callout.title ? `<p class="callout-title"><strong>${escapeHtml(callout.title)}</strong></p>` : ''
  return `      <aside class="callout callout--${escapeAttr(callout.kind)}">
        ${title}
        ${renderMarkdown(callout.body)}
      </aside>`
}

function renderLessonExtras(opts: {
  plan: LessonPlan
}): string {
  const { plan } = opts
  const calloutsList = plan.callouts ?? []
  const flow = plan.flowDiagram && plan.flowDiagram.trim()
    ? `      <pre class="flow">${escapeHtml(plan.flowDiagram)}</pre>`
    : ''
  const callouts = calloutsList.length
    ? calloutsList.map((callout) => renderCallout(callout)).join('\n')
    : ''
  const interview = plan.interviewAnswer && plan.interviewAnswer.trim()
    ? `      <section class="interview">
        <h2>面试答案</h2>
        ${renderMarkdown(plan.interviewAnswer)}
      </section>`
    : ''
  const primarySource = plan.primarySource
    ? renderPrimarySource(plan.primarySource)
    : ''
  return [flow, callouts, interview, primarySource].filter(Boolean).join('\n')
}

function renderPrimarySource(source: { title: string; url?: string; note?: string }): string {
  const title = source.url
    ? `<a href="${escapeAttr(sanitizeHref(source.url) || '#')}" target="_blank" rel="noreferrer noopener">${escapeHtml(source.title)}</a>`
    : `<strong>${escapeHtml(source.title)}</strong>`
  const note = source.note ? `<p>${escapeHtml(source.note)}</p>` : ''
  return `      <section class="primary-source">
        <h2>推荐阅读</h2>
        <p class="primary-source-title">${title}</p>
        ${note}
      </section>`
}

export function renderLessonHtmlFromPlan(opts: {
  plan: LessonPlan
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  workspaceName: string
  recordRelativePath: string | null
  referenceRelativePath: string | null
  lessons?: LessonSummary[]
  glossaryAvailable?: boolean
  generator: TeachingSettingsV1['generator']
}): string {
  const { plan, lesson, mission, workspaceName, recordRelativePath, referenceRelativePath, generator } = opts
  const assetBase = relativeAssetBase(lesson.relativePath)
  const nav = deriveLessonNav(opts.lessons, lesson.id)
  const sections = plan.sections
    .map(
      (section) => `      <section>
        <h2>${escapeHtml(section.heading)}</h2>
        ${renderMarkdown(section.body)}
      </section>`
    )
    .join('\n')

  const extras = renderLessonExtras({ plan })

  const keyPoints = plan.keyPoints.length
    ? `      <section>
        <h2>要点</h2>
        <ul class="compact-list">
${plan.keyPoints.map((point) => `          <li>${escapeHtml(point)}</li>`).join('\n')}
        </ul>
      </section>`
    : ''

  const flashcards = plan.flashcards.length
    ? `      <section class="flashcards">
        <h2>复习卡片</h2>
${plan.flashcards
  .map(
    (card) =>
      `        <article class="flashcard" tabindex="0"><div class="flashcard-face flashcard-front"><span>${escapeHtml(card.front)}</span></div><div class="flashcard-face flashcard-back"><span>${escapeHtml(card.back)}</span><div class="flashcard-self"><button type="button" data-rating="again">再次</button><button type="button" data-rating="good">良好</button><button type="button" data-rating="mastered">掌握</button></div></div></article>`
  )
  .join('\n')}
      </section>`
    : ''

  const quiz = plan.quiz.length
    ? `      <section class="practice">
        <h2>检索练习</h2>
${plan.quiz.map((item) => renderQuizCard(item)).join('\n')}
      </section>`
    : ''

  const metadata = generator.structuredOutput
    ? `
  <script type="application/json" id="teachos-lesson-metadata">${safeJsonScript({
        lesson,
        mission,
        workspaceName,
        artifacts: {
          lesson: lesson.relativePath,
          reference: referenceRelativePath,
          learningRecord: recordRelativePath
        },
        plan: {
          title: plan.title,
          objective: plan.objective,
          durationMinutes: plan.durationMinutes,
          sections: plan.sections.length,
          quiz: plan.quiz.length,
          flashcards: plan.flashcards.length
        },
        generator: {
          providerId: generator.providerId,
          model: generator.model,
          endpointFormat: generator.endpointFormat,
          temperature: generator.temperature,
          maxOutputTokens: generator.maxOutputTokens,
          includeRetrievalPractice: generator.includeRetrievalPractice
        }
      })}</script>`
    : ''

  const footerLine = plan.followupPrompt && plan.followupPrompt.trim()
    ? escapeHtml(plan.followupPrompt)
    : '下一步：把不清楚的地方继续问教学助手，并把新的理解沉淀成 learning record。'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(plan.title)} · ${escapeHtml(workspaceName)}</title>
  <link rel="stylesheet" href="${assetBase}assets/lesson.css" />
  <link rel="stylesheet" href="${assetBase}assets/flashcards.css" />
</head>
<body>
  <main class="lesson-page">
    <header class="lesson-hero">
      <p class="kicker">Lesson ${escapeHtml(lesson.id)} · ${escapeHtml(String(plan.durationMinutes))} min</p>
      <h1>${escapeHtml(plan.title)}</h1>
      <p>${escapeHtml(plan.objective)}</p>
    </header>

${renderLessonTopNav({ assetBase, nav, glossaryAvailable: opts.glossaryAvailable ?? false })}

${sections}

${extras}

${keyPoints}

${flashcards}

${quiz}

${renderLessonFootNav(nav)}

    <footer>
      <p>${footerLine}</p>
    </footer>
  </main>
${metadata}
  <script src="${assetBase}assets/quiz.js"></script>
  <script src="${assetBase}assets/flashcards.js"></script>
</body>
</html>
`
}

export function renderReferenceHtmlFromPlan(opts: {
  plan: LessonPlan
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  workspaceName: string
  glossaryAvailable?: boolean
}): string {
  const { plan, lesson, mission, workspaceName } = opts
  const assetBase = relativeAssetBase(lesson.relativePath)
  const notes = plan.referenceNotes
    ? renderMarkdown(plan.referenceNotes)
    : `<p>本节速查：${escapeHtml(plan.objective)}</p>`
  const keyPoints = plan.keyPoints.length
    ? `<ul class="compact-list">
${plan.keyPoints.map((point) => `  <li>${escapeHtml(point)}</li>`).join('\n')}
</ul>`
    : ''
  const flow = plan.flowDiagram && plan.flowDiagram.trim()
    ? `<pre class="flow">${escapeHtml(plan.flowDiagram)}</pre>`
    : ''
  const glossaryLink = opts.glossaryAvailable
    ? ` · <a href="${escapeAttr(`${assetBase}GLOSSARY.md`)}">Glossary</a>`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(plan.title)} Reference · ${escapeHtml(workspaceName)}</title>
  <link rel="stylesheet" href="${assetBase}assets/lesson.css" />
</head>
<body>
  <main class="lesson-page reference-page">
    <header class="lesson-hero">
      <p class="kicker">Reference · Lesson ${escapeHtml(lesson.id)}</p>
      <h1>${escapeHtml(plan.title)} 速查</h1>
      <p>${escapeHtml(mission.title)}：${escapeHtml(mission.excerpt)}</p>
    </header>
    <nav class="lesson-nav">
      <a href="${escapeAttr(`${assetBase}MISSION.md`)}">Mission</a>${glossaryLink} · <a href="${escapeAttr(`${assetBase}RESOURCES.md`)}">Resources</a>
    </nav>
    <section>
      ${notes}
      ${flow}
      ${keyPoints}
    </section>
  </main>
</body>
</html>
`
}

export function renderLearningRecordFromPlan(opts: {
  plan: LessonPlan
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
}): string {
  const { plan, lesson, mission } = opts
  const note = (plan.learningRecordNote || '').trim()
  // The prompt asks the model to structure learningRecordNote as two sections
  // marked with `## 判定` and `## 影响`. If present, surface them verbatim;
  // otherwise fall back to a flat summary so empty/legacy plans still render.
  const hasJudgment = /^##\s*判定/m.test(note)
  const body = hasJudgment
    ? note
    : `## 判定\n\n${note || plan.objective}\n\n## 影响\n\n_暂未记录对本课程后续的影响；下次生成课程时由对话补充。_`
  return `# ${plan.title}

- 工作区：${mission.title}
- 课程：Lesson ${lesson.id}（${plan.durationMinutes} 分钟）
- 学习目标：${plan.objective}
- 正文小节：${plan.sections.length}　检索练习：${plan.quiz.length} 题　复习卡片：${plan.flashcards.length} 张

${body}

---

_本记录由 TeachOS 在生成课程时自动落盘，供后续课程的 zone of proximal development 决策使用；对话中若展示了新的理解或纠正了误解，应另起一条 learning-record。_
`
}

// ----------------------------------------------------------------
// Quiz card markup — consumed by the shared assets/quiz.js
// ----------------------------------------------------------------

function renderQuizCard(item: LessonQuizItem): string {
  const type = item.type
  if (type === 'fill') {
    return `        <article class="quiz-card" data-type="fill" data-answer="${escapeAttr(String(item.answer))}">
          <p>${escapeHtml(item.question)}</p>
          <div class="quiz-fill">
            <input type="text" placeholder="输入你的答案" aria-label="答案输入" />
            <button type="button" data-choice="submit">提交</button>
          </div>
          <output aria-live="polite"></output>
          <p class="quiz-explanation">${escapeHtml(item.explanation)}</p>
        </article>`
  }
  if (type === 'truefalse') {
    const answer = String(item.answer) === '1' || String(item.answer).toLowerCase() === 'true' ? 'true' : 'false'
    return `        <article class="quiz-card" data-type="truefalse" data-answer="${escapeAttr(answer)}">
          <p>${escapeHtml(item.question)}</p>
          <div class="quiz-choices">
            <button type="button" data-choice="true">正确</button>
            <button type="button" data-choice="false">错误</button>
          </div>
          <output aria-live="polite"></output>
          <p class="quiz-explanation">${escapeHtml(item.explanation)}</p>
        </article>`
  }
  // single + multi
  const indices = Array.isArray(item.answer)
    ? item.answer
    : typeof item.answer === 'number'
      ? [item.answer]
      : String(item.answer)
          .split(',')
          .map((part) => Number.parseInt(part.trim(), 10))
          .filter(Number.isFinite)
  const letters = indices.map((index) => letterFor(index)).join(',')
  const choices = item.choices
    .map(
      (choice, index) =>
        `            <button type="button" data-choice="${letterFor(index)}">${escapeHtml(choice)}</button>`
    )
    .join('\n')
  return `        <article class="quiz-card" data-type="${escapeAttr(type)}" data-answer="${escapeAttr(letters)}">
          <p>${escapeHtml(item.question)}</p>
          <div class="quiz-choices">
${choices}
          </div>
          <output aria-live="polite"></output>
          <p class="quiz-explanation">${escapeHtml(item.explanation)}</p>
        </article>`
}

function letterFor(index: number): string {
  return String.fromCharCode(97 + index) // 0 -> a, 1 -> b, ...
}

// ----------------------------------------------------------------
// Minimal, strict markdown → HTML (no raw HTML allowed)
// ----------------------------------------------------------------

type TableAlignment = 'left' | 'center' | 'right' | null

type MarkdownTable = {
  header: string[]
  alignments: TableAlignment[]
  rows: string[][]
  endIndex: number
}

function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source)
  const lines = escaped.split(/\r?\n/)
  const blocks: string[] = []
  let list: 'ul' | 'ol' | null = null
  let code = false
  let codeBuffer: string[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const flushList = (): void => {
    if (list) {
      blocks.push(list === 'ul' ? `<ul class="compact-list">${listItems.join('')}</ul>` : `<ol>${listItems.join('')}</ol>`)
      list = null
      listItems = []
    }
  }

  let listItems: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^```/.test(line.trim())) {
      if (code) {
        blocks.push(`<pre><code>${codeBuffer.join('\n')}</code></pre>`)
        codeBuffer = []
        code = false
      } else {
        flushParagraph()
        flushList()
        code = true
      }
      continue
    }
    if (code) {
      codeBuffer.push(line)
      continue
    }
    const table = parseMarkdownTable(lines, index)
    if (table) {
      flushParagraph()
      flushList()
      blocks.push(renderMarkdownTable(table))
      index = table.endIndex
      continue
    }
    const ulMatch = /^[-*]\s+(.*)$/.exec(line)
    const olMatch = /^\d+\.\s+(.*)$/.exec(line)
    if (ulMatch) {
      flushParagraph()
      if (list !== 'ul') {
        flushList()
        list = 'ul'
        listItems = []
      }
      listItems.push(`<li>${inline(ulMatch[1]!)}</li>`)
      continue
    }
    if (olMatch) {
      flushParagraph()
      if (list !== 'ol') {
        flushList()
        list = 'ol'
        listItems = []
      }
      listItems.push(`<li>${inline(olMatch[1]!)}</li>`)
      continue
    }
    flushList()
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line)
    if (headingMatch) {
      flushParagraph()
      const level = headingMatch[1]!.length
      blocks.push(`<h${level + 1}>${inline(headingMatch[2]!)}</h${level + 1}>`)
      continue
    }
    if (/^>\s+/.test(line)) {
      flushParagraph()
      blocks.push(`<blockquote>${inline(line.replace(/^>\s+/, ''))}</blockquote>`)
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  if (code) blocks.push(`<pre><code>${codeBuffer.join('\n')}</code></pre>`)
  return blocks.join('\n')
}

function parseMarkdownTable(lines: string[], startIndex: number): MarkdownTable | null {
  const header = splitTableRow(lines[startIndex] ?? '')
  const separator = splitTableRow(lines[startIndex + 1] ?? '')
  if (!header || !separator || header.length === 0 || separator.length !== header.length) return null

  const alignments: TableAlignment[] = []
  for (const cell of separator) {
    const alignment = parseTableAlignment(cell)
    if (alignment === undefined) return null
    alignments.push(alignment)
  }

  const rows: string[][] = []
  let endIndex = startIndex + 1
  for (let index = startIndex + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') break
    const row = splitTableRow(line)
    if (!row) break
    rows.push(normalizeTableCells(row, header.length))
    endIndex = index
  }

  return {
    header: normalizeTableCells(header, header.length),
    alignments,
    rows,
    endIndex
  }
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null

  const hasLeadingPipe = trimmed.startsWith('|')
  const hasTrailingPipe = endsWithUnescapedPipe(trimmed)
  let body = hasLeadingPipe ? trimmed.slice(1) : trimmed
  if (hasTrailingPipe) body = body.slice(0, -1)

  const cells: string[] = []
  let current = ''
  let escaped = false
  let inCode = false
  let sawSeparator = hasLeadingPipe || hasTrailingPipe

  for (const char of body) {
    if (char === '`' && !escaped) {
      inCode = !inCode
      current += char
      continue
    }
    if (char === '|' && !escaped && !inCode) {
      cells.push(current.trim())
      current = ''
      sawSeparator = true
      continue
    }
    current += char
    escaped = char === '\\' && !escaped
  }

  if (!sawSeparator) return null
  cells.push(current.trim())
  return cells
}

function endsWithUnescapedPipe(value: string): boolean {
  if (!value.endsWith('|')) return false
  let slashCount = 0
  for (let index = value.length - 2; index >= 0 && value[index] === '\\'; index -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 0
}

function parseTableAlignment(cell: string): TableAlignment | undefined {
  // Normalize full-width colons and em/en dashes some Chinese-locale models
  // emit. Require at least 2 dashes/colons (GFM says 3+, but weaker models
  // emit `:--:` or `--` and we'd rather render the table than drop it to a
  // paragraph — see the 0003-rag.html regression).
  const marker = cell
    .replace(/[：:]/g, ':')
    .replace(/[—–\-―]/g, '-')
    .replace(/\s+/g, '')
  if (!/^:?-{2,}:?$/.test(marker)) return undefined
  if (marker.startsWith(':') && marker.endsWith(':')) return 'center'
  if (marker.endsWith(':')) return 'right'
  if (marker.startsWith(':')) return 'left'
  return null
}

function normalizeTableCells(cells: string[], expected: number): string[] {
  const normalized = cells.slice(0, expected)
  while (normalized.length < expected) normalized.push('')
  return normalized
}

function renderMarkdownTable(table: MarkdownTable): string {
  const header = table.header
    .map((cell, index) => `          <th scope="col"${alignmentClass(table.alignments[index])}>${inline(cell)}</th>`)
    .join('')
  const rows = table.rows
    .map((row) => `        <tr>${row.map((cell, index) => `<td${alignmentClass(table.alignments[index])}>${inline(cell)}</td>`).join('')}</tr>`)
    .join('\n')

  return `<div class="markdown-table-wrap">
      <table>
        <thead>
        <tr>${header}</tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`
}

function alignmentClass(alignment: TableAlignment | undefined): string {
  return alignment ? ` class="align-${alignment}"` : ''
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
      const safe = sanitizeHref(href)
      return safe ? `<a href="${escapeAttr(safe)}">${label}</a>` : label
    })
}

function sanitizeHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''
  // Only allow relative URLs or explicit http(s); block javascript:, data:, etc.
  if (/^(https?:\/\/|\/|\.\.\/|\.\/|#)/i.test(trimmed)) return trimmed
  if (!/[a-z0-9+.-]+:/i.test(trimmed)) return trimmed // relative (e.g. "../MISSION.md")
  return ''
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
}

function safeJsonScript(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function relativeAssetBase(relativeLessonPath: string): string {
  const parts = relativeLessonPath.split('/').filter(Boolean)
  const depth = Math.max(0, parts.length - 1)
  return depth === 0 ? './' : '../'.repeat(depth)
}

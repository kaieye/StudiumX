import type { LessonPlan, LessonQuizItem } from '../../shared/lesson-schema'
import type { LessonSummary, TeachingSettingsV1 } from '../../shared/teaching-types'

/**
 * Renders a validated LessonPlan into the same static HTML skeleton used by
 * the fallback template: shared `assets/lesson.css` + `assets/quiz.js` +
 * `assets/flashcards.js`, and an embedded metadata JSON script. Markdown in
 * section bodies is converted through a strict allowlist (no raw HTML).
 */

export function renderLessonHtmlFromPlan(opts: {
  plan: LessonPlan
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  workspaceName: string
  recordRelativePath: string | null
  referenceRelativePath: string | null
  generator: TeachingSettingsV1['generator']
}): string {
  const { plan, lesson, mission, workspaceName, recordRelativePath, referenceRelativePath, generator } = opts
  const assetBase = relativeAssetBase(lesson.relativePath)
  const sections = plan.sections
    .map(
      (section) => `      <section>
        <h2>${escapeHtml(section.heading)}</h2>
        ${renderMarkdown(section.body)}
      </section>`
    )
    .join('\n')

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

    <section class="mission-card">
      <span>Mission</span>
      <strong>${escapeHtml(mission.title)}</strong>
      <p>${escapeHtml(mission.excerpt)}</p>
    </section>

${sections}

${keyPoints}

${flashcards}

${quiz}

    <footer>
      <p>下一步：把不清楚的地方继续问教学助手，并把新的理解沉淀成 learning record。</p>
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
    <section>
      ${notes}
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
  const note = plan.learningRecordNote || plan.objective
  return `# ${plan.title}

本节课围绕「${mission.title}」建立了一个可保存的学习动作：${note}。

- 学习目标：${plan.objective}
- 时长：${plan.durationMinutes} 分钟
- 正文小节：${plan.sections.length}
- 检索练习：${plan.quiz.length} 题
- 复习卡片：${plan.flashcards.length} 张

下一步应继续维护 MISSION.md、RESOURCES.md 与 learning-records，而不是只依赖一次性聊天上下文。
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
  for (const raw of lines) {
    const line = raw
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

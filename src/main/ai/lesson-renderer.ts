import type { LessonCalloutKind, LessonPlan, LessonQuizItem } from '../../shared/lesson-schema'
import { LESSON_MARKUP_CLASSES, LESSON_MARKUP_DATA_ATTRIBUTES } from '../../shared/lesson-style-themes/contract'
import type { LessonSummary, TeachingSettingsV1 } from '../../shared/teaching-types'
import { renderLessonDocument, renderReferenceDocument } from './lesson-rendering/document-frame'
import { compileLessonMarkup, escapeAttr, escapeHtml, sanitizeHref } from './lesson-rendering/markup-compiler'

/**
 * Public rendering facade for lesson publication. The three exported operations
 * remain the publishing seam; markup parsing and static-document framing live
 * behind dedicated internal modules.
 */

const cls = LESSON_MARKUP_CLASSES
const data = LESSON_MARKUP_DATA_ATTRIBUTES

function renderMarkup(source: string): string {
  return compileLessonMarkup(source, { compactListClass: cls.compactList })
}

function renderCallout(callout: { kind: LessonCalloutKind; title?: string; body: string }): string {
  const title = callout.title ? `<p class="callout-title"><strong>${escapeHtml(callout.title)}</strong></p>` : ''
  return `      <aside class="callout callout--${escapeAttr(callout.kind)}">
        ${title}
        ${renderMarkup(callout.body)}
      </aside>`
}

function renderLessonExtras(plan: LessonPlan): string {
  const flow = plan.flowDiagram && plan.flowDiagram.trim()
    ? `      <pre class="flow">${escapeHtml(plan.flowDiagram)}</pre>`
    : ''
  const callouts = (plan.callouts ?? []).map(renderCallout).join('\n')
  const interview = plan.interviewAnswer && plan.interviewAnswer.trim()
    ? `      <section class="interview">
        <h2>面试答案</h2>
        ${renderMarkup(plan.interviewAnswer)}
      </section>`
    : ''
  const primarySource = plan.primarySource ? renderPrimarySource(plan.primarySource) : ''
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
  recordRelativePath?: string | null
  referenceRelativePath: string | null
  lessons?: LessonSummary[]
  glossaryAvailable?: boolean
  generator: TeachingSettingsV1['generator']
}): string {
  const { plan, lesson, mission, workspaceName, recordRelativePath = null, referenceRelativePath, generator } = opts
  const sections = plan.sections
    .map((section) => `      <section>
        <h2>${escapeHtml(section.heading)}</h2>
        ${renderMarkup(section.body)}
      </section>`)
    .join('\n')
  const extras = renderLessonExtras(plan)
  const keyPoints = plan.keyPoints.length
    ? `      <section>
        <h2>要点</h2>
        <ul class="${cls.compactList}">
${plan.keyPoints.map((point) => `          <li>${escapeHtml(point)}</li>`).join('\n')}
        </ul>
      </section>`
    : ''
  const flashcards = plan.flashcards.length
    ? `      <section class="${cls.flashcards}">
        <h2>复习卡片</h2>
${plan.flashcards
  .map(
    (card) =>
      `        <article class="${cls.flashcard}" tabindex="0"><div class="${cls.flashcardFace} ${cls.flashcardFront}"><span>${escapeHtml(card.front)}</span></div><div class="${cls.flashcardFace} ${cls.flashcardBack}"><span>${escapeHtml(card.back)}</span><div class="${cls.flashcardSelf}"><button type="button" ${data.flashcardRating}="again">再次</button><button type="button" ${data.flashcardRating}="good">良好</button><button type="button" ${data.flashcardRating}="mastered">掌握</button></div></div></article>`
  )
  .join('\n')}
      </section>`
    : ''
  const quiz = plan.quiz.length
    ? `      <section class="${cls.practice}">
        <h2>检索练习</h2>
${plan.quiz.map(renderQuizCard).join('\n')}
      </section>`
    : ''
  const footerLine = plan.followupPrompt && plan.followupPrompt.trim()
    ? plan.followupPrompt
    : '下一步：把不清楚的地方继续问教学助手，并把新的理解沉淀成 learning record。'

  const metadata = generator.structuredOutput
    ? {
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
      }
    : undefined

  return renderLessonDocument({
    title: plan.title,
    workspaceName,
    lessonRelativePath: lesson.relativePath,
    pageClass: cls.page,
    heroClass: cls.hero,
    heroKickerClass: cls.heroKicker,
    lesson,
    durationMinutes: plan.durationMinutes,
    objective: plan.objective,
    body: [sections, extras, keyPoints, flashcards, quiz].filter(Boolean).join('\n\n'),
    lessons: opts.lessons,
    glossaryAvailable: opts.glossaryAvailable ?? false,
    footerLine,
    metadata
  })
}

export function renderReferenceHtmlFromPlan(opts: {
  plan: LessonPlan
  lesson: LessonSummary
  mission: { title: string; excerpt: string }
  workspaceName: string
  glossaryAvailable?: boolean
}): string {
  const { plan, lesson, mission, workspaceName } = opts
  const notes = plan.referenceNotes
    ? renderMarkup(plan.referenceNotes)
    : `<p>本节速查：${escapeHtml(plan.objective)}</p>`
  const keyPoints = plan.keyPoints.length
    ? `<ul class="${cls.compactList}">
${plan.keyPoints.map((point) => `  <li>${escapeHtml(point)}</li>`).join('\n')}
</ul>`
    : ''
  const flow = plan.flowDiagram && plan.flowDiagram.trim()
    ? `<pre class="flow">${escapeHtml(plan.flowDiagram)}</pre>`
    : ''

  return renderReferenceDocument({
    title: plan.title,
    workspaceName,
    lessonRelativePath: lesson.relativePath,
    pageClass: cls.page,
    heroClass: cls.hero,
    heroKickerClass: cls.heroKicker,
    lesson,
    mission,
    body: [notes, flow, keyPoints].filter(Boolean).join('\n      '),
    glossaryAvailable: opts.glossaryAvailable ?? false
  })
}

// Quiz markup remains byte-for-byte shaped for the shared assets/quiz.js
// event contract; document-frame owns loading that shared script.
function renderQuizCard(item: LessonQuizItem): string {
  const type = item.type
  if (type === 'fill') {
    return `        <article class="${cls.quizCard}" ${data.quizType}="fill" ${data.quizAnswer}="${escapeAttr(String(item.answer))}">
          <p>${escapeHtml(item.question)}</p>
          <div class="${cls.quizFill}">
            <input type="text" placeholder="输入你的答案" aria-label="答案输入" />
            <button type="button" ${data.quizChoice}="submit">提交</button>
          </div>
          <output aria-live="polite"></output>
          <p class="${cls.quizExplanation}">${escapeHtml(item.explanation)}</p>
        </article>`
  }
  if (type === 'truefalse') {
    const answer = String(item.answer) === '1' || String(item.answer).toLowerCase() === 'true' ? 'true' : 'false'
    return `        <article class="${cls.quizCard}" ${data.quizType}="truefalse" ${data.quizAnswer}="${escapeAttr(answer)}">
          <p>${escapeHtml(item.question)}</p>
          <div class="${cls.quizChoices}">
            <button type="button" ${data.quizChoice}="true">正确</button>
            <button type="button" ${data.quizChoice}="false">错误</button>
          </div>
          <output aria-live="polite"></output>
          <p class="${cls.quizExplanation}">${escapeHtml(item.explanation)}</p>
        </article>`
  }
  const indices = Array.isArray(item.answer)
    ? item.answer
    : typeof item.answer === 'number'
      ? [item.answer]
      : String(item.answer)
          .split(',')
          .map((part) => Number.parseInt(part.trim(), 10))
          .filter(Number.isFinite)
  const letters = indices.map(letterFor).join(',')
  const choices = item.choices
    .map((choice, index) => `            <button type="button" ${data.quizChoice}="${letterFor(index)}">${escapeHtml(choice)}</button>`)
    .join('\n')
  return `        <article class="${cls.quizCard}" ${data.quizType}="${escapeAttr(type)}" ${data.quizAnswer}="${escapeAttr(letters)}">
          <p>${escapeHtml(item.question)}</p>
          <div class="${cls.quizChoices}">
${choices}
          </div>
          <output aria-live="polite"></output>
          <p class="${cls.quizExplanation}">${escapeHtml(item.explanation)}</p>
        </article>`
}

function letterFor(index: number): string {
  return String.fromCharCode(97 + index)
}

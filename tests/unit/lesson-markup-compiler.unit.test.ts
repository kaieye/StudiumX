import { describe, expect, it } from 'vitest'
import type { LessonPlan } from '../../src/shared/lesson-schema'
import { LESSON_MARKUP_CLASSES, LESSON_MARKUP_DATA_ATTRIBUTES } from '../../src/shared/lesson-style-themes/contract'
import type { LessonSummary, TeachingSettingsV1 } from '../../src/shared/teaching-types'
import { renderLessonHtmlFromPlan, renderReferenceHtmlFromPlan } from '../../src/main/ai/lesson-renderer'
import { compileLessonMarkup } from '../../src/main/ai/lesson-rendering/markup-compiler'

const classes = LESSON_MARKUP_CLASSES
const data = LESSON_MARKUP_DATA_ATTRIBUTES

const lesson: LessonSummary = {
  id: '0007',
  title: 'Compiler contract',
  sessionName: 'Compiler contract',
  prompt: 'render safely',
  objective: 'Keep artifact contracts stable.',
  durationMinutes: 20,
  relativePath: 'courses/compiler/lesson/0007-compiler-contract.html',
  absolutePath: 'D:/workspace/courses/compiler/lesson/0007-compiler-contract.html',
  courseId: 'compiler',
  courseName: 'Compiler',
  courseRelativePath: 'courses/compiler',
  courseAbsolutePath: 'D:/workspace/courses/compiler'
}

const generator: TeachingSettingsV1['generator'] = {
  providerId: 'test',
  model: 'unit-test',
  endpointFormat: 'openai',
  temperature: 0,
  maxOutputTokens: 1000,
  lessonDurationMinutes: 20,
  includeRetrievalPractice: true,
  generateReference: true,
  structuredOutput: true,
  streaming: false,
  reasoningEffort: 'auto',
  requestTimeoutMs: 60_000
}

function plan(overrides: Partial<LessonPlan> = {}): LessonPlan {
  return {
    title: 'Safe markup',
    objective: 'Compile only a safe HTML allowlist.',
    durationMinutes: 20,
    sections: [{ heading: 'Markup', body: 'Plain body.' }],
    keyPoints: [],
    quiz: [],
    flashcards: [],
    referenceNotes: '',
    learningRecordNote: '',
    ...overrides
  }
}

describe('lesson markup compiler golden contracts', () => {
  it('renders nested lists, aligned tables, escaped pipes, quotes, and only safe links', () => {
    const html = compileLessonMarkup(
      `- parent
  - child
    1. one
    2. two
- sibling

| left | middle | right |
| :-- | :--: | --: |
| a\\|b | **bold** | \`code|span\` |

> quoted **note**

<script>alert(1)</script> [bad](javascript:alert(1)) [good](https://example.test/docs)`,
      { compactListClass: classes.compactList }
    )

    expect(html).toContain(`<ul class="${classes.compactList}"><li>parent<ul class="${classes.compactList}"><li>child<ol><li>one</li><li>two</li></ol></li></ul></li><li>sibling</li></ul>`)
    expect(html).toContain('<th scope="col" class="align-left">left</th>')
    expect(html).toContain('<th scope="col" class="align-center">middle</th>')
    expect(html).toContain('<th scope="col" class="align-right">right</th>')
    expect(html).toContain('<td class="align-left">a|b</td>')
    expect(html).toContain('<td class="align-center"><strong>bold</strong></td>')
    expect(html).toContain('<td class="align-right"><code>code|span</code></td>')
    expect(html).toContain('<blockquote>quoted <strong>note</strong></blockquote>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('bad <a href="https://example.test/docs">good</a>')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('keeps MathML for valid math and falls back to escaped code for malformed math', () => {
    const html = compileLessonMarkup(
      'Inline $E = mc^2$ and invalid $\\def\\broken{$x$\\broken$.\n\n$$\\notARealCommand{x}$$',
      { compactListClass: classes.compactList }
    )

    expect(html).toContain('class="lesson-math lesson-math--inline"')
    expect(html).toContain('<math')
    expect(html).toContain('class="lesson-math-fallback"')
    expect(html).toContain('\\notARealCommand{x}')
    expect(html).not.toContain('<span class="lesson-math lesson-math--block">')
  })

  it('preserves lesson framing, metadata, relative assets, and quiz script markup', () => {
    const artifact = renderLessonHtmlFromPlan({
      plan: plan({
        title: 'Metadata </script> safety',
        sections: [{ heading: 'Markup', body: '[blocked](data:text/html,boom)' }],
        quiz: [{ type: 'single', question: 'Which?', choices: ['A', 'B'], answer: 1, explanation: 'B wins.' }],
        callouts: [{ kind: 'insight', title: 'Remember', body: '> Safe quote' }]
      }),
      lesson,
      mission: { title: 'Mission', excerpt: 'Keep contracts.' },
      workspaceName: 'Workspace <unsafe>',
      recordRelativePath: 'courses/compiler/lesson/0007-compiler-contract.md',
      referenceRelativePath: 'courses/compiler/lesson/0007-compiler-contract-reference.html',
      lessons: [
        { ...lesson, id: '0006', relativePath: 'courses/compiler/lesson/0006-prev.html' },
        lesson,
        { ...lesson, id: '0008', relativePath: 'courses/compiler/lesson/0008-next.html' }
      ],
      glossaryAvailable: true,
      generator
    })

    expect(artifact).toContain('href="../../../assets/lesson.css"')
    expect(artifact).toContain('href="../../../assets/flashcards.css"')
    expect(artifact).toContain('src="../../../assets/quiz.js"')
    expect(artifact).toContain('src="../../../assets/flashcards.js"')
    expect(artifact).toContain('href="0006-prev.html" class="lesson-nav-prev"')
    expect(artifact).toContain('href="0008-next.html" class="lesson-nav-next"')
    expect(artifact).toContain('<aside class="callout callout--insight">')
    expect(artifact).toContain('<blockquote>Safe quote</blockquote>')
    expect(artifact).toContain(`${data.quizType}="single"`)
    expect(artifact).toContain(`${data.quizAnswer}="b"`)
    expect(artifact).toContain(`${data.quizChoice}="a"`)
    expect(artifact).toContain('<script type="application/json" id="studiumx-lesson-metadata">')
    expect(artifact).toContain('Metadata \\u003c/script\\u003e safety')
    expect(artifact).not.toContain('href="data:')
    expect(artifact).not.toContain('</script> safety</title>')
  })

  it('keeps the reference document chrome while sharing safe markup compilation', () => {
    const artifact = renderReferenceHtmlFromPlan({
      plan: plan({ referenceNotes: '| A | B |\n| -- | --: |\n| 1 | 2 |' }),
      lesson,
      mission: { title: 'Mission', excerpt: 'Keep contracts.' },
      workspaceName: 'Workspace',
      glossaryAvailable: true
    })

    expect(artifact).toContain('<main class="lesson-page reference-page">')
    expect(artifact).toContain('href="../../../GLOSSARY.md"')
    expect(artifact).toContain('<div class="markdown-table-wrap">')
    expect(artifact).toContain('class="align-right"')
    expect(artifact).not.toContain('assets/quiz.js')
  })
})

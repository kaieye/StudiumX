import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tempRoot = await mkdtemp(join(tmpdir(), 'lesson-markdown-rendering-check-'))
const outfile = join(tempRoot, 'lesson-renderer.mjs')

try {
await build({
  entryPoints: [join(process.cwd(), 'src', 'main', 'ai', 'lesson-renderer.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent'
})
const {
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan
} = await import(pathToFileURL(outfile).href)

const markdownTable = `| 概念 | 写法 | 分数 |
| --- | :---: | ---: |
| **输入** | \`prompt\` | 1 |
| 输出 | <script>alert(1)</script> | 2 |

表格后的段落应该继续正常渲染。`

const plan = {
  title: 'Markdown 表格渲染',
  objective: '把课程正文里的 GFM 表格渲染成安全 HTML。',
  durationMinutes: 15,
  sections: [
    {
      heading: '对照表',
      body: markdownTable
    }
  ],
  keyPoints: [],
  quiz: [],
  flashcards: [],
  referenceNotes: markdownTable,
  learningRecordNote: ''
}

const lesson = {
  id: '001',
  title: plan.title,
  sessionName: plan.title,
  prompt: '测试 markdown 表格',
  objective: plan.objective,
  durationMinutes: plan.durationMinutes,
  relativePath: 'courses/demo/lesson/001-markdown-table.html',
  absolutePath: 'D:\\tmp\\001-markdown-table.html',
  courseId: 'demo',
  courseName: 'demo',
  courseRelativePath: 'courses/demo',
  courseAbsolutePath: 'D:\\tmp\\courses\\demo'
}

const common = {
  plan,
  lesson,
  mission: { title: '教学链路优化', excerpt: '课程页应该正确展示 Markdown 内容。' },
  workspaceName: 'StudiumX'
}

const generator = {
  structuredOutput: false,
  providerId: 'test',
  model: 'test',
  endpointFormat: 'openai',
  temperature: 0,
  maxOutputTokens: 1000,
  includeRetrievalPractice: false
}

const lessonHtml = renderLessonHtmlFromPlan({
  ...common,
  recordRelativePath: null,
  referenceRelativePath: null,
  generator
})
const referenceHtml = renderReferenceHtmlFromPlan(common)

for (const html of [lessonHtml, referenceHtml]) {
  assert.match(html, /<div class="markdown-table-wrap">/, 'markdown tables should render inside a scroll wrapper')
  assert.match(html, /<thead>/, 'markdown tables should include a table head')
  assert.match(html, /<tbody>/, 'markdown tables should include a table body')
  assert.match(html, /<strong>输入<\/strong>/, 'table cells should keep inline strong markup')
  assert.match(html, /<code>prompt<\/code>/, 'table cells should keep inline code markup')
  assert.match(html, /class="align-center"/, 'center alignment markers should become classes')
  assert.match(html, /class="align-right"/, 'right alignment markers should become classes')
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'raw HTML in table cells should be escaped')
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'raw HTML in table cells must not execute')
  assert.doesNotMatch(html, /\| 概念 \| 写法 \| 分数 \|/, 'markdown table source should not remain as a paragraph')
  assert.match(html, /<p>表格后的段落应该继续正常渲染。<\/p>/, 'content after a table should keep rendering')
}

const mathPlan = {
  title: '数学公式渲染',
  objective: '静态课程页应渲染 MathML 公式。',
  durationMinutes: 8,
  sections: [
    {
      heading: '公式',
      body: '行内公式 $E = mc^2$ 应渲染。\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$'
    }
  ],
  keyPoints: [],
  quiz: [],
  flashcards: [],
  referenceNotes: '',
  learningRecordNote: ''
}
const mathLesson = {
  id: '005',
  title: mathPlan.title,
  sessionName: mathPlan.title,
  prompt: '数学公式',
  objective: mathPlan.objective,
  durationMinutes: mathPlan.durationMinutes,
  relativePath: 'courses/demo/lesson/005-math.html',
  absolutePath: 'D:\\tmp\\005-math.html',
  courseId: 'demo',
  courseName: 'demo',
  courseRelativePath: 'courses/demo',
  courseAbsolutePath: 'D:\\tmp\\courses\\demo'
}
const mathHtml = renderLessonHtmlFromPlan({
  plan: mathPlan,
  lesson: mathLesson,
  mission: { title: '教学链路优化', excerpt: '公式应渲染。' },
  workspaceName: 'StudiumX',
  recordRelativePath: null,
  referenceRelativePath: null,
  generator
})
assert.match(mathHtml, /class="lesson-math lesson-math--inline"/, 'inline math should get a static lesson math wrapper')
assert.match(mathHtml, /class="lesson-math lesson-math--block"/, 'block math should get a static lesson math wrapper')
assert.match(mathHtml, /<math/, 'static lesson math should render MathML')
assert.doesNotMatch(mathHtml, /\$\$\s*\\int_0\^1/, 'block math source should not remain as raw markdown')

const [baseStyles, promptSource, generationSource] = await Promise.all([
  readFile('src/shared/lesson-style-themes/base.ts', 'utf8'),
  readFile('src/main/ai/lesson-prompts.ts', 'utf8'),
  readFile('src/main/teaching-lesson-generation.ts', 'utf8')
])

// Workspace `assets/lesson.css` is generated from the theme source during
// workspace scaffolding; the repository intentionally keeps no root workspace
// asset copy. Validate the source of truth instead.
assert.match(baseStyles, /\.markdown-table-wrap \{/, 'lesson CSS should style the table scroll wrapper')
assert.match(baseStyles, /td\.align-right/, 'lesson CSS should style right-aligned table cells')
assert.match(baseStyles, /\.lesson-math--block \{/, 'lesson CSS should style static math blocks')
assert.match(promptSource, /GFM 表格/, 'lesson prompt contract should advertise GFM table support')
assert.match(generationSource, /STATIC_LESSON_RENDERER_CAPABILITIES/, 'production lesson generation should pass static renderer capabilities')

// Relaxed table separator: `:--:` (2 dashes) must also render as a table,
// not collapse into a paragraph (the 0003-rag.html regression).
const relaxedTablePlan = {
  title: '宽松表格分隔行',
  objective: '两横线分隔行也应渲染成表格。',
  durationMinutes: 10,
  sections: [
    {
      heading: '对照表',
      body: '| 项 | 说明 |\n|:--:|--|\n| A | 甲 |\n| B | 乙 |'
    }
  ],
  keyPoints: [],
  quiz: [],
  flashcards: [],
  referenceNotes: '',
  learningRecordNote: ''
}
const relaxedLesson = {
  id: '002',
  title: relaxedTablePlan.title,
  sessionName: relaxedTablePlan.title,
  prompt: '宽松表格',
  objective: relaxedTablePlan.objective,
  durationMinutes: relaxedTablePlan.durationMinutes,
  relativePath: 'courses/demo/lesson/002-relaxed-table.html',
  absolutePath: 'D:\\tmp\\002-relaxed-table.html',
  courseId: 'demo',
  courseName: 'demo',
  courseRelativePath: 'courses/demo',
  courseAbsolutePath: 'D:\\tmp\\courses\\demo'
}
const relaxedHtml = renderLessonHtmlFromPlan({
  plan: relaxedTablePlan,
  lesson: relaxedLesson,
  mission: { title: '教学链路优化', excerpt: '两横线表格应渲染。' },
  workspaceName: 'StudiumX',
  recordRelativePath: null,
  referenceRelativePath: null,
  generator
})
assert.match(relaxedHtml, /<div class="markdown-table-wrap">/, 'two-dash separators should still render as a table')
assert.match(relaxedHtml, /class="align-center"/, 'two-dash center alignment should still produce the class')
assert.doesNotMatch(relaxedHtml, /\| 项 \| 说明 \|/, 'two-dash table source must not remain as a paragraph')

// Model-generated lessons commonly nest markdown headings under a section
// heading. Four-hash headings must render instead of leaking raw `####`.
const nestedHeadingPlan = {
  title: '嵌套标题',
  objective: '四级 Markdown 标题应渲染成 HTML 标题。',
  durationMinutes: 5,
  sections: [
    {
      heading: '正文',
      body: '#### ① 索引阶段（Indexing）— 离线'
    }
  ],
  keyPoints: [],
  quiz: [],
  flashcards: [],
  referenceNotes: '',
  learningRecordNote: ''
}
const nestedHeadingLesson = {
  id: '004',
  title: nestedHeadingPlan.title,
  sessionName: nestedHeadingPlan.title,
  prompt: '嵌套标题',
  objective: nestedHeadingPlan.objective,
  durationMinutes: nestedHeadingPlan.durationMinutes,
  relativePath: 'courses/demo/lesson/004-nested-heading.html',
  absolutePath: 'D:\\tmp\\004-nested-heading.html',
  courseId: 'demo',
  courseName: 'demo',
  courseRelativePath: 'courses/demo',
  courseAbsolutePath: 'D:\\tmp\\courses\\demo'
}
const nestedHeadingHtml = renderLessonHtmlFromPlan({
  plan: nestedHeadingPlan,
  lesson: nestedHeadingLesson,
  mission: { title: '教学链路优化', excerpt: '嵌套标题应渲染。' },
  workspaceName: 'StudiumX',
  recordRelativePath: null,
  referenceRelativePath: null,
  generator
})
assert.match(nestedHeadingHtml, /<h5>① 索引阶段（Indexing）— 离线<\/h5>/, 'four-hash headings should render one level below h4')
assert.doesNotMatch(nestedHeadingHtml, /<p>####/, 'four-hash heading source should not remain as paragraph text')

// New teach-skill-quality components: nav replaces mission-card; flow /
// callout / interview / primary-source / followupPrompt render.
const richPlan = {
  title: '富组件课程',
  objective: '验证新组件渲染。',
  durationMinutes: 12,
  sections: [{ heading: '正文', body: '一段说明。' }],
  keyPoints: ['要点一'],
  quiz: [],
  flashcards: [],
  referenceNotes: '',
  learningRecordNote: '## 判定\n用户应理解 RAG 三阶段。\n\n## 影响\n下一课不再重讲三阶段。',
  primarySource: { title: 'Lilian Weng — RAG', url: 'https://lilianweng.github.io/posts/2023-06-23-rag/', note: '读检索与增强两节。' },
  followupPrompt: '试着向同事解释为什么 RAG 比微调更适合动态知识。',
  interviewAnswer: 'RAG 是检索增强生成：先检索相关片段，再拼进 prompt 让模型作答。',
  callouts: [{ kind: 'criteria', title: '取舍准则', body: '知识频繁更新选 RAG。' }],
  flowDiagram: '检索 ──▶ 增强 ──▶ 生成'
}
const richLesson = {
  id: '003',
  title: richPlan.title,
  sessionName: richPlan.title,
  prompt: '富组件',
  objective: richPlan.objective,
  durationMinutes: richPlan.durationMinutes,
  relativePath: 'courses/demo/lesson/003-rich.html',
  absolutePath: 'D:\\tmp\\003-rich.html',
  courseId: 'demo',
  courseName: 'demo',
  courseRelativePath: 'courses/demo',
  courseAbsolutePath: 'D:\\tmp\\courses\\demo'
}
const richHtml = renderLessonHtmlFromPlan({
  plan: richPlan,
  lesson: richLesson,
  mission: { title: '教学链路优化', excerpt: '新组件应渲染。' },
  workspaceName: 'StudiumX',
  lessons: [
    { id: '002', title: '上一课', objective: '前置', relativePath: 'courses/demo/lesson/002-prev.html', absolutePath: 'D:\\tmp\\002-prev.html', sessionName: '002 上一课', sessionId: 'lesson-0002', prompt: '', createdAt: '', durationMinutes: 10, courseId: 'demo', courseName: 'demo', courseRelativePath: 'courses/demo', courseAbsolutePath: 'D:\\tmp\\courses\\demo', sessionRelativePath: 'courses/demo/lesson', sessionAbsolutePath: 'D:\\tmp\\courses\\demo\\lesson' },
    { id: '003', title: '富组件课程', objective: '验证新组件渲染。', relativePath: 'courses/demo/lesson/003-rich.html', absolutePath: 'D:\\tmp\\003-rich.html', sessionName: '003 富组件课程', sessionId: 'lesson-0003', prompt: '', createdAt: '', durationMinutes: 12, courseId: 'demo', courseName: 'demo', courseRelativePath: 'courses/demo', courseAbsolutePath: 'D:\\tmp\\courses\\demo', sessionRelativePath: 'courses/demo/lesson', sessionAbsolutePath: 'D:\\tmp\\courses\\demo\\lesson' },
    { id: '004', title: '下一课', objective: '后续', relativePath: 'courses/demo/lesson/004-next.html', absolutePath: 'D:\\tmp\\004-next.html', sessionName: '004 下一课', sessionId: 'lesson-0004', prompt: '', createdAt: '', durationMinutes: 10, courseId: 'demo', courseName: 'demo', courseRelativePath: 'courses/demo', courseAbsolutePath: 'D:\\tmp\\courses\\demo', sessionRelativePath: 'courses/demo/lesson', sessionAbsolutePath: 'D:\\tmp\\courses\\demo\\lesson' }
  ],
  glossaryAvailable: true,
  recordRelativePath: 'learning-records/003-rich.md',
  referenceRelativePath: null,
  generator
})
assert.match(richHtml, /<nav class="lesson-nav">/, 'lesson should render cross-lesson top nav')
assert.match(richHtml, /<nav class="lesson-nav lesson-nav--foot">/, 'lesson should render bottom nav')
assert.match(richHtml, /href="[^"]*GLOSSARY\.md"/, 'glossary link should appear when glossary is available')
assert.match(richHtml, /href="002-prev\.html"/, 'prev lesson link should be derived from the lessons list')
assert.match(richHtml, /<pre class="flow">/, 'flowDiagram should render as a styled pre block')
assert.match(richHtml, /<aside class="callout callout--criteria">/, 'callouts should render with kind class')
assert.match(richHtml, /<section class="interview">/, 'interviewAnswer should render in an interview section')
assert.match(richHtml, /<section class="primary-source">/, 'primarySource should render as a section')
assert.match(richHtml, /target="_blank" rel="noreferrer noopener"/, 'external primary source link should open safely')
assert.match(richHtml, /试着向同事解释/, 'followupPrompt should replace the generic footer')
assert.doesNotMatch(richHtml, /<section class="mission-card">/, 'the big mission-card section should be gone from lessons')

// Reference page should also render nav + flow.
const referenceHtml2 = renderReferenceHtmlFromPlan({
  plan: richPlan,
  lesson: richLesson,
  mission: { title: '教学链路优化', excerpt: '速查页应带 nav。' },
  workspaceName: 'StudiumX',
  glossaryAvailable: true
})
assert.match(referenceHtml2, /<nav class="lesson-nav">/, 'reference page should render nav')
assert.match(referenceHtml2, /<pre class="flow">/, 'reference page should render the flow diagram')
assert.doesNotMatch(referenceHtml2, /<section class="mission-card">/, 'reference page should not carry the old mission-card')

console.log('check:lesson-markdown-rendering passed')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

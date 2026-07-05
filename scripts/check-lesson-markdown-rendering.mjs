import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const {
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan,
  renderLearningRecordFromPlan
} = await import('../src/main/ai/lesson-renderer.ts')

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

const [baseStyles, assetStyles, promptSource] = await Promise.all([
  readFile('src/shared/lesson-style-themes/base.ts', 'utf8'),
  readFile('assets/lesson.css', 'utf8'),
  readFile('src/main/ai/lesson-prompts.ts', 'utf8')
])

assert.match(baseStyles, /\.markdown-table-wrap \{/, 'lesson CSS should style the table scroll wrapper')
assert.match(baseStyles, /td\.align-right/, 'lesson CSS should style right-aligned table cells')
assert.match(assetStyles, /\.markdown-table-wrap \{/, 'workspace lesson.css asset should style the table scroll wrapper')
assert.match(assetStyles, /td\.align-right/, 'workspace lesson.css asset should style right-aligned table cells')
assert.match(promptSource, /GFM 表格/, 'lesson prompt contract should advertise GFM table support')

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

// Learning record now uses a judgment + impact structure (markdown headings),
// not the old flat meta-description.
const recordMd = renderLearningRecordFromPlan({
  plan: richPlan,
  lesson: richLesson,
  mission: { title: '教学链路优化', excerpt: '记录应含判定与影响。' }
})
assert.match(recordMd, /## 判定/, 'learning record should carry a judgment heading')
assert.match(recordMd, /## 影响/, 'learning record should carry an impact-on-future-lessons heading')
assert.match(recordMd, /Lesson 003/, 'learning record should reference the lesson id')

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

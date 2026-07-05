import assert from 'node:assert/strict'

const {
  normalizeLessonBrief,
  buildLessonPromptFromBrief,
  buildLessonPromptWithConversation
} = await import('../src/shared/teaching-workflow.ts')

// Fragment fields (the exact garbage the old regex extractor produced from
// the assistant's own words: 背景「工作」← “工作区”, 动作「先」← “我先看看”)
// must be rejected so the model retries with a real brief.
assert.equal(normalizeLessonBrief(null), null)
assert.equal(normalizeLessonBrief({}), null)
assert.equal(normalizeLessonBrief({ topic: 'RAG' }), null, 'missing firstLessonFocus should reject')
assert.equal(
  normalizeLessonBrief({ topic: 'R', firstLessonFocus: '先' }),
  null,
  'single-character fragments must not pass as a lesson brief'
)

const brief = normalizeLessonBrief({
  topic: 'RAG 检索增强生成',
  firstLessonFocus: '用一张流程图讲清 RAG 的五个核心步骤，并给出面试话术',
  learnerProfile: '有编程基础的求职者',
  goal: '准备面试，概念为主不写代码',
  constraints: '每节课 15-20 分钟',
  extraNotes: ''
})
assert.ok(brief)
assert.equal(brief.topic, 'RAG 检索增强生成')
assert.equal(brief.extraNotes, undefined, 'empty optional fields should be dropped')

const prompt = buildLessonPromptFromBrief(brief)
assert.match(prompt, /主题：RAG 检索增强生成/)
assert.match(prompt, /学习者背景：有编程基础的求职者/)
assert.match(prompt, /学习目标：准备面试/)
assert.match(prompt, /本节课要完成的动作：用一张流程图/)
assert.doesNotMatch(prompt, /额外说明/, 'omitted fields should not leave empty labels')

// Whitespace normalization + length clamp.
const noisy = normalizeLessonBrief({
  topic: '  RAG\n检索增强生成  ',
  firstLessonFocus: `${'很'.repeat(700)}长的目标`
})
assert.ok(noisy)
assert.equal(noisy.topic, 'RAG 检索增强生成')
assert.equal(noisy.firstLessonFocus.length, 600, 'brief fields should clamp to 600 chars')

// Direct-generation prompts fold in the user's verbatim words — never
// assistant text, never extracted "signals".
const conversationPrompt = buildLessonPromptWithConversation('我只需要了解一下概念就行了', [
  { role: 'user', content: '我想学习springboot' },
  { role: 'assistant', content: '好的，我先看看当前教学工作区里已有的文件。' }
])
assert.match(conversationPrompt, /我只需要了解一下概念就行了/)
assert.match(conversationPrompt, /springboot/i)
assert.doesNotMatch(
  conversationPrompt,
  /先看看当前教学工作区/,
  'assistant words must never be folded into the lesson prompt'
)

assert.equal(
  buildLessonPromptWithConversation('直接生成', undefined),
  '直接生成',
  'no conversation means the prompt passes through untouched'
)

console.log('teaching workflow brief contract ok')

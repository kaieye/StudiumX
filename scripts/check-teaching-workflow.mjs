import assert from 'node:assert/strict'

const {
  assessTeachingReadiness,
  isContinuationLessonRequest,
  isLearningSetupRequest
} = await import('../src/shared/teaching-workflow.ts')

const vague = assessTeachingReadiness({
  userInput: '我想学习RAG',
  missionTitle: 'learn',
  missionExcerpt: '学习目标、可信资源、课程讲义和复习记录沉淀为本地文件。'
})

assert.equal(vague.stage, 'clarifying')
assert.equal(isLearningSetupRequest('我想学习RAG'), true)
assert.equal(isContinuationLessonRequest('我想学习RAG'), false)
assert.ok(vague.missingSignals.includes('background'))
assert.ok(vague.missingSignals.includes('goal'))
assert.ok(vague.assistantMessage.includes('我先不生成 lesson'))

const terse = assessTeachingReadiness({
  userInput: 'RAG',
  missionTitle: 'learn',
  missionExcerpt: '学习目标、可信资源、课程讲义和复习记录沉淀为本地文件。'
})

assert.equal(terse.stage, 'clarifying')

const ready = assessTeachingReadiness({
  userInput:
    '我想学习 RAG。我是会 Python 的后端工程师，做过简单 LLM API 调用。目标是在公司知识库里做一个可评估的问答 demo。每天 1 小时，准备用 Python、OpenAI compatible API 和本地 Markdown 文档。第一节课先跑通最小检索链路并写出评估样例。',
  missionTitle: 'learn',
  missionExcerpt: '学习目标、可信资源、课程讲义和复习记录沉淀为本地文件。'
})

assert.equal(ready.stage, 'ready')
assert.equal(ready.missingSignals.length, 0)
assert.ok(ready.lessonPrompt.includes('RAG'))

assert.equal(isContinuationLessonRequest('基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'), true)

console.log('teaching workflow gate ok')

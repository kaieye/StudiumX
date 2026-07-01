import assert from 'node:assert/strict'

const {
  buildLearnerMemoryCandidate,
  buildMemoryConsentPrompt,
  classifyMemoryConsentResponse,
  extractPendingLearnerMemoryCandidate,
  isBareMemoryConsentResponse,
  planLearnerMemoryCapture
} = await import('../src/shared/teaching-memory-capture.ts')

const userInput = '我是高中生，数学基础一般，目标是两周内搞懂函数概念，每天只能学30分钟，喜欢先做题再总结。'
const candidate = buildLearnerMemoryCandidate(userInput)

assert.ok(candidate)
assert.match(candidate.content, /高中生/)
assert.ok(candidate.tags.includes('learner-profile'))
assert.ok(candidate.tags.includes('background'))
assert.ok(candidate.tags.includes('goals'))
assert.ok(candidate.tags.includes('constraints'))
assert.ok(candidate.tags.includes('preferences'))

const firstPlan = planLearnerMemoryCapture(candidate, [])
assert.equal(firstPlan.action, 'create')

const existingMemory = {
  id: 'mem_1',
  content: '学习者画像（背景/场景）：用户是产品经理，偏好案例驱动学习。',
  scope: 'user',
  tags: ['learner-profile', 'background'],
  confidence: 0.8,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z'
}

const laterPlan = planLearnerMemoryCapture(candidate, [existingMemory])
assert.equal(laterPlan.action, 'request_consent')

const duplicatePlan = planLearnerMemoryCapture(candidate, [{
  ...existingMemory,
  content: candidate.content,
  tags: candidate.tags
}])
assert.equal(duplicatePlan.action, 'none')
assert.equal(duplicatePlan.reason, 'duplicate')

const consentPrompt = buildMemoryConsentPrompt(candidate)
const pending = extractPendingLearnerMemoryCandidate(`好的，我们先从函数概念开始。${consentPrompt}`)
assert.ok(pending)
assert.equal(pending.content, candidate.content)
assert.equal(classifyMemoryConsentResponse('可以，记录吧'), 'approve')
assert.equal(classifyMemoryConsentResponse('不要记录'), 'reject')
assert.equal(isBareMemoryConsentResponse('可以'), true)
assert.equal(isBareMemoryConsentResponse('可以记录。另外我每天晚上有一小时，想先做考试题。'), false)
assert.equal(isBareMemoryConsentResponse(userInput), false)

console.log('memory capture checks ok')

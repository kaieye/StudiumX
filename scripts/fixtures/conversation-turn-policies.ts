import assert from 'node:assert/strict'

import { buildMemoryConsentPrompt } from '../../src/shared/teaching-memory-capture'
import { createLessonToolLifecycle } from '../../src/main/teaching-conversation-lesson-tool'
import { resolveDirectMemoryConsent } from '../../src/main/teaching-conversation-memory'
import { buildAgentChatSystemPrompt } from '../../src/main/teaching-conversation-prompt'
import { deriveConversationTurnContext } from '../../src/main/teaching-conversation-turn-context'

const workspace = { rootPath: 'C:/workspace' }
const temporary = deriveConversationTurnContext({
  mode: 'temporary',
  workspace,
  toolsEnabled: true,
  hasLessonGenerator: true
})
assert.equal(temporary.mode, 'temporary')
assert.equal(temporary.workspaceRoot, undefined, 'temporary mode must never bind workspace tools')
assert.equal(temporary.memoryWorkspaceRoot, workspace.rootPath, 'memory remains scoped to the selected workspace')
assert.equal(temporary.workspaceToolsEnabled, false)
assert.equal(temporary.lessonToolEnabled, false)

const teaching = deriveConversationTurnContext({
  mode: 'teaching',
  workspace,
  toolsEnabled: true,
  hasLessonGenerator: true
})
assert.equal(teaching.workspaceRoot, workspace.rootPath)
assert.equal(teaching.workspaceToolsEnabled, true)
assert.equal(teaching.lessonToolEnabled, true)

const candidate = {
  content: '学习者画像（背景/场景）：用户是高中生，准备两周内掌握函数概念。',
  tags: ['learner-profile', 'background'],
  confidence: 0.9
}
const priorAssistantContent = `我们会按这个节奏学习。${buildMemoryConsentPrompt(candidate)}`
let memoriesCreated = 0
const consent = await resolveDirectMemoryConsent({
  userInput: '可以，记录吧',
  previousAssistantContent: priorAssistantContent,
  workspaceRoot: workspace.rootPath,
  createMemory: async (payload) => {
    memoriesCreated += 1
    assert.equal(payload.workspaceRoot, workspace.rootPath)
    return { id: 'memory_1', ...payload, createdAt: 'now', updatedAt: 'now' }
  }
})
assert.equal(consent.handled, true)
assert.equal(memoriesCreated, 1, 'a bare approval should be resolved without invoking the model')
if (consent.handled) assert.equal(consent.memoryCapture.action, 'approved')

const substantiveReply = await resolveDirectMemoryConsent({
  userInput: '可以记录。另外我每天晚上有一小时，想先做考试题。',
  previousAssistantContent: priorAssistantContent,
  workspaceRoot: workspace.rootPath,
  createMemory: async () => {
    throw new Error('substantive replies must not be captured as bare consent')
  }
})
assert.equal(substantiveReply.handled, false)
if (!substantiveReply.handled) assert.equal(substantiveReply.isBareConsentResponse, false)

const lessonEntries: Array<{ handler: (args: unknown) => Promise<string> }> = []
const lifecycle = createLessonToolLifecycle({
  enabled: true,
  generateLessonFromBrief: async () => ({ id: '0001', title: 'RAG 是什么', relativePath: 'lessons/0001-rag.html' })
})
lifecycle.registerInto({ register: (entry) => lessonEntries.push(entry) })
assert.equal(lessonEntries.length, 1)
assert.equal(lifecycle.isGenerationRequested('我想系统学习 RAG'), true)
const successfulLesson = await lessonEntries[0]!.handler({
  topic: 'RAG 检索增强生成',
  firstLessonFocus: '用一张流程图讲清 RAG 的五个核心步骤。'
})
assert.match(successfulLesson, /"ok":true/)
assert.equal(lifecycle.hasAttemptedGeneration(), true)
assert.equal(lifecycle.generatedLessons().length, 1)

let failedAttempts = 0
const failedEntries: Array<{ handler: (args: unknown) => Promise<string> }> = []
const failedLifecycle = createLessonToolLifecycle({
  enabled: true,
  generateLessonFromBrief: async () => {
    failedAttempts += 1
    throw new Error('lesson pipeline unavailable')
  }
})
failedLifecycle.registerInto({ register: (entry) => failedEntries.push(entry) })
const validBrief = { topic: 'RAG 检索增强生成', firstLessonFocus: '用一张流程图讲清 RAG 的五个核心步骤。' }
await assert.rejects(() => failedEntries[0]!.handler(validBrief), /本轮不要再次调用 generate_lesson/)
await assert.rejects(() => failedEntries[0]!.handler(validBrief), /已经尝试 generate_lesson 且失败/)
assert.equal(failedAttempts, 1, 'a failed lesson pipeline must not be retried within the same turn')

const temporaryPrompt = buildAgentChatSystemPrompt({
  mode: 'temporary',
  lessonToolEnabled: false,
  skillReferences: [],
  temporaryContext: { learnerProfiles: ['高中生'], courses: [{ name: '函数入门', lessonCount: 2, sessionCount: 1 }] },
  visiblePageContext: '当前页面是函数课程概览。'
})
assert.match(temporaryPrompt, /当前是临时会话/)
assert.match(temporaryPrompt, /当前页面是函数课程概览/)
assert.doesNotMatch(temporaryPrompt, /你是 StudiumX 的教学助手/)

console.log('conversation turn policy checks ok')

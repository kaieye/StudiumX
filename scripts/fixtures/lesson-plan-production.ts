import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { parseLessonPlan } from '../../src/main/lesson-plan-parsing'
import { produce, type PreparedLessonPlanRequest } from '../../src/main/lesson-plan-production'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'

const VALID_PLAN = {
  title: '理解检索增强生成',
  objective: '解释检索如何约束生成回答',
  durationMinutes: 15,
  sections: [{ heading: '检索先于生成', body: '先检索可靠资料，再用资料约束回答。' }],
  keyPoints: ['检索提供上下文'],
  quiz: [],
  flashcards: [],
  referenceNotes: '',
  learningRecordNote: ''
}

type ProviderRequest = { tools?: unknown[]; messages?: Array<{ content?: string | null }> }
let queuedResponses: string[] = []
const providerRequests: ProviderRequest[] = []

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  providerRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as ProviderRequest)
  const content = queuedResponses.shift() ?? JSON.stringify(VALID_PLAN)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
})

let tempRoot = ''
try {
  tempRoot = await mkdtemp(join(tmpdir(), 'lesson-plan-production-'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  const settings = configuredSettings(tempRoot, address.port)
  const parsedFromProse = parseLessonPlan(`说明文字\n${JSON.stringify({ ...VALID_PLAN, sections: [{ heading: 'JSON { 字符', body: '大括号在字符串中不应打断提取。' }] })}\n结束`)
  assert.ok(parsedFromProse.plan, 'parser should extract a balanced JSON object from provider prose')
  assert.equal(parseLessonPlan('{"title":"only title"}').diagnostic?.kind, 'schema')

  const normalStatuses: string[] = []
  queuedResponses = [`前置说明\n${JSON.stringify(VALID_PLAN)}\n后置说明`]
  const normal = await produce(prepared(settings, normalStatuses))
  assert.equal(normal.source, 'ai')
  assert.equal(normal.plan.title, VALID_PLAN.title)
  assert.ok(normalStatuses.includes('calling'))
  assert.ok(normalStatuses.includes('validating'))

  const repairedStatuses: string[] = []
  queuedResponses = ['这不是 JSON', `\`\`\`json\n${JSON.stringify(VALID_PLAN)}\n\`\`\``]
  const repaired = await produce(prepared(settings, repairedStatuses))
  assert.equal(repaired.reason, '首次输出未通过校验，已自动修复')
  assert.ok(repairedStatuses.indexOf('validating') < repairedStatuses.lastIndexOf('calling'), 'repair should validate before it begins the repair request')
  assert.equal(repairedStatuses.at(-1), 'validating')

  const compactStatuses: string[] = []
  queuedResponses = ['bad first', 'bad repair', JSON.stringify(VALID_PLAN)]
  const compact = await produce(prepared(settings, compactStatuses))
  assert.equal(compact.reason, '首次输出和修复均未通过校验，已用紧凑重试重新生成')
  assert.equal(compactStatuses.filter((status) => status === 'validating').length, 3)

  const toolSettings = configuredSettings(tempRoot, address.port)
  toolSettings.tools.enabled = true
  toolSettings.tools.workspaceRead = true
  toolSettings.tools.webSearch = false
  toolSettings.tools.webFetch = false
  toolSettings.tools.maxIterations = 2
  queuedResponses = [JSON.stringify(VALID_PLAN)]
  const beforeToolRequest = providerRequests.length
  const toolResult = await produce(prepared(toolSettings, []))
  assert.equal(toolResult.source, 'ai')
  const toolRequest = providerRequests[beforeToolRequest]
  assert.ok(Array.isArray(toolRequest?.tools) && toolRequest.tools.length > 0, 'supported configured tools should be preferred before a single-shot provider call')

  const noProviderSettings = configuredSettings(tempRoot, address.port)
  noProviderSettings.provider.providers = noProviderSettings.provider.providers.map((provider) => ({ ...provider, apiKey: '' }))
  const beforeFallback = providerRequests.length
  const fallback = await produce(prepared(noProviderSettings, []))
  assert.equal(fallback.source, 'fallback')
  assert.equal(fallback.reason, '未配置 API Key')
  assert.equal(providerRequests.length, beforeFallback, 'missing keys should select the local fallback without a provider request')

  console.log('lesson plan production ok')
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

function configuredSettings(rootPath: string, port: number): TeachingSettingsV1 {
  const settings = defaultSettings(rootPath)
  settings.provider.activeProviderId = 'deepseek'
  settings.generator.providerId = 'deepseek'
  settings.generator.model = 'deepseek-v4-flash'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.streaming = false
  settings.generator.requestTimeoutMs = 5_000
  settings.tools.enabled = false
  settings.provider.providers = settings.provider.providers.map((provider) =>
    provider.id === 'deepseek'
      ? { ...provider, baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key', models: ['deepseek-v4-flash'] }
      : provider
  )
  return settings
}

function prepared(settings: TeachingSettingsV1, statuses: string[]): PreparedLessonPlanRequest {
  return {
    workspace: { rootPath: settings.workspace.defaultRoot },
    mission: { title: '检索增强生成', excerpt: '学习 RAG 的基础概念。' },
    prompt: '学习 RAG 的检索流程',
    sequence: 2,
    settings,
    systemPrompt: '只输出 LessonPlan JSON。',
    userPrompt: '生成一节检索增强生成课程。',
    callbacks: { onStatus: (status) => statuses.push(status) }
  }
}

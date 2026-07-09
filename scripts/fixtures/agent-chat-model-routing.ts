import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'

const MODEL_REPLY = 'MODEL_REPLY_FROM_PROVIDER'

const requests: Array<{
  method: string | undefined
  url: string | undefined
  body: { model?: string; messages?: Array<{ role: string; content?: string }> }
}> = []

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = Buffer.concat(chunks).toString('utf8')
  requests.push({
    method: req.method,
    url: req.url,
    body: body ? JSON.parse(body) : {}
  })

  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unexpected route' }))
    return
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    choices: [
      {
        message: {
          role: 'assistant',
          content: MODEL_REPLY
        }
      }
    ]
  }))
})

const listen = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => resolve())
})

const close = (srv: typeof server): Promise<void> => new Promise((resolve, reject) => {
  srv.close((error) => error ? reject(error) : resolve())
})

let tempRoot = ''

try {
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-chat-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.provider.activeProviderId = 'deepseek'
  settings.generator.providerId = 'deepseek'
  settings.generator.model = 'deepseek-v4-flash'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.tools.enabled = true
  settings.tools.workspaceRead = true
  settings.tools.webSearch = false
  settings.tools.webFetch = false
  settings.provider.providers = settings.provider.providers.map((provider) =>
    provider.id === 'deepseek'
      ? {
          ...provider,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: 'test-key',
          models: ['deepseek-v4-flash']
        }
      : provider
  )

  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'studiumx-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings
  })
  const state = await service.createWorkspace({ name: 'learn-rag', prompt: '学习 RAG' })
  const workspace = state.activeWorkspace
  assert.ok(workspace)

  const chunks: string[] = []
  const statuses: string[] = []
  const result = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      messages: [],
      userInput: '我想学习 RAG'
    },
    {
      streamId: 'test-stream',
      onChunk: (chunk) => chunks.push(chunk.delta),
      onStatus: (status) => statuses.push(status.status),
      onTool: () => {}
    }
  )

  assert.equal(requests.length, 1, 'teaching-mode chat must call the configured model provider')
  assert.equal(requests[0]?.url, '/v1/chat/completions')
  assert.equal(requests[0]?.body.model, 'deepseek-v4-flash')
  assert.ok(!('error' in result), 'agent chat should return the provider response')
  assert.equal(result.finalText, MODEL_REPLY)
  assert.equal(chunks.join(''), MODEL_REPLY)
  assert.deepEqual(statuses, ['thinking', 'done'])

  const sentMessages = requests[0]?.body.messages ?? []
  assert.equal(sentMessages[0]?.role, 'system')
  assert.match(sentMessages[0]?.content ?? '', /teach skill/)
  assert.match(sentMessages[0]?.content ?? '', /automatically loaded/)
  assert.match(sentMessages[0]?.content ?? '', /Teaching Workspace/)
  assert.match(sentMessages[0]?.content ?? '', /lesson-generation-policy/)
  assert.match(sentMessages[0]?.content ?? '', /generate_lesson/)
  assert.match(sentMessages[0]?.content ?? '', /do not treat readiness hints as a canned assistant answer/)
  assert.doesNotMatch(sentMessages[0]?.content ?? '', /Claude|Anthropic/)
  assert.equal(sentMessages.at(-1)?.role, 'user')
  assert.equal(sentMessages.at(-1)?.content, '我想学习 RAG')

  const identityChunks: string[] = []
  const identityStatuses: string[] = []
  const identityResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      messages: [],
      userInput: '你是什么模型？'
    },
    {
      streamId: 'identity-stream',
      onChunk: (chunk) => identityChunks.push(chunk.delta),
      onStatus: (status) => identityStatuses.push(status.status),
      onTool: () => {}
    }
  )

  assert.equal(
    requests.length,
    2,
    'model identity questions should still be answered by the configured model provider'
  )
  assert.ok(!('error' in identityResult), 'model identity response should return the provider response')
  assert.equal(identityResult.finalText, MODEL_REPLY)
  assert.equal(identityChunks.join(''), MODEL_REPLY)
  assert.deepEqual(identityStatuses, ['thinking', 'done'])

  const identityMessages = requests[1]?.body.messages ?? []
  assert.equal(identityMessages[0]?.role, 'system')
  assert.match(identityMessages[0]?.content ?? '', /configuredProvider: DeepSeek/)
  assert.match(identityMessages[0]?.content ?? '', /configuredModelId: deepseek-v4-flash/)
  assert.match(identityMessages[0]?.content ?? '', /endpointFormat: chat_completions/)
  assert.doesNotMatch(identityMessages[0]?.content ?? '', /Claude|Anthropic/)
  assert.equal(identityMessages.at(-1)?.role, 'user')
  assert.equal(identityMessages.at(-1)?.content, '你是什么模型？')

  const temporaryResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'temporary',
      messages: [],
      userInput: '我有哪些课程？'
    },
    {
      streamId: 'temporary-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )

  assert.equal(requests.length, 3, 'temporary chat should call the configured model provider')
  assert.ok(!('error' in temporaryResult), 'temporary chat should return the provider response')
  const temporaryBody = requests[2]?.body ?? {}
  const temporaryMessages = temporaryBody.messages ?? []
  assert.equal(temporaryMessages[0]?.role, 'system')
  assert.match(temporaryMessages[0]?.content ?? '', /当前是临时会话/)
  assert.match(temporaryMessages[0]?.content ?? '', /学习者画像、课程概览和当前打开页面的可见文本/)
  assert.doesNotMatch(temporaryMessages[0]?.content ?? '', /automatically loaded/)
  assert.doesNotMatch(temporaryMessages[0]?.content ?? '', /Teaching Workspace/)
  assert.doesNotMatch(JSON.stringify(temporaryBody), /list_workspace|read_workspace_file|search_workspace|glob_workspace/)
  assert.equal(temporaryMessages.at(-1)?.role, 'user')
  assert.equal(temporaryMessages.at(-1)?.content, '我有哪些课程？')

  const canceledController = new AbortController()
  canceledController.abort()
  const canceledStatuses: string[] = []
  const canceledResult = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      messages: [],
      userInput: '这条会被中断'
    },
    {
      streamId: 'canceled-stream',
      signal: canceledController.signal,
      onChunk: () => {},
      onStatus: (status) => canceledStatuses.push(status.status),
      onTool: () => {}
    }
  )
  assert.equal('canceled' in canceledResult, true, 'aborted agent chat should return a canceled result')
  assert.equal(requests.length, 3, 'aborted agent chat should not call the provider')
  assert.deepEqual(canceledStatuses, [])

  console.log('agent chat model routing ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

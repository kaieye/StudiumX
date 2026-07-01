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
  body: { messages?: Array<{ role: string; content?: string }> }
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

  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-agent-chat-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.provider.activeProviderId = 'custom'
  settings.generator.providerId = 'custom'
  settings.generator.model = 'fake-chat-model'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.tools.enabled = false
  settings.provider.providers = settings.provider.providers.map((provider) =>
    provider.id === 'custom'
      ? {
          ...provider,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: 'test-key',
          models: ['fake-chat-model']
        }
      : provider
  )

  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'teachos-workspaces.json'),
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
  assert.ok(!('error' in result), 'agent chat should return the provider response')
  assert.equal(result.finalText, MODEL_REPLY)
  assert.equal(chunks.join(''), MODEL_REPLY)
  assert.deepEqual(statuses, ['thinking', 'done'])

  const sentMessages = requests[0]?.body.messages ?? []
  assert.equal(sentMessages[0]?.role, 'system')
  assert.match(sentMessages[0]?.content ?? '', /teach skill/)
  assert.match(sentMessages[0]?.content ?? '', /automatically loaded/)
  assert.match(sentMessages[0]?.content ?? '', /Teaching Workspace/)
  assert.match(sentMessages[0]?.content ?? '', /teaching-readiness-hints/)
  assert.match(sentMessages[0]?.content ?? '', /do not treat readiness hints as a canned assistant answer/)
  assert.equal(sentMessages.at(-1)?.role, 'user')
  assert.equal(sentMessages.at(-1)?.content, '我想学习 RAG')

  console.log('agent chat model routing ok')
} finally {
  await close(server).catch(() => {})
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

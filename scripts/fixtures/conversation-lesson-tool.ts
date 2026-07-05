import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'

type MockMessage = { role: string; content?: string | null }
type MockRequest = { messages?: MockMessage[]; tools?: unknown[] }

const VALID_PLAN = {
  title: 'RAG 是什么',
  objective: '用一张流程图讲清 RAG 的五个核心步骤',
  durationMinutes: 15,
  sections: [
    { heading: '为什么需要 RAG', body: '大模型有知识截止、幻觉与私有数据三个硬伤，RAG 通过检索外部资料来约束生成。' }
  ],
  keyPoints: ['RAG = 检索 + 生成'],
  quiz: [
    {
      type: 'single',
      question: 'RAG 的全称是什么？',
      choices: ['检索增强生成', '随机应用生成'],
      answer: 0,
      explanation: 'Retrieval-Augmented Generation。'
    }
  ],
  flashcards: [{ front: 'RAG 全称', back: 'Retrieval-Augmented Generation' }],
  referenceNotes: 'RAG = Retrieval-Augmented Generation，先检索后生成。',
  learningRecordNote: '建立了 RAG 的全局认知。'
}

// 'success': pipeline requests return a valid plan; 'broken': they return
// garbage twice (first attempt + repair round) so generation must fail
// without writing anything.
let pipelineMode: 'success' | 'broken' = 'success'
let pipelineRequests = 0
let conversationMode: 'normal' | 'budget-exhaustion' = 'normal'

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as MockRequest
  const messages = body.messages ?? []
  const systemText = String(messages[0]?.content ?? '')
  const isConversation = systemText.includes('教学助手')

  const reply = (payload: unknown): void => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  if (!isConversation) {
    // Lesson pipeline call (research loop first attempt or repair round).
    pipelineRequests += 1
    reply({
      choices: [
        {
          message: {
            role: 'assistant',
            content: pipelineMode === 'success' ? JSON.stringify(VALID_PLAN) : '抱歉，我无法输出 JSON。'
          }
        }
      ]
    })
    return
  }

  if (conversationMode === 'budget-exhaustion') {
    const forcedFinalWithoutTools = Array.isArray(body.tools) && body.tools.length === 0
    const hasToolResult = messages.some((message) => message.role === 'tool')
    if (forcedFinalWithoutTools || hasToolResult) {
      reply({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '好，资料齐了。开始生成第二课。'
            }
          }
        ]
      })
      return
    }

    reply({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-read-before-lesson',
                type: 'function',
                function: {
                  name: 'read_workspace_file',
                  arguments: JSON.stringify({ path: 'MISSION.md' })
                }
              }
            ]
          }
        }
      ]
    })
    return
  }

  const hasToolResult = messages.some((message) => message.role === 'tool')
  if (!hasToolResult) {
    reply({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-lesson-1',
                type: 'function',
                function: {
                  name: 'generate_lesson',
                  arguments: JSON.stringify({
                    topic: 'RAG 检索增强生成',
                    firstLessonFocus: '用一张流程图讲清 RAG 的五个核心步骤，并给出面试话术',
                    learnerProfile: '有编程基础的求职者',
                    goal: '准备面试，概念为主不写代码'
                  })
                }
              }
            ]
          }
        }
      ]
    })
    return
  }
  const toolPayload = String(messages.findLast((message) => message.role === 'tool')?.content ?? '')
  reply({
    choices: [
      {
        message: {
          role: 'assistant',
          content: toolPayload.includes('"ok":true')
            ? '第 1 课已生成：RAG 是什么。'
            : '课程生成失败了，我们可以稍后重试。'
        }
      }
    ]
  })
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

  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-conversation-lesson-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.provider.activeProviderId = 'deepseek'
  settings.generator.providerId = 'deepseek'
  settings.generator.model = 'deepseek-v4-flash'
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.requestTimeoutMs = 5000
  settings.generator.streaming = false
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
    registryPath: join(tempRoot, 'user-data', 'teachos-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings
  })
  const state = await service.createWorkspace({ name: 'learn-rag', prompt: '学习 RAG' })
  const workspace = state.activeWorkspace
  assert.ok(workspace)

  // --- Scenario 1: the conversation agent generates a lesson via its tool.
  const statuses: string[] = []
  const result = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'teaching',
      messages: [],
      userInput: '我想学习RAG，有编程基础，为了准备面试，概念为主。直接生成第一课。'
    },
    {
      streamId: 'lesson-tool-stream',
      onChunk: () => {},
      onStatus: (status) => statuses.push(status.status),
      onTool: () => {}
    }
  )

  assert.ok(!('error' in result) && !('canceled' in result), 'conversation should complete')
  assert.equal(result.finalText, '第 1 课已生成：RAG 是什么。')
  assert.equal(result.generatedLessons?.length, 1, 'generate_lesson output should be surfaced to the renderer')
  const lesson = result.generatedLessons?.[0]
  assert.ok(lesson)
  assert.match(lesson.relativePath, /^lessons\/0001-.+\.html$/)
  assert.equal(lesson.title, 'RAG 是什么')

  const lessonHtml = await readFile(join(workspace.rootPath, lesson.relativePath), 'utf8')
  assert.match(lessonHtml, /RAG/)
  const indexRaw = JSON.parse(await readFile(join(workspace.rootPath, '.teachos', 'index.json'), 'utf8')) as {
    lessons?: Array<{ relativePath?: string }>
  }
  assert.equal(
    indexRaw.lessons?.some((entry) => entry.relativePath === lesson.relativePath),
    true,
    'conversation-generated lessons must land in the workspace index like direct ones'
  )
  assert.ok(statuses.includes('tool_running'), 'lesson generation should stream tool progress')

  // --- Scenario 2: pipeline failure must not persist any placeholder lesson.
  pipelineMode = 'broken'
  pipelineRequests = 0
  const failure = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'teaching',
      messages: [],
      userInput: '再生成一节进阶课。'
    },
    {
      streamId: 'lesson-tool-failure-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )

  assert.ok(!('error' in failure) && !('canceled' in failure), 'the conversation itself should survive a failed generation')
  assert.equal(failure.generatedLessons, undefined, 'a failed generation must not report lessons')
  assert.equal(failure.finalText, '课程生成失败了，我们可以稍后重试。')
  assert.ok(pipelineRequests >= 2, 'validation failure should trigger exactly one repair round')

  const lessonFiles = (await readdir(join(workspace.rootPath, 'lessons'))).filter((name) => name.endsWith('.html'))
  assert.equal(lessonFiles.length, 2, 'only lesson 0001 (+ its reference page) may exist — no fallback lesson on failure')
  assert.equal(
    lessonFiles.every((name) => name.startsWith('0001-')),
    true,
    'no 0002 placeholder lesson may be written when generation fails'
  )

  // --- Scenario 3: exhausting the tool budget before generate_lesson should
  // recover by running the lesson pipeline directly for an explicit
  // continuation request. The user asked to continue; a clear generated lesson
  // is better than a truthful but dead-end "budget exhausted" error.
  conversationMode = 'budget-exhaustion'
  pipelineMode = 'success'
  pipelineRequests = 0
  settings.tools.maxIterations = 1
  const exhausted = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'teaching',
      messages: [],
      userInput: '第一节课学完了，直接开始第二节课，内容多一点。'
    },
    {
      streamId: 'lesson-tool-budget-exhaustion-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )

  assert.ok(!('error' in exhausted) && !('canceled' in exhausted), 'explicit lesson continuation should recover after tool budget exhaustion')
  assert.equal(exhausted.generatedLessons?.length, 1, 'budget exhaustion recovery should surface the generated lesson')
  assert.equal(exhausted.generatedLessons?.[0]?.id, '0002', 'the recovered lesson should be the next lesson')
  assert.match(exhausted.finalText, /课程已生成/)
  assert.ok(pipelineRequests >= 1, 'recovery should run the lesson generation pipeline')
  const filesAfterExhaustion = (await readdir(join(workspace.rootPath, 'lessons'))).filter((name) => name.endsWith('.html'))
  assert.equal(filesAfterExhaustion.length, 4, 'lesson 0002 plus its reference page should be written')
  assert.equal(filesAfterExhaustion.some((name) => name.startsWith('0002-')), true, 'lesson 0002 should exist on disk')

  console.log('conversation lesson tool ok')
} finally {
  await close(server).catch(() => undefined)
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

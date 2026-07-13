import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { resolveAskPending } from '../../src/main/ai/ask-pending'
import { resolveToolPermissionPending } from '../../src/main/ai/tool-permission-pending'

type MockMessage = {
  role: string
  content?: string | null
  tool_calls?: Array<{ function?: { name?: string } }>
}
type MockRequest = { messages?: MockMessage[]; tools?: unknown[]; response_format?: { type?: string }; max_tokens?: number }

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
let pipelineMode: 'success' | 'broken' | 'compact-recovery' = 'success'
let pipelineRequests = 0
let pipelineBodies: MockRequest[] = []
let conversationMode:
  | 'normal'
  | 'budget-exhaustion'
  | 'captured-rag-onboarding'
  | 'onboarding-budget-exhaustion'
  | 'onboarding-final-tool-call-error' = 'normal'
let onboardingConversationRequests = 0

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
    pipelineBodies.push(body)
    const content =
      pipelineMode === 'success' || (pipelineMode === 'compact-recovery' && pipelineRequests >= 3)
        ? JSON.stringify(VALID_PLAN)
        : '抱歉，我无法输出 JSON。'
    reply({
      choices: [
        {
          message: {
            role: 'assistant',
            content
          }
        }
      ]
    })
    return
  }

  if (conversationMode === 'budget-exhaustion') {
    const forcedFinalWithoutTools = !Array.isArray(body.tools) || body.tools.length === 0
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

  if (conversationMode === 'captured-rag-onboarding') {
    onboardingConversationRequests += 1
    const generateResult = messages.findLast(
      (message) => message.role === 'tool' && String(message.content ?? '').includes('"lessonId"')
    )
    if (generateResult) {
      reply({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '第 1 课已生成：RAG 是什么。'
            }
          }
        ]
      })
      return
    }

    const scriptedCalls = onboardingConversationRequests === 1
      ? [
          {
            id: 'call-captured-list',
            name: 'list_workspace',
            arguments: JSON.stringify({ path: '.', recursive: true })
          }
        ]
      : onboardingConversationRequests === 2
        ? ['MISSION.md', 'NOTES.md', 'RESOURCES.md', 'GLOSSARY.md'].map((path, index) => ({
            id: `call-captured-read-${index + 1}`,
            name: 'read_workspace_file',
            arguments: JSON.stringify({ path })
          }))
        : [
            {
              id: 'call-captured-generate',
              name: 'generate_lesson',
              arguments: JSON.stringify({
                topic: 'RAG 检索增强生成',
                firstLessonFocus: '用一张流程图讲清 RAG 的核心流程，并完成一次检索练习'
              })
            }
          ]
    reply({
      choices: [
        {
          message: {
            role: 'assistant',
            content: onboardingConversationRequests === 2
              ? '工作区已有基础结构，让我先读取关键文件，了解当前状态。'
              : null,
            tool_calls: scriptedCalls.map((call) => ({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: call.arguments
              }
            }))
          }
        }
      ]
    })
    return
  }

  if (conversationMode === 'onboarding-budget-exhaustion' || conversationMode === 'onboarding-final-tool-call-error') {
    onboardingConversationRequests += 1
    const forcedFinalWithoutTools = !Array.isArray(body.tools) || body.tools.length === 0
    if (forcedFinalWithoutTools) {
      if (conversationMode === 'onboarding-final-tool-call-error') {
        reply({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-forced-final-still-wants-lesson',
                    type: 'function',
                    function: {
                      name: 'generate_lesson',
                      arguments: JSON.stringify({
                        topic: 'RAG 检索增强生成',
                        firstLessonFocus: '用一张流程图讲清 RAG 的核心流程'
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
      reply({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '好的，MISSION.md 已锁定为「RAG 面试准备」。现在生成第一节课——最关键的起步内容。'
            }
          }
        ]
      })
      return
    }

    const scriptedCalls = [
      {
        id: 'call-onboarding-list',
        name: 'list_workspace',
        arguments: JSON.stringify({ path: '.', recursive: true })
      },
      {
        id: 'call-onboarding-read',
        name: 'read_workspace_file',
        arguments: JSON.stringify({ path: 'MISSION.md' })
      },
      {
        id: 'call-onboarding-ask',
        name: 'ask',
        arguments: JSON.stringify({
          questions: [
            {
              header: '学习动机',
              question: '你为什么想学 RAG？',
              options: [
                { label: '面试准备', description: '准备 AI/ML 相关岗位面试' },
                { label: '项目落地', description: '在自有数据上搭建 RAG 系统' }
              ]
            }
          ]
        })
      },
      {
        id: 'call-onboarding-write',
        name: 'write_workspace_file',
        arguments: JSON.stringify({
          path: 'MISSION.md',
          overwrite: true,
          content: [
            '# Mission: 学透 RAG，通过面试',
            '',
            '## Why',
            '准备 AI/ML 岗位面试，需要系统理解 RAG 的原理、流程和关键设计权衡。',
            '',
            '## Success looks like',
            '- 能清晰解释 RAG 是什么、为什么需要它、三步核心流程',
            '',
            '## Constraints',
            '- 每节 15-20 分钟，概念讲解为主'
          ].join('\n')
        })
      }
    ]
    const next = scriptedCalls[onboardingConversationRequests - 1] ?? {
      id: `call-onboarding-extra-read-${onboardingConversationRequests}`,
      name: 'read_workspace_file',
      arguments: JSON.stringify({ path: 'MISSION.md' })
    }
    reply({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: next.id,
                type: 'function',
                function: {
                  name: next.name,
                  arguments: next.arguments
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
          content: /"ok"\s*:\s*true/.test(toolPayload)
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

  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-conversation-lesson-'))
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
  settings.tools.workspaceWritePermission = 'ask_each_time'
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

  // --- Scenario 1: the conversation agent generates a lesson via its tool.
  const statuses: string[] = []
  let permissionResolved = false
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
      onTool: (event) => {
        if (event.toolCall.name !== 'tool_permission' || event.result !== undefined) return
        setTimeout(() => {
          permissionResolved = resolveToolPermissionPending('lesson-tool-stream', event.toolCall.id, [
            { questionId: 'permission', selected: ['allow_for_run'] }
          ])
        }, 0)
      }
    }
  )

  assert.ok(!('error' in result) && !('canceled' in result), 'conversation should complete')
  assert.equal(permissionResolved, true, 'permission resolver must exist before the realtime request can be answered')
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
  assert.equal(pipelineBodies[0]?.response_format?.type, 'json_object', 'tool-augmented lesson generation should request JSON mode')
  assert.ok((pipelineBodies[0]?.max_tokens ?? 0) >= 8192, 'lesson generation should raise the output budget for structured lesson plans')
  settings.tools.workspaceWritePermission = 'allow_for_conversation'

  // --- Scenario 2: pipeline failure must not persist any placeholder lesson.
  pipelineMode = 'broken'
  pipelineRequests = 0
  pipelineBodies = []
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

  // --- Scenario 3: reaching the loop limit before generate_lesson must not
  // bypass the agent loop and invoke the side-effecting lesson pipeline.
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

  assert.equal('error' in exhausted, true, 'loop exhaustion should surface a truthful manual-retry boundary')
  assert.equal(pipelineRequests, 0, 'loop exhaustion must not auto-run the lesson generation pipeline')
  const filesAfterExhaustion = (await readdir(join(workspace.rootPath, 'lessons'))).filter((name) => name.endsWith('.html'))
  assert.equal(filesAfterExhaustion.length, 2, 'no new lesson or reference page should be written')
  assert.equal(filesAfterExhaustion.some((name) => name.startsWith('0002-')), false)

  // --- Scenario 4: a new learner can enter with a broad topic, answer one
  // clarification question, and have the agent decide to generate the first
  // lesson. If the loop ends immediately after the mission write, StudiumX
  // keeps that completed operation but does not infer and run a second side effect.
  conversationMode = 'onboarding-budget-exhaustion'
  onboardingConversationRequests = 0
  pipelineMode = 'success'
  pipelineRequests = 0
  settings.tools.maxIterations = 4
  const onboardingStreamId = 'lesson-tool-onboarding-budget-exhaustion-stream'
  const onboarding = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'teaching',
      messages: [],
      userInput: '我想学习RAG'
    },
    {
      streamId: onboardingStreamId,
      onChunk: () => {},
      onStatus: () => {},
      onTool: (event) => {
        if (event.toolCall.name !== 'ask') return
        setTimeout(() => {
          resolveAskPending(onboardingStreamId, event.toolCall.id, [
            { questionId: 'q1', selected: ['面试准备'] }
          ])
        }, 0)
      }
    }
  )

  assert.equal('canceled' in onboarding, false)
  assert.equal('generatedLessons' in onboarding ? onboarding.generatedLessons : undefined, undefined)
  assert.equal(pipelineRequests, 0, 'onboarding exhaustion must not auto-run generate_lesson')
  const filesAfterOnboarding = (await readdir(join(workspace.rootPath, 'lessons'))).filter((name) => name.endsWith('.html'))
  assert.equal(filesAfterOnboarding.some((name) => name.startsWith('0002-')), false)

  // --- Scenario 5: some OpenAI-compatible providers still return tool_calls
  // during a no-tools final-answer round. A returned tool_call is not an
  // authorization to execute the side effect out of band.
  conversationMode = 'onboarding-final-tool-call-error'
  onboardingConversationRequests = 0
  pipelineMode = 'success'
  pipelineRequests = 0
  settings.tools.maxIterations = 4
  const finalToolCallStreamId = 'lesson-tool-final-tool-call-error-stream'
  const finalToolCall = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'teaching',
      messages: [],
      userInput: '我想学习RAG'
    },
    {
      streamId: finalToolCallStreamId,
      onChunk: () => {},
      onStatus: () => {},
      onTool: (event) => {
        if (event.toolCall.name !== 'ask') return
        setTimeout(() => {
          resolveAskPending(finalToolCallStreamId, event.toolCall.id, [
            { questionId: 'q1', selected: ['面试准备'] }
          ])
        }, 0)
      }
    }
  )

  assert.equal('canceled' in finalToolCall, false)
  assert.equal('generatedLessons' in finalToolCall ? finalToolCall.generatedLessons : undefined, undefined)
  assert.equal(pipelineRequests, 0, 'a forced-final tool_call must not trigger out-of-band generation')
  const filesAfterFinalToolCall = (await readdir(join(workspace.rootPath, 'lessons'))).filter((name) => name.endsWith('.html'))
  assert.equal(filesAfterFinalToolCall.some((name) => name.startsWith('0002-')), false)

  // --- Scenario 6: replay the captured "我想学习RAG" trace. The persisted
  // generic limit is one iteration, but a durable teaching request still needs
  // enough room to inspect the workspace and execute generate_lesson.
  conversationMode = 'captured-rag-onboarding'
  onboardingConversationRequests = 0
  pipelineMode = 'success'
  pipelineRequests = 0
  settings.tools.maxIterations = 1
  const capturedOnboarding = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'teaching',
      messages: [],
      userInput: '我想学习RAG'
    },
    {
      streamId: 'lesson-tool-captured-rag-onboarding-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )

  assert.ok(!('error' in capturedOnboarding) && !('canceled' in capturedOnboarding))
  assert.equal(capturedOnboarding.generatedLessons?.length, 1, 'broad learning intent should produce a durable first lesson')
  assert.equal(pipelineRequests, 1, 'the captured teaching chain should execute generate_lesson exactly once')
  assert.ok(
    onboardingConversationRequests >= 4,
    'the teaching chain should continue through workspace inspection, lesson generation, and final confirmation'
  )
  const filesAfterCapturedOnboarding = (await readdir(join(workspace.rootPath, 'lessons')))
    .filter((name) => name.endsWith('.html'))
  assert.equal(filesAfterCapturedOnboarding.some((name) => name.startsWith('0002-')), true, 'lesson 0002 should exist on disk')

  // --- Scenario 7: malformed JSON should get one repair round and then a
  // compact full regeneration. The compact round is intentionally shorter
  // and should rescue providers that clipped or broke the first JSON object.
  conversationMode = 'normal'
  pipelineMode = 'compact-recovery'
  pipelineRequests = 0
  pipelineBodies = []
  settings.tools.maxIterations = 0
  const compactRecovery = await service.agentChatStream(
    {
      workspaceId: workspace.id,
      mode: 'teaching',
      messages: [],
      userInput: '继续生成一节需要紧凑重试的课。'
    },
    {
      streamId: 'lesson-tool-compact-recovery-stream',
      onChunk: () => {},
      onStatus: () => {},
      onTool: () => {}
    }
  )

  assert.ok(!('error' in compactRecovery) && !('canceled' in compactRecovery), 'compact regeneration should recover from invalid JSON')
  assert.equal(compactRecovery.generatedLessons?.length, 1, 'compact regeneration should still surface the generated lesson')
  assert.equal(compactRecovery.generatedLessons?.[0]?.id, '0003', 'compact recovery should persist the next lesson')
  assert.equal(pipelineRequests, 3, 'compact recovery should run first attempt, repair, and one compact regeneration')
  assert.equal(
    pipelineBodies.every((request) => request.response_format?.type === 'json_object'),
    true,
    'all lesson-plan attempts should request JSON mode'
  )
  const filesAfterCompactRecovery = (await readdir(join(workspace.rootPath, 'lessons'))).filter((name) => name.endsWith('.html'))
  assert.equal(filesAfterCompactRecovery.some((name) => name.startsWith('0003-')), true, 'lesson 0003 should exist on disk')

  console.log('conversation lesson tool ok')
} finally {
  await close(server).catch(() => undefined)
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

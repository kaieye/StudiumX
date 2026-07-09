import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const tempParent = join(process.cwd(), '.studiumx')
await mkdir(tempParent, { recursive: true })
const tempRoot = await mkdtemp(join(tempParent, 'agent-process-timeline-'))
const outfile = join(tempRoot, 'agent-process-timeline.mjs')

try {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [join(process.cwd(), 'src', 'renderer', 'src', 'agent-process-timeline.ts')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent'
  })

  const { buildAgentProcessTimeline } = await import(pathToFileURL(outfile).href)
  const turn = {
    id: 'assistant-turn',
    role: 'assistant',
    content: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    processEvents: [
      {
        id: 'status-thinking',
        kind: 'status',
        status: 'thinking',
        title: '分析问题与上下文',
        createdAt: '2026-07-01T00:00:00.000Z'
      },
      {
        id: 'tool-call',
        kind: 'tool_call',
        title: '调用工具：list_workspace',
        toolCallId: 'call-1',
        toolName: 'list_workspace',
        createdAt: '2026-07-01T00:00:01.000Z'
      },
      {
        id: 'tool-result',
        kind: 'tool_result',
        title: '工具完成：list_workspace',
        toolCallId: 'call-1',
        toolName: 'list_workspace',
        createdAt: '2026-07-01T00:00:02.000Z'
      },
      {
        id: 'status-tool-done',
        kind: 'status',
        status: 'tool_done',
        title: '整理工具返回结果',
        createdAt: '2026-07-01T00:00:03.000Z'
      }
    ],
    toolCalls: [
      {
        id: 'call-1',
        name: 'list_workspace',
        arguments: '{"path":"."}',
        result: '{"entries":[]}'
      }
    ]
  }

  const timeline = buildAgentProcessTimeline(turn)
  assert.deepEqual(
    timeline.map((item) => item.kind === 'event' ? item.event.title : `工具卡片：${item.toolCall.name}`),
    [
      '分析问题与上下文',
      '调用工具：list_workspace',
      '工具完成：list_workspace',
      '整理工具返回结果'
    ]
  )
  assert.equal(timeline.length, 4, 'tool calls with process events must not be rendered again at the bottom')
  assert.equal(timeline[1]?.kind, 'event')
  assert.equal(timeline[1]?.toolCall?.name, 'list_workspace')
  assert.equal(timeline[2]?.kind, 'event')
  assert.equal(timeline[2]?.toolCall?.result, '{"entries":[]}')

  const legacyTurn = {
    id: 'legacy-assistant-turn',
    role: 'assistant',
    content: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    toolCalls: [
      {
        id: 'legacy-call',
        name: 'web_search',
        arguments: '{"query":"agent loop"}',
        result: '[]'
      }
    ]
  }
  assert.deepEqual(
    buildAgentProcessTimeline(legacyTurn).map((item) => item.kind === 'tool_call' ? item.toolCall.name : item.event.title),
    ['web_search'],
    'saved conversations without process events should still render their tool card'
  )

  console.log('agent process timeline order ok')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

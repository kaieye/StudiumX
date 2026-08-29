import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateMindMap, generateMindMapProposal } from '../../src/main/mindmap/mind-map-generation'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { MindMapProviderProposal } from '../../src/shared/mindmap/commands/mind-map-proposal'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function currentDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Study map',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    theme: { id: 'default' },
    sheets: [{
      id: 'sheet-1',
      title: 'Overview',
      root: { id: 'root-1', title: 'Overview', children: [] },
      elements: [],
      layout: { structureClass: 'studiumx.layout.logic.right' }
    }],
    assets: []
  }
}

function proposalFixture(): MindMapProviderProposal {
  return {
    schemaVersion: 1,
    proposalId: 'proposal-1',
    scope: 'sheet',
    items: [
      { id: 'rename-sheet', command: { type: 'sheet.rename', sheetId: 'sheet-1', title: 'Reviewed sheet' } }
    ]
  }
}

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .concat('data: [DONE]\n\n')
    .join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

function toolCallSse(name: string, args: string): Response {
  return sseResponse([
    { choices: [{ delta: { reasoning_content: '先检查当前导图结构。' } }] },
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call-submit', type: 'function', function: { name, arguments: args } }]
        }
      }]
    }
  ])
}

function answerSse(text: string): Response {
  return sseResponse([{ choices: [{ delta: { content: text } }] }])
}

function proposalSettings() {
  const settings = defaultSettings('/tmp/mind-map-agent')
  settings.generator.endpointFormat = 'chat_completions'
  settings.generator.streaming = true
  settings.provider.activeProviderId = settings.provider.providers[0]!.id
  settings.provider.providers = [{
    ...settings.provider.providers[0]!,
    apiKey: 'sk-fixture'
  }]
  return settings
}

function proposalRequest() {
  return {
    schemaVersion: 1,
    scope: 'sheet' as const,
    documentId: 'doc-1',
    sheetId: 'sheet-1',
    selectedTopicIds: [],
    sourceRefs: []
  }
}

type ToolCallRecord = { id: string; name: string; arguments: string }

describe('mind-map generation as a bounded agent loop', () => {
  it('lets the model submit the proposal through a real tool call and finalizes with a reply', async () => {
    const proposal = proposalFixture()
    const requestBodies: Array<Record<string, unknown>> = []
    const toolCalls: ToolCallRecord[] = []
    const toolResults: Array<{ name: string; isError: boolean }> = []
    const reasoning: string[] = []
    const previews: string[] = []
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (requestBodies.length === 1) {
        return toolCallSse('submit_mind_map_proposal', JSON.stringify(proposal))
      }
      return answerSse('提案已生成，可以应用到画布。')
    }) as typeof fetch

    const result = await generateMindMapProposal({
      title: 'Study map',
      prompt: 'Rename the sheet.',
      settings: proposalSettings(),
      document: currentDocument(),
      request: proposalRequest()
    }, (delta) => previews.push(delta), (delta) => reasoning.push(delta), {
      onToolCall: (call) => toolCalls.push(call),
      onToolResult: (call, _result, isError) => toolResults.push({ name: call.name, isError })
    })

    // The model handed over the proposal through the terminal business tool.
    expect(result).toEqual({
      ...proposal,
      assistantMessage: '提案已生成，可以应用到画布。'
    })
    expect(reasoning).toEqual(['先检查当前导图结构。'])
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({ name: 'submit_mind_map_proposal' })
    expect(toolResults).toEqual([{ name: 'submit_mind_map_proposal', isError: false }])
    // The validated envelope feeds the canvas preview reveal.
    expect(previews).toEqual([JSON.stringify({ items: proposal.items })])

    // Chat mode with tools: no strict-JSON response_format, and the submit
    // tool is offered so reasoning stays visible for reasoning providers.
    const firstRequest = requestBodies[0]!
    expect(firstRequest.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: 'submit_mind_map_proposal' }) })
    ])
    expect(firstRequest).not.toHaveProperty('response_format')
    // The finalize round stops offering tools after the durable submit.
    expect(requestBodies[1]).not.toHaveProperty('tools')
  })

  it('feeds an invalid submission back to the model as a corrective tool result', async () => {
    const proposal = proposalFixture()
    let round = 0
    let correctiveToolResult = ''
    globalThis.fetch = (async (_input, init) => {
      round += 1
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ role: string; content: string }>
      }
      if (round === 1) {
        // First attempt: wrong scope, which the validator must reject.
        return toolCallSse('submit_mind_map_proposal', JSON.stringify({
          ...proposal,
          scope: 'document'
        }))
      }
      if (round === 2) {
        // The request after the rejected submission must carry the validator's
        // error as a tool result so the model can self-correct.
        const lastToolResult = [...(body.messages ?? [])].reverse()
          .find((message) => message.role === 'tool')
        correctiveToolResult = lastToolResult?.content ?? ''
        return toolCallSse('submit_mind_map_proposal', JSON.stringify(proposal))
      }
      return answerSse('已修正并提交提案。')
    }) as typeof fetch

    const result = await generateMindMapProposal({
      title: 'Study map',
      prompt: 'Rename the sheet.',
      settings: proposalSettings(),
      document: currentDocument(),
      request: proposalRequest()
    })

    expect(result).toEqual({
      ...proposal,
      assistantMessage: '已修正并提交提案。'
    })
    expect(correctiveToolResult).toContain('mind-map proposal failed schema validation')
  })

  it('runs the full-document path through the same submit-tool loop', async () => {
    // The provider emits the V1 document envelope; the gateway owns the
    // V1→V2 migration after this boundary.
    const document = {
      schemaVersion: 1,
      id: 'doc-1',
      title: 'Study map',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
      sheets: [{
        id: 'sheet-1',
        title: 'Overview',
        root: { id: 'root-1', title: 'Overview', children: [] }
      }]
    }
    let submitSeen = false
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { tools?: Array<{ function: { name: string } }> }
      if (!submitSeen) {
        submitSeen = true
        expect(body.tools).toEqual([
          expect.objectContaining({ function: expect.objectContaining({ name: 'submit_mind_map_document' }) })
        ])
        return toolCallSse('submit_mind_map_document', JSON.stringify(document))
      }
      return answerSse('已生成思维导图。')
    }) as typeof fetch

    const previews: string[] = []
    const result = await generateMindMap({
      title: 'Study map',
      prompt: 'Create a study map.',
      settings: proposalSettings(),
      generationId: 'gen-1'
    }, (delta) => previews.push(delta))

    expect(result).toEqual({
      ...document,
      sheets: [{ ...document.sheets[0], structureClass: 'studiumx.layout.logic.right' }]
    })
    expect(previews).toHaveLength(1)
    expect(JSON.parse(previews[0]!)).toEqual(result)
  })
})

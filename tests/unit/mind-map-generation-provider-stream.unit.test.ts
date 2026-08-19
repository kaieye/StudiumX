import { afterEach, describe, expect, it } from 'vitest'

import { generateMindMapProposal } from '../../src/main/mindmap/mind-map-generation'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { MindMapProviderProposal } from '../../src/shared/mindmap/commands/mind-map-proposal'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
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

function proposal(): MindMapProviderProposal {
  return {
    schemaVersion: 1,
    proposalId: 'proposal-1',
    scope: 'sheet',
    items: []
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

describe('mind-map generation over Responses streaming', () => {
  it('explicitly disables Ark DeepSeek thinking for a structured Responses request', async () => {
    const expected = proposal()
    const providerRequests: Record<string, unknown>[] = []
    globalThis.fetch = (async (_input, init) => {
      const providerRequest = JSON.parse(String(init?.body)) as Record<string, unknown>
      providerRequests.push(providerRequest)
      // Ark enables DeepSeek thinking by default even when the request omits a
      // reasoning field. In that mode the provider can spend the entire output
      // budget on reasoning and terminate response.incomplete with no answer.
      if ((providerRequest.thinking as { type?: unknown } | undefined)?.type !== 'disabled') {
        return sseResponse([
          { type: 'response.reasoning_summary_text.delta', delta: 'Planning the JSON response.' },
          {
            type: 'response.incomplete',
            response: {
              status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
              usage: { input_tokens: 11, output_tokens: 12800, total_tokens: 12811 }
            }
          }
        ])
      }
      return sseResponse([
        { type: 'response.output_text.delta', delta: `\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`` },
        { type: 'response.completed', response: { status: 'completed' } }
      ])
    }) as typeof fetch

    const settings = defaultSettings('/tmp/mind-map-provider-stream')
    settings.generator.providerId = 'custom'
    settings.generator.endpointFormat = 'responses'
    settings.generator.model = 'deepseek-v4-flash-ga-260731'
    settings.generator.reasoningEffort = 'max'
    settings.generator.streaming = true
    settings.provider.activeProviderId = 'custom'
    settings.provider.providers = [{
      ...settings.provider.providers[0]!,
      id: 'custom',
      name: 'Responses fixture',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      endpointFormat: 'responses',
      models: ['deepseek-v4-flash-ga-260731'],
      apiKey: 'sk-fixture'
    }]

    await expect(generateMindMapProposal({
      title: 'Study map',
      prompt: 'Add one topic.',
      settings,
      document: currentDocument(),
      request: {
        schemaVersion: 1,
        scope: 'sheet',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: []
      }
    }, () => {}, () => {})).resolves.toEqual(expected)
    expect(providerRequests).toHaveLength(1)
    expect(providerRequests[0]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(providerRequests[0]).not.toHaveProperty('reasoning')
  })
})

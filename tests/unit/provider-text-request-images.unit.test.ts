import { describe, expect, it } from 'vitest'
import { buildRequest } from '../../src/main/ai/provider-adapter/request-builder'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { AdapterRequest } from '../../src/main/ai/provider-adapter'
import type { TeachingModelProviderProfile } from '../../src/shared/teaching-types'

function provider(): TeachingModelProviderProfile {
  const settings = defaultSettings('C:/provider-text-request-images-fixture')
  return {
    ...settings.provider.providers[0]!,
    baseUrl: 'https://provider.example/v1',
    apiKey: 'sk-fixture'
  }
}

function generator() {
  const settings = defaultSettings('C:/provider-text-request-images-fixture')
  return settings.generator
}

function image() {
  return {
    id: 'image-1',
    name: 'diagram.png',
    mimeType: 'image/png' as const,
    dataBase64: 'iVBORw0KGgo=',
    sizeBytes: 8
  }
}

function readBody(built: { url: string; init: RequestInit }): { url: string; body: Record<string, unknown> } {
  return { url: built.url, body: JSON.parse(String(built.init.body)) }
}

describe('buildRequest image attachments (structured text lanes)', () => {
  it('serializes images into the chat_completions user message', () => {
    const request: AdapterRequest = {
      systemPrompt: 'system',
      userPrompt: 'Analyze this diagram.',
      jsonMode: true,
      imageAttachments: [image()]
    }
    const { body } = readBody(buildRequest('chat_completions', {
      provider: provider(), generator: generator(), request, stream: false
    }))
    expect(body.messages).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this diagram.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }
        ]
      }
    ])
  })

  it('serializes images into the custom_endpoint user message', () => {
    const request: AdapterRequest = {
      systemPrompt: 'system',
      userPrompt: 'Analyze this diagram.',
      jsonMode: true,
      imageAttachments: [image()]
    }
    const { body } = readBody(buildRequest('custom_endpoint', {
      provider: provider(), generator: generator(), request, stream: false
    }))
    expect(body.messages).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this diagram.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }
        ]
      }
    ])
  })

  it('serializes images into the Responses API input item', () => {
    const request: AdapterRequest = {
      systemPrompt: 'system',
      userPrompt: 'Analyze this diagram.',
      jsonMode: true,
      imageAttachments: [image()]
    }
    const { body } = readBody(buildRequest('responses', {
      provider: provider(), generator: generator(), request, stream: false
    }))
    expect(body.input).toEqual([{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Analyze this diagram.' },
        { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=' }
      ]
    }])
  })

  it('serializes images into the Anthropic Messages user turn', () => {
    const request: AdapterRequest = {
      systemPrompt: 'system',
      userPrompt: 'Analyze this diagram.',
      jsonMode: true,
      imageAttachments: [image()]
    }
    const { body } = readBody(buildRequest('messages', {
      provider: provider(), generator: generator(), request, stream: false
    }))
    expect(body.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this diagram.' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }
      ]
    }])
  })

  it('keeps the plain string user message when no images are attached', () => {
    const request: AdapterRequest = {
      systemPrompt: 'system',
      userPrompt: 'plain text',
      jsonMode: true
    }
    for (const format of ['chat_completions', 'custom_endpoint'] as const) {
      const { body } = readBody(buildRequest(format, {
        provider: provider(), generator: generator(), request, stream: false
      }))
      const messages = body.messages as Array<{ role: string; content: unknown }>
      expect(messages[1]!.content).toBe('plain text')
    }
    const { body: responsesBody } = readBody(buildRequest('responses', {
      provider: provider(), generator: generator(), request, stream: false
    }))
    expect(responsesBody.input).toBe('plain text')
    const { body: anthropicBody } = readBody(buildRequest('messages', {
      provider: provider(), generator: generator(), request, stream: false
    }))
    const messages = anthropicBody.messages as Array<{ role: string; content: unknown }>
    expect(messages[0]!.content).toBe('plain text')
  })

  it('supports image-only user turns (empty text with attachments)', () => {
    const request: AdapterRequest = {
      systemPrompt: 'system',
      userPrompt: '',
      jsonMode: true,
      imageAttachments: [image()]
    }
    const { body } = readBody(buildRequest('chat_completions', {
      provider: provider(), generator: generator(), request, stream: false
    }))
    const messages = body.messages as Array<{ role: string; content: unknown }>
    expect(messages[1]!.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PRODUCT_USER_AGENT,
  isCliSpoofProviderHeader,
  isReservedProviderHeaderName,
  mergeProviderRequestHeaders,
  normalizeProviderCustomHeaders,
  redactProviderCustomHeadersForLog,
  redactProviderHeaderMapForLog
} from '../../src/shared/provider-custom-headers'
import { adapterAuthHeaders } from '../../src/shared/provider-format'
import { buildChatRequest, buildRequest } from '../../src/main/ai/provider-adapter/request-builder'
import { normalizeTeachingSettings } from '../../src/shared/teaching-settings-schema'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../src/shared/teaching-types'

describe('provider custom headers — reserved blacklist', () => {
  it('flags auth and identity keys case-insensitively', () => {
    expect(isReservedProviderHeaderName('Authorization')).toBe(true)
    expect(isReservedProviderHeaderName('authorization')).toBe(true)
    expect(isReservedProviderHeaderName('X-Api-Key')).toBe(true)
    expect(isReservedProviderHeaderName('api-key')).toBe(true)
    expect(isReservedProviderHeaderName('User-Agent')).toBe(true)
    expect(isReservedProviderHeaderName('Cookie')).toBe(true)
    expect(isReservedProviderHeaderName('X-Campus-Gateway')).toBe(false)
  })
})

describe('provider custom headers — normalize', () => {
  it('keeps ordered non-reserved headers and drops reserved / spoof', () => {
    const normalized = normalizeProviderCustomHeaders([
      { name: 'X-Campus-Id', value: 'campus-a' },
      { name: 'Authorization', value: 'Bearer evil' },
      { name: 'x-api-key', value: 'should-drop' },
      { name: 'X-Client-Name', value: 'claude-cli' },
      { name: 'X-Trace', value: 't1' },
      { name: 'X-Campus-Id', value: 'campus-b' },
      null,
      { name: '', value: 'x' },
      { name: 'Bad Name', value: 'x' }
    ])
    expect(normalized).toEqual([
      { name: 'X-Campus-Id', value: 'campus-b' },
      { name: 'X-Trace', value: 't1' }
    ])
  })

  it('rejects CLI identity spoof packages by name and value', () => {
    expect(isCliSpoofProviderHeader('X-Client-Name', 'anything')).toBe(true)
    expect(isCliSpoofProviderHeader('X-Campus', 'openai-python/1.0')).toBe(true)
    expect(isCliSpoofProviderHeader('X-Campus', 'normal-value')).toBe(false)
    const normalized = normalizeProviderCustomHeaders([
      { name: 'User-Agent', value: 'claude-cli/1.0' },
      { name: 'X-Stainless-Lang', value: 'js' },
      { name: 'X-Ok', value: '1' }
    ])
    expect(normalized).toEqual([{ name: 'X-Ok', value: '1' }])
  })
})

describe('provider custom headers — merge order', () => {
  it('applies custom after base auth without overriding reserved base keys', () => {
    const base = adapterAuthHeaders('chat_completions', 'sk-real')
    const merged = mergeProviderRequestHeaders(base, [
      { name: 'Authorization', value: 'Bearer spoof' },
      { name: 'X-Gateway-Token', value: 'campus-token' },
      { name: 'X-Order-First', value: '1' },
      { name: 'X-Order-Second', value: '2' }
    ])
    expect(merged.Authorization).toBe('Bearer sk-real')
    expect(merged['X-Gateway-Token']).toBe('campus-token')
    expect(merged['X-Order-First']).toBe('1')
    expect(merged['X-Order-Second']).toBe('2')
    expect(merged['User-Agent']).toBe(PROVIDER_PRODUCT_USER_AGENT)
  })

  it('always sets honest product User-Agent last', () => {
    const merged = mergeProviderRequestHeaders(
      { Accept: 'application/json', 'user-agent': 'evil-cli/9' },
      [{ name: 'User-Agent', value: 'claude-cli' }]
    )
    expect(merged['User-Agent']).toBe(PROVIDER_PRODUCT_USER_AGENT)
    expect(Object.keys(merged).filter((k) => k.toLowerCase() === 'user-agent')).toHaveLength(1)
  })
})

describe('provider custom headers — log redaction', () => {
  it('redacts secret-looking custom header values', () => {
    expect(
      redactProviderCustomHeadersForLog([
        { name: 'X-Campus-Id', value: 'public' },
        { name: 'X-Api-Key', value: 'sk-secret-value-long' },
        { name: 'X-Token', value: 'Bearer abc.def' },
        { name: 'X-Opaque', value: 'sk-abcdefghijklmnopqrst' }
      ])
    ).toEqual([
      { name: 'X-Campus-Id', value: 'public' },
      { name: 'X-Api-Key', value: '[redacted]' },
      { name: 'X-Token', value: '[redacted]' },
      { name: 'X-Opaque', value: '[redacted]' }
    ])
  })

  it('redacts Authorization on merged header maps', () => {
    const map = redactProviderHeaderMapForLog({
      Authorization: 'Bearer sk-real',
      'X-Campus': 'ok'
    })
    expect(map.Authorization).toBe('[redacted]')
    expect(map['X-Campus']).toBe('ok')
  })
})

describe('buildRequest / buildChatRequest headers', () => {
  const provider = {
    id: 'custom',
    name: 'Custom',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k',
    endpointFormat: 'chat_completions',
    models: ['m'],
    docsUrl: '',
    apiKeyUrl: '',
    customHeaders: [
      { name: 'X-Campus-Gateway', value: 'gw-1' },
      { name: 'Authorization', value: 'Bearer no' },
      { name: 'X-Client-Name', value: 'claude-cli' }
    ]
  } as TeachingModelProviderProfile
  const generator = {
    model: 'm',
    temperature: 0.2,
    maxOutputTokens: 100,
    endpointFormat: 'chat_completions'
  } as TeachingSettingsV1['generator']

  it('merges allowed custom headers on chat request and keeps auth', () => {
    const built = buildChatRequest('chat_completions', {
      provider,
      generator,
      request: { messages: [{ role: 'user', content: 'hi' }] },
      stream: false,
      includeTools: false
    })
    const headers = built.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer k')
    expect(headers['X-Campus-Gateway']).toBe('gw-1')
    expect(headers['X-Client-Name']).toBeUndefined()
    expect(headers['User-Agent']).toBe(PROVIDER_PRODUCT_USER_AGENT)
  })

  it('merges allowed custom headers on text buildRequest', () => {
    const built = buildRequest('chat_completions', {
      provider,
      generator,
      request: { systemPrompt: 's', userPrompt: 'u', jsonMode: false },
      stream: false
    })
    const headers = built.init.headers as Record<string, string>
    expect(headers['X-Campus-Gateway']).toBe('gw-1')
    expect(headers.Authorization).toBe('Bearer k')
  })
})

describe('settings validation for custom headers shape', () => {
  it('normalizes provider customHeaders list and strips reserved keys', () => {
    const settings = normalizeTeachingSettings(
      {
        provider: {
          activeProviderId: 'custom',
          providers: [
            {
              id: 'custom',
              name: 'Custom',
              apiKey: 'secret',
              baseUrl: 'https://models.example.test/v1',
              endpointFormat: 'chat_completions',
              models: ['m1'],
              customHeaders: [
                { name: '  X-Campus  ', value: 'a' },
                { name: 'Authorization', value: 'Bearer x' },
                { name: 'X-Client-Name', value: 'codex-cli' },
                { name: 'X-Campus', value: 'b' }
              ]
            }
          ]
        }
      },
      'C:/StudiumX/workspaces'
    )
    const custom = settings.provider.providers.find((p) => p.id === 'custom')
    expect(custom?.customHeaders).toEqual([{ name: 'X-Campus', value: 'b' }])
  })

  it('omits customHeaders when empty after normalize', () => {
    const settings = normalizeTeachingSettings(
      {
        provider: {
          providers: [
            {
              id: 'custom',
              baseUrl: 'https://models.example.test/v1',
              models: ['m'],
              customHeaders: [{ name: 'Authorization', value: 'x' }]
            }
          ]
        }
      },
      'C:/StudiumX/workspaces'
    )
    const custom = settings.provider.providers.find((p) => p.id === 'custom')
    expect(custom?.customHeaders).toBeUndefined()
  })
})

import type { ModelEndpointFormat } from './teaching-types'
import { upstreamOpenAiModelsUrl } from './openai-compat-url'

const CONTENT_TYPE_JSON = 'application/json'
const ANTHROPIC_VERSION = '2023-06-01'

export type ProviderFormatAdapter = {
  format: ModelEndpointFormat
  toolsSupported: boolean
  probeSupported: boolean
  authHeaders: (apiKey: string) => Record<string, string>
  requestHeaders: (apiKey: string) => Record<string, string>
  modelsUrl: (baseUrl: string) => string
  parseModelIds: (body: string) => string[]
  unsupportedProbeMessage?: string
}

const bearerHeaders = (apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = apiKey.trim()
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

const anthropicHeaders = (apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'anthropic-version': ANTHROPIC_VERSION
  }
  const key = apiKey.trim()
  if (key) headers['x-api-key'] = key
  return headers
}

const withJsonContentType = (headers: Record<string, string>): Record<string, string> => ({
  ...headers,
  'Content-Type': CONTENT_TYPE_JSON
})

function parseOpenAiModelIds(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object') return []
    const data = (parsed as { data?: unknown }).data
    if (!Array.isArray(data)) return []
    return data
      .map((item) => (typeof item === 'string' ? item : (item as { id?: string })?.id ?? ''))
      .filter((id): id is string => Boolean(id) && typeof id === 'string')
  } catch {
    return []
  }
}

function parseMessagesModelIds(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object') return []
    const data = (parsed as { data?: unknown }).data
    if (Array.isArray(data)) {
      return data
        .map((item) => (typeof item === 'string' ? item : (item as { id?: string })?.id ?? ''))
        .filter((id): id is string => Boolean(id) && typeof id === 'string')
    }
    const models = (parsed as { models?: unknown }).models
    if (Array.isArray(models)) {
      return models
        .map((item) => (item as { id?: string })?.id ?? '')
        .filter((id): id is string => Boolean(id))
    }
  } catch {
    return []
  }
  return []
}

const openAiModelsUrl = (baseUrl: string): string => upstreamOpenAiModelsUrl(baseUrl)

const FORMAT_ADAPTERS = {
  chat_completions: {
    format: 'chat_completions',
    toolsSupported: true,
    probeSupported: true,
    authHeaders: bearerHeaders,
    requestHeaders: (apiKey) => withJsonContentType(bearerHeaders(apiKey)),
    modelsUrl: openAiModelsUrl,
    parseModelIds: parseOpenAiModelIds
  },
  responses: {
    format: 'responses',
    toolsSupported: true,
    probeSupported: true,
    authHeaders: bearerHeaders,
    requestHeaders: (apiKey) => withJsonContentType(bearerHeaders(apiKey)),
    modelsUrl: openAiModelsUrl,
    parseModelIds: parseOpenAiModelIds
  },
  messages: {
    format: 'messages',
    toolsSupported: true,
    probeSupported: true,
    authHeaders: anthropicHeaders,
    requestHeaders: (apiKey) => withJsonContentType(anthropicHeaders(apiKey)),
    modelsUrl: openAiModelsUrl,
    parseModelIds: parseMessagesModelIds
  },
  custom_endpoint: {
    format: 'custom_endpoint',
    toolsSupported: true,
    probeSupported: false,
    authHeaders: bearerHeaders,
    requestHeaders: (apiKey) => withJsonContentType(bearerHeaders(apiKey)),
    modelsUrl: openAiModelsUrl,
    parseModelIds: parseOpenAiModelIds,
    unsupportedProbeMessage: 'Custom endpoint 模式不支持 /models 探测，请手动添加模型 ID。'
  }
} satisfies Record<ModelEndpointFormat, ProviderFormatAdapter>

export function providerFormatAdapter(format: ModelEndpointFormat): ProviderFormatAdapter {
  return FORMAT_ADAPTERS[format]
}

export function providerProbeHeaders(format: ModelEndpointFormat, apiKey: string): Record<string, string> {
  return providerFormatAdapter(format).authHeaders(apiKey)
}

export function adapterAuthHeaders(format: ModelEndpointFormat, apiKey: string): Record<string, string> {
  return providerFormatAdapter(format).requestHeaders(apiKey)
}

export function toolsSupportedForFormat(format: ModelEndpointFormat): boolean {
  return providerFormatAdapter(format).toolsSupported
}

export function modelListProbeSupportedForFormat(format: ModelEndpointFormat): boolean {
  return providerFormatAdapter(format).probeSupported
}


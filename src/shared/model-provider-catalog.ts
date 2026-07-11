import type {
  ModelEndpointFormat,
  ModelReasoningEffort,
  TeachingModelProviderPreset,
  TeachingModelProviderProfile
} from './teaching-types/settings'

export type ModelCatalogModality = 'text' | 'image' | 'audio' | 'video'

export type ModelReasoningProtocol =
  | 'anthropic'
  | 'deepseek'
  | 'minimax_openai'
  | 'openai'

export type ModelProviderCatalogModel = {
  id: string
  name?: string
  endpointFormats?: ModelEndpointFormat[]
  inputModalities: ModelCatalogModality[]
  outputModalities: ModelCatalogModality[]
  contextWindowTokens?: number
  maxOutputTokens?: number
  reasoning?: {
    efforts: ModelReasoningEffort[]
    protocol: ModelReasoningProtocol
  }
}

export type ModelProviderCatalogEntry = {
  id: string
  name: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  docsUrl: string
  apiKeyUrl: string
  models: ModelProviderCatalogModel[]
}

export type ModelCapabilityLookup = {
  providerId?: string
  providerBaseUrl?: string
  modelId: string
}

export type ResolvedModelCapability = {
  provider: ModelProviderCatalogEntry
  model: ModelProviderCatalogModel
}

const TEXT_ONLY = {
  inputModalities: ['text'],
  outputModalities: ['text']
} as const satisfies Pick<ModelProviderCatalogModel, 'inputModalities' | 'outputModalities'>

const TEXT_IMAGE = {
  inputModalities: ['text', 'image'],
  outputModalities: ['text']
} as const satisfies Pick<ModelProviderCatalogModel, 'inputModalities' | 'outputModalities'>

const TEXT_IMAGE_AUDIO_VIDEO = {
  inputModalities: ['text', 'image', 'audio', 'video'],
  outputModalities: ['text']
} as const satisfies Pick<ModelProviderCatalogModel, 'inputModalities' | 'outputModalities'>

export const MODEL_PROVIDER_CATALOG = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    endpointFormat: 'chat_completions',
    docsUrl: 'https://api-docs.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      {
        id: 'deepseek-v4-pro',
        ...TEXT_ONLY,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
        reasoning: { protocol: 'deepseek', efforts: ['auto', 'high', 'max'] }
      },
      {
        id: 'deepseek-v4-flash',
        ...TEXT_ONLY,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
        reasoning: { protocol: 'deepseek', efforts: ['auto', 'high', 'max'] }
      }
    ]
  },
  {
    id: 'glm',
    name: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    endpointFormat: 'chat_completions',
    docsUrl: 'https://docs.bigmodel.cn',
    apiKeyUrl: 'https://www.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    models: [
      {
        id: 'glm-4.5',
        ...TEXT_ONLY,
        contextWindowTokens: 131_072,
        maxOutputTokens: 98_304
      },
      {
        id: 'glm-4.5-air',
        ...TEXT_ONLY,
        contextWindowTokens: 131_072,
        maxOutputTokens: 98_304
      },
      {
        id: 'glm-4-flash',
        ...TEXT_ONLY,
        contextWindowTokens: 131_072,
        maxOutputTokens: 16_384
      }
    ]
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    endpointFormat: 'chat_completions',
    docsUrl: 'https://platform.xiaomimimo.com/#/docs',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    models: [
      {
        id: 'mimo-v2.5-pro-ultraspeed',
        ...TEXT_ONLY,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 131_072,
        reasoning: { protocol: 'openai', efforts: ['auto', 'off', 'low', 'medium', 'high'] }
      },
      {
        id: 'mimo-v2.5-pro',
        ...TEXT_ONLY,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 131_072,
        reasoning: { protocol: 'openai', efforts: ['auto', 'off', 'low', 'medium', 'high'] }
      },
      {
        id: 'mimo-v2.5',
        ...TEXT_IMAGE_AUDIO_VIDEO,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 131_072,
        reasoning: { protocol: 'openai', efforts: ['auto', 'off', 'low', 'medium', 'high'] }
      },
      {
        id: 'mimo-v2-omni',
        ...TEXT_IMAGE_AUDIO_VIDEO,
        contextWindowTokens: 262_144,
        maxOutputTokens: 131_072
      }
    ]
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    endpointFormat: 'messages',
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-anthropic-api',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    models: [
      {
        id: 'MiniMax-M3',
        inputModalities: ['text', 'image', 'video'],
        outputModalities: ['text'],
        contextWindowTokens: 1_000_000
      },
      {
        id: 'MiniMax-M2.7',
        ...TEXT_ONLY,
        contextWindowTokens: 204_800
      },
      {
        id: 'MiniMax-M2.5',
        ...TEXT_ONLY,
        contextWindowTokens: 204_800
      }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    endpointFormat: 'messages',
    docsUrl: 'https://platform.claude.com/docs',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      {
        id: 'claude-opus-4-8',
        ...TEXT_IMAGE,
        contextWindowTokens: 200_000,
        maxOutputTokens: 32_000,
        reasoning: { protocol: 'anthropic', efforts: ['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'] }
      },
      {
        id: 'claude-opus-4-7',
        ...TEXT_IMAGE,
        contextWindowTokens: 200_000,
        maxOutputTokens: 32_000,
        reasoning: { protocol: 'anthropic', efforts: ['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'] }
      },
      {
        id: 'claude-opus-4-6',
        ...TEXT_IMAGE,
        contextWindowTokens: 200_000,
        maxOutputTokens: 32_000,
        reasoning: { protocol: 'anthropic', efforts: ['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'] }
      },
      {
        id: 'claude-sonnet-4-6',
        ...TEXT_IMAGE,
        contextWindowTokens: 200_000,
        maxOutputTokens: 32_000,
        reasoning: { protocol: 'anthropic', efforts: ['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'] }
      },
      {
        id: 'claude-haiku-4-5',
        ...TEXT_IMAGE,
        contextWindowTokens: 200_000,
        maxOutputTokens: 32_000,
        reasoning: { protocol: 'anthropic', efforts: ['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'] }
      }
    ]
  },
  {
    id: 'custom',
    name: 'OpenAI Compatible',
    baseUrl: '',
    endpointFormat: 'chat_completions',
    docsUrl: '',
    apiKeyUrl: '',
    models: []
  }
] as const satisfies ModelProviderCatalogEntry[]

export const TEACHING_MODEL_PROVIDER_PRESETS_FROM_CATALOG = MODEL_PROVIDER_CATALOG.map((provider) => ({
  id: provider.id,
  name: provider.name,
  baseUrl: provider.baseUrl,
  endpointFormat: provider.endpointFormat,
  models: provider.models.map((model) => model.id),
  docsUrl: provider.docsUrl,
  apiKeyUrl: provider.apiKeyUrl
})) satisfies TeachingModelProviderPreset[]

export function findModelProviderCatalogEntry(providerId: string): ModelProviderCatalogEntry | null {
  const id = canonicalProviderId(providerId)
  return MODEL_PROVIDER_CATALOG.find((provider) => provider.id === id) ?? null
}

export function resolveModelCapability(input: ModelCapabilityLookup): ResolvedModelCapability | null {
  const modelId = normalizeModelId(input.modelId)
  if (!modelId) return null

  const providers = candidateProviders(input)
  for (const provider of providers) {
    const model = provider.models.find((item) => normalizeModelId(item.id) === modelId)
    if (model) return { provider, model }
  }

  for (const provider of MODEL_PROVIDER_CATALOG) {
    const model = provider.models.find((item) => normalizeModelId(item.id) === modelId)
    if (model) return { provider, model }
  }
  return null
}

export function modelReasoningEffortsForProviderModel(input: ModelCapabilityLookup): ModelReasoningEffort[] | null {
  const resolved = resolveModelCapability(input)
  if (resolved?.model.reasoning?.efforts.length) return [...resolved.model.reasoning.efforts]
  return null
}

export function modelReasoningProtocolForProviderModel(input: ModelCapabilityLookup): ModelReasoningProtocol | null {
  const resolved = resolveModelCapability(input)
  return resolved?.model.reasoning?.protocol ?? null
}

export function modelContextWindowTokens(input: ModelCapabilityLookup): number | null {
  const contextWindowTokens = resolveModelCapability(input)?.model.contextWindowTokens
  return positiveIntegerOrNull(contextWindowTokens)
}

export function modelMaxOutputTokens(input: ModelCapabilityLookup): number | null {
  const maxOutputTokens = resolveModelCapability(input)?.model.maxOutputTokens
  return positiveIntegerOrNull(maxOutputTokens)
}

export function effectiveMaxOutputTokens(
  provider: TeachingModelProviderProfile,
  modelId: string,
  requestedMaxOutputTokens: number
): number {
  const requested = positiveIntegerOrNull(requestedMaxOutputTokens) ?? 1
  const catalogLimit = modelMaxOutputTokens({
    providerId: provider.id,
    providerBaseUrl: provider.baseUrl,
    modelId
  })
  return catalogLimit ? Math.min(requested, catalogLimit) : requested
}

function candidateProviders(input: ModelCapabilityLookup): ModelProviderCatalogEntry[] {
  const candidates: ModelProviderCatalogEntry[] = []
  if (input.providerId) {
    const byId = findModelProviderCatalogEntry(input.providerId)
    if (byId) candidates.push(byId)
  }
  const providerHost = hostFromUrl(input.providerBaseUrl)
  if (providerHost) {
    for (const provider of MODEL_PROVIDER_CATALOG) {
      const catalogHost = hostFromUrl(provider.baseUrl)
      if (!catalogHost || providerHost !== catalogHost) continue
      if (!candidates.some((item) => item.id === provider.id)) candidates.push(provider)
    }
  }
  return candidates
}

function canonicalProviderId(providerId: string): string {
  switch (providerId.trim().toLowerCase()) {
    case 'bigmodel':
    case 'bigmodel-coding-plan':
      return 'glm'
    case 'xiaomi-mimo':
      return 'xiaomi'
    default:
      return providerId.trim().toLowerCase()
  }
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function hostFromUrl(value: string | undefined): string {
  if (!value) return ''
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

import type {
  ListUpstreamModelsResult,
  ModelEndpointFormat,
  ProbeProviderPayload,
  ProbeProviderResult,
  TeachingModelProviderProfile
} from '../shared/teaching-types'
import {
  upstreamAnthropicMessagesUrl,
  upstreamOpenAiCustomEndpointUrl,
  upstreamOpenAiModelsUrl
} from '../shared/openai-compat-url'
import { fetchWithOptionalProxy } from './proxy-fetch'

const PROBE_TIMEOUT_MS = 10_000
const DIRECT_PROBE_TIMEOUT_MS = 5_000
const ANTHROPIC_VERSION = '2023-06-01'

type ProviderProbeFetch = typeof fetchWithOptionalProxy

/**
 * Auth headers per endpoint format — ported from Kun. Anthropic Messages
 * uses `x-api-key` + `anthropic-version`; everything else uses `Bearer`.
 */
export function providerProbeHeaders(
  endpointFormat: ModelEndpointFormat,
  apiKey: string
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = apiKey.trim()
  if (endpointFormat === 'messages') {
    headers['anthropic-version'] = ANTHROPIC_VERSION
    if (key) headers['x-api-key'] = key
    return headers
  }
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

function isCustomEndpointFormat(format: ModelEndpointFormat): boolean {
  return format === 'custom_endpoint'
}

/**
 * Probe a model provider by listing its models endpoint. Runs in the main
 * process so the API key never leaves it and renderer CORS does not apply.
 */
export async function probeModelProvider(
  request: ProbeProviderPayload,
  proxyUrl: string,
  fetcher: ProviderProbeFetch = fetchWithOptionalProxy
): Promise<ProbeProviderResult> {
  const baseUrl = request.baseUrl.trim()
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, message: 'Base URL 必须以 http:// 或 https:// 开头。' }
  }
  if (isCustomEndpointFormat(request.endpointFormat)) {
    return {
      ok: false,
      message: 'Custom endpoint 模式不支持 /models 探测，请手动添加模型 ID。'
    }
  }

  const url = modelsUrlFor(request.endpointFormat, baseUrl)
  const startedAt = Date.now()
  let res: Response
  let text: string
  try {
    res = await fetcher(
      url,
      {
        method: 'GET',
        headers: providerProbeHeaders(request.endpointFormat, request.apiKey),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      },
      proxyUrl
    )
    text = await res.text()
  } catch (e) {
    const message = providerProbeFailureMessage(e, url)
    if (
      proxyUrl &&
      (await directProviderReachable(url, request.endpointFormat, request.apiKey, fetcher))
    ) {
      return {
        ok: false,
        message: `${message} 代理请求失败，但直连可达。请在 设置 > 模型 中关闭或修正代理。`
      }
    }
    return { ok: false, message }
  }

  const latencyMs = Date.now() - startedAt
  if (!res.ok) {
    return {
      ok: false,
      message: `Provider 返回 ${res.status} ${res.statusText}${truncateBody(text)}`
    }
  }

  const modelIds = parseModelIds(text, request.endpointFormat)
  if (modelIds.length === 0) {
    return { ok: false, message: '连接成功，但未解析到任何模型 ID。' }
  }
  return { ok: true, latencyMs, modelIds }
}

/** Fetch the model list for a configured provider (Settings > 模型 > 拉取模型列表). */
export async function fetchUpstreamModels(
  provider: TeachingModelProviderProfile,
  proxyUrl: string,
  fetcher: ProviderProbeFetch = fetchWithOptionalProxy
): Promise<ListUpstreamModelsResult> {
  const result = await probeModelProvider(
    {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      endpointFormat: provider.endpointFormat
    },
    proxyUrl,
    fetcher
  )
  if (!result.ok) return { ok: false, message: result.message }
  return { ok: true, modelIds: result.modelIds }
}

function modelsUrlFor(endpointFormat: ModelEndpointFormat, baseUrl: string): string {
  // Anthropic Messages providers (e.g. MiniMax /anthropic) expose a models list
  // under the OpenAI-compat path too, but their native base differs. We probe
  // the OpenAI-compat /models first; if the base is the anthropic endpoint we
  // fall back to GET on the messages base root which some gateways support.
  if (endpointFormat === 'messages') {
    return upstreamOpenAiModelsUrl(baseUrl)
  }
  return upstreamOpenAiModelsUrl(baseUrl)
}

function parseModelIds(body: string, endpointFormat: ModelEndpointFormat): string[] {
  try {
    const parsed = JSON.parse(body) as unknown
    if (endpointFormat === 'messages' && parsed && typeof parsed === 'object') {
      const data = (parsed as { data?: unknown }).data
      if (Array.isArray(data)) {
        return data
          .map((item) => (typeof item === 'string' ? item : (item as { id?: string })?.id ?? ''))
          .filter((id): id is string => Boolean(id) && typeof id === 'string')
      }
      // Anthropic-style `{ "models": [{ "id": "..." }] }`
      const models = (parsed as { models?: unknown }).models
      if (Array.isArray(models)) {
        return models
          .map((item) => (item as { id?: string })?.id ?? '')
          .filter((id): id is string => Boolean(id))
      }
    }
    if (parsed && typeof parsed === 'object') {
      const data = (parsed as { data?: unknown }).data
      if (Array.isArray(data)) {
        return data
          .map((item) => (typeof item === 'string' ? item : (item as { id?: string })?.id ?? ''))
          .filter((id): id is string => Boolean(id) && typeof id === 'string')
      }
    }
  } catch {
    // fall through
  }
  return []
}

function providerProbeFailureMessage(error: unknown, url: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/aborted|timeout/i.test(raw)) {
    return `连接超时（${PROBE_TIMEOUT_MS / 1000}s）。请检查 Base URL、网络或代理设置。`
  }
  return `无法连接到 provider：${raw}`
}

async function directProviderReachable(
  url: string,
  endpointFormat: ModelEndpointFormat,
  apiKey: string,
  fetcher: ProviderProbeFetch
): Promise<boolean> {
  try {
    const res = await fetcher(
      url,
      {
        method: 'GET',
        headers: providerProbeHeaders(endpointFormat, apiKey),
        signal: AbortSignal.timeout(DIRECT_PROBE_TIMEOUT_MS)
      },
      ''
    )
    return res.status >= 200 && res.status < 500
  } catch {
    return false
  }
}

function truncateBody(body: string): string {
  const trimmed = body.trim().slice(0, 200)
  return trimmed ? `：${trimmed}` : ''
}

export { upstreamAnthropicMessagesUrl, upstreamOpenAiCustomEndpointUrl }

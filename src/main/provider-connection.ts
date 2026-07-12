import type {
  ListUpstreamModelsResult,
  ModelEndpointFormat,
  ProbeProviderPayload,
  ProbeProviderResult
} from '../shared/teaching-types'
import { fetchWithOptionalProxy } from './proxy-fetch'
import { providerFormatAdapter, providerProbeHeaders } from '../shared/provider-format'
import { validateProviderRequestUrl } from '../shared/provider-url-policy'
import { redactProviderErrorText } from '../shared/provider-error'

export { providerProbeHeaders } from '../shared/provider-format'

const PROBE_TIMEOUT_MS = 10_000
const DIRECT_PROBE_TIMEOUT_MS = 5_000

type ProviderProbeFetch = typeof fetchWithOptionalProxy

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
  const policy = validateProviderRequestUrl(baseUrl)
  if (!policy.ok) return { ok: false, message: policy.message }
  const format = providerFormatAdapter(request.endpointFormat)
  if (!format.probeSupported) {
    return {
      ok: false,
      message: format.unsupportedProbeMessage ?? '当前端点格式不支持 /models 探测，请手动添加模型 ID。'
    }
  }

  const url = format.modelsUrl(baseUrl)
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
      (await directProviderReachable(url, request.endpointFormat, fetcher))
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

  const modelIds = format.parseModelIds(text)
  if (modelIds.length === 0) {
    return { ok: false, message: '连接成功，但未解析到任何模型 ID。' }
  }
  return { ok: true, latencyMs, modelIds }
}

/** Fetch the model list for a configured provider (Settings > 模型 > 拉取模型列表). */
export async function fetchUpstreamModels(
  provider: ProbeProviderPayload,
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

function providerProbeFailureMessage(error: unknown, url: string): string {
  const raw = redactProviderErrorText(error instanceof Error ? error.message : String(error))
  if (/aborted|timeout/i.test(raw)) {
    return `连接超时（${PROBE_TIMEOUT_MS / 1000}s）。请检查 Base URL、网络或代理设置。`
  }
  return `无法连接到 provider：${raw}`
}

async function directProviderReachable(
  url: string,
  endpointFormat: ModelEndpointFormat,
  fetcher: ProviderProbeFetch
): Promise<boolean> {
  try {
    const res = await fetcher(
      url,
      {
        method: 'GET',
        headers: providerProbeHeaders(endpointFormat, ''),
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
  const trimmed = redactProviderErrorText(body).trim().slice(0, 200)
  return trimmed ? `：${trimmed}` : ''
}

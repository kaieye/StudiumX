export type ProviderUrlPolicyResult =
  | { ok: true; url: URL }
  | { ok: false; message: string }

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const SENSITIVE_URL_PARAMS = /(?:^|[?&#;])(?:api[_-]?key|apikey|access[_-]?token|token|key|secret|authorization)=/i

/**
 * Provider requests carry API keys. By default they must use HTTPS; plain HTTP
 * is only allowed for explicit local development endpoints where the traffic
 * stays on the loopback interface.
 */
export function validateProviderRequestUrl(rawUrl: string): ProviderUrlPolicyResult {
  const trimmed = rawUrl.trim()
  if (!trimmed) return { ok: false, message: 'Base URL 不能为空。' }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, message: 'Base URL 不是有效 URL。' }
  }

  if (url.username || url.password) {
    return { ok: false, message: 'Base URL 不应包含用户名或密码。请改用系统代理或专用认证设置。' }
  }

  if (SENSITIVE_URL_PARAMS.test(`${url.search}${url.hash}`)) {
    return { ok: false, message: 'Base URL 不应把 API key、token 或 secret 放在 query/hash 中。请使用模型配置里的 API Key 字段。' }
  }

  if (url.protocol === 'https:') return { ok: true, url }

  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return { ok: true, url }

  if (url.protocol === 'http:') {
    return {
      ok: false,
      message: '远程 provider Base URL 默认必须使用 HTTPS。HTTP 仅允许 localhost / 127.0.0.1 / [::1] 本地开发例外，避免 API Key 明文传输。'
    }
  }

  return { ok: false, message: 'Base URL 必须使用 https://；本地开发可使用 http://localhost。' }
}

export function assertProviderRequestUrl(rawUrl: string): void {
  const result = validateProviderRequestUrl(rawUrl)
  if (!result.ok) throw new Error(result.message)
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (LOCAL_HTTP_HOSTS.has(normalized)) return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

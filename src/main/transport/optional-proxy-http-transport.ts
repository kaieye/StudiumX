import { fetchDirect } from './direct-fetch-adapter'
import { fetchThroughProxy } from './proxy-request-adapter'

/**
 * Fetch over the configured proxy only when one is present. Callers own the
 * policy decision to supply a proxy URL; transport selection stays here.
 */
export async function requestWithOptionalProxy(
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
): Promise<Response> {
  const normalizedProxyUrl = proxyUrl.trim()
  return normalizedProxyUrl
    ? fetchThroughProxy(input, init, normalizedProxyUrl)
    : fetchDirect(input, init)
}
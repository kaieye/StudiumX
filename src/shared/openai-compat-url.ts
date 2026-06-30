/**
 * OpenAI-compatible URL builders — ported from Kun so `/beta` and unversioned
 * bases still resolve to `/v1/...` endpoints. Shared so main + renderer can
 * construct provider URLs consistently.
 */

function splitUrlSuffix(url: string): { path: string; suffix: string } {
  const query = url.search(/[?#]/)
  if (query < 0) return { path: url, suffix: '' }
  return { path: url.slice(0, query), suffix: url.slice(query) }
}

function appendUrlPath(baseUrl: string, path: string): string {
  const split = splitUrlSuffix(baseUrl)
  return `${split.path.replace(/\/+$/, '')}/${path}${split.suffix}`
}

function trimUrlPathEnd(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl.trim())
  return `${split.path.replace(/\/+$/, '')}${split.suffix}`
}

function lastPathSegment(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl.trim())
  return split.path.replace(/\/+$/, '').split('/').pop() ?? ''
}

function isVersionSegment(segment: string): boolean {
  const s = segment.toLowerCase()
  if (s === 'beta') return true
  return /^v\d+$/i.test(s)
}

function unversionedBaseUrl(baseUrl: string): string {
  const split = splitUrlSuffix(baseUrl)
  const trimmed = split.path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash < 0) return `${trimmed}${split.suffix}`
  const seg = trimmed.slice(slash + 1)
  if (isVersionSegment(seg)) return `${trimmed.slice(0, slash)}${split.suffix}`
  return `${trimmed}${split.suffix}`
}

function versionedBaseUrl(baseUrl: string): string {
  const trimmed = trimUrlPathEnd(baseUrl)
  const seg = lastPathSegment(trimmed)
  if (isVersionSegment(seg)) return trimmed
  return appendUrlPath(trimmed, 'v1')
}

export function upstreamOpenAiModelsUrl(baseUrl: string): string {
  const endpointBase = baseUrl.trim()
  let versioned = versionedBaseUrl(endpointBase)
  if (lastPathSegment(versioned).toLowerCase() === 'beta') {
    versioned = appendUrlPath(unversionedBaseUrl(endpointBase), 'v1')
  }
  return appendUrlPath(versioned, 'models')
}

export function upstreamOpenAiChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  let versioned = versionedBaseUrl(trimmed)
  if (lastPathSegment(versioned).toLowerCase() === 'beta') {
    versioned = appendUrlPath(unversionedBaseUrl(trimmed), 'v1')
  }
  return appendUrlPath(versioned, 'chat/completions')
}

export function upstreamOpenAiResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  let versioned = versionedBaseUrl(trimmed)
  if (lastPathSegment(versioned).toLowerCase() === 'beta') {
    versioned = appendUrlPath(unversionedBaseUrl(trimmed), 'v1')
  }
  return appendUrlPath(versioned, 'responses')
}

export function upstreamOpenAiCustomEndpointUrl(baseUrl: string): string {
  return trimUrlPathEnd(baseUrl)
}

/**
 * Anthropic Messages endpoint. Bases like `https://api.minimaxi.com/anthropic`
 * or `https://api.anthropic.com` resolve to `.../v1/messages`. If the base
 * already ends in a version segment, the path is appended directly.
 */
export function upstreamAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = trimUrlPathEnd(baseUrl)
  const seg = lastPathSegment(trimmed)
  if (isVersionSegment(seg)) return appendUrlPath(trimmed, 'messages')
  return appendUrlPath(trimmed, 'v1/messages')
}

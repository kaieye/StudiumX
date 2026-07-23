import { Buffer } from 'node:buffer'

import {
  DEFAULT_MCP_RESULT_LIMITS,
  type McpArtifactKind,
  type McpArtifactReference,
  type McpNormalizedArtifactContent,
  type McpNormalizedContent,
  type McpNormalizedResourceLinkContent,
  type McpNormalizedStructuredContent,
  type McpNormalizedToolResult,
  type McpRawToolResult,
  type McpResultLimits,
  type McpResultNormalizerOptions
} from '../../shared/mcp/result-types'

const MAX_SAFE_JSON_DEPTH = 12
const MAX_SAFE_JSON_PROPERTIES = 80
const MAX_SAFE_JSON_ARRAY_ITEMS = 80
const MAX_SAFE_JSON_STRING_CHARS = 4_096
const URL_CREDENTIAL_QUERY_KEY = /(?:access[_-]?token|api[_-]?key|auth(?:orization)?|credential|key|password|secret|sig(?:nature)?|token)/i

/**
 * Normalize an untrusted MCP result into a closed, bounded model-facing shape.
 *
 * It is intentionally independent of the MCP transport, session manager,
 * registry, dispatcher, ledger, and renderer. Supplying an artifactWriter is
 * the only side-effecting dependency; without one the function remains pure
 * and returns a bounded omission summary for binary/encoded payloads.
 */
export async function normalizeMcpToolResult(
  input: McpRawToolResult,
  options: McpResultNormalizerOptions = {}
): Promise<McpNormalizedToolResult> {
  const limits = resolveLimits(options.limits)
  const artifacts: McpArtifactReference[] = []
  const context: NormalizeContext = {
    limits,
    artifactWriter: options.artifactWriter,
    artifacts,
    sourceByteCount: 0,
    truncated: false,
    spilled: false
  }

  const content: McpNormalizedContent[] = []
  const rawEntries = toContentEntries(input.content)
  const entriesToProcess = rawEntries.slice(0, limits.maxContentEntries)
  if (rawEntries.length > entriesToProcess.length) context.truncated = true

  for (const entry of entriesToProcess) {
    content.push(await normalizeContentEntry(entry, context))
  }

  const structuredContent =
    input.structuredContent === undefined
      ? undefined
      : normalizeStructuredContent(input.structuredContent, context)

  const modelTextResult = buildModelText(content, structuredContent, limits.maxModelTextChars)
  if (modelTextResult.truncated) context.truncated = true

  const isError = input.isError === true
  return {
    status: isError ? 'failed' : 'succeeded',
    isError,
    ...(isError ? { errorCode: 'mcp_application_error' as const } : {}),
    content,
    ...(structuredContent ? { structuredContent } : {}),
    modelText: modelTextResult.text,
    byteCount: context.sourceByteCount,
    truncated: context.truncated,
    spilled: context.spilled,
    artifactRefs: artifacts
  }
}

type NormalizeContext = {
  limits: McpResultLimits
  artifactWriter: McpResultNormalizerOptions['artifactWriter']
  artifacts: McpArtifactReference[]
  sourceByteCount: number
  truncated: boolean
  spilled: boolean
}

async function normalizeContentEntry(
  entry: unknown,
  context: NormalizeContext
): Promise<McpNormalizedContent> {
  if (typeof entry === 'string') return normalizeStringEntry(entry, context)
  if (isBytes(entry)) return spillBytes('binary', entry, undefined, context)
  if (!isRecord(entry)) return unknownContent('Unsupported MCP content value.')

  const type = typeof entry.type === 'string' ? entry.type : ''
  switch (type) {
    case 'text':
      return typeof entry.text === 'string'
        ? normalizeStringEntry(entry.text, context)
        : unknownContent('MCP text content did not contain text.')
    case 'resource_link':
      return normalizeResourceLink(entry)
    case 'image':
      return normalizeEncodedContent('image', entry.data, entry.mimeType, context)
    case 'audio':
      return normalizeEncodedContent('audio', entry.data, entry.mimeType, context)
    case 'resource':
      return normalizeEmbeddedResource(entry.resource, context)
    default:
      return unknownContent(
        type ? `Unsupported MCP content type “${safeLabel(type)}”.` : 'Unsupported MCP content block.'
      )
  }
}

async function normalizeStringEntry(
  value: string,
  context: NormalizeContext
): Promise<McpNormalizedContent> {
  context.sourceByteCount = addBounded(context.sourceByteCount, Buffer.byteLength(value, 'utf8'))
  const dataUrl = decodeDataUrl(value, context.limits.maxArtifactBytes)
  if (dataUrl.kind === 'decoded') {
    return spillBytes('binary', dataUrl.bytes, dataUrl.mediaType, context)
  }
  if (dataUrl.kind === 'over_limit') {
    context.truncated = true
    return omittedArtifact('binary', dataUrl.mediaType, 'MCP data URL omitted because it exceeds the artifact limit.')
  }
  if (dataUrl.kind === 'invalid') {
    context.truncated = true
    return omittedArtifact('binary', undefined, 'Invalid MCP data URL was omitted.')
  }

  // A large bare base64 value is data, not useful model text. Deliberately do
  // not decode short ordinary words that happen to fit the alphabet.
  const base64 = decodeBase64(value, context.limits.maxArtifactBytes, 256)
  if (base64.kind === 'decoded') return spillBytes('binary', base64.bytes, undefined, context)
  if (base64.kind === 'over_limit') {
    context.truncated = true
    return omittedArtifact('binary', undefined, 'MCP base64 payload omitted because it exceeds the artifact limit.')
  }

  const bounded = truncateText(value, context.limits.maxTextCharsPerEntry)
  if (bounded.truncated) context.truncated = true
  return { kind: 'text', text: bounded.text, truncated: bounded.truncated }
}

function normalizeResourceLink(entry: Record<string, unknown>): McpNormalizedResourceLinkContent {
  return {
    kind: 'resource_link',
    ...(typeof entry.uri === 'string' ? { uri: sanitizeResourceUri(entry.uri) } : {}),
    ...(typeof entry.name === 'string' ? { name: safeLabel(entry.name) } : {}),
    ...(typeof entry.mimeType === 'string' ? { mimeType: safeMediaType(entry.mimeType) } : {}),
    ...(typeof entry.description === 'string'
      ? { description: truncateText(safeLabel(entry.description), 240).text }
      : {}),
    fetched: false
  }
}

async function normalizeEncodedContent(
  kind: 'image' | 'audio',
  rawData: unknown,
  rawMediaType: unknown,
  context: NormalizeContext
): Promise<McpNormalizedContent> {
  const mediaType = typeof rawMediaType === 'string' ? safeMediaType(rawMediaType) : undefined
  if (isBytes(rawData)) return spillBytes(kind, rawData, mediaType, context)
  if (typeof rawData !== 'string') {
    return omittedArtifact(kind, mediaType, `MCP ${kind} content was missing encoded bytes.`)
  }

  context.sourceByteCount = addBounded(context.sourceByteCount, rawData.length)
  const decoded = decodeBase64(rawData, context.limits.maxArtifactBytes, 0)
  if (decoded.kind === 'decoded') return spillBytes(kind, decoded.bytes, mediaType, context)
  context.truncated = true
  return omittedArtifact(
    kind,
    mediaType,
    decoded.kind === 'over_limit'
      ? `MCP ${kind} bytes omitted because they exceed the artifact limit.`
      : `Invalid MCP ${kind} encoding was omitted.`
  )
}

async function normalizeEmbeddedResource(
  rawResource: unknown,
  context: NormalizeContext
): Promise<McpNormalizedContent> {
  if (!isRecord(rawResource)) return unknownContent('MCP resource content did not contain a resource object.')
  const mediaType = typeof rawResource.mimeType === 'string' ? safeMediaType(rawResource.mimeType) : undefined

  if (isBytes(rawResource.blob)) return spillBytes('resource', rawResource.blob, mediaType, context)
  if (typeof rawResource.blob === 'string') {
    context.sourceByteCount = addBounded(context.sourceByteCount, rawResource.blob.length)
    const decoded = decodeBase64(rawResource.blob, context.limits.maxArtifactBytes, 0)
    if (decoded.kind === 'decoded') return spillBytes('resource', decoded.bytes, mediaType, context)
    context.truncated = true
    return omittedArtifact(
      'resource',
      mediaType,
      decoded.kind === 'over_limit'
        ? 'MCP resource bytes omitted because they exceed the artifact limit.'
        : 'Invalid MCP resource byte encoding was omitted.'
    )
  }

  if (typeof rawResource.text === 'string') {
    context.sourceByteCount = addBounded(context.sourceByteCount, Buffer.byteLength(rawResource.text, 'utf8'))
    const bytes = Buffer.from(rawResource.text, 'utf8')
    if (bytes.byteLength > context.limits.maxArtifactBytes) {
      context.truncated = true
      return omittedArtifact('resource', mediaType, 'MCP resource text omitted because it exceeds the artifact limit.')
    }
    if (rawResource.text.length > context.limits.maxTextCharsPerEntry) {
      return spillBytes('resource', bytes, mediaType ?? 'text/plain', context)
    }
    const bounded = truncateText(rawResource.text, context.limits.maxTextCharsPerEntry)
    if (bounded.truncated) context.truncated = true
    return { kind: 'text', text: bounded.text, truncated: bounded.truncated }
  }

  // An embedded resource without bytes is still a resource link, never a fetch.
  return {
    kind: 'resource_link',
    ...(typeof rawResource.uri === 'string' ? { uri: sanitizeResourceUri(rawResource.uri) } : {}),
    ...(mediaType ? { mimeType: mediaType } : {}),
    fetched: false
  }
}

async function spillBytes(
  kind: McpArtifactKind,
  bytes: Uint8Array,
  mediaType: string | undefined,
  context: NormalizeContext
): Promise<McpNormalizedArtifactContent> {
  context.sourceByteCount = addBounded(context.sourceByteCount, bytes.byteLength)
  if (bytes.byteLength > context.limits.maxArtifactBytes) {
    context.truncated = true
    return omittedArtifact(kind, mediaType, `MCP ${kind} bytes omitted because they exceed the artifact limit.`)
  }
  if (!context.artifactWriter) {
    context.truncated = true
    return omittedArtifact(kind, mediaType, `MCP ${kind} bytes were omitted because local artifact storage is unavailable.`)
  }

  try {
    const artifact = await context.artifactWriter.writeArtifact({
      kind,
      bytes,
      ...(mediaType ? { mediaType } : {})
    })
    context.artifacts.push(artifact)
    context.spilled = true
    return {
      kind,
      ...(mediaType ? { mediaType } : {}),
      artifact,
      omitted: false,
      summary: artifact.summary
    }
  } catch {
    context.truncated = true
    return omittedArtifact(kind, mediaType, `MCP ${kind} bytes could not be saved locally and were omitted.`)
  }
}

function omittedArtifact(
  kind: McpArtifactKind,
  mediaType: string | undefined,
  summary: string
): McpNormalizedArtifactContent {
  return { kind, ...(mediaType ? { mediaType } : {}), omitted: true, summary }
}

function unknownContent(summary: string): McpNormalizedContent {
  return { kind: 'unknown', summary }
}

function normalizeStructuredContent(
  value: unknown,
  context: NormalizeContext
): McpNormalizedStructuredContent {
  const serialized = safeJson(value, context.limits.maxStructuredJsonChars)
  context.sourceByteCount = addBounded(context.sourceByteCount, Buffer.byteLength(serialized.sourceJson, 'utf8'))
  if (serialized.truncated) context.truncated = true
  return { json: serialized.json, truncated: serialized.truncated }
}

function buildModelText(
  content: readonly McpNormalizedContent[],
  structuredContent: McpNormalizedStructuredContent | undefined,
  maxChars: number
): Readonly<{ text: string; truncated: boolean }> {
  const parts: string[] = []
  for (const entry of content) {
    switch (entry.kind) {
      case 'text':
        parts.push(entry.text)
        break
      case 'resource_link':
        parts.push(
          `[MCP resource link; not fetched${entry.name ? `: ${entry.name}` : ''}${entry.uri ? ` (${entry.uri})` : ''}]`
        )
        break
      case 'image':
      case 'audio':
      case 'resource':
      case 'binary':
        parts.push(
          entry.artifact
            ? `[MCP ${entry.kind} artifact: ${entry.artifact.id}; ${entry.artifact.summary}]`
            : `[${entry.summary}]`
        )
        break
      case 'unknown':
        parts.push(`[${entry.summary}]`)
        break
    }
  }
  if (structuredContent) parts.push(`[MCP structuredContent]\n${structuredContent.json}`)

  const joined = parts.filter(Boolean).join('\n\n')
  const bounded = truncateText(joined, maxChars)
  return bounded
}

function toContentEntries(content: unknown): readonly unknown[] {
  if (content === undefined || content === null) return []
  return Array.isArray(content) ? content : [content]
}

function resolveLimits(overrides: Partial<McpResultLimits> | undefined): McpResultLimits {
  return {
    maxContentEntries: positiveLimit(overrides?.maxContentEntries, DEFAULT_MCP_RESULT_LIMITS.maxContentEntries),
    maxTextCharsPerEntry: positiveLimit(
      overrides?.maxTextCharsPerEntry,
      DEFAULT_MCP_RESULT_LIMITS.maxTextCharsPerEntry
    ),
    maxStructuredJsonChars: positiveLimit(
      overrides?.maxStructuredJsonChars,
      DEFAULT_MCP_RESULT_LIMITS.maxStructuredJsonChars
    ),
    maxModelTextChars: positiveLimit(overrides?.maxModelTextChars, DEFAULT_MCP_RESULT_LIMITS.maxModelTextChars),
    maxArtifactBytes: positiveLimit(overrides?.maxArtifactBytes, DEFAULT_MCP_RESULT_LIMITS.maxArtifactBytes)
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback
}

function truncateText(value: string, maxChars: number): Readonly<{ text: string; truncated: boolean }> {
  if (value.length <= maxChars) return { text: value, truncated: false }
  const marker = '\n[truncated]'
  if (maxChars <= marker.length) return { text: marker.slice(0, maxChars), truncated: true }
  return { text: `${value.slice(0, maxChars - marker.length)}${marker}`, truncated: true }
}

function safeJson(value: unknown, maxChars: number): Readonly<{ json: string; sourceJson: string; truncated: boolean }> {
  let sourceJson = 'null'
  try {
    sourceJson =
      JSON.stringify(
        projectJson(value, new WeakSet<object>(), 0, {
          nodesRemaining: 512,
          stringCharsRemaining: Math.max(1_024, Math.min(maxChars * 4, 65_536))
        })
      ) ?? 'null'
  } catch {
    sourceJson = 'null'
  }
  if (sourceJson.length <= maxChars) return { json: sourceJson, sourceJson, truncated: false }

  const compact = '{"$truncated":true}'
  if (maxChars < compact.length) {
    return { json: smallestValidJson(maxChars), sourceJson, truncated: true }
  }
  let preview = sourceJson.slice(0, Math.max(0, maxChars - 48))
  let envelope = JSON.stringify({ $truncated: true, $preview: preview })
  while (envelope.length > maxChars && preview.length > 0) {
    preview = preview.slice(0, Math.max(0, preview.length - Math.ceil((envelope.length - maxChars) / 2)))
    envelope = JSON.stringify({ $truncated: true, $preview: preview })
  }
  return { json: envelope.length <= maxChars ? envelope : compact, sourceJson, truncated: true }
}

function smallestValidJson(maxChars: number): string {
  if (maxChars >= 4) return 'null'
  if (maxChars >= 2) return '[]'
  return '0'
}

type JsonProjectionBudget = {
  nodesRemaining: number
  stringCharsRemaining: number
}

function projectJson(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  budget: JsonProjectionBudget
): unknown {
  budget.nodesRemaining -= 1
  if (budget.nodesRemaining < 0) return '[value omitted by safety budget]'
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value === 'string' ? boundedJsonString(value, budget) : value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return null
  if (isBytes(value)) return `[binary ${value.byteLength} bytes omitted]`
  if (depth >= MAX_SAFE_JSON_DEPTH) return '[max depth]'
  if (!isRecord(value) && !Array.isArray(value)) return '[unsupported value]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_SAFE_JSON_ARRAY_ITEMS)
      .map((entry) => projectJson(entry, seen, depth + 1, budget))
    if (value.length > result.length) result.push(`[${value.length - result.length} array items omitted]`)
    return result
  }

  const projected: Record<string, unknown> = {}
  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return '[uninspectable object]'
  }
  for (const key of keys.slice(0, MAX_SAFE_JSON_PROPERTIES)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) {
      projected[boundedJsonKey(key, budget)] = '[accessor omitted]'
      continue
    }
    projected[boundedJsonKey(key, budget)] = projectJson(descriptor.value, seen, depth + 1, budget)
  }
  if (keys.length > MAX_SAFE_JSON_PROPERTIES) {
    projected.$omittedProperties = keys.length - MAX_SAFE_JSON_PROPERTIES
  }
  return projected
}

function decodeDataUrl(
  value: string,
  maxBytes: number
):
  | Readonly<{ kind: 'not_data_url' }>
  | Readonly<{ kind: 'decoded'; bytes: Buffer; mediaType?: string }>
  | Readonly<{ kind: 'over_limit'; mediaType?: string }>
  | Readonly<{ kind: 'invalid' }> {
  if (!value.startsWith('data:')) return { kind: 'not_data_url' }
  const comma = value.indexOf(',')
  if (comma < 5) return { kind: 'invalid' }
  const metadata = value.slice(5, comma)
  const payload = value.slice(comma + 1)
  const mediaType = safeMediaType(metadata.split(';', 1)[0] ?? '')
  if (/;base64(?:;|$)/i.test(metadata)) {
    const decoded = decodeBase64(payload, maxBytes, 0)
    if (decoded.kind === 'decoded') return { kind: 'decoded', bytes: decoded.bytes, ...(mediaType ? { mediaType } : {}) }
    return decoded.kind === 'over_limit'
      ? { kind: 'over_limit', ...(mediaType ? { mediaType } : {}) }
      : { kind: 'invalid' }
  }
  // Percent-encoded data URLs remain bounded before decode. Do not retain raw
  // payload text when decoding fails.
  if (payload.length > maxBytes * 3) return { kind: 'over_limit', ...(mediaType ? { mediaType } : {}) }
  try {
    const bytes = Buffer.from(decodeURIComponent(payload), 'utf8')
    if (bytes.byteLength > maxBytes) return { kind: 'over_limit', ...(mediaType ? { mediaType } : {}) }
    return { kind: 'decoded', bytes, ...(mediaType ? { mediaType } : {}) }
  } catch {
    return { kind: 'invalid' }
  }
}

function decodeBase64(
  value: string,
  maxBytes: number,
  minimumChars: number
):
  | Readonly<{ kind: 'not_base64' }>
  | Readonly<{ kind: 'decoded'; bytes: Buffer }>
  | Readonly<{ kind: 'over_limit' }>
  | Readonly<{ kind: 'invalid' }> {
  if (value.length < minimumChars) return { kind: 'not_base64' }
  const compact = value.replace(/\s/g, '')
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    return minimumChars === 0 ? { kind: 'invalid' } : { kind: 'not_base64' }
  }
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0
  const estimatedBytes = (compact.length / 4) * 3 - padding
  if (estimatedBytes > maxBytes) return { kind: 'over_limit' }
  try {
    const decoded = Buffer.from(compact, 'base64')
    if (decoded.byteLength > maxBytes) return { kind: 'over_limit' }
    return { kind: 'decoded', bytes: decoded }
  } catch {
    return { kind: 'invalid' }
  }
}

function sanitizeResourceUri(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    parsed.username = ''
    parsed.password = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (URL_CREDENTIAL_QUERY_KEY.test(key)) parsed.searchParams.set(key, '<redacted>')
    }
    return truncateText(parsed.toString(), 1_024).text
  } catch {
    // Do not echo a malformed opaque URI: it can contain userinfo or tokens.
    return '[invalid resource URI]'
  }
}

function safeMediaType(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/.test(normalized)
    ? normalized
    : undefined
}

function safeLabel(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function boundedJsonString(value: string, budget: JsonProjectionBudget): string {
  const maxChars = Math.min(MAX_SAFE_JSON_STRING_CHARS, Math.max(0, budget.stringCharsRemaining))
  budget.stringCharsRemaining -= maxChars
  return truncateText(value, maxChars).text
}

function boundedJsonKey(value: string, budget: JsonProjectionBudget): string {
  const maxChars = Math.min(120, Math.max(1, budget.stringCharsRemaining))
  budget.stringCharsRemaining -= maxChars
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxChars)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function addBounded(left: number, right: number): number {
  return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right
}

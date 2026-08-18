/**
 * Closed, renderer-safe MCP result vocabulary (ADR-0013).
 *
 * These types deliberately contain no filesystem paths, raw bytes, headers,
 * credentials, arguments, or transport errors. They describe the result after
 * main-process normalization, before it is adapted into the existing tool
 * dispatcher / ToolOutcome path.
 */

export type McpArtifactKind = 'image' | 'audio' | 'resource' | 'binary'

/**
 * A public artifact reference is an opaque content-addressed identifier, not a
 * file path or capability. It cannot be used by a renderer to read the file.
 */
export type McpArtifactReference = Readonly<{
  id: string
  kind: McpArtifactKind
  byteLength: number
  /** A conservative media type only when it passed local validation. */
  mediaType?: string
  /** Short, non-secret fingerprint for local correlation. */
  digestPrefix: string
  /** Generated locally; never copied from a server payload. */
  summary: string
}>

/** Main-process dependency injected into the otherwise pure normalizer. */
export type McpArtifactWriter = Readonly<{
  writeArtifact(input: Readonly<{
    kind: McpArtifactKind
    bytes: Uint8Array
    mediaType?: string
  }>): Promise<McpArtifactReference>
}>

/** Raw MCP call result accepted by a later transport/session-manager adapter. */
export type McpRawToolResult = Readonly<{
  content?: unknown
  structuredContent?: unknown
  isError?: boolean
}>

export type McpResultLimits = Readonly<{
  /** Maximum number of MCP content entries inspected from one result. */
  maxContentEntries: number
  /** Maximum source text characters preserved for one text entry. */
  maxTextCharsPerEntry: number
  /** Maximum safe JSON characters preserved for structuredContent. */
  maxStructuredJsonChars: number
  /** Maximum characters returned to the generic tool-result budget. */
  maxModelTextChars: number
  /** Maximum decoded bytes that may be sent to the local artifact writer. */
  maxArtifactBytes: number
}>

export const DEFAULT_MCP_RESULT_LIMITS: McpResultLimits = Object.freeze({
  maxContentEntries: 32,
  maxTextCharsPerEntry: 8_192,
  maxStructuredJsonChars: 8_192,
  maxModelTextChars: 24_576,
  maxArtifactBytes: 8 * 1024 * 1024
})

export type McpNormalizedTextContent = Readonly<{
  kind: 'text'
  text: string
  truncated: boolean
}>

/** A non-fetching metadata-only link. URL credentials are removed by the normalizer. */
export type McpNormalizedResourceLinkContent = Readonly<{
  kind: 'resource_link'
  uri?: string
  name?: string
  mimeType?: string
  description?: string
  fetched: false
}>

export type McpNormalizedArtifactContent = Readonly<{
  kind: 'image' | 'audio' | 'resource' | 'binary'
  mediaType?: string
  artifact?: McpArtifactReference
  /** True when bytes were deliberately not retained in an artifact. */
  omitted: boolean
  summary: string
}>

/** Unknown server content is never stringified verbatim into model context. */
export type McpNormalizedUnknownContent = Readonly<{
  kind: 'unknown'
  summary: string
}>

export type McpNormalizedContent =
  | McpNormalizedTextContent
  | McpNormalizedResourceLinkContent
  | McpNormalizedArtifactContent
  | McpNormalizedUnknownContent

export type McpNormalizedStructuredContent = Readonly<{
  /** Safe JSON text, or a valid JSON truncation envelope for oversized values. */
  json: string
  truncated: boolean
}>

export type McpNormalizedToolResult = Readonly<{
  /** `failed` is the application-level MCP `isError:true` branch. */
  status: 'succeeded' | 'failed'
  isError: boolean
  /** Stable generic failure code; raw server error content stays in bounded text blocks. */
  errorCode?: 'mcp_application_error'
  content: readonly McpNormalizedContent[]
  /** Preserved independently even when ordinary `content` is also present. */
  structuredContent?: McpNormalizedStructuredContent
  /** Bounded model-facing representation to pass into the generic result budget next. */
  modelText: string
  /** Size/cap facts safe for local trace correlation. */
  byteCount: number
  truncated: boolean
  spilled: boolean
  artifactRefs: readonly McpArtifactReference[]
}>

export type McpResultNormalizerOptions = Readonly<{
  limits?: Partial<McpResultLimits>
  artifactWriter?: McpArtifactWriter
}>

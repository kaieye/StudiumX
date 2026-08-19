/**
 * User-selected images attached to an AI conversation turn.
 *
 * The attachment is deliberately an opaque, bounded data payload rather than a
 * local path or URL. Paths/blob URLs cannot be dereferenced safely by the host
 * and would make a renderer-only capability leak across the IPC boundary.
 */

export const AGENT_CHAT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
] as const

export type AgentChatImageMimeType = (typeof AGENT_CHAT_IMAGE_MIME_TYPES)[number]

export type AgentChatImageAttachment = {
  id: string
  name: string
  mimeType: AgentChatImageMimeType
  dataBase64: string
  sizeBytes: number
}

export const MAX_IMAGES_PER_TURN = 5
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_NAME_CHARS = 160
export const MAX_IMAGE_ID_CHARS = 160

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/
const RENDERER_LOCAL_URL_RE = /^(?:file|blob):/i
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-z]:[\\/]/i
const ATTACHMENT_KEYS = new Set<keyof AgentChatImageAttachment>([
  'id',
  'name',
  'mimeType',
  'dataBase64',
  'sizeBytes'
])

export function isAgentChatImageMimeType(value: unknown): value is AgentChatImageMimeType {
  return typeof value === 'string' && (AGENT_CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

export function decodedBase64ByteLength(value: string): number {
  if (!value || value.length % 4 !== 0 || !BASE64_RE.test(value)) return -1
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.max(0, (value.length * 3) / 4 - padding)
}

export function hasExpectedImageMagicBytes(
  mimeType: AgentChatImageMimeType,
  dataBase64: string
): boolean {
  // Read only the first few bytes. This works in both Node and the browser and
  // avoids retaining a second decoded copy of a potentially large image.
  const prefix = decodeBase64Prefix(dataBase64, 16)
  if (!prefix) return false
  if (mimeType === 'image/png') {
    return bytesEqual(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mimeType === 'image/jpeg') return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
  if (mimeType === 'image/gif') {
    return asciiPrefix(prefix, 6) === 'GIF87a' || asciiPrefix(prefix, 6) === 'GIF89a'
  }
  // WebP is a RIFF container: bytes 0..3 are RIFF and 8..11 are WEBP.
  return asciiPrefix(prefix, 4) === 'RIFF' && asciiPrefix(prefix.slice(8), 4) === 'WEBP'
}

export function validateAgentChatImageAttachment(
  value: unknown,
  options: { requireMagicBytes?: boolean } = {}
): AgentChatImageAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('图片附件必须是对象。')
  }
  const record = value as Record<string, unknown>
  const unexpectedKeys = Object.keys(record).filter((key) => !ATTACHMENT_KEYS.has(key as keyof AgentChatImageAttachment))
  if (unexpectedKeys.length > 0) {
    throw new Error('图片附件包含不允许的字段。')
  }
  const id = requireBoundedText(record.id, '图片附件 id', MAX_IMAGE_ID_CHARS)
  const name = requireBoundedText(record.name, '图片文件名', MAX_IMAGE_NAME_CHARS)
  if (CONTROL_CHARS_RE.test(id) || CONTROL_CHARS_RE.test(name)) {
    throw new Error('图片附件不能包含控制字符。')
  }
  if (isPathOrRendererLocalReference(id) || isPathOrRendererLocalReference(name)) {
    throw new Error('图片附件不能包含本地路径、file: 或 blob: URL。')
  }
  if (!isAgentChatImageMimeType(record.mimeType)) {
    throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。')
  }
  const dataBase64 = typeof record.dataBase64 === 'string' ? record.dataBase64 : ''
  const decodedBytes = decodedBase64ByteLength(dataBase64)
  if (decodedBytes <= 0 || decodedBytes > MAX_IMAGE_BYTES) {
    throw new Error(`图片大小必须在 1 字节到 ${MAX_IMAGE_BYTES} 字节之间。`)
  }
  if (record.sizeBytes !== decodedBytes) {
    throw new Error('图片附件大小校验失败。')
  }
  if (options.requireMagicBytes !== false && !hasExpectedImageMagicBytes(record.mimeType, dataBase64)) {
    throw new Error('图片文件内容与声明的类型不匹配。')
  }
  return { id, name, mimeType: record.mimeType, dataBase64, sizeBytes: decodedBytes }
}

export function validateAgentChatImageAttachments(
  value: unknown,
  options: { requireMagicBytes?: boolean } = {}
): AgentChatImageAttachment[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('图片附件必须是数组。')
  if (value.length > MAX_IMAGES_PER_TURN) throw new Error(`每条消息最多添加 ${MAX_IMAGES_PER_TURN} 张图片。`)
  const attachments = value.map((item) => validateAgentChatImageAttachment(item, options))
  const total = attachments.reduce((sum, item) => sum + item.sizeBytes, 0)
  if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error(`每条消息图片总大小不能超过 ${MAX_TOTAL_IMAGE_BYTES} 字节。`)
  return attachments.length > 0 ? attachments : undefined
}

function requireBoundedText(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxChars) {
    throw new Error(`${label}无效。`)
  }
  return value.trim()
}

/**
 * Attachment metadata crosses the renderer/main boundary and may be durable.
 * It is never a capability to open a local file, so reject values that could
 * be mistaken for a path or renderer-only URL even when a compromised
 * renderer does not use the normal file picker.
 */
function isPathOrRendererLocalReference(value: string): boolean {
  return RENDERER_LOCAL_URL_RE.test(value) ||
    WINDOWS_ABSOLUTE_PATH_RE.test(value) ||
    value.includes('/') ||
    value.includes('\\')
}

function decodeBase64Prefix(value: string, maxBytes: number): number[] | null {
  const byteLength = decodedBase64ByteLength(value)
  if (byteLength < 0) return null
  const bytes: number[] = []
  for (let index = 0; index < value.length && bytes.length < maxBytes; index += 4) {
    const chunk = value.slice(index, index + 4)
    if (chunk.length < 4) break
    const a = base64Value(chunk.charCodeAt(0))
    const b = base64Value(chunk.charCodeAt(1))
    const c = chunk[2] === '=' ? 0 : base64Value(chunk.charCodeAt(2))
    const d = chunk[3] === '=' ? 0 : base64Value(chunk.charCodeAt(3))
    if (a < 0 || b < 0 || c < 0 || d < 0) return null
    bytes.push((a << 2) | (b >> 4))
    if (chunk[2] !== '=' && bytes.length < maxBytes) bytes.push(((b & 15) << 4) | (c >> 2))
    if (chunk[3] !== '=' && bytes.length < maxBytes) bytes.push(((c & 3) << 6) | d)
  }
  return bytes
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 97 + 26
  if (code >= 48 && code <= 57) return code - 48 + 52
  if (code === 43) return 62
  if (code === 47) return 63
  return -1
}

function bytesEqual(left: readonly number[], right: readonly number[]): boolean {
  return right.every((value, index) => left[index] === value)
}

function asciiPrefix(bytes: readonly number[], length: number): string {
  return String.fromCharCode(...bytes.slice(0, length))
}

/**
 * PNG artifact boundary for renderer-rasterized mind maps.
 *
 * Rasterization happens in the renderer's browser canvas because the main
 * process has no general-purpose image codec.  The main process still treats
 * the resulting bytes as untrusted IPC input: this module validates strict
 * base64, PNG structure, dimensions, chunk limits, and the expected raster
 * size before any file write.
 */

export type MindMapPngExportArtifact = {
  pngBase64: string
  width: number
  height: number
}

export type MindMapPngExportDimensions = Pick<MindMapPngExportArtifact, 'width' | 'height'>

export type MindMapPngInspection = MindMapPngExportDimensions & {
  byteLength: number
  bytes: Uint8Array
}

export const MIND_MAP_PNG_EXPORT_LIMITS = {
  maxWidth: 8_192,
  maxHeight: 8_192,
  maxPixels: 16_777_216,
  maxBytes: 32 * 1024 * 1024,
  maxChunks: 100_000
} as const

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Validate a renderer-produced PNG artifact and return its decoded bytes.
 * `expectedDimensions` is optional for callers that only need to inspect a
 * standalone artifact; IPC callers should provide it to bind the raster to
 * the validated SVG layout.
 */
export function inspectMindMapPngExportArtifact(
  value: unknown,
  expectedDimensions?: MindMapPngExportDimensions
): MindMapPngInspection {
  if (!isRecord(value)) throw new Error('PNG export artifact must be an object')
  const width = requireDimension(value.width, 'width')
  const height = requireDimension(value.height, 'height')
  if (expectedDimensions !== undefined) {
    if (width !== expectedDimensions.width || height !== expectedDimensions.height) {
      throw new Error('PNG export dimensions do not match the validated SVG layout')
    }
  }
  if (typeof value.pngBase64 !== 'string') {
    throw new Error('PNG export artifact must contain base64 bytes')
  }

  const bytes = decodeBase64(value.pngBase64)
  const image = inspectPngBytes(bytes)
  if (image.width !== width || image.height !== height) {
    throw new Error('PNG artifact dimensions do not match its declared dimensions')
  }
  return { width, height, byteLength: bytes.byteLength, bytes }
}

/** Decode strict RFC 4648 base64 without relying on Node-only globals. */
export function decodeMindMapPngBase64(value: string): Uint8Array {
  return decodeBase64(value)
}

function inspectPngBytes(bytes: Uint8Array): MindMapPngExportDimensions {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength + 12) {
    throw new Error('PNG export artifact is truncated')
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error('PNG export artifact has an invalid signature')
    }
  }

  let offset = PNG_SIGNATURE.byteLength
  let chunkCount = 0
  let sawHeader = false
  let sawImageData = false
  let sawEnd = false
  let width = 0
  let height = 0

  while (offset < bytes.byteLength) {
    if (++chunkCount > MIND_MAP_PNG_EXPORT_LIMITS.maxChunks) {
      throw new Error('PNG export artifact contains too many chunks')
    }
    if (bytes.byteLength - offset < 12) {
      throw new Error('PNG export artifact contains a truncated chunk')
    }
    const length = readUint32(bytes, offset)
    const typeOffset = offset + 4
    const dataOffset = offset + 8
    const crcOffset = dataOffset + length
    const nextOffset = crcOffset + 4
    if (length > MIND_MAP_PNG_EXPORT_LIMITS.maxBytes || nextOffset > bytes.byteLength) {
      throw new Error('PNG export artifact contains an invalid chunk length')
    }

    if (!isValidChunkType(bytes, typeOffset)) {
      throw new Error('PNG export artifact has an invalid chunk type')
    }
    const type = fourCc(bytes, typeOffset)
    if (!sawHeader && type !== 'IHDR') {
      throw new Error('PNG export artifact must begin with IHDR')
    }
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) throw new Error('PNG export artifact has an invalid IHDR')
      sawHeader = true
      width = readUint32(bytes, dataOffset)
      height = readUint32(bytes, dataOffset + 4)
      validatePngDimensions(width, height)
      validatePngHeader(bytes, dataOffset)
    } else if (type === 'IDAT') {
      if (!sawHeader) throw new Error('PNG export artifact has IDAT before IHDR')
      sawImageData = true
    } else if (type === 'IEND') {
      if (!sawHeader || !sawImageData || length !== 0 || sawEnd) {
        throw new Error('PNG export artifact has an invalid IEND')
      }
      sawEnd = true
    }

    if (readUint32(bytes, crcOffset) !== crc32(bytes, typeOffset, 4 + length)) {
      throw new Error('PNG export artifact has an invalid chunk checksum')
    }
    offset = nextOffset
    if (sawEnd) {
      if (offset !== bytes.byteLength) {
        throw new Error('PNG export artifact contains trailing bytes')
      }
      break
    }
  }

  if (!sawHeader || !sawImageData || !sawEnd) {
    throw new Error('PNG export artifact is missing required chunks')
  }
  return { width, height }
}

function validatePngHeader(bytes: Uint8Array, offset: number): void {
  const bitDepth = bytes[offset + 8]
  const colorType = bytes[offset + 9]
  const compression = bytes[offset + 10]
  const filter = bytes[offset + 11]
  const interlace = bytes[offset + 12]
  const validBitDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  }
  if (!(colorType in validBitDepths) || !validBitDepths[colorType]!.includes(bitDepth)) {
    throw new Error('PNG export artifact has an invalid color format')
  }
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
    throw new Error('PNG export artifact has an unsupported compression header')
  }
}

function validatePngDimensions(width: number, height: number): void {
  if (
    width < 1 ||
    height < 1 ||
    width > MIND_MAP_PNG_EXPORT_LIMITS.maxWidth ||
    height > MIND_MAP_PNG_EXPORT_LIMITS.maxHeight ||
    width * height > MIND_MAP_PNG_EXPORT_LIMITS.maxPixels
  ) {
    throw new Error('PNG export dimensions exceed the safety limit')
  }
}

function requireDimension(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MIND_MAP_PNG_EXPORT_LIMITS[`max${name[0]!.toUpperCase()}${name.slice(1)}` as 'maxWidth' | 'maxHeight']
  ) {
    throw new Error(`PNG export ${name} is outside the safety limit`)
  }
  return value
}

function decodeBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > Math.ceil(MIND_MAP_PNG_EXPORT_LIMITS.maxBytes / 3) * 4 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new Error('PNG export artifact must contain strict bounded base64')
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((value.length / 4) * 3 - padding)
  let output = 0
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(value[index]!)
    const b = BASE64_ALPHABET.indexOf(value[index + 1]!)
    const c = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]!)
    const d = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]!)
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error('PNG export artifact contains invalid base64')
    }
    if (index + 4 === value.length) {
      if (padding === 2 && (b & 15) !== 0) {
        throw new Error('PNG export artifact contains non-canonical base64')
      }
      if (padding === 1 && (c & 3) !== 0) {
        throw new Error('PNG export artifact contains non-canonical base64')
      }
    }
    bytes[output++] = (a << 2) | (b >> 4)
    if (output < bytes.length) bytes[output++] = ((b & 15) << 4) | (c >> 2)
    if (output < bytes.length) bytes[output++] = ((c & 3) << 6) | d
  }
  if (bytes.byteLength > MIND_MAP_PNG_EXPORT_LIMITS.maxBytes) {
    throw new Error('PNG export artifact exceeds the byte safety limit')
  }
  return bytes
}

function isValidChunkType(bytes: Uint8Array, offset: number): boolean {
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index]!
    if (!((value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a))) {
      return false
    }
  }
  return true
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  )
}

function crc32(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff
  for (let index = 0; index < length; index += 1) {
    crc ^= bytes[offset + index]!
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

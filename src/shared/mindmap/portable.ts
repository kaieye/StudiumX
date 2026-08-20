/**
 * Portable, single-file interchange envelope for StudiumX mind maps.
 *
 * The workspace repository intentionally keeps asset bytes out of its
 * canonical JSON file.  This envelope is only used at an explicit import /
 * export boundary and embeds bounded base64 payloads so a map can be moved as
 * one file without changing the teaching-authority boundary.
 */
import { mindMapDocumentV2Schema } from './domain/schema'
import { validateMindMapDocumentV2 } from './domain/invariants'
import type { MindMapAssetRef, MindMapDocumentV2, MindMapTopicV2 } from './domain/types'

export const MIND_MAP_PORTABLE_FORMAT = 'studiumx-mindmap' as const
export const MIND_MAP_PORTABLE_VERSION = 1 as const
export const MIND_MAP_PORTABLE_MAX_BYTES = 128 * 1024 * 1024
export const MIND_MAP_PORTABLE_MAX_ASSETS = 512
export const MIND_MAP_PORTABLE_MAX_ASSET_BYTES = 16 * 1024 * 1024

export type MindMapPortableAsset = {
  asset: MindMapAssetRef
  dataBase64: string
}

export type MindMapPortablePackage = {
  format: typeof MIND_MAP_PORTABLE_FORMAT
  version: typeof MIND_MAP_PORTABLE_VERSION
  document: MindMapDocumentV2
  assets: MindMapPortableAsset[]
}

export type MindMapPortableParseErrorCode =
  | 'empty_input'
  | 'invalid_json'
  | 'invalid_envelope'
  | 'unsupported_version'
  | 'invalid_document'
  | 'invalid_assets'
  | 'asset_mismatch'
  | 'asset_too_large'
  | 'package_too_large'

export class MindMapPortableError extends Error {
  readonly code: MindMapPortableParseErrorCode

  constructor(code: MindMapPortableParseErrorCode, message: string) {
    super(message)
    this.name = 'MindMapPortableError'
    this.code = code
  }
}

/** Build an envelope from a canonical document and its already-read bytes. */
export function createMindMapPortablePackage(
  document: MindMapDocumentV2,
  assets: readonly MindMapPortableAsset[]
): MindMapPortablePackage {
  validateDocument(document)
  validatePortableAssets(document, assets)
  return {
    format: MIND_MAP_PORTABLE_FORMAT,
    version: MIND_MAP_PORTABLE_VERSION,
    document,
    assets: [...assets]
  }
}

/** Serialize an envelope deterministically as UTF-8 JSON. */
export function serializeMindMapPortablePackage(pkg: MindMapPortablePackage): string {
  const normalized = createMindMapPortablePackage(pkg.document, pkg.assets)
  const serialized = JSON.stringify(normalized, null, 2)
  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes > MIND_MAP_PORTABLE_MAX_BYTES) {
    throw new MindMapPortableError(
      'package_too_large',
      `Portable mind-map package exceeds ${MIND_MAP_PORTABLE_MAX_BYTES} bytes.`
    )
  }
  return `${serialized}\n`
}

/** Parse and validate a portable package without touching the filesystem. */
export function parseMindMapPortablePackage(input: string): MindMapPortablePackage {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new MindMapPortableError('empty_input', 'Portable mind-map package is empty.')
  }
  const inputBytes = new TextEncoder().encode(input).byteLength
  if (inputBytes > MIND_MAP_PORTABLE_MAX_BYTES) {
    throw new MindMapPortableError(
      'package_too_large',
      `Portable mind-map package exceeds ${MIND_MAP_PORTABLE_MAX_BYTES} bytes.`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    throw new MindMapPortableError(
      'invalid_json',
      `Portable mind-map package is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['format', 'version', 'document', 'assets'])) {
    throw new MindMapPortableError('invalid_envelope', 'Portable mind-map package has an invalid envelope.')
  }
  if (parsed.format !== MIND_MAP_PORTABLE_FORMAT) {
    throw new MindMapPortableError(
      'invalid_envelope',
      `Unsupported portable mind-map format: ${String(parsed.format)}.`
    )
  }
  if (parsed.version !== MIND_MAP_PORTABLE_VERSION) {
    throw new MindMapPortableError(
      'unsupported_version',
      `Unsupported portable mind-map version: ${String(parsed.version)}.`
    )
  }
  const document = parseDocument(parsed.document)
  if (!Array.isArray(parsed.assets) || parsed.assets.length > MIND_MAP_PORTABLE_MAX_ASSETS) {
    throw new MindMapPortableError(
      'invalid_assets',
      `Portable mind-map package contains too many assets (maximum ${MIND_MAP_PORTABLE_MAX_ASSETS}).`
    )
  }

  const assets: MindMapPortableAsset[] = []
  for (const candidate of parsed.assets) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ['asset', 'dataBase64'])) {
      throw new MindMapPortableError('invalid_assets', 'Portable asset entry has an invalid shape.')
    }
    const asset = parseAsset(candidate.asset)
    if (typeof candidate.dataBase64 !== 'string' || !isCanonicalBase64(candidate.dataBase64)) {
      throw new MindMapPortableError('invalid_assets', `Portable asset "${asset.id}" has invalid base64 data.`)
    }
    const decodedBytes = estimateBase64Bytes(candidate.dataBase64)
    if (decodedBytes > MIND_MAP_PORTABLE_MAX_ASSET_BYTES) {
      throw new MindMapPortableError(
        'asset_too_large',
        `Portable asset "${asset.id}" exceeds ${MIND_MAP_PORTABLE_MAX_ASSET_BYTES} bytes.`
      )
    }
    assets.push({ asset, dataBase64: candidate.dataBase64 })
  }
  validatePortableAssets(document, assets)
  return {
    format: MIND_MAP_PORTABLE_FORMAT,
    version: MIND_MAP_PORTABLE_VERSION,
    document,
    assets
  }
}

function parseDocument(value: unknown): MindMapDocumentV2 {
  const parsed = mindMapDocumentV2Schema.safeParse(value)
  if (!parsed.success) {
    throw new MindMapPortableError('invalid_document', `Portable document failed schema validation: ${parsed.error.message}`)
  }
  const document = parsed.data
  const validation = validateMindMapDocumentV2(document)
  if (!validation.ok) {
    throw new MindMapPortableError(
      'invalid_document',
      `Portable document violates mind-map invariants: ${validation.errors.map((error) => error.message).join('; ')}`
    )
  }
  return document
}

function parseAsset(value: unknown): MindMapAssetRef {
  if (!isRecord(value)) throw new MindMapPortableError('invalid_assets', 'Portable asset metadata must be an object.')
  const allowed = ['id', 'fileName', 'mimeType', 'sizeBytes', 'sha256', 'createdAt']
  if (!hasExactKeys(value, allowed)) {
    throw new MindMapPortableError('invalid_assets', 'Portable asset metadata has unexpected fields.')
  }
  if (typeof value.id !== 'string' || !/^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id)) {
    throw new MindMapPortableError('invalid_assets', 'Portable asset id is invalid.')
  }
  if (
    typeof value.fileName !== 'string' ||
    value.fileName.length === 0 ||
    value.fileName === '.' ||
    value.fileName === '..' ||
    value.fileName.includes('/') ||
    value.fileName.includes('\\') ||
    value.fileName.includes(':') ||
    value.fileName.includes('\0') ||
    [...value.fileName].some((character) => character < ' ')
  ) {
    throw new MindMapPortableError('invalid_assets', `Portable asset "${value.id}" fileName is invalid.`)
  }
  if (value.mimeType !== undefined && typeof value.mimeType !== 'string') {
    throw new MindMapPortableError('invalid_assets', `Portable asset "${value.id}" mimeType is invalid.`)
  }
  if (
    value.sizeBytes !== undefined &&
    (typeof value.sizeBytes !== 'number' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0)
  ) {
    throw new MindMapPortableError('invalid_assets', `Portable asset "${value.id}" sizeBytes is invalid.`)
  }
  if (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))) {
    throw new MindMapPortableError('invalid_assets', `Portable asset "${value.id}" sha256 is invalid.`)
  }
  if (value.createdAt !== undefined && typeof value.createdAt !== 'string') {
    throw new MindMapPortableError('invalid_assets', `Portable asset "${value.id}" createdAt is invalid.`)
  }
  return value as MindMapAssetRef
}

function validateDocument(document: MindMapDocumentV2): void {
  const parsed = mindMapDocumentV2Schema.safeParse(document)
  if (!parsed.success) {
    throw new MindMapPortableError('invalid_document', `Portable document failed schema validation: ${parsed.error.message}`)
  }
  const validation = validateMindMapDocumentV2(parsed.data)
  if (!validation.ok) {
    throw new MindMapPortableError(
      'invalid_document',
      `Portable document violates mind-map invariants: ${validation.errors.map((error) => error.message).join('; ')}`
    )
  }
}

function validatePortableAssets(
  document: MindMapDocumentV2,
  assets: readonly MindMapPortableAsset[]
): void {
  if (assets.length > MIND_MAP_PORTABLE_MAX_ASSETS) {
    throw new MindMapPortableError('invalid_assets', 'Portable package contains too many assets.')
  }
  const declared = new Map(document.assets.map((asset) => [asset.id, asset]))
  const seen = new Set<string>()
  for (const entry of assets) {
    if (seen.has(entry.asset.id)) {
      throw new MindMapPortableError('invalid_assets', `Portable asset "${entry.asset.id}" is duplicated.`)
    }
    seen.add(entry.asset.id)
    const expected = declared.get(entry.asset.id)
    if (!expected || !sameAssetMetadata(expected, entry.asset)) {
      throw new MindMapPortableError(
        'asset_mismatch',
        `Portable asset "${entry.asset.id}" does not match the document asset table.`
      )
    }
    if (!isCanonicalBase64(entry.dataBase64)) {
      throw new MindMapPortableError('invalid_assets', `Portable asset "${entry.asset.id}" has invalid base64 data.`)
    }
    const decodedBytes = estimateBase64Bytes(entry.dataBase64)
    if (decodedBytes > MIND_MAP_PORTABLE_MAX_ASSET_BYTES) {
      throw new MindMapPortableError('asset_too_large', `Portable asset "${entry.asset.id}" is too large.`)
    }
    if (entry.asset.sizeBytes !== undefined && entry.asset.sizeBytes !== decodedBytes) {
      throw new MindMapPortableError('asset_mismatch', `Portable asset "${entry.asset.id}" size does not match its data.`)
    }
  }
  if (seen.size !== declared.size) {
    throw new MindMapPortableError('asset_mismatch', 'Portable package must include every document asset exactly once.')
  }
  validateReferencedAssets(document, declared)
}

function validateReferencedAssets(
  document: MindMapDocumentV2,
  declared: ReadonlyMap<string, MindMapAssetRef>
): void {
  const references = new Set<string>()
  for (const sheet of document.sheets) {
    for (const image of sheet.images ?? []) references.add(image.assetId)
    walkTopic(sheet.root, (topic) => {
      for (const assetId of topic.assetIds ?? []) references.add(assetId)
    })
  }
  for (const assetId of references) {
    if (!declared.has(assetId)) {
      throw new MindMapPortableError('asset_mismatch', `Document references missing asset "${assetId}".`)
    }
  }
}

function walkTopic(topic: MindMapTopicV2, visit: (topic: MindMapTopicV2) => void): void {
  visit(topic)
  for (const child of topic.children) walkTopic(child, visit)
}

function sameAssetMetadata(a: MindMapAssetRef, b: MindMapAssetRef): boolean {
  return a.id === b.id &&
    a.fileName === b.fileName &&
    a.mimeType === b.mimeType &&
    a.sizeBytes === b.sizeBytes &&
    a.sha256 === b.sha256 &&
    a.createdAt === b.createdAt
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0) return true
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false
  const padding = value.indexOf('=')
  return padding < 0 || padding >= value.length - 2 || value.slice(padding).length <= 2
}

function estimateBase64Bytes(value: string): number {
  if (value.length === 0) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

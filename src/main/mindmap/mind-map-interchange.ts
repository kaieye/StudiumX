/** Sidecar media interchange for editable Markdown and OPML exports. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { mindMapElementStyleSchema } from '../../shared/mindmap/domain/schema'
import type {
  MindMapAssetRef,
  MindMapDocumentV2,
  MindMapElementStyle,
  MindMapImageElement,
  MindMapPoint,
  MindMapTopicV2
} from '../../shared/mindmap/domain/types'
import { MindMapAssetStore } from './mind-map-assets'

export const MIND_MAP_INTERCHANGE_FORMAT = 'studiumx-mindmap-media' as const
export const MIND_MAP_INTERCHANGE_VERSION = 1 as const
export const MIND_MAP_INTERCHANGE_MANIFEST = 'studiumx-mindmap-media.json'
export const MIND_MAP_INTERCHANGE_MAX_MANIFEST_BYTES = 2 * 1024 * 1024
export const MIND_MAP_INTERCHANGE_MAX_ASSETS = 512
export const MIND_MAP_INTERCHANGE_MAX_ASSET_BYTES = 16 * 1024 * 1024
/** Total sidecar media budget. Keeps a malformed manifest from staging GiB of data. */
export const MIND_MAP_INTERCHANGE_MAX_BYTES = 128 * 1024 * 1024

export type MindMapInterchangeImageRecord = {
  sheetIndex: number
  sheetId: string
  imageId: string
  assetId: string
  topicPath?: number[]
  topicId?: string
  width: number
  height: number
  position?: MindMapPoint
  label?: string
  style?: MindMapElementStyle
}

export type MindMapInterchangeTopicRecord = {
  sheetIndex: number
  sheetId: string
  topicPath: number[]
  topicId: string
  assetIds: string[]
}

export type MindMapInterchangeAssetRecord = {
  assetId: string
  relativePath: string
  fileName: string
  mimeType?: string
  sizeBytes: number
  sha256: string
}

export type MindMapInterchangeManifest = {
  format: typeof MIND_MAP_INTERCHANGE_FORMAT
  version: typeof MIND_MAP_INTERCHANGE_VERSION
  assets: MindMapInterchangeAssetRecord[]
  images: MindMapInterchangeImageRecord[]
  topics: MindMapInterchangeTopicRecord[]
}

export type InterchangeAssetPayload = {
  asset: MindMapAssetRef
  content: Buffer
}

export type ImportedInterchangeMedia = {
  document: MindMapDocumentV2
  importedAssets: MindMapAssetRef[]
}

/** Read every canonical asset referenced by a document for an explicit export. */
export async function readMindMapInterchangeAssetPayloads(
  document: MindMapDocumentV2,
  workspaceRoot: string
): Promise<InterchangeAssetPayload[]> {
  const assetStore = new MindMapAssetStore({
    rootPath: join(resolve(workspaceRoot), 'mindmap-assets')
  })
  const payloads: InterchangeAssetPayload[] = []
  for (const asset of document.assets) {
    payloads.push({ asset, content: await assetStore.read(asset) })
  }
  return payloads
}

/** Build the sidecar metadata and deterministic relative media names. */
export function buildMindMapInterchangeManifest(
  document: MindMapDocumentV2
): MindMapInterchangeManifest {
  const assets = document.assets.map((asset, index) => ({
    assetId: asset.id,
    relativePath: `asset-${String(index).padStart(3, '0')}-${safeFileName(asset.fileName)}`,
    fileName: asset.fileName,
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    sizeBytes: asset.sizeBytes ?? 0,
    sha256: asset.sha256 ?? ''
  }))
  const images: MindMapInterchangeImageRecord[] = []
  const topics: MindMapInterchangeTopicRecord[] = []
  document.sheets.forEach((sheet, sheetIndex) => {
    walkTopic(sheet.root, [], (topic, topicPath) => {
      if (topic.assetIds && topic.assetIds.length > 0) {
        topics.push({
          sheetIndex,
          sheetId: sheet.id,
          topicPath,
          topicId: topic.id,
          assetIds: [...topic.assetIds]
        })
      }
    })
    for (const image of sheet.images ?? []) {
      const topicPath = image.topicId === undefined ? undefined : findTopicPath(sheet.root, image.topicId)
      images.push({
        sheetIndex,
        sheetId: sheet.id,
        imageId: image.id,
        assetId: image.assetId,
        ...(topicPath ? { topicPath } : {}),
        ...(image.topicId ? { topicId: image.topicId } : {}),
        width: image.width,
        height: image.height,
        ...(image.position ? { position: { ...image.position } } : {}),
        ...(image.label !== undefined ? { label: image.label } : {}),
        ...(image.style ? { style: { ...image.style } } : {})
      })
    }
  })
  return {
    format: MIND_MAP_INTERCHANGE_FORMAT,
    version: MIND_MAP_INTERCHANGE_VERSION,
    assets,
    images,
    topics
  }
}

/** Map attached image links for the pure Markdown serializer. */
export function markdownImageLinksForManifest(
  manifest: MindMapInterchangeManifest,
  sidecarDirectoryName: string
): ReadonlyMap<string, Array<{ alt: string; url: string }>> {
  const byTopic = new Map<string, Array<{ alt: string; url: string }>>()
  const assets = new Map(manifest.assets.map((asset) => [asset.assetId, asset]))
  for (const image of manifest.images) {
    if (image.topicId === undefined) continue
    const asset = assets.get(image.assetId)
    if (!asset) continue
    const links = byTopic.get(image.topicId) ?? []
    links.push({
      alt: image.label?.trim() || asset.fileName,
      url: `${sidecarDirectoryName}/${asset.relativePath}`
    })
    byTopic.set(image.topicId, links)
  }
  return byTopic
}

/** Map private OPML image path attributes for attached images. */
export function opmlImagePathsForManifest(
  manifest: MindMapInterchangeManifest
): ReadonlyMap<string, string[]> {
  const byTopic = new Map<string, string[]>()
  const assets = new Map(manifest.assets.map((asset) => [asset.assetId, asset]))
  for (const image of manifest.images) {
    if (image.topicId === undefined) continue
    const asset = assets.get(image.assetId)
    if (!asset) continue
    const paths = byTopic.get(image.topicId) ?? []
    paths.push(asset.relativePath)
    byTopic.set(image.topicId, paths)
  }
  return byTopic
}

/** Write a sidecar directory and all media bytes next to an export file. */
export async function writeMindMapInterchangeSidecar(
  exportFilePath: string,
  document: MindMapDocumentV2,
  payloads: readonly InterchangeAssetPayload[],
  manifest: MindMapInterchangeManifest = buildMindMapInterchangeManifest(document)
): Promise<string> {
  if (document.assets.length === 0) {
    // A previous export may have left a media manifest beside the same map
    // filename. Keep the sidecar directory (and any user-inspectable bytes)
    // untouched, but atomically replace its active manifest with an empty one
    // so a later import cannot resurrect deleted images.
    const sidecarDirectory = `${exportFilePath}.assets`
    if (!await hasRealOptionalDirectory(sidecarDirectory)) return ''
    const emptyManifest = buildMindMapInterchangeManifest(document)
    await writeAtomically(
      join(sidecarDirectory, MIND_MAP_INTERCHANGE_MANIFEST),
      `${JSON.stringify(emptyManifest, null, 2)}\n`
    )
    return sidecarDirectory
  }
  if (payloads.length !== document.assets.length) {
    throw new Error('Mind-map sidecar payloads do not match the document asset table.')
  }
  const sidecarDirectory = `${exportFilePath}.assets`
  await ensureRealDirectory(sidecarDirectory)
  const byId = new Map(payloads.map((payload) => [payload.asset.id, payload]))
  if (byId.size !== payloads.length || byId.size !== document.assets.length) {
    throw new Error('Mind-map sidecar payload ids must match the document asset table exactly.')
  }
  const normalizedAssets = manifest.assets.map((record) => {
    const payload = byId.get(record.assetId)
    if (!payload) throw new Error(`Missing bytes for sidecar asset "${record.assetId}".`)
    const normalized = {
      ...record,
      sizeBytes: payload.content.byteLength,
      sha256: createHash('sha256').update(payload.content).digest('hex')
    }
    verifyPayload(normalized, payload.content)
    return normalized
  })
  assertTotalAssetBytes(normalizedAssets)
  for (const record of normalizedAssets) {
    const payload = byId.get(record.assetId)!
    const target = resolveContained(sidecarDirectory, record.relativePath)
    await writeAtomically(target, payload.content)
  }
  const manifestPath = join(sidecarDirectory, MIND_MAP_INTERCHANGE_MANIFEST)
  await writeAtomically(manifestPath, `${JSON.stringify({ ...manifest, assets: normalizedAssets }, null, 2)}\n`)
  return sidecarDirectory
}

/** Read a neighbouring sidecar and materialize media into a workspace. */
export async function importMindMapInterchangeSidecar(
  sourceFilePath: string,
  workspaceRoot: string,
  document: MindMapDocumentV2
): Promise<ImportedInterchangeMedia> {
  const sidecarDirectory = `${sourceFilePath}.assets`
  if (!await hasRealOptionalDirectory(sidecarDirectory)) {
    return { document, importedAssets: [] }
  }
  const manifestPath = join(sidecarDirectory, MIND_MAP_INTERCHANGE_MANIFEST)
  const manifestBytes = await readOptionalManifest(manifestPath)
  if (!manifestBytes) return { document, importedAssets: [] }
  const manifest = parseManifest(manifestBytes)
  validateManifestDocumentTargets(manifest, document)
  const assetStore = new MindMapAssetStore({ rootPath: join(resolve(workspaceRoot), 'mindmap-assets') })
  const importedAssets: MindMapAssetRef[] = []
  const idMap = new Map<string, string>()
  try {
    for (const record of manifest.assets) {
      const content = await readSidecarAsset(sidecarDirectory, record)
      const imported = await assetStore.importFromBytes({
        id: randomUUID(),
        fileName: record.fileName,
        ...(record.mimeType ? { mimeType: record.mimeType } : {}),
        content
      })
      idMap.set(record.assetId, imported.id)
      importedAssets.push(imported)
    }
    const restored = restoreInterchangeDocument(document, manifest, idMap, importedAssets)
    return { document: restored, importedAssets }
  } catch (error) {
    await Promise.all(importedAssets.map((asset) => assetStore.remove(asset).catch(() => undefined)))
    throw error
  }
}

function restoreInterchangeDocument(
  document: MindMapDocumentV2,
  manifest: MindMapInterchangeManifest,
  idMap: ReadonlyMap<string, string>,
  importedAssets: readonly MindMapAssetRef[]
): MindMapDocumentV2 {
  const remap = (assetId: string): string => {
    const mapped = idMap.get(assetId)
    if (!mapped) throw new Error(`Sidecar references missing asset "${assetId}".`)
    return mapped
  }
  const sheets = document.sheets.map((sheet, sheetIndex) => ({
    ...sheet,
    root: remapTopicAssets(sheet.root, sheetIndex, manifest.topics, remap),
    images: [] as MindMapImageElement[]
  }))
  for (const image of manifest.images) {
    const sheet = sheets[image.sheetIndex]
    if (!sheet) throw new Error(`Sidecar image references missing sheet index ${image.sheetIndex}.`)
    const topic = image.topicPath ? topicAtPath(sheet.root, image.topicPath) : undefined
    if (image.topicPath && !topic) throw new Error(`Sidecar image "${image.imageId}" references a missing topic path.`)
    sheet.images!.push({
      id: image.imageId,
      type: 'image',
      assetId: remap(image.assetId),
      width: image.width,
      height: image.height,
      ...(topic ? { topicId: topic.id } : {}),
      ...(image.position ? { position: { ...image.position } } : {}),
      ...(image.label !== undefined ? { label: image.label } : {}),
      ...(image.style ? { style: { ...image.style } } : {})
    })
  }
  return { ...document, sheets, assets: importedAssets.map((asset) => ({ ...asset })) }
}

function remapTopicAssets(
  topic: MindMapTopicV2,
  sheetIndex: number,
  records: readonly MindMapInterchangeTopicRecord[],
  remap: (assetId: string) => string,
  path: number[] = []
): MindMapTopicV2 {
  const record = records.find((candidate) => candidate.sheetIndex === sheetIndex && samePath(candidate.topicPath, path))
  return {
    ...topic,
    ...(record || topic.assetIds ? { assetIds: (record?.assetIds ?? topic.assetIds ?? []).map(remap) } : {}),
    children: topic.children.map((child, index) => remapTopicAssets(child, sheetIndex, records, remap, [...path, index]))
  }
}

function walkTopic(
  topic: MindMapTopicV2,
  path: number[],
  visit: (topic: MindMapTopicV2, path: number[]) => void
): void {
  visit(topic, path)
  topic.children.forEach((child, index) => walkTopic(child, [...path, index], visit))
}

function findTopicPath(root: MindMapTopicV2, topicId: string, path: number[] = []): number[] | undefined {
  if (root.id === topicId) return path
  for (let index = 0; index < root.children.length; index += 1) {
    const found = findTopicPath(root.children[index]!, topicId, [...path, index])
    if (found) return found
  }
  return undefined
}

function topicAtPath(root: MindMapTopicV2, path: readonly number[]): MindMapTopicV2 | undefined {
  let topic: MindMapTopicV2 | undefined = root
  for (const index of path) topic = topic?.children[index]
  return topic
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function safeFileName(fileName: string): string {
  const value = basename(fileName).replace(/[^A-Za-z0-9._-]+/g, '-')
  return value || 'asset'
}

function verifyPayload(record: MindMapInterchangeAssetRecord, content: Buffer): void {
  if (content.byteLength > MIND_MAP_INTERCHANGE_MAX_ASSET_BYTES) {
    throw new Error(`Sidecar asset "${record.assetId}" is too large.`)
  }
  if (record.sizeBytes !== content.byteLength) {
    throw new Error(`Sidecar asset "${record.assetId}" size does not match its manifest.`)
  }
  const hash = createHash('sha256').update(content).digest('hex')
  if (record.sha256 && record.sha256 !== hash) {
    throw new Error(`Sidecar asset "${record.assetId}" hash does not match its manifest.`)
  }
}

async function readSidecarAsset(
  sidecarDirectory: string,
  record: MindMapInterchangeAssetRecord
): Promise<Buffer> {
  const target = resolveContained(sidecarDirectory, record.relativePath)
  const info = await lstat(target)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Sidecar asset "${record.assetId}" is not a regular file.`)
  if (info.size > MIND_MAP_INTERCHANGE_MAX_ASSET_BYTES) throw new Error(`Sidecar asset "${record.assetId}" is too large.`)
  const handle = await open(target, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error('Sidecar asset changed while it was being opened.')
    const content = await handle.readFile()
    verifyPayload(record, content)
    return content
  } finally {
    await handle.close()
  }
}

async function readOptionalManifest(path: string): Promise<Buffer | null> {
  const info = await lstat(path).catch((error: unknown) => {
    if (isErrno(error) && error.code === 'ENOENT') return null
    throw error
  })
  if (!info) return null
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Mind-map sidecar manifest must be a regular file.')
  if (info.size > MIND_MAP_INTERCHANGE_MAX_MANIFEST_BYTES) throw new Error('Mind-map sidecar manifest is too large.')
  return open(path, 'r').then(async (handle) => {
    try {
      const opened = await handle.stat()
      if (
        !opened.isFile()
        || opened.dev !== info.dev
        || opened.ino !== info.ino
        || opened.size > MIND_MAP_INTERCHANGE_MAX_MANIFEST_BYTES
      ) {
        throw new Error('Mind-map sidecar manifest changed while it was being opened.')
      }
      const content = await handle.readFile()
      if (content.byteLength > MIND_MAP_INTERCHANGE_MAX_MANIFEST_BYTES) {
        throw new Error('Mind-map sidecar manifest is too large.')
      }
      return content
    } finally {
      await handle.close()
    }
  })
}

function parseManifest(bytes: Buffer): MindMapInterchangeManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw new Error(`Mind-map sidecar manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (
    !isRecord(parsed)
    || !hasExactKeys(parsed, ['format', 'version', 'assets', 'images', 'topics'])
    || parsed.format !== MIND_MAP_INTERCHANGE_FORMAT
    || parsed.version !== MIND_MAP_INTERCHANGE_VERSION
  ) {
    throw new Error('Mind-map sidecar manifest has an unsupported format or version.')
  }
  if (!Array.isArray(parsed.assets) || !Array.isArray(parsed.images) || !Array.isArray(parsed.topics)) {
    throw new Error('Mind-map sidecar manifest is missing required arrays.')
  }
  if (parsed.assets.length > MIND_MAP_INTERCHANGE_MAX_ASSETS) {
    throw new Error('Mind-map sidecar manifest has too many assets.')
  }

  const assets = parsed.assets.map(parseAssetRecord)
  const assetIds = new Set<string>()
  const relativePaths = new Set<string>()
  for (const asset of assets) {
    if (assetIds.has(asset.assetId) || relativePaths.has(asset.relativePath)) {
      throw new Error('Mind-map sidecar manifest has duplicate asset identifiers or paths.')
    }
    assetIds.add(asset.assetId)
    relativePaths.add(asset.relativePath)
  }
  assertTotalAssetBytes(assets)

  const images = parsed.images.map((value) => parseImageRecord(value, assetIds))
  const imageIds = new Set<string>()
  for (const image of images) {
    const identity = `${image.sheetIndex}\u0000${image.imageId}`
    if (imageIds.has(identity)) {
      throw new Error('Mind-map sidecar manifest has duplicate image identifiers.')
    }
    imageIds.add(identity)
  }

  const topics = parsed.topics.map((value) => parseTopicRecord(value, assetIds))
  const topicPaths = new Set<string>()
  for (const topic of topics) {
    const identity = `${topic.sheetIndex}\u0000${topic.topicPath.join('/')}`
    if (topicPaths.has(identity)) {
      throw new Error('Mind-map sidecar manifest has duplicate topic paths.')
    }
    topicPaths.add(identity)
  }
  return {
    format: MIND_MAP_INTERCHANGE_FORMAT,
    version: MIND_MAP_INTERCHANGE_VERSION,
    assets,
    images,
    topics
  }
}

function parseAssetRecord(value: unknown): MindMapInterchangeAssetRecord {
  const required = ['assetId', 'relativePath', 'fileName', 'sizeBytes', 'sha256']
  const allowed = [...required, 'mimeType']
  if (!isRecord(value) || !hasAllowedKeys(value, allowed, required)) {
    throw new Error('Mind-map sidecar asset record is invalid.')
  }
  const { assetId, relativePath, fileName, sizeBytes, sha256, mimeType } = value
  if (!isSafeAssetId(assetId) || !isSafeFileName(fileName) || !isSafeSidecarFileName(relativePath)) {
    throw new Error('Mind-map sidecar asset record contains an unsafe identifier or path.')
  }
  if (
    typeof sizeBytes !== 'number'
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || sizeBytes > MIND_MAP_INTERCHANGE_MAX_ASSET_BYTES
  ) {
    throw new Error('Mind-map sidecar asset size is invalid.')
  }
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Mind-map sidecar asset hash is invalid.')
  }
  if (mimeType !== undefined && !isSafeMimeType(mimeType)) {
    throw new Error('Mind-map sidecar asset mime type is invalid.')
  }
  return {
    assetId,
    relativePath,
    fileName,
    ...(mimeType === undefined ? {} : { mimeType }),
    sizeBytes,
    sha256
  }
}

function parseImageRecord(
  value: unknown,
  assetIds: ReadonlySet<string>
): MindMapInterchangeImageRecord {
  const required = ['sheetIndex', 'sheetId', 'imageId', 'assetId', 'width', 'height']
  const allowed = [...required, 'topicPath', 'topicId', 'position', 'label', 'style']
  if (!isRecord(value) || !hasAllowedKeys(value, allowed, required)) {
    throw new Error('Mind-map sidecar image record is invalid.')
  }
  const {
    sheetIndex,
    sheetId,
    imageId,
    assetId,
    width,
    height,
    topicPath: rawTopicPath,
    topicId: rawTopicId,
    position: rawPosition,
    label: rawLabel,
    style: rawStyle
  } = value
  if (
    typeof sheetIndex !== 'number'
    || !Number.isSafeInteger(sheetIndex)
    || sheetIndex < 0
    || !isNonEmptyString(sheetId)
    || !isNonEmptyString(imageId)
    || !isNonEmptyString(assetId)
    || !assetIds.has(assetId)
    || typeof width !== 'number'
    || !Number.isFinite(width)
    || width <= 0
    || typeof height !== 'number'
    || !Number.isFinite(height)
    || height <= 0
  ) {
    throw new Error('Mind-map sidecar image record is invalid.')
  }

  const hasTopicPath = rawTopicPath !== undefined
  const hasTopicId = rawTopicId !== undefined
  if (hasTopicPath !== hasTopicId) {
    throw new Error('A sidecar image must include both topicPath and topicId, or neither.')
  }
  const topicPath = hasTopicPath ? parseTopicPath(rawTopicPath) : undefined
  if (hasTopicId && !isNonEmptyString(rawTopicId)) {
    throw new Error('Mind-map sidecar image topic id is invalid.')
  }
  const position = rawPosition === undefined ? undefined : parsePoint(rawPosition)
  if (!hasTopicPath && position === undefined) {
    throw new Error('A free sidecar image must include a finite canvas position.')
  }
  if (rawLabel !== undefined && typeof rawLabel !== 'string') {
    throw new Error('Mind-map sidecar image label is invalid.')
  }
  const style = rawStyle === undefined ? undefined : parseElementStyle(rawStyle)
  return {
    sheetIndex,
    sheetId,
    imageId,
    assetId,
    ...(topicPath === undefined ? {} : { topicPath }),
    ...(hasTopicId ? { topicId: rawTopicId } : {}),
    width,
    height,
    ...(position === undefined ? {} : { position }),
    ...(rawLabel === undefined ? {} : { label: rawLabel }),
    ...(style === undefined ? {} : { style })
  }
}

function parseTopicRecord(
  value: unknown,
  assetIds: ReadonlySet<string>
): MindMapInterchangeTopicRecord {
  const required = ['sheetIndex', 'sheetId', 'topicPath', 'topicId', 'assetIds']
  if (!isRecord(value) || !hasExactKeys(value, required)) {
    throw new Error('Mind-map sidecar topic record is invalid.')
  }
  const { sheetIndex, sheetId, topicPath: rawTopicPath, topicId, assetIds: rawAssetIds } = value
  if (
    typeof sheetIndex !== 'number'
    || !Number.isSafeInteger(sheetIndex)
    || sheetIndex < 0
    || !isNonEmptyString(sheetId)
    || !isNonEmptyString(topicId)
  ) {
    throw new Error('Mind-map sidecar topic record is invalid.')
  }
  const topicPath = parseTopicPath(rawTopicPath)
  if (!Array.isArray(rawAssetIds) || rawAssetIds.length === 0) {
    throw new Error('Mind-map sidecar topic asset ids are invalid.')
  }
  const topicAssetIds: string[] = []
  const seen = new Set<string>()
  for (const assetId of rawAssetIds) {
    if (!isNonEmptyString(assetId) || !assetIds.has(assetId) || seen.has(assetId)) {
      throw new Error('Mind-map sidecar topic asset ids are invalid.')
    }
    seen.add(assetId)
    topicAssetIds.push(assetId)
  }
  return {
    sheetIndex,
    sheetId,
    topicPath,
    topicId,
    assetIds: topicAssetIds
  }
}

function parseTopicPath(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((index) => !Number.isSafeInteger(index) || index < 0)) {
    throw new Error('Mind-map sidecar topic path is invalid.')
  }
  return [...value]
}

function parsePoint(value: unknown): MindMapPoint {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['x', 'y'])
    || typeof value.x !== 'number'
    || !Number.isFinite(value.x)
    || typeof value.y !== 'number'
    || !Number.isFinite(value.y)
  ) {
    throw new Error('Mind-map sidecar image position is invalid.')
  }
  return { x: value.x, y: value.y }
}

function parseElementStyle(value: unknown): MindMapElementStyle {
  const parsed = mindMapElementStyleSchema.strict().safeParse(value)
  if (!parsed.success) throw new Error('Mind-map sidecar image style is invalid.')
  return parsed.data
}

function validateManifestDocumentTargets(
  manifest: MindMapInterchangeManifest,
  document: MindMapDocumentV2
): void {
  for (const topic of manifest.topics) {
    const target = resolveManifestTopic(document, topic.sheetIndex, topic.sheetId, topic.topicPath)
    if (shouldVerifySourceIds(document, topic.sheetIndex) && target.id !== topic.topicId) {
      throw new Error(`Sidecar topic path does not match source topic "${topic.topicId}".`)
    }
  }
  for (const image of manifest.images) {
    if (image.topicPath === undefined) {
      resolveManifestSheet(document, image.sheetIndex, image.sheetId)
      continue
    }
    const target = resolveManifestTopic(document, image.sheetIndex, image.sheetId, image.topicPath)
    if (shouldVerifySourceIds(document, image.sheetIndex) && target.id !== image.topicId) {
      throw new Error(`Sidecar image "${image.imageId}" references a mismatched topic id.`)
    }
  }
}

function resolveManifestSheet(
  document: MindMapDocumentV2,
  sheetIndex: number,
  sourceSheetId: string
) {
  const sheet = document.sheets[sheetIndex]
  if (!sheet) throw new Error(`Sidecar references missing sheet index ${sheetIndex}.`)
  if (shouldVerifySourceIds(document, sheetIndex) && sheet.id !== sourceSheetId) {
    throw new Error(`Sidecar sheet id "${sourceSheetId}" does not match the imported document.`)
  }
  return sheet
}

function resolveManifestTopic(
  document: MindMapDocumentV2,
  sheetIndex: number,
  sourceSheetId: string,
  topicPath: readonly number[]
): MindMapTopicV2 {
  const sheet = resolveManifestSheet(document, sheetIndex, sourceSheetId)
  const topic = topicAtPath(sheet.root, topicPath)
  if (!topic) throw new Error('Sidecar topic path is not present in the imported document.')
  return topic
}

/** Markdown deliberately has no private ids; its parser assigns these stable ids. */
function shouldVerifySourceIds(document: MindMapDocumentV2, sheetIndex: number): boolean {
  const sheet = document.sheets[sheetIndex]
  return sheet !== undefined && sheet.id !== `sheet-${sheetIndex + 1}`
}

function assertTotalAssetBytes(
  assets: readonly Pick<MindMapInterchangeAssetRecord, 'sizeBytes'>[]
): void {
  let total = 0
  for (const asset of assets) {
    total += asset.sizeBytes
    if (!Number.isSafeInteger(total) || total > MIND_MAP_INTERCHANGE_MAX_BYTES) {
      throw new Error(`Mind-map sidecar media exceeds ${MIND_MAP_INTERCHANGE_MAX_BYTES} bytes.`)
    }
  }
}

function isSafeAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
}

function isSafeFileName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes(':')
    && !value.includes('\0')
    && ![...value].some((character) => character < ' ')
}

function isSafeSidecarFileName(value: unknown): value is string {
  return isSafeFileName(value)
    && value !== MIND_MAP_INTERCHANGE_MANIFEST
    && basename(value) === value
}

function isSafeMimeType(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[]
): boolean {
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => key in value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function ensureRealDirectory(path: string): Promise<void> {
  return mkdir(path, { recursive: true }).then(async () => {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Mind-map sidecar path must be a real directory.')
  })
}

/** A missing sidecar is normal; an existing symlink or non-directory is not. */
async function hasRealOptionalDirectory(path: string): Promise<boolean> {
  const info = await lstat(path).catch((error: unknown) => {
    if (isErrno(error) && error.code === 'ENOENT') return null
    throw error
  })
  if (!info) return false
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Mind-map sidecar path must be a real directory.')
  }
  return true
}

function resolveContained(root: string, relativePath: string): string {
  const target = resolve(root, relativePath)
  const relation = relative(resolve(root), target)
  if (
    relation === '..'
    || relation.startsWith(`..${sep}`)
    || relation.includes(`..${sep}`)
    || isAbsolute(relation)
  ) throw new Error('Mind-map sidecar path escapes its directory.')
  return target
}

async function writeAtomically(filePath: string, content: string | Uint8Array): Promise<void> {
  const temporary = `${filePath}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await rename(temporary, filePath)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

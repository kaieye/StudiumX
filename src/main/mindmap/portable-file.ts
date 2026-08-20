/** Main-process filesystem boundary for the single-file `.sxmind` format. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { MindMapAssetRef, MindMapDocumentV2, MindMapTopicV2 } from '../../shared/mindmap/domain/types'
import {
  MIND_MAP_PORTABLE_MAX_BYTES,
  MIND_MAP_PORTABLE_MAX_ASSET_BYTES,
  createMindMapPortablePackage,
  parseMindMapPortablePackage,
  serializeMindMapPortablePackage,
  type MindMapPortableAsset
} from '../../shared/mindmap/portable'
import { MindMapAssetStore } from './mind-map-assets'

const FALLBACK_SLUG = 'mind-map'
const READ_CHUNK_BYTES = 64 * 1024

export type ImportedPortableMindMap = {
  document: MindMapDocumentV2
  importedAssets: MindMapAssetRef[]
}

/** Export one document and every declared asset into a single `.sxmind` file. */
export async function exportMindMapPortableFile(
  document: MindMapDocumentV2,
  workspaceRoot: string,
  destinationDirectory: string
): Promise<{ path: string }> {
  const assetStore = new MindMapAssetStore({ rootPath: join(resolve(workspaceRoot), 'mindmap-assets') })
  const assets: MindMapPortableAsset[] = []
  for (const asset of document.assets) {
    const content = await assetStore.read(asset)
    assets.push({ asset, dataBase64: content.toString('base64') })
  }
  const serialized = serializeMindMapPortablePackage(createMindMapPortablePackage(document, assets))
  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const slug = slugify(document.title) || FALLBACK_SLUG
  const filePath = join(destination, `${slug}.sxmind`)
  await writeAtomically(filePath, serialized)
  return { path: filePath }
}

/**
 * Import a portable file and materialize its assets into the destination
 * workspace.  Asset ids are always regenerated; package ids are untrusted and
 * must never collide with an existing workspace asset.
 */
export async function importMindMapPortableFile(
  sourcePath: string,
  workspaceRoot: string
): Promise<ImportedPortableMindMap> {
  const bytes = await readBoundedPortableFile(sourcePath)
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error(`Portable mind-map source is not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`)
  }
  const pkg = parseMindMapPortablePackage(source)
  const assetStore = new MindMapAssetStore({ rootPath: join(resolve(workspaceRoot), 'mindmap-assets') })
  const idMap = new Map<string, string>()
  const importedAssets: MindMapAssetRef[] = []

  try {
    for (const entry of pkg.assets) {
      const content = Buffer.from(entry.dataBase64, 'base64')
      verifyPortableAssetBytes(entry.asset, content)
      const imported = await assetStore.importFromBytes({
        id: randomUUID(),
        fileName: entry.asset.fileName,
        ...(entry.asset.mimeType ? { mimeType: entry.asset.mimeType } : {}),
        content,
        ...(entry.asset.createdAt ? { createdAt: entry.asset.createdAt } : {})
      })
      idMap.set(entry.asset.id, imported.id)
      importedAssets.push(imported)
    }

    const document = remapDocumentAssets(pkg.document, idMap, importedAssets)
    return { document, importedAssets }
  } catch (error) {
    await Promise.all(importedAssets.map((asset) => assetStore.remove(asset).catch(() => undefined)))
    throw error
  }
}

async function readBoundedPortableFile(sourcePath: string): Promise<Uint8Array> {
  const info = await lstat(sourcePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('Portable mind-map source must be a regular file, not a directory or symlink')
  }
  if (info.size > MIND_MAP_PORTABLE_MAX_BYTES) {
    throw new Error(`Portable mind-map source exceeds ${MIND_MAP_PORTABLE_MAX_BYTES} bytes`)
  }

  const handle = await open(sourcePath, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) {
      throw new Error('Portable mind-map source changed while it was being opened')
    }
    if (opened.size > MIND_MAP_PORTABLE_MAX_BYTES) {
      throw new Error(`Portable mind-map source exceeds ${MIND_MAP_PORTABLE_MAX_BYTES} bytes`)
    }
    const chunks: Buffer[] = []
    let total = 0
    while (total <= MIND_MAP_PORTABLE_MAX_BYTES) {
      const remaining = MIND_MAP_PORTABLE_MAX_BYTES + 1 - total
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining))
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      total += bytesRead
      if (total > MIND_MAP_PORTABLE_MAX_BYTES) {
        throw new Error(`Portable mind-map source exceeds ${MIND_MAP_PORTABLE_MAX_BYTES} bytes`)
      }
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}

function verifyPortableAssetBytes(asset: MindMapAssetRef, content: Buffer): void {
  if (content.byteLength > MIND_MAP_PORTABLE_MAX_ASSET_BYTES) {
    throw new Error(`Portable asset "${asset.id}" exceeds ${MIND_MAP_PORTABLE_MAX_ASSET_BYTES} bytes`)
  }
  if (asset.sizeBytes !== undefined && asset.sizeBytes !== content.byteLength) {
    throw new Error(`Portable asset "${asset.id}" size does not match its bytes`)
  }
  if (asset.sha256 !== undefined) {
    const sha256 = createHash('sha256').update(content).digest('hex')
    if (sha256 !== asset.sha256) {
      throw new Error(`Portable asset "${asset.id}" hash does not match its bytes`)
    }
  }
}

function remapDocumentAssets(
  document: MindMapDocumentV2,
  idMap: ReadonlyMap<string, string>,
  importedAssets: readonly MindMapAssetRef[]
): MindMapDocumentV2 {
  const remapId = (id: string): string => {
    const mapped = idMap.get(id)
    if (!mapped) throw new Error(`Portable document references asset "${id}" without an embedded payload`)
    return mapped
  }
  return {
    ...document,
    assets: importedAssets.map((asset) => ({ ...asset })),
    sheets: document.sheets.map((sheet) => ({
      ...sheet,
      images: sheet.images?.map((image) => ({ ...image, assetId: remapId(image.assetId) })),
      root: remapTopicAssets(sheet.root, remapId)
    }))
  }
}

function remapTopicAssets(topic: MindMapTopicV2, remapId: (id: string) => string): MindMapTopicV2 {
  return {
    ...topic,
    ...(topic.assetIds ? { assetIds: topic.assetIds.map(remapId) } : {}),
    children: topic.children.map((child) => remapTopicAssets(child, remapId))
  }
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, filePath)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

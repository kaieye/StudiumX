/**
 * Main-process `.xmind` file import/export (docs/mindmap/design.md §7, slice S6).
 *
 * A `.xmind` file (XMind 2020+) is a ZIP archive containing `content.json` (an
 * array of sheets) plus optional `metadata.json` / `manifest.json` /
 * `Thumbnails/`. We only need `content.json`. ZIP codec is `fflate` (pure JS,
 * no native deps — matches the local-first ethos).
 *
 * The pure helpers `buildXmindZip` / `parseXmindZip` are unit-testable without
 * touching the filesystem; `readXmindFile` / `exportXmindFile` wrap them with
 * `node:fs/promises` I/O.
 */
import { lstat, mkdir, open, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import {
  buildXmindExportCompatibilityReport,
  documentToXmindContent,
  documentV2ToXmindContent,
  type XmindV2ExportSheet,
  xmindContentToDocument
} from '../../shared/mindmap/xmind-converter'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'
import { convertSheetToV1 } from '../../shared/mindmap/v2-to-v1'
import {
  buildXmindImportCompatibilityReport,
  type XmindCompatibilityReport
} from '../../shared/mindmap/xmind-compatibility'
import type { MindMapAssetRef } from '../../shared/mindmap/domain/types'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'

/** Filename inside the ZIP that holds the serialized sheet array. */
const CONTENT_ENTRY = 'content.json'

/**
 * Import budgets are deliberately local technical limits, not provider quotas.
 * We only need `content.json`; filtering before inflate avoids expanding
 * unrelated attachments/thumbnails and bounds hostile ZIP metadata.
 */
const MAX_XMIND_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_XMIND_ENTRIES = 128
const MAX_XMIND_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_XMIND_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024

/** One bounded PNG candidate extracted from an XMind `attachments/` entry. */
export type XmindEmbeddedImage = {
  zipPath: string
  fileName: string
  mimeType: 'image/png'
  bytes: Uint8Array
}

/** Callback used by the main-process importer to copy one embedded image. */
export type XmindEmbeddedImageImporter =
  (image: XmindEmbeddedImage) => Promise<MindMapAssetRef> | MindMapAssetRef

export type XmindFileImportOptions = {
  nowIso?: string
  importEmbeddedImage?: XmindEmbeddedImageImporter
}

export type XmindFileImportResult = {
  document: MindMapDocument
  compatibilityReport: XmindCompatibilityReport
  /** Metadata for assets copied by the optional importer; never absolute paths. */
  assets?: MindMapAssetRef[]
}

type ParsedXmindArchive = {
  content: unknown
  embeddedImages: Map<string, XmindEmbeddedImage>
}

/** Minimal manifest so XMind tolerates the archive. */
const MANIFEST_JSON: Record<string, unknown> = {
  'file-entries': { 'content.json': {} }
}

/** Minimal metadata stamping the creator for XMind tolerance. */
const METADATA_JSON: Record<string, unknown> = {
  creator: { name: 'StudiumX', version: '0.1.3' }
}

/** Fallback filename slug when a safe title-derived slug cannot be produced. */
const FALLBACK_SLUG = 'mind-map'

/**
 * Encode a `MindMapDocument` into `.xmind` ZIP bytes (`content.json` plus
 * minimal `metadata.json` / `manifest.json`). Pure — no I/O.
 */
export function buildXmindZip(doc: MindMapDocument): Uint8Array {
  const contentJson = JSON.stringify(documentToXmindContent(doc))
  return zipSync({
    [CONTENT_ENTRY]: strToU8(contentJson),
    'metadata.json': strToU8(JSON.stringify(METADATA_JSON)),
    'manifest.json': strToU8(JSON.stringify(MANIFEST_JSON))
  })
}

/**
 * Build a `.xmind` ZIP from a v2 document, preserving theme attributes
 * (background, branch colors, font) in the sheet theme block (§7.5/§11).
 */
export function buildXmindZipV2(doc: MindMapDocumentV2): Uint8Array {
  const exportSheets = v2DocumentExportSheets(doc)
  const contentJson = JSON.stringify(documentV2ToXmindContent(exportSheets, doc.theme))
  return zipSync({
    [CONTENT_ENTRY]: strToU8(contentJson),
    'metadata.json': strToU8(JSON.stringify(METADATA_JSON)),
    'manifest.json': strToU8(JSON.stringify(MANIFEST_JSON))
  })
}

/**
 * Build a `.xmind` ZIP from a v2 document AND retain the structured
 * compatibility audit for the exact export payload. Mirrors
 * `parseXmindZipWithCompatibilityReport` on the import side; the legacy
 * `buildXmindZipV2` helper keeps returning only the bytes so existing
 * callers remain source-compatible.
 */
export function buildXmindZipV2WithCompatibilityReport(doc: MindMapDocumentV2): {
  bytes: Uint8Array
  compatibilityReport: XmindCompatibilityReport
} {
  const bytes = buildXmindZipV2(doc)
  return {
    bytes,
    compatibilityReport: buildXmindExportCompatibilityReport(doc)
  }
}

/** Map a v2 document's sheets to the `XmindV2ExportSheet` shape used by both the ZIP builder and its report. */
function v2DocumentExportSheets(
  doc: MindMapDocumentV2
): XmindV2ExportSheet[] {
  return doc.sheets.map((sheet) => {
    const relationships = convertSheetToV1(sheet).relationships
    return {
      id: sheet.id,
      title: sheet.title,
      root: sheet.root,
      structureClass: sheet.layout.structureClass,
      relationships
    }
  })
}

/**
 * Decode `.xmind` ZIP bytes into a `MindMapDocument`. Unknown ZIP entries are
 * tolerated and ignored. Throws a clear error if `content.json` is missing.
 * Pure — no I/O.
 */
export function parseXmindZip(bytes: Uint8Array): MindMapDocument {
  return parseXmindZipWithCompatibilityReport(bytes).document
}

/**
 * Decode an `.xmind` ZIP and retain the structured compatibility audit that
 * corresponds to the exact `content.json` payload being converted.  The
 * legacy `parseXmindZip` helper above intentionally keeps returning only the
 * document so existing callers remain source-compatible.
 */
export function parseXmindZipWithCompatibilityReport(bytes: Uint8Array): {
  document: MindMapDocument
  compatibilityReport: XmindCompatibilityReport
} {
  const archive = decodeXmindZip(bytes)
  return {
    document: xmindContentToDocument(archive.content),
    compatibilityReport: buildXmindImportCompatibilityReport(archive.content)
  }
}

/**
 * Read a `.xmind` file from disk and map its `content.json` to a
 * `MindMapDocument`.
 */
export async function readXmindFile(sourcePath: string): Promise<MindMapDocument> {
  return (await readXmindFileWithCompatibilityReport(sourcePath)).document
}

/**
 * Read an XMind archive and return both the converted document and the
 * compatibility report for the source content.  File safety checks are shared
 * with the legacy `readXmindFile` path.
 */
export async function readXmindFileWithCompatibilityReport(
  sourcePath: string,
  options: XmindFileImportOptions = {}
): Promise<XmindFileImportResult> {
  const bytes = await readBoundedXmindFile(sourcePath)
  const archive = decodeXmindZip(bytes)
  const imageSources = collectImageSources(archive.content)
  const selectedImagePath = imageSources.find((path) => archive.embeddedImages.has(path))

  let importedAsset: MindMapAssetRef | undefined
  const importedImagePaths = new Set<string>()
  if (selectedImagePath !== undefined && options.importEmbeddedImage !== undefined) {
    importedAsset = await options.importEmbeddedImage(
      archive.embeddedImages.get(selectedImagePath)!
    )
    if (
      importedAsset === undefined ||
      typeof importedAsset.id !== 'string' ||
      importedAsset.id.length === 0
    ) {
      throw new Error('XMind embedded image importer returned an invalid asset id')
    }
    importedImagePaths.add(selectedImagePath)
  }

  const assetIds = new Map<string, string>()
  if (selectedImagePath !== undefined && importedAsset !== undefined) {
    assetIds.set(selectedImagePath, importedAsset.id)
  }
  const converterOptions = {
    ...(options.nowIso !== undefined ? { nowIso: options.nowIso } : {}),
    ...(assetIds.size > 0
      ? { assetIdForPath: (path: string) => assetIds.get(path) }
      : {})
  }
  return {
    document: xmindContentToDocument(archive.content, converterOptions),
    compatibilityReport: buildXmindImportCompatibilityReport(archive.content, {
      importedImagePaths
    }),
    ...(importedAsset !== undefined ? { assets: [importedAsset] } : {})
  }
}

function decodeXmindZip(bytes: Uint8Array): ParsedXmindArchive {
  if (bytes.byteLength > MAX_XMIND_ARCHIVE_BYTES) {
    throw new Error(
      `.xmind archive exceeds the ${MAX_XMIND_ARCHIVE_BYTES} byte safety limit`
    )
  }

  let entries: Record<string, Uint8Array>
  try {
    let entryCount = 0
    let totalUncompressedBytes = 0
    const seenNames = new Set<string>()
    entries = unzipSync(bytes, {
      filter: (entry) => {
        entryCount += 1
        if (entryCount > MAX_XMIND_ENTRIES) {
          throw new Error(
            `.xmind archive contains more than ${MAX_XMIND_ENTRIES} entries`
          )
        }
        if (!isSafeZipEntryName(entry.name)) {
          throw new Error(`.xmind archive contains an unsafe entry path: ${entry.name}`)
        }
        if (seenNames.has(entry.name)) {
          throw new Error(`.xmind archive contains a duplicate entry: ${entry.name}`)
        }
        seenNames.add(entry.name)
        if (entry.originalSize > MAX_XMIND_ENTRY_BYTES) {
          throw new Error(
            `.xmind entry ${entry.name} exceeds the ${MAX_XMIND_ENTRY_BYTES} byte safety limit`
          )
        }
        totalUncompressedBytes += entry.originalSize
        if (totalUncompressedBytes > MAX_XMIND_TOTAL_UNCOMPRESSED_BYTES) {
          throw new Error(
            `.xmind archive exceeds the ${MAX_XMIND_TOTAL_UNCOMPRESSED_BYTES} byte uncompressed safety limit`
          )
        }
        return entry.name === CONTENT_ENTRY || embeddedImageFileName(entry.name) !== undefined
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('.xmind archive')) throw new Error(message)
    throw new Error(`Not a valid .xmind ZIP archive: ${message}`)
  }

  const contentEntry = entries[CONTENT_ENTRY]
  if (!contentEntry) {
    throw new Error('.xmind archive is missing content.json')
  }

  let content: unknown
  try {
    content = JSON.parse(strFromU8(contentEntry))
  } catch (error) {
    throw new Error(`content.json is not valid JSON: ${(error as Error).message}`)
  }

  const embeddedImages = new Map<string, XmindEmbeddedImage>()
  for (const [zipPath, imageBytes] of Object.entries(entries)) {
    const fileName = embeddedImageFileName(zipPath)
    if (fileName === undefined) continue
    embeddedImages.set(zipPath, {
      zipPath,
      fileName,
      mimeType: 'image/png',
      bytes: imageBytes
    })
  }
  return { content, embeddedImages }
}

/**
 * Read a user-selected archive without loading an unbounded file into memory.
 *
 * The initial lstat rejects directories and symlinks.  The descriptor stat and
 * identity check closes the common replacement race between that check and
 * opening the file; the chunked read also catches a file that grows after the
 * initial size check.
 */
async function readBoundedXmindFile(sourcePath: string): Promise<Uint8Array> {
  const sourceInfo = await lstat(sourcePath)
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
    throw new Error('.xmind source must be a regular file, not a directory or symlink')
  }
  if (sourceInfo.size > MAX_XMIND_ARCHIVE_BYTES) {
    throw new Error(
      `.xmind source exceeds the ${MAX_XMIND_ARCHIVE_BYTES} byte safety limit`
    )
  }

  const handle = await open(sourcePath, 'r')
  try {
    const openedInfo = await handle.stat()
    if (
      !openedInfo.isFile() ||
      openedInfo.dev !== sourceInfo.dev ||
      openedInfo.ino !== sourceInfo.ino
    ) {
      throw new Error('.xmind source changed while it was being opened')
    }
    if (openedInfo.size > MAX_XMIND_ARCHIVE_BYTES) {
      throw new Error(
        `.xmind source exceeds the ${MAX_XMIND_ARCHIVE_BYTES} byte safety limit`
      )
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    const chunkSize = 64 * 1024
    while (totalBytes <= MAX_XMIND_ARCHIVE_BYTES) {
      const remaining = MAX_XMIND_ARCHIVE_BYTES + 1 - totalBytes
      const chunk = Buffer.allocUnsafe(Math.min(chunkSize, remaining))
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      totalBytes += bytesRead
      if (totalBytes > MAX_XMIND_ARCHIVE_BYTES) {
        throw new Error(
          `.xmind source exceeds the ${MAX_XMIND_ARCHIVE_BYTES} byte safety limit`
        )
      }
    }
    return Buffer.concat(chunks, totalBytes)
  } finally {
    await handle.close()
  }
}

/**
 * Build a `.xmind` ZIP from a `MindMapDocument` and write it into
 * `destinationDirectory` as `<slug>.xmind`. Returns the written absolute path.
 */
export async function exportXmindFile(
  doc: MindMapDocument,
  destinationDirectory: string
): Promise<{ path: string }> {
  const slug = slugify(doc.title) || FALLBACK_SLUG
  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const filePath = join(destination, `${slug}.xmind`)
  await writeFile(filePath, buildXmindZip(doc))
  return { path: filePath }
}

/**
 * Export a v2 document to .xmind, preserving theme attributes.
 */
export async function exportXmindFileV2(
  doc: MindMapDocumentV2,
  destinationDirectory: string
): Promise<{ path: string }> {
  const slug = slugify(doc.title) || FALLBACK_SLUG
  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const filePath = join(destination, `${slug}.xmind`)
  await writeFile(filePath, buildXmindZipV2(doc))
  return { path: filePath }
}

/** Return a basename only for the one-level embedded PNG shape we support. */
function embeddedImageFileName(zipPath: string): string | undefined {
  const match = /^attachments\/([^/\\]+\.png)$/i.exec(zipPath)
  if (!match) return undefined
  const fileName = match[1]
  if (!fileName || fileName === '.' || fileName === '..') return undefined
  return fileName
}

/** Collect topic image sources in sheet/tree order, without retaining foreign values. */
function collectImageSources(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const sources: string[] = []
  const seen = new Set<string>()
  const visitTopic = (rawTopic: unknown): void => {
    if (typeof rawTopic !== 'object' || rawTopic === null || Array.isArray(rawTopic)) return
    const topic = rawTopic as Record<string, unknown>
    const image = topic.image
    if (typeof image === 'object' && image !== null && !Array.isArray(image)) {
      const src = (image as Record<string, unknown>).src
      if (typeof src === 'string' && src.length > 0 && !seen.has(src)) {
        seen.add(src)
        sources.push(src)
      }
    }
    const children = topic.children
    if (typeof children !== 'object' || children === null || Array.isArray(children)) return
    const attached = (children as Record<string, unknown>).attached
    if (!Array.isArray(attached)) return
    for (const child of attached) visitTopic(child)
  }

  for (const rawSheet of content) {
    if (typeof rawSheet !== 'object' || rawSheet === null || Array.isArray(rawSheet)) continue
    visitTopic((rawSheet as Record<string, unknown>).rootTopic)
  }
  return sources
}

function isSafeZipEntryName(name: string): boolean {
  if (!name || name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) return false
  return name.split(/[\\/]/).every((segment) => segment !== '..')
}

/**
 * Lowercase-alphanumeric slug with single dashes, trimmed of leading/trailing
 * dashes. Returns '' when there is nothing slug-safe in `title`.
 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug
}

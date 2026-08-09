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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import {
  documentToXmindContent,
  xmindContentToDocument
} from '../../shared/mindmap/xmind-converter'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'

/** Filename inside the ZIP that holds the serialized sheet array. */
const CONTENT_ENTRY = 'content.json'

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
 * Decode `.xmind` ZIP bytes into a `MindMapDocument`. Unknown ZIP entries are
 * tolerated and ignored. Throws a clear error if `content.json` is missing.
 * Pure — no I/O.
 */
export function parseXmindZip(bytes: Uint8Array): MindMapDocument {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (error) {
    throw new Error(`Not a valid .xmind ZIP archive: ${(error as Error).message}`)
  }

  const contentEntry = entries[CONTENT_ENTRY]
  if (!contentEntry) {
    throw new Error('.xmind archive is missing content.json')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(contentEntry))
  } catch (error) {
    throw new Error(`content.json is not valid JSON: ${(error as Error).message}`)
  }
  return xmindContentToDocument(parsed)
}

/**
 * Read a `.xmind` file from disk and map its `content.json` to a
 * `MindMapDocument`.
 */
export async function readXmindFile(sourcePath: string): Promise<MindMapDocument> {
  const bytes = await readFile(sourcePath)
  return parseXmindZip(new Uint8Array(bytes))
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
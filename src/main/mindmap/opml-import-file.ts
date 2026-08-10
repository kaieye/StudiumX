/**
 * Main-process OPML import for the supported mind-map subset.
 *
 * XML parsing remains pure in `shared/mindmap`; this module owns only the
 * user-selected file boundary and converts structured parse failures into an
 * IPC-safe error. Files are opened only after an lstat regular-file check and
 * are read in bounded chunks before decoding.
 */
import { lstat, open } from 'node:fs/promises'
import { TextDecoder } from 'node:util'

import { mindMapOpmlToDocument } from '../../shared/mindmap/opml-import'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'

const MAX_OPML_BYTES = 2 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024

/** Read and parse an OPML 2.0 mind-map file selected by the user. */
export async function importMindMapOpmlFile(
  sourcePath: string
): Promise<MindMapDocumentV2> {
  const bytes = await readBoundedOpmlFile(sourcePath)

  let opml: string
  try {
    opml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`OPML source is not valid UTF-8: ${message}`)
  }

  const result = mindMapOpmlToDocument(opml)
  if (!result.ok) {
    const location = result.error.line === undefined ? '' : ` at line ${result.error.line}`
    throw new Error(
      `OPML import failed (${result.error.code})${location}: ${result.error.message}`
    )
  }
  return result.document
}

/**
 * Read a user-selected OPML file without following a final symlink or loading
 * more than the parser's local technical input budget.
 */
async function readBoundedOpmlFile(sourcePath: string): Promise<Uint8Array> {
  const sourceInfo = await lstat(sourcePath)
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
    throw new Error('OPML source must be a regular file, not a directory or symlink')
  }
  if (sourceInfo.size > MAX_OPML_BYTES) {
    throw new Error(`OPML source exceeds the ${MAX_OPML_BYTES} byte safety limit`)
  }

  const handle = await open(sourcePath, 'r')
  try {
    const openedInfo = await handle.stat()
    if (
      !openedInfo.isFile() ||
      openedInfo.dev !== sourceInfo.dev ||
      openedInfo.ino !== sourceInfo.ino
    ) {
      throw new Error('OPML source changed while it was being opened')
    }
    if (openedInfo.size > MAX_OPML_BYTES) {
      throw new Error(`OPML source exceeds the ${MAX_OPML_BYTES} byte safety limit`)
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    while (totalBytes <= MAX_OPML_BYTES) {
      const remaining = MAX_OPML_BYTES + 1 - totalBytes
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining))
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      totalBytes += bytesRead
      if (totalBytes > MAX_OPML_BYTES) {
        throw new Error(`OPML source exceeds the ${MAX_OPML_BYTES} byte safety limit`)
      }
    }
    return Buffer.concat(chunks, totalBytes)
  } finally {
    await handle.close()
  }
}

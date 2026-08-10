/**
 * Main-process Markdown import for the supported mind-map subset.
 *
 * The parser remains pure in `shared/mindmap`; this module owns only the
 * user-selected file boundary and turns a structured parse failure into an
 * IPC-safe error. Files are opened only after an lstat regular-file check and
 * are read in bounded chunks so an import cannot load an unbounded artifact.
 */
import { lstat, open } from 'node:fs/promises'
import { TextDecoder } from 'node:util'

import { mindMapMarkdownToDocument } from '../../shared/mindmap/markdown-import'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024

/** Read and parse a Markdown mind-map file selected by the user. */
export async function importMindMapMarkdownFile(
  sourcePath: string
): Promise<MindMapDocumentV2> {
  const bytes = await readBoundedMarkdownFile(sourcePath)

  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Markdown source is not valid UTF-8: ${message}`)
  }

  const result = mindMapMarkdownToDocument(markdown)
  if (!result.ok) {
    const location = result.error.line === undefined ? '' : ` at line ${result.error.line}`
    throw new Error(
      `Markdown import failed (${result.error.code})${location}: ${result.error.message}`
    )
  }
  return result.document
}

/**
 * Read a user-selected Markdown file without following a final symlink or
 * loading more than the parser's local technical input budget.
 */
async function readBoundedMarkdownFile(sourcePath: string): Promise<Uint8Array> {
  const sourceInfo = await lstat(sourcePath)
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
    throw new Error('Markdown source must be a regular file, not a directory or symlink')
  }
  if (sourceInfo.size > MAX_MARKDOWN_BYTES) {
    throw new Error(
      `Markdown source exceeds the ${MAX_MARKDOWN_BYTES} byte safety limit`
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
      throw new Error('Markdown source changed while it was being opened')
    }
    if (openedInfo.size > MAX_MARKDOWN_BYTES) {
      throw new Error(
        `Markdown source exceeds the ${MAX_MARKDOWN_BYTES} byte safety limit`
      )
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    while (totalBytes <= MAX_MARKDOWN_BYTES) {
      const remaining = MAX_MARKDOWN_BYTES + 1 - totalBytes
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining))
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      totalBytes += bytesRead
      if (totalBytes > MAX_MARKDOWN_BYTES) {
        throw new Error(
          `Markdown source exceeds the ${MAX_MARKDOWN_BYTES} byte safety limit`
        )
      }
    }
    return Buffer.concat(chunks, totalBytes)
  } finally {
    await handle.close()
  }
}

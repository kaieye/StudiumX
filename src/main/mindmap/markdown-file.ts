/**
 * Main-process Markdown export for a v2 mind map.
 *
 * Serialization remains in the pure shared exporter; this module only owns the
 * destination-directory boundary and the deterministic file name.  Renderer
 * code never receives filesystem access for this path.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { mindMapDocumentToMarkdown } from '../../shared/mindmap/markdown-export'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'

const FALLBACK_SLUG = 'mind-map'

/**
 * Serialize a v2 document to `<safe-title>.md` in the selected directory.
 * Notes are included by default by the shared Markdown exporter.
 */
export async function exportMindMapMarkdownFile(
  doc: MindMapDocumentV2,
  destinationDirectory: string
): Promise<{ path: string }> {
  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const slug = slugify(doc.title) || FALLBACK_SLUG
  const filePath = join(destination, `${slug}.md`)
  await writeFile(filePath, mindMapDocumentToMarkdown(doc), 'utf8')
  return { path: filePath }
}

/** Keep generated names local and predictable; never derive a path segment from
 * untrusted separators or traversal markers. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Main-process OPML export for a v2 mind map.
 *
 * The tree serializer lives in the shared layer; this module owns only the
 * filesystem destination boundary and deterministic file naming.  Renderer
 * code never receives filesystem access for this path.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { mindMapDocumentToOpml } from '../../shared/mindmap/opml-export'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'

const FALLBACK_SLUG = 'mind-map'

/** Serialize a v2 document to `<safe-title>.opml` in the selected directory. */
export async function exportMindMapOpmlFile(
  doc: MindMapDocumentV2,
  destinationDirectory: string
): Promise<{ path: string }> {
  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const slug = slugify(doc.title) || FALLBACK_SLUG
  const filePath = join(destination, `${slug}.opml`)
  await writeFile(filePath, mindMapDocumentToOpml(doc), 'utf8')
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

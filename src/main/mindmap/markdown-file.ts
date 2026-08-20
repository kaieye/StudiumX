/**
 * Main-process Markdown export for a v2 mind map.
 *
 * Serialization remains in the pure shared exporter; this module owns the
 * destination-directory boundary, asset reads, and the optional neighbouring
 * media sidecar. Renderer code never receives filesystem access for this path.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { mindMapDocumentToMarkdown } from '../../shared/mindmap/markdown-export'
import type { MindMapDocumentV2, MindMapTopicV2 } from '../../shared/mindmap/domain/types'
import {
  buildMindMapInterchangeManifest,
  markdownImageLinksForManifest,
  readMindMapInterchangeAssetPayloads,
  writeMindMapInterchangeSidecar
} from './mind-map-interchange'

const FALLBACK_SLUG = 'mind-map'

/**
 * Serialize a v2 document to `<safe-title>.md` in the selected directory.
 * When `workspaceRoot` is supplied, declared assets are copied into a
 * neighbouring `<file>.assets/` sidecar and attached images become relative
 * Markdown links. The two-argument form is retained for callers exporting
 * documents without assets.
 */
export async function exportMindMapMarkdownFile(
  doc: MindMapDocumentV2,
  destinationDirectory: string
): Promise<{ path: string }>
export async function exportMindMapMarkdownFile(
  doc: MindMapDocumentV2,
  workspaceRoot: string,
  destinationDirectory: string
): Promise<{ path: string }>
export async function exportMindMapMarkdownFile(
  doc: MindMapDocumentV2,
  workspaceRootOrDestination: string,
  maybeDestinationDirectory?: string
): Promise<{ path: string }> {
  const workspaceRoot = maybeDestinationDirectory === undefined
    ? undefined
    : workspaceRootOrDestination
  const destinationDirectory = maybeDestinationDirectory ?? workspaceRootOrDestination
  if (doc.assets.length > 0 && workspaceRoot === undefined) {
    throw new Error('Markdown export with media requires the workspace root.')
  }

  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const slug = slugify(doc.title) || FALLBACK_SLUG
  const filePath = join(destination, `${slug}.md`)

  if (workspaceRoot === undefined) {
    await writeFile(filePath, mindMapDocumentToMarkdown(doc), 'utf8')
    return { path: filePath }
  }

  const payloads = await readMindMapInterchangeAssetPayloads(doc, workspaceRoot)
  const manifest = buildMindMapInterchangeManifest(doc)
  const sidecarDirectoryName = basename(`${filePath}.assets`)
  const links = markdownImageLinksForManifest(manifest, sidecarDirectoryName)
  const markdown = mindMapDocumentToMarkdown(doc, {
    imageLinksForTopic: (topic: MindMapTopicV2) => links.get(topic.id) ?? []
  })

  // Materialize media first; if writing the text file fails, the sidecar is
  // still a valid explicit export artifact and can be retried safely.
  await writeMindMapInterchangeSidecar(filePath, doc, payloads, manifest)
  await writeFile(filePath, markdown, 'utf8')
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

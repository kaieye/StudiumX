/**
 * Main-process OPML export for a v2 mind map.
 *
 * Serialization remains in the shared layer; this module owns the destination
 * boundary and the optional neighbouring media sidecar used for exact image
 * restoration on re-import.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { mindMapDocumentToOpml } from '../../shared/mindmap/opml-export'
import type { MindMapDocumentV2, MindMapTopicV2 } from '../../shared/mindmap/domain/types'
import {
  buildMindMapInterchangeManifest,
  opmlImagePathsForManifest,
  readMindMapInterchangeAssetPayloads,
  writeMindMapInterchangeSidecar
} from './mind-map-interchange'

const FALLBACK_SLUG = 'mind-map'

/** Serialize a v2 document to `<safe-title>.opml` in the selected directory. */
export async function exportMindMapOpmlFile(
  doc: MindMapDocumentV2,
  destinationDirectory: string
): Promise<{ path: string }>
export async function exportMindMapOpmlFile(
  doc: MindMapDocumentV2,
  workspaceRoot: string,
  destinationDirectory: string
): Promise<{ path: string }>
export async function exportMindMapOpmlFile(
  doc: MindMapDocumentV2,
  workspaceRootOrDestination: string,
  maybeDestinationDirectory?: string
): Promise<{ path: string }> {
  const workspaceRoot = maybeDestinationDirectory === undefined
    ? undefined
    : workspaceRootOrDestination
  const destinationDirectory = maybeDestinationDirectory ?? workspaceRootOrDestination
  if (doc.assets.length > 0 && workspaceRoot === undefined) {
    throw new Error('OPML export with media requires the workspace root.')
  }

  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const slug = slugify(doc.title) || FALLBACK_SLUG
  const filePath = join(destination, `${slug}.opml`)

  if (workspaceRoot === undefined) {
    await writeFile(filePath, mindMapDocumentToOpml(doc), 'utf8')
    return { path: filePath }
  }

  const payloads = await readMindMapInterchangeAssetPayloads(doc, workspaceRoot)
  const manifest = buildMindMapInterchangeManifest(doc)
  const imagePaths = opmlImagePathsForManifest(manifest)
  const opml = mindMapDocumentToOpml(doc, {
    imagePathsForTopic: (topic: MindMapTopicV2) => imagePaths.get(topic.id) ?? []
  })

  await writeMindMapInterchangeSidecar(filePath, doc, payloads, manifest)
  await writeFile(filePath, opml, 'utf8')
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

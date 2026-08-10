/**
 * Main-process PNG export for a renderer-rasterized mind-map sheet.
 *
 * The renderer owns SVG-to-canvas rasterization; this seam owns only strict
 * artifact validation, the selected destination directory, and a predictable
 * filename.  No renderer-provided path or extension is used directly.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  inspectMindMapPngExportArtifact,
  type MindMapPngExportArtifact,
  type MindMapPngExportDimensions
} from '../../shared/mindmap/png-export'

const FALLBACK_SLUG = 'mind-map'

export type MindMapPngFileExport = MindMapPngExportArtifact & {
  title: string
}

/** Write a validated PNG artifact to `<safe-title>.png` in the destination. */
export async function exportMindMapPngFile(
  input: MindMapPngFileExport,
  destinationDirectory: string,
  expectedDimensions?: MindMapPngExportDimensions
): Promise<{ path: string }> {
  const inspection = inspectMindMapPngExportArtifact(input, expectedDimensions)
  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const slug = slugify(input.title) || FALLBACK_SLUG
  const filePath = join(destination, `${slug}.png`)
  await writeFile(filePath, inspection.bytes)
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

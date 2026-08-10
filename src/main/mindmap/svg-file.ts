/**
 * Main-process SVG export for a laid-out mind-map sheet.
 *
 * The shared serializer owns the static-SVG safety boundary; this module owns
 * only the selected destination directory and deterministic file name.
 * Renderer code never receives filesystem access for this path.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  serializeMindMapSvg,
  type MindMapSvgExportInput
} from '../../shared/mindmap/svg-export'

const FALLBACK_SLUG = 'mind-map'

/** Serialize a laid-out sheet to `<safe-title>.svg` in the selected directory. */
export async function exportMindMapSvgFile(
  input: MindMapSvgExportInput,
  destinationDirectory: string
): Promise<{ path: string }> {
  const destination = resolve(destinationDirectory)
  await mkdir(destination, { recursive: true })
  const slug = slugify(input.title) || FALLBACK_SLUG
  const filePath = join(destination, `${slug}.svg`)
  await writeFile(filePath, serializeMindMapSvg(input), 'utf8')
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

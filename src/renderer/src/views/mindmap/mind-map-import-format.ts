/** Formats accepted by the native mind-map import boundary. */
export type MindMapImportFormat = 'markdown' | 'opml'

/**
 * Resolve a selected file name to the matching import contract.
 *
 * The renderer receives an Electron file path separately, but the visible file
 * name is the safer format hint: it avoids treating arbitrary path fragments
 * as a format and keeps the routing deterministic for uppercase extensions.
 */
export function mindMapImportFormatForFileName(
  fileName: string | null | undefined
): MindMapImportFormat | null {
  if (!fileName) return null
  const extension = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  switch (extension) {
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'opml':
      return 'opml'
    default:
      return null
  }
}

/** Native file-input filter for all supported mind-map imports. */
export const MIND_MAP_IMPORT_ACCEPT = '.md,.markdown,.opml'

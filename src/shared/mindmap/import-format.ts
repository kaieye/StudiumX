/**
 * Formats accepted by the native mind-map import boundary.
 *
 * Shared between the renderer (which used to gate a native file input) and the
 * main process (which now owns the dialog + format routing). The file dialog
 * runs in the main process so the same import works identically on macOS and
 * Windows — a renderer `File` object cannot resolve an on-disk path on every
 * platform.
 */
export type MindMapImportFormat = 'markdown' | 'opml' | 'portable'

/**
 * Resolve a selected file name to the matching import contract.
 *
 * The file name is the safer format hint than a path fragment: it avoids
 * treating arbitrary path fragments as a format and keeps the routing
 * deterministic for uppercase extensions on every OS.
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
    case 'sxmind':
      return 'portable'
    default:
      return null
  }
}

/** Native file-input filter for all supported mind-map imports. */
export const MIND_MAP_IMPORT_ACCEPT = '.md,.markdown,.opml,.sxmind'

/** Dialog filter extensions (no leading dots) for the main-process picker. */
export const MIND_MAP_IMPORT_EXTENSIONS = ['md', 'markdown', 'opml', 'sxmind'] as const

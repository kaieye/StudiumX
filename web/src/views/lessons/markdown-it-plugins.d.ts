/**
 * Web-local type shim for the markdown-it plugins used by the reused desktop
 * MarkdownPreview (imported via @renderer/markdown-preview).
 *
 * The desktop ships identical ambient declarations in a sibling .d.ts under
 * the repo-root renderer source, but that file is OUTSIDE the Web tsconfig
 * include scope (the Web config only includes the web source tree), so the Web
 * typecheck cannot see it. The packages markdown-it-mark and
 * markdown-it-task-lists ship no bundled types and have no @types packages, so
 * without this shim importing the desktop MarkdownPreview fails with TS7016.
 *
 * This is a TYPE SHIM ONLY (not renderer source, which is read-only): the
 * runtime packages resolve normally via Vite at bundle time. There is no
 * duplicate-declaration conflict because the desktop .d.ts is not part of the
 * Web program.
 */

declare module 'markdown-it-mark' {
  import type MarkdownIt from 'markdown-it'

  const markdownItMark: MarkdownIt.PluginSimple
  export default markdownItMark
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'

  const markdownItTaskLists: MarkdownIt.PluginWithOptions<{
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
  }>
  export default markdownItTaskLists
}

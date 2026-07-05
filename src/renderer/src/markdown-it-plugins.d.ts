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

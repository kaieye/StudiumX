import type { MindMapLink, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'

function appendMarkdownBlock(title: string, markdown: string): string {
  const base = title.trimEnd()
  return base ? `${base}\n${markdown}` : markdown
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, '\\$1')
}

export function formulaMarkdown(formula: string, inline = false): string {
  const value = formula.trim()
  if (!value) return ''
  // Inline formulas render mid-text with a single `$…$`; block formulas use
  // a display-mode `$$…$$` block so the formula sits on its own line.
  return inline ? `$${value}$` : `$$\n${value}\n$$`
}

export function linkMarkdown(link: Pick<MindMapLink, 'url' | 'title'>): string {
  const label = escapeMarkdownLinkLabel(link.title?.trim() || link.url)
  return `[${label}](${link.url})`
}

export function appendFormulaMarkdown(title: string, formula: string, inline = false): string {
  const markdown = formulaMarkdown(formula, inline)
  if (!markdown) return title.trimEnd()
  // Inline formulas sit directly in the text flow without a line break; block
  // formulas are appended on their own line as a display block.
  if (inline) return title ? `${title}${markdown}` : markdown
  return appendMarkdownBlock(title, markdown)
}

export function appendLinkMarkdown(title: string, link: Pick<MindMapLink, 'url' | 'title'>): string {
  return appendMarkdownBlock(title, linkMarkdown(link))
}

/**
 * Legacy documents may still carry formulas and links in dedicated topic
 * fields. Render them as ordinary Markdown content so they are visible in the
 * node instead of falling back to hidden icon buttons. New edits are written
 * directly to `title` by the formula/link editors.
 */
export function mindMapTopicDisplayTitle(topic: Pick<MindMapTopicV2, 'title' | 'formula' | 'links'>): string {
  let title = topic.title
  if (topic.formula) {
    const markdown = formulaMarkdown(topic.formula)
    if (markdown && !title.includes(markdown)) title = appendMarkdownBlock(title, markdown)
  }
  for (const link of topic.links ?? []) {
    const markdown = linkMarkdown(link)
    if (!title.includes(markdown)) title = appendMarkdownBlock(title, markdown)
  }
  return title
}

/** Remove the exact Markdown fragments generated for a set of managed links. */
export function removeLinkMarkdown(title: string, links: readonly Pick<MindMapLink, 'url' | 'title'>[]): string {
  let next = title
  for (const link of links) {
    const markdown = linkMarkdown(link)
    next = next.replace(`\n${markdown}`, '').replace(markdown, '')
  }
  return next.trimEnd()
}

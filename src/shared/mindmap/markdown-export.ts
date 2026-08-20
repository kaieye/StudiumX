/**
 * Pure Markdown export for the v2 mind-map model.
 *
 * This intentionally exports the structural tree and optional topic notes only.
 * Canvas positions, styles, relationships, and other v2-only elements are not
 * silently represented as Markdown; a future compatibility report can make
 * those omissions explicit when the IPC export surface is added.
 */
import type {
  MindMapDocumentV2,
  MindMapTopicV2
} from './domain/types'

export type MindMapMarkdownExportOptions = {
  /** Include topic notes as nested blockquotes. Defaults to true. */
  includeNotes?: boolean
  /** Optional image links emitted below the owning topic. */
  imageLinksForTopic?: (topic: MindMapTopicV2) => readonly { alt: string; url: string }[]
}

/**
 * Serialize a mind-map document to deterministic, human-readable Markdown.
 *
 * Multiple sheets are emitted beneath the document heading. Each sheet's root
 * topic starts a nested bullet tree; topic titles and notes are flattened to a
 * single Markdown line so user content cannot create additional headings or
 * list structure accidentally.
 */
export function mindMapDocumentToMarkdown(
  document: MindMapDocumentV2,
  options: MindMapMarkdownExportOptions = {}
): string {
  const includeNotes = options.includeNotes !== false
  const lines: string[] = [`# ${markdownLine(document.title)}`]

  for (const sheet of document.sheets) {
    lines.push('', `## ${markdownLine(sheet.title)}`)
    appendTopicMarkdown(lines, sheet.root, 0, includeNotes, options.imageLinksForTopic)
  }

  return `${lines.join('\n')}\n`
}

function appendTopicMarkdown(
  lines: string[],
  topic: MindMapTopicV2,
  depth: number,
  includeNotes: boolean,
  imageLinksForTopic?: (topic: MindMapTopicV2) => readonly { alt: string; url: string }[]
): void {
  const indent = '  '.repeat(depth)
  lines.push(`${indent}- ${markdownLine(topic.title)}`)

  if (includeNotes && topic.note !== undefined && topic.note.trim() !== '') {
    const noteIndent = '  '.repeat(depth + 1)
    lines.push(`${noteIndent}> ${markdownLine(topic.note)}`)
  }

  for (const image of imageLinksForTopic?.(topic) ?? []) {
    const imageIndent = '  '.repeat(depth + 1)
    lines.push(`${imageIndent}!${markdownImageAlt(image.alt)}(${markdownImageUrl(image.url)})`)
  }

  for (const child of topic.children) {
    appendTopicMarkdown(lines, child, depth + 1, includeNotes, imageLinksForTopic)
  }
}

function markdownImageAlt(value: string): string {
  return `[${value.replace(/[\[\]]/g, '')}]`
}

function markdownImageUrl(value: string): string {
  return value.replace(/[()\s]/g, (character) => character === ' ' ? '%20' : `\\${character}`)
}

function markdownLine(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .trim()
}

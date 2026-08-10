/**
 * Pure OPML 2.0 export for the v2 mind-map model.
 *
 * OPML has a tree-shaped outline model, so each sheet is represented by a
 * wrapper outline and its root topic is emitted below it. Stable StudiumX ids
 * are carried in private attributes for a future importer; consumers that do
 * not understand those attributes can still read the normal `text` tree.
 */
import type {
  MindMapDocumentV2,
  MindMapTopicV2
} from './domain/types'

export type MindMapOpmlExportOptions = {
  /** Include topic notes in OPML `description` attributes. Defaults to true. */
  includeNotes?: boolean
  /** Include stable StudiumX ids for future round-tripping. Defaults to true. */
  includeIds?: boolean
}

/**
 * Serialize a v2 mind-map document as deterministic OPML 2.0.
 *
 * Styles, positions, relationships, and other non-tree elements do not have a
 * portable OPML representation and are intentionally omitted rather than
 * encoded as misleading outline nodes.
 */
export function mindMapDocumentToOpml(
  document: MindMapDocumentV2,
  options: MindMapOpmlExportOptions = {}
): string {
  const includeNotes = options.includeNotes !== false
  const includeIds = options.includeIds !== false
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXmlText(document.title)}</title>`,
    '  </head>',
    '  <body>'
  ]

  for (const sheet of document.sheets) {
    const sheetAttributes = [
      `text="${escapeXmlAttribute(sheet.title)}"`,
      ...(includeIds ? [`_studiumx_sheet_id="${escapeXmlAttribute(sheet.id)}"`] : [])
    ]
    lines.push(`    <outline ${sheetAttributes.join(' ')}>`)
    appendTopicOpml(lines, sheet.root, 6, includeNotes, includeIds)
    lines.push('    </outline>')
  }

  lines.push('  </body>', '</opml>', '')
  return lines.join('\n')
}

function appendTopicOpml(
  lines: string[],
  topic: MindMapTopicV2,
  indentSize: number,
  includeNotes: boolean,
  includeIds: boolean
): void {
  const attributes = [
    `text="${escapeXmlAttribute(topic.title)}"`,
    ...(includeIds ? [`_studiumx_topic_id="${escapeXmlAttribute(topic.id)}"`] : []),
    ...(includeNotes && topic.note !== undefined && topic.note.trim() !== ''
      ? [`description="${escapeXmlAttribute(topic.note)}"`]
      : [])
  ]
  const indent = ' '.repeat(indentSize)
  const hasChildren = topic.children.length > 0

  if (!hasChildren) {
    lines.push(`${indent}<outline ${attributes.join(' ')} />`)
    return
  }

  lines.push(`${indent}<outline ${attributes.join(' ')}>`)
  for (const child of topic.children) {
    appendTopicOpml(lines, child, indentSize + 2, includeNotes, includeIds)
  }
  lines.push(`${indent}</outline>`)
}

/** Escape XML text while removing XML 1.0-invalid control code points. */
function escapeXmlText(value: string): string {
  return escapeXml(value, false)
}

/** Escape an XML attribute, preserving line breaks through numeric entities. */
function escapeXmlAttribute(value: string): string {
  return escapeXml(value, true)
}

function escapeXml(value: string, preserveLineBreaks: boolean): string {
  let escaped = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || !isXml10CodePoint(codePoint)) continue

    if (preserveLineBreaks && codePoint === 10) {
      escaped += '&#10;'
      continue
    }
    if (preserveLineBreaks && codePoint === 13) {
      escaped += '&#13;'
      continue
    }

    switch (character) {
      case '&':
        escaped += '&amp;'
        break
      case '<':
        escaped += '&lt;'
        break
      case '>':
        escaped += '&gt;'
        break
      case '"':
        escaped += '&quot;'
        break
      case "'":
        escaped += '&apos;'
        break
      default:
        escaped += character
    }
  }
  return escaped
}

function isXml10CodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

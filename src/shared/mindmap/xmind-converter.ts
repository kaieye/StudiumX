/**
 * Pure converters between an XMind `.xmind` `content.json` (a JSON array of
 * sheets) and the native `MindMapDocument` model. No I/O, no side effects —
 * timestamps are injected via an options param for testability.
 *
 * XMind topic/sheet shapes differ from the native model in the ambient
 * `class` field and the `children.attached` wrapper, so these converters
 * normalize that boundary. Unknown fields are tolerated (ignored).
 */
import {
  DEFAULT_MIND_MAP_STRUCTURE_CLASS,
  MIND_MAP_DOCUMENT_SCHEMA_VERSION
} from './mind-map-types'
import type {
  MindMapDocument,
  MindMapNode,
  MindMapSheet,
  MindMapStructureClass
} from './mind-map-types'

const SHEET_CLASS = 'sheet'
const TOPIC_CLASS = 'topic'

/** Options for `xmindContentToDocument` (injectable timestamps). */
export type XmindImportOptions = {
  /** ISO 8601 timestamp stamped onto the resulting document. */
  nowIso?: string
}

/**
 * Map one XMind topic (with its `children.attached`) to a native node.
 * `structureClass` defaults forward-compatibly to `right` when absent.
 */
function topicToNode(raw: unknown): MindMapNode {
  const topic =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  const rawChildren =
    typeof topic.children === 'object' && topic.children !== null
      ? (topic.children as Record<string, unknown>).attached
      : undefined
  const attached = Array.isArray(rawChildren)
    ? rawChildren.map((child) => topicToNode(child))
    : []
  return {
    id: isNonEmptyString(topic.id) ? topic.id : '',
    title: typeof topic.title === 'string' ? topic.title : '',
    ...(typeof topic.note === 'string' && topic.note.length > 0
      ? { note: topic.note }
      : {}),
    ...(typeof topic.collapsed === 'boolean'
      ? { collapsed: topic.collapsed }
      : {}),
    ...(asStructureClass(topic.structureClass) !== undefined
      ? { structureClass: asStructureClass(topic.structureClass) }
      : {}),
    children: attached
  }
}

/**
 * Convert XMind `.xmind` `content.json` (an array of sheets) to a native
 * `MindMapDocument`. Unknown fields are ignored; a missing `structureClass`
 * defaults to `right`.
 */
export function xmindContentToDocument(
  content: unknown,
  opts: XmindImportOptions = {}
): MindMapDocument {
  const rawSheets = Array.isArray(content) ? content : []
  const sheets: MindMapSheet[] = rawSheets
    .map((rawSheet) => {
      const sheet =
        typeof rawSheet === 'object' && rawSheet !== null
          ? (rawSheet as Record<string, unknown>)
          : {}
      const rootRaw = sheet.rootTopic
      const root = topicToNode(rootRaw)
      return {
        id: isNonEmptyString(sheet.id) ? sheet.id : '',
        title: typeof sheet.title === 'string' ? sheet.title : '',
        structureClass:
          asStructureClass(sheet.structureClass) ??
          DEFAULT_MIND_MAP_STRUCTURE_CLASS,
        root
      }
    })
    .filter((sheet) => Boolean(sheet.id))

  const nowIso = opts.nowIso ?? new Date().toISOString()
  return {
    schemaVersion: MIND_MAP_DOCUMENT_SCHEMA_VERSION,
    id: cryptoRandomId(),
    title: sheets[0]?.title ?? 'Untitled',
    createdAt: nowIso,
    updatedAt: nowIso,
    sheets
  }
}

/** Map a native node to the XMind topic shape (with `children.attached`). */
function nodeToTopic(node: MindMapNode): Record<string, unknown> {
  const attached = node.children.map((child) => nodeToTopic(child))
  return {
    class: TOPIC_CLASS,
    id: node.id,
    title: node.title,
    ...(node.note !== undefined ? { note: node.note } : {}),
    ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {}),
    ...(node.structureClass !== undefined
      ? { structureClass: node.structureClass }
      : {}),
    ...(attached.length > 0 ? { children: { attached } } : {})
  }
}

/**
 * Convert a native `MindMapDocument` to the XMind `.xmind` `content.json`
 * shape (an array of sheets with `class` and `children.attached` wrappers).
 */
export function documentToXmindContent(
  doc: MindMapDocument
): Record<string, unknown>[] {
  return doc.sheets.map((sheet) => ({
    class: SHEET_CLASS,
    id: sheet.id,
    title: sheet.title,
    structureClass: sheet.structureClass,
    rootTopic: {
      class: TOPIC_CLASS,
      ...nodeToTopic(sheet.root)
    }
  }))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function asStructureClass(value: unknown): MindMapStructureClass | undefined {
  return typeof value === 'string' &&
    (value === 'org.xmind.ui.logic.right' ||
      value === 'org.xmind.ui.logic.balanced' ||
      value === 'org.xmind.ui.logic.left' ||
      value === 'org.xmind.ui.logic.map' ||
      value === 'org.xmind.ui.logic.down' ||
      value === 'org.xmind.ui.logic.up')
    ? value
    : undefined
}

/** Generate a fresh document id (crypto-safe where available). */
function cryptoRandomId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (cryptoLike && typeof cryptoLike.randomUUID === 'function') {
    return cryptoLike.randomUUID()
  }
  return `mindmap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
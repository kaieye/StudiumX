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
  MindMapRelationship,
  MindMapSheet,
  MindMapStructureClass
} from './mind-map-types'
import type { MindMapTheme } from './domain/types'

const SHEET_CLASS = 'sheet'
const TOPIC_CLASS = 'topic'
const RELATIONSHIP_CLASS = 'relationship'

/** Options for `xmindContentToDocument` (injectable timestamps). */
export type XmindImportOptions = {
  /** ISO 8601 timestamp stamped onto the resulting document. */
  nowIso?: string
  /**
   * Resolve one bounded embedded-asset path to a workspace asset id.  The
   * converter only receives the stable id; it never reads ZIP bytes or paths
   * from the filesystem.
   */
  assetIdForPath?: (path: string) => string | undefined
}

/**
 * Map one XMind topic (with its `children.attached`) to a native node.
 * `structureClass` defaults forward-compatibly to `right` when absent.
 */
function topicToNode(raw: unknown, opts: XmindImportOptions): MindMapNode {
  const topic =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  const rawChildren =
    typeof topic.children === 'object' && topic.children !== null
      ? (topic.children as Record<string, unknown>).attached
      : undefined
  const attached = Array.isArray(rawChildren)
    ? rawChildren.map((child) => topicToNode(child, opts))
    : []
  const imagePath = imageSourcePath(topic.image)
  const assetId = imagePath !== undefined ? opts.assetIdForPath?.(imagePath) : undefined
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
    ...(isNonEmptyString(assetId) ? { assetIds: [assetId] } : {}),
    children: attached
  }
}

/** Map one XMind relationship to the v1 interop shape used by the file codec. */
function relationshipToV1(raw: unknown): MindMapRelationship | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const relationship = raw as Record<string, unknown>
  const id = isNonEmptyString(relationship.id) ? relationship.id : ''
  // XMind exports both endpoint wrappers (`end1`/`end2`) and the compact
  // endpoint-id form (`end1Id`/`end2Id`). Prefer the explicit id fields when
  // present, then accept the wrapper and v1-compatible aliases.
  const from = relationshipEndpointId(
    relationship.end1Id ?? relationship.end1 ?? relationship.from
  )
  const to = relationshipEndpointId(
    relationship.end2Id ?? relationship.end2 ?? relationship.to
  )
  if (!id || !from || !to) return undefined

  const label =
    typeof relationship.title === 'string'
      ? relationship.title
      : typeof relationship.label === 'string'
        ? relationship.label
        : undefined

  return {
    id,
    from,
    to,
    ...(label !== undefined ? { label } : {})
  }
}

function relationshipEndpointId(value: unknown): string {
  if (isNonEmptyString(value)) return value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const id = (value as Record<string, unknown>).id
  return isNonEmptyString(id) ? id : ''
}

/** Map a v1 relationship to XMind's endpoint-wrapper representation. */
function relationshipToXmind(relationship: MindMapRelationship): Record<string, unknown> {
  return {
    class: RELATIONSHIP_CLASS,
    id: relationship.id,
    end1: { id: relationship.from },
    end2: { id: relationship.to },
    ...(relationship.label !== undefined ? { title: relationship.label } : {})
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
      const root = topicToNode(rootRaw, opts)
      return {
        id: isNonEmptyString(sheet.id) ? sheet.id : '',
        title: typeof sheet.title === 'string' ? sheet.title : '',
        structureClass:
          asStructureClass(sheet.structureClass) ??
          DEFAULT_MIND_MAP_STRUCTURE_CLASS,
        root,
        ...(Array.isArray(sheet.relationships)
          ? (() => {
              const relationships = sheet.relationships
                .map(relationshipToV1)
                .filter((relationship): relationship is MindMapRelationship => relationship !== undefined)
              return relationships.length > 0 ? { relationships } : {}
            })()
          : {})
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

function imageSourcePath(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const src = (value as Record<string, unknown>).src
  return typeof src === 'string' && src.length > 0 ? src : undefined
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
    },
    ...(sheet.relationships !== undefined && sheet.relationships.length > 0
      ? { relationships: sheet.relationships.map(relationshipToXmind) }
      : {})
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
      value === 'org.xmind.ui.logic.up' ||
      value === 'org.xmind.ui.map' ||
      value === 'org.xmind.ui.map.clockwise' ||
      value === 'org.xmind.ui.map.anticlockwise' ||
      value === 'org.xmind.ui.org-chart.down' ||
      value === 'org.xmind.ui.org-chart.up' ||
      value === 'org.xmind.ui.tree.right' ||
      value === 'org.xmind.ui.tree.left' ||
      value === 'org.xmind.ui.brace.right' ||
      value === 'org.xmind.ui.brace.left' ||
      value === 'org.xmind.ui.timeline.horizontal' ||
      value === 'org.xmind.ui.timeline.vertical' ||
      value === 'org.xmind.ui.spreadsheet' ||
      value === 'org.xmind.ui.spreadsheet.column' ||
      value === 'org.xmind.ui.fishbone.rightHeaded' ||
      value === 'org.xmind.ui.fishbone.leftHeaded')
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

/**
 * Project a v2 theme into XMind's sheet-level `theme` / `style` fields so the
 * new theme attributes (background, branch colors, font) survive a .xmind
 * export roundtrip (§7.5/§11 risk table).
 *
 * XMind stores visual styling in two places:
 * 1. Sheet-level `theme` object (map background, default font).
 * 2. Topic-level `style` overrides (per-topic fill/stroke/font).
 *
 * We map the document-level `MindMapTheme` to the sheet `theme` block. Topic-
 * level styles (from `topicStyles` and per-node overrides) are not projected
 * here — they would require the full v2 topic tree, which the v1 converter
 * does not have. The sheet theme block covers background, branch colors, and
 * global font, which are the user-facing theme attributes.
 */
function themeToXmindSheetTheme(theme: MindMapTheme | undefined): Record<string, unknown> | undefined {
  if (!theme) return undefined
  const themeBlock: Record<string, unknown> = {}
  if (theme.background) {
    themeBlock.map = { 'svg:fill': theme.background }
  }
  if (theme.fontFamily) {
    themeBlock.defaults = { 'fo:font-family': theme.fontFamily }
  }
  if (theme.branchColors && theme.branchColors.length > 0) {
    themeBlock.multiLineColors = { ...theme.branchColors }
  }
  if (theme.lineColor) {
    themeBlock.lineColor = theme.lineColor
  }
  // rainbowBranches: false means single-color branches (use lineColor).
  if (theme.rainbowBranches === false && theme.lineColor) {
    delete themeBlock.multiLineColors
  }
  if (Object.keys(themeBlock).length === 0) return undefined
  return themeBlock
}

/**
 * Export a v2 document (with theme + layout) to XMind content.json.
 *
 * This is the v2-aware export path that preserves theme attributes. It
 * supersedes `documentToXmindContent` for v2 documents.
 */
export function documentV2ToXmindContent(
  sheets: ReadonlyArray<{
    id: string
    title: string
    root: MindMapNode
    structureClass: MindMapStructureClass
    relationships?: readonly MindMapRelationship[]
  }>,
  theme: MindMapTheme | undefined
): Record<string, unknown>[] {
  const sheetTheme = themeToXmindSheetTheme(theme)
  return sheets.map((sheet) => ({
    class: SHEET_CLASS,
    id: sheet.id,
    title: sheet.title,
    structureClass: sheet.structureClass,
    ...(sheetTheme !== undefined ? { theme: sheetTheme } : {}),
    rootTopic: {
      class: TOPIC_CLASS,
      ...nodeToTopic(sheet.root)
    },
    ...(sheet.relationships !== undefined && sheet.relationships.length > 0
      ? { relationships: sheet.relationships.map(relationshipToXmind) }
      : {})
  }))
}

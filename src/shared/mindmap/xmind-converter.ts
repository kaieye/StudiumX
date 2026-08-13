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
import type {
  MindMapTheme,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from './domain/types'

/**
 * Numbering metadata carried on a v2 topic. Declared structurally here so
 * the XMind interop layer can round-trip numbering without depending on the
 * canonical `MindMapTopicV2` field, which the canvas/inspector feature lands
 * separately (see AGENTS.md coordination for the sibling numbering work).
 * Once `MindMapTopicV2.numbering` exists, `TopicWithNumbering` is a no-op.
 */
export type MindMapTopicNumbering = {
  pattern?: 'none' | 'arabic' | 'uppercase' | 'lowercase' | 'roman'
  tiered?: boolean
  restartAt?: number
}

export type TopicWithNumbering = MindMapTopicV2 & { numbering?: MindMapTopicNumbering }

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
 * XMind numbering tokens accepted on import.
 *
 * Modern XMind stores numbering as a topic-level extension
 * (`org.xmind.ui.numbering` with a pattern like `numeral-arabic`) and the
 * style-property tokens (`org.xmind.numbering.*`) also appear in XMind's own
 * UI serialization. StudiumX emits the style-property form on export; on
 * import BOTH forms are accepted so a real XMind file and a StudiumX
 * .xmind round trip restore numbering. Unknown tokens are ignored; real
 * XMind files may store numbering differently across versions, so this
 * import is best effort and never crashes on an unrecognized value.
 */
const XMIND_NUMBERING_TOKENS: Record<string, 'none' | 'arabic' | 'uppercase' | 'lowercase' | 'roman'> = {
  'org.xmind.numbering.none': 'none',
  'org.xmind.numbering.arabic': 'arabic',
  'org.xmind.numbering.uppercase': 'uppercase',
  'org.xmind.numbering.lowercase': 'lowercase',
  'org.xmind.numbering.roman': 'roman'
}

/** XMind topic-extension numbering pattern names → native pattern. */
const XMIND_EXTENSION_NUMBERING_PATTERNS: Record<string, 'none' | 'arabic' | 'uppercase' | 'lowercase' | 'roman'> = {
  'numeral-arabic': 'arabic',
  'alphabet-uppercase': 'uppercase',
  'alphabet-lowercase': 'lowercase',
  roman: 'roman',
  none: 'none'
}

/**
 * Read numbering from an XMind topic's style properties (`xmind:numbering`,
 * `xmind:numbering-tiered`, `xmind:numbering-restart-at`) and/or its
 * `org.xmind.ui.numbering` extension. Best-effort and tolerant: unknown or
 * malformed values are ignored, never thrown.
 */
function numberingFromXmindTopic(topic: Record<string, unknown>): MindMapTopicNumbering | undefined {
  let pattern: MindMapTopicNumbering['pattern']
  let tiered: boolean | undefined
  let restartAt: number | undefined

  const style =
    typeof topic.style === 'object' && topic.style !== null && !Array.isArray(topic.style)
      ? (topic.style as Record<string, unknown>)
      : undefined
  const properties =
    style && typeof style.properties === 'object' && style.properties !== null
      ? (style.properties as Record<string, unknown>)
      : undefined
  if (properties) {
    if (typeof properties['xmind:numbering'] === 'string') {
      const token = properties['xmind:numbering'] as string
      const mapped = token.startsWith('org.xmind.numbering.')
        ? XMIND_NUMBERING_TOKENS[token]
        : undefined
      if (mapped !== undefined) pattern = mapped
    }
    if (properties['xmind:numbering-tiered'] === 'true') tiered = true
    if (typeof properties['xmind:numbering-restart-at'] === 'string') {
      const parsed = Number.parseInt(properties['xmind:numbering-restart-at'] as string, 10)
      if (Number.isFinite(parsed) && parsed >= 0) restartAt = parsed
    }
  }

  const extension =
    typeof topic['org.xmind.ui.numbering'] === 'object' &&
    topic['org.xmind.ui.numbering'] !== null &&
    !Array.isArray(topic['org.xmind.ui.numbering'])
      ? (topic['org.xmind.ui.numbering'] as Record<string, unknown>)
      : undefined
  if (extension) {
    if (typeof extension.pattern === 'string') {
      const mapped = XMIND_EXTENSION_NUMBERING_PATTERNS[extension.pattern as string]
      if (mapped !== undefined) pattern = mapped
    }
    if (typeof extension.tiered === 'boolean') tiered = extension.tiered
    if (typeof extension.numberOfDigits === 'number' && Number.isFinite(extension.numberOfDigits)) {
      restartAt = extension.numberOfDigits >= 0 ? extension.numberOfDigits : undefined
    }
  }

  if (pattern === undefined) return undefined
  return {
    pattern,
    ...(tiered !== undefined ? { tiered } : {}),
    ...(restartAt !== undefined ? { restartAt } : {})
  }
}

/** Build the v1 interop node for one XMind topic, including numbering. */
function topicNodeFromXmind(
  raw: unknown,
  opts: XmindImportOptions
): MindMapNode & { numbering?: MindMapTopicNumbering } {
  const topic =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  const numbering = numberingFromXmindTopic(topic)
  const rawChildren =
    typeof topic.children === 'object' && topic.children !== null
      ? (topic.children as Record<string, unknown>).attached
      : undefined
  const attached = Array.isArray(rawChildren)
    ? rawChildren.map((child) => topicNodeFromXmind(child, opts))
    : []
  const node: MindMapNode & { numbering?: MindMapTopicNumbering } = {
    id: isNonEmptyString(topic.id) ? topic.id : '',
    title: typeof topic.title === 'string' ? topic.title : '',
    children: attached,
    ...(numbering !== undefined ? { numbering } : {})
  }

  const imagePath = imageSourcePath(topic.image)
  const assetId = imagePath !== undefined ? opts.assetIdForPath?.(imagePath) : undefined
  if (typeof topic.note === 'string' && topic.note.length > 0) node.note = topic.note
  if (typeof topic.collapsed === 'boolean') node.collapsed = topic.collapsed
  const structureClass = asStructureClass(topic.structureClass)
  if (structureClass !== undefined) node.structureClass = structureClass
  if (isNonEmptyString(assetId)) node.assetIds = [assetId]
  return node
}

/**
 * Map one XMind topic (with its `children.attached`) to a native node.
 * `structureClass` defaults forward-compatibly to `right` when absent.
 */
function topicToNode(raw: unknown, opts: XmindImportOptions): MindMapNode {
  return topicNodeFromXmind(raw, opts)
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
 * Project a v2 theme into XMind's sheet-level `theme` fields so background,
 * branch colors, and font survive a .xmind export roundtrip (§7.5/§11).
 * Topic-level style properties are emitted separately by `topicV2ToXmind`.
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

/** Return the topic-style theme layer inherited at one tree depth. */
function topicStyleLayerForDepth(
  theme: MindMapTheme | undefined,
  depth: number
): MindMapTopicStyleOverride | undefined {
  return depth === 0
    ? theme?.topicStyles?.central
    : depth === 1
      ? theme?.topicStyles?.main
      : theme?.topicStyles?.sub
}

type XmindV2ExportTopic = MindMapNode | TopicWithNumbering

function isV2ExportTopic(topic: XmindV2ExportTopic): topic is TopicWithNumbering {
  return 'style' in topic
}

function localTopicStyle(topic: XmindV2ExportTopic): MindMapTopicStyleOverride | undefined {
  return isV2ExportTopic(topic) ? topic.style : undefined
}

const XMIND_NUMBERING_PATTERN_TOKEN: Record<
  NonNullable<MindMapTopicNumbering['pattern']>,
  string
> = {
  none: 'org.xmind.numbering.none',
  arabic: 'org.xmind.numbering.arabic',
  uppercase: 'org.xmind.numbering.uppercase',
  lowercase: 'org.xmind.numbering.lowercase',
  roman: 'org.xmind.numbering.roman'
}

/**
 * Project the native numbering override onto XMind topic style properties.
 *
 * XMind has no single canonical numbering property shared across versions;
 * both a topic-level `org.xmind.ui.numbering` extension and style tokens
 * (`org.xmind.numbering.*`) exist in the wild. This converter emits the
 * style-property form (`xmind:numbering` and friends) because it is
 * consistent with how the other topic style fields (`fo:...`, border, …)
 * are exported as style properties, and it is the pragmatic form for a
 * StudiumX → XMind round trip. Best effort: real XMind files store
 * numbering differently across versions, so no complete parity is claimed.
 */
function numberingToXmindStyleProperties(
  numbering: MindMapTopicNumbering | undefined
): Record<string, string> | undefined {
  if (!numbering || !numbering.pattern) return undefined
  const properties: Record<string, string> = {
    'xmind:numbering': XMIND_NUMBERING_PATTERN_TOKEN[numbering.pattern]
  }
  if (numbering.tiered === true) properties['xmind:numbering-tiered'] = 'true'
  if (numbering.restartAt !== undefined) {
    properties['xmind:numbering-restart-at'] = String(numbering.restartAt)
  }
  return properties
}

/**
 * Map a native topic (v2 with numbering, or a v1 interop node that carries
 * the numbering bag) into the XMind numbering style properties. Numbering
 * rides along the same style bag as the other topic overrides; even when
 * the topic has no other style it is still emitted so an ordered-list
 * export round-trips.
 */
function topicNumberingToXmind(
  topic: XmindV2ExportTopic
): Record<string, string> | undefined {
  if (!topic.numbering) return undefined
  return numberingToXmindStyleProperties(topic.numbering)
}

function effectiveTopicStyleForExport(
  topic: XmindV2ExportTopic,
  theme: MindMapTheme | undefined,
  depth: number
): MindMapTopicStyleOverride | undefined {
  const merged = {
    ...(topicStyleLayerForDepth(theme, depth) ?? {}),
    ...(localTopicStyle(topic) ?? {})
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Map the supported native topic-style fields to XMind topic style properties.
 *
 * XMind has no verified hand-drawn-border property distinct from its ordinary
 * `solid` / `dash` values. We therefore export hand-drawn variants as an
 * explicit visual approximation rather than claiming lossless parity.
 */
function topicStyleToXmindProperties(
  style: MindMapTopicStyleOverride | undefined
): Record<string, string> | undefined {
  if (!style) return undefined

  const properties: Record<string, string> = {}
  if (style.borderStyle === 'none') {
    properties['border-line-color'] = 'none'
    properties['border-line-width'] = '0'
  } else {
    if (style.stroke !== undefined) properties['border-line-color'] = style.stroke
    if (style.borderWidth !== undefined) {
      properties['border-line-width'] = String(style.borderWidth)
    }
    if (style.borderStyle !== undefined) {
      properties['border-line-pattern'] =
        style.borderStyle === 'dash' || style.borderStyle === 'hand-drawn-dash'
          ? 'dash'
          : 'solid'
    }
  }
  if (style.textDecoration !== undefined) {
    properties['fo:text-decoration'] = style.textDecoration
  }
  if (style.textTransform !== undefined) {
    // XMind's stored token for its visual “None” choice is `manual`.
    properties['fo:text-transform'] = style.textTransform === 'none'
      ? 'manual'
      : style.textTransform
  }
  if (style.textAlign !== undefined) properties['fo:text-align'] = style.textAlign

  return Object.keys(properties).length > 0 ? properties : undefined
}

function topicV2ToXmind(
  topic: XmindV2ExportTopic,
  theme: MindMapTheme | undefined,
  depth: number
): Record<string, unknown> {
  const attached = topic.children.map((child) => topicV2ToXmind(child, theme, depth + 1))
  const styleProperties = topicStyleToXmindProperties(
    effectiveTopicStyleForExport(topic, theme, depth)
  )
  const numberingProperties = topicNumberingToXmind(topic)
  const styleBlock =
    styleProperties !== undefined || numberingProperties !== undefined
      ? {
          id: `studiumx-topic-${topic.id}`,
          properties: {
            ...(styleProperties ?? {}),
            ...(numberingProperties ?? {})
          }
        }
      : undefined

  return {
    class: TOPIC_CLASS,
    id: topic.id,
    title: topic.title,
    ...(topic.note !== undefined ? { note: topic.note } : {}),
    ...(topic.collapsed !== undefined ? { collapsed: topic.collapsed } : {}),
    ...(isV2ExportTopic(topic)
      ? topic.style?.structureClass !== undefined
        ? { structureClass: topic.style.structureClass }
        : {}
      : topic.structureClass !== undefined
        ? { structureClass: topic.structureClass }
        : {}),
    ...(styleBlock !== undefined ? { style: styleBlock } : {}),
    ...(attached.length > 0 ? { children: { attached } } : {})
  }
}

export type XmindV2ExportSheet = {
  id: string
  title: string
  /** Accepts the legacy MindMapNode shape as well as the native v2 topic tree. */
  root: XmindV2ExportTopic
  structureClass: MindMapStructureClass
  relationships?: readonly MindMapRelationship[]
}

/**
 * Export v2 sheets to XMind content.json while retaining their native topic
 * trees. Keeping this separate from `documentToXmindContent` preserves the v1
 * compatibility API and avoids adding v2-only style fields to `MindMapNode`.
 */
export function documentV2ToXmindContent(
  sheets: ReadonlyArray<XmindV2ExportSheet>,
  theme: MindMapTheme | undefined
): Record<string, unknown>[] {
  const sheetTheme = themeToXmindSheetTheme(theme)
  return sheets.map((sheet) => {
    const exportedRoot = topicV2ToXmind(sheet.root, theme, 0)
    return {
      class: SHEET_CLASS,
      id: sheet.id,
      title: sheet.title,
      structureClass: sheet.structureClass,
      ...(sheetTheme !== undefined ? { theme: sheetTheme } : {}),
      rootTopic: exportedRoot,
      ...(sheet.relationships !== undefined && sheet.relationships.length > 0
        ? { relationships: sheet.relationships.map(relationshipToXmind) }
        : {})
    }
  })
}

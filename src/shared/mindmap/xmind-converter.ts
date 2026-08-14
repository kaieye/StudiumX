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
  MindMapDocumentV2,
  MindMapRelationship as MindMapRelationshipElement,
  MindMapTheme,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from './domain/types'
import {
  emptyXmindCompatibilityReport,
  type XmindCompatibilityFinding,
  type XmindCompatibilityReport
} from './xmind-compatibility'

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

/* ------------------------------------------------------------------ *
 * XMind EXPORT compatibility report
 *
 * Mirrors `documentV2ToXmindContent` so every exported/omitted property
 * can be audited without re-deriving the mapping. Pure and value-free:
 * findings carry stable paths, counts and reason strings only. It walks
 * the same theme + topic inputs as the converter and additionally reports
 * v2-only state (element styles, layout) that the export ignores.
 * ------------------------------------------------------------------ */

type ExportCategory = keyof XmindCompatibilityReport

class ExportReportBuilder {
  private readonly entries: Record<
    ExportCategory,
    Map<string, XmindCompatibilityFinding>
  > = {
    preserved: new Map(),
    approximated: new Map(),
    dropped: new Map(),
    warnings: new Map()
  }

  public constructor(private readonly report: XmindCompatibilityReport) {}

  public add(
    category: ExportCategory,
    path: string,
    count: number,
    reason: string
  ): void {
    if (count <= 0) return
    const key = `${path}\u0000${reason}`
    const bucket = this.entries[category]
    const existing = bucket.get(key)
    if (existing) {
      existing.count += count
      return
    }
    const finding = { path, count, reason }
    bucket.set(key, finding)
    this.report[category].push(finding)
  }
}

/**
 * Build a value-free per-item compatibility report for a StudiumX v2
 * document being exported to XMind `content.json`. Categories:
 *
 * - `preserved`: the field is written to XMind 1:1.
 * - `approximated`: written with a near mapping (e.g. hand-drawn border,
 *   no-op text transform rewritten to XMind's `manual` token).
 * - `dropped`: present in the v2 model but not exported by the converter.
 * - `warnings`: genuinely surprising cases (e.g. rainbow branches disabled
 *   with no fallback line color).
 */
export function buildXmindExportCompatibilityReport(
  doc: MindMapDocumentV2
): XmindCompatibilityReport {
  const report = emptyXmindCompatibilityReport()
  const builder = new ExportReportBuilder(report)
  const theme = doc.theme

  reportThemeExport(theme, doc.sheets.length, builder)

  for (const sheet of doc.sheets) {
    const relationships = sheet.elements.filter(
      (el): el is MindMapRelationshipElement => el.type === 'relationship'
    )
    if (relationships.length > 0) {
      builder.add(
        'preserved',
        'sheets[].relationships',
        relationships.length,
        'Sheet relationships map to XMind relationship elements'
      )
      for (const relationship of relationships) {
        if (relationship.label !== undefined) {
          builder.add(
            'preserved',
            'sheets[].relationships[].title',
            1,
            'Relationship label maps to the XMind relationship title'
          )
        }
      }
    }

    const styledElements = sheet.elements.filter((el) => el.style !== undefined)
    if (styledElements.length > 0) {
      builder.add(
        'dropped',
        'sheets[].elements[].style',
        styledElements.length,
        'Element style for boundaries/summaries/callouts/free-topics/relationships is not exported to XMind'
      )
    }

    if (sheet.layout.lineStyle !== undefined) {
      builder.add(
        'dropped',
        'sheets[].layout.lineStyle',
        1,
        'Connector line style is not exported to XMind'
      )
    }
    if (sheet.layout.linePattern !== undefined) {
      builder.add(
        'dropped',
        'sheets[].layout.linePattern',
        1,
        'Branch line pattern is not exported to XMind'
      )
    }
    if (sheet.layout.compact !== undefined) {
      builder.add(
        'dropped',
        'sheets[].layout.compact',
        1,
        'Compact layout flag is not exported to XMind'
      )
    }
    if (sheet.layout.spacing !== undefined) {
      builder.add(
        'dropped',
        'sheets[].layout.spacing',
        1,
        'Layout spacing is not exported to XMind'
      )
    }
    if (sheet.layout.tapered !== undefined) {
      builder.add(
        'dropped',
        'sheets[].layout.tapered',
        1,
        'Tapered branch flag is not exported to XMind'
      )
    }
    if (sheet.layout.lineWidthScale !== undefined) {
      builder.add(
        'dropped',
        'sheets[].layout.lineWidthScale',
        1,
        'Branch line-width scale is not exported to XMind'
      )
    }

    reportExportedTopic(sheet.root, theme, 0, builder)
  }

  return report
}

/** Theme-level export findings (the theme block is attached to every sheet). */
function reportThemeExport(
  theme: MindMapTheme | undefined,
  sheetCount: number,
  builder: ExportReportBuilder
): void {
  if (!theme) return
  const rainbowDisabled = theme.rainbowBranches === false
  if (theme.background) {
    builder.add(
      'preserved',
      'sheets[].theme.map.svg:fill',
      sheetCount,
      'Theme background maps to the XMind sheet background fill'
    )
  }
  if (theme.fontFamily) {
    builder.add(
      'preserved',
      'sheets[].theme.defaults.fo:font-family',
      sheetCount,
      'Theme font family maps to the XMind sheet default font'
    )
  }
  if (theme.branchColors && theme.branchColors.length > 0) {
    if (rainbowDisabled && theme.lineColor) {
      builder.add(
        'dropped',
        'sheets[].theme.multiLineColors',
        sheetCount,
        'Branch colors are dropped when rainbow branches are disabled and a line color is set'
      )
    } else if (rainbowDisabled) {
      builder.add(
        'dropped',
        'sheets[].theme.multiLineColors',
        sheetCount,
        'Branch colors are dropped when rainbow branches are disabled'
      )
      builder.add(
        'warnings',
        'sheets[].theme.lineColor',
        sheetCount,
        'Rainbow branches are disabled but no line color is set'
      )
    } else {
      builder.add(
        'preserved',
        'sheets[].theme.multiLineColors',
        sheetCount,
        'Branch colors map to the XMind multi-line branch palette'
      )
    }
  }
  if (theme.lineColor) {
    builder.add(
      'preserved',
      'sheets[].theme.lineColor',
      sheetCount,
      'Theme line color maps to the XMind branch line color'
    )
  }
  if (theme.textColor) {
    builder.add(
      'dropped',
      'sheets[].theme.textColor',
      sheetCount,
      'Theme text color has no XMind export mapping'
    )
  }
  if (theme.name) {
    builder.add(
      'dropped',
      'sheets[].theme.name',
      sheetCount,
      'Theme name is not exported to XMind'
    )
  }
  if (theme.shape) {
    builder.add(
      'dropped',
      'sheets[].theme.shape',
      sheetCount,
      'Theme shape token is not exported to XMind'
    )
  }
  if (theme.colorSchemeId) {
    builder.add(
      'dropped',
      'sheets[].theme.colorSchemeId',
      sheetCount,
      'Theme color-scheme id is not exported to XMind'
    )
  }
}

/** Recursively report one topic and its subtree exactly as the exporter walks it. */
function reportExportedTopic(
  topic: MindMapTopicV2,
  theme: MindMapTheme | undefined,
  depth: number,
  builder: ExportReportBuilder
): void {
  if (topic.note !== undefined) {
    builder.add(
      'preserved',
      'topics[].note',
      1,
      'Topic note maps to the XMind note'
    )
  }
  if (topic.collapsed !== undefined) {
    builder.add(
      'preserved',
      'topics[].collapsed',
      1,
      'Collapsed state maps to the XMind collapsed flag'
    )
  }
  const overrideStructure = topic.style?.structureClass
  if (overrideStructure !== undefined) {
    builder.add(
      'preserved',
      'topics[].structureClass',
      1,
      'Topic structure-class override is exported as the topic layout'
    )
  }

  reportExportedTopicStyle(
    effectiveTopicStyleForExport(topic, theme, depth),
    builder
  )

  const numberingProperties = topicNumberingToXmind(topic)
  if (numberingProperties) {
    if (numberingProperties['xmind:numbering'] !== undefined) {
      builder.add(
        'preserved',
        'topics[].style.xmind:numbering',
        1,
        'Topic numbering pattern maps to the XMind numbering token'
      )
    }
    if (numberingProperties['xmind:numbering-tiered'] !== undefined) {
      builder.add(
        'preserved',
        'topics[].style.xmind:numbering-tiered',
        1,
        'Topic tiered numbering maps to the XMind tiered flag'
      )
    }
    if (numberingProperties['xmind:numbering-restart-at'] !== undefined) {
      builder.add(
        'preserved',
        'topics[].style.xmind:numbering-restart-at',
        1,
        'Topic numbering restart index maps to the XMind restart-at property'
      )
    }
  }

  if (topic.labels !== undefined) {
    builder.add(
      'dropped',
      'topics[].labels',
      1,
      'Topic labels are not exported to XMind'
    )
  }
  if (topic.markers !== undefined) {
    builder.add(
      'dropped',
      'topics[].markers',
      1,
      'Topic markers are not exported to XMind'
    )
  }
  if (topic.links !== undefined) {
    builder.add(
      'dropped',
      'topics[].links',
      1,
      'Topic links are not exported to XMind'
    )
  }
  if (topic.sourceRefs !== undefined) {
    builder.add(
      'dropped',
      'topics[].sourceRefs',
      1,
      'Topic source references are not exported to XMind'
    )
  }
  if (topic.assetIds !== undefined) {
    builder.add(
      'dropped',
      'topics[].assetIds',
      1,
      'Topic asset references are not exported to XMind'
    )
  }
  if (topic.planning !== undefined) {
    builder.add(
      'dropped',
      'topics[].planning',
      1,
      'Topic planning metadata is not exported to XMind'
    )
  }
  if (topic.manualPosition !== undefined) {
    builder.add(
      'dropped',
      'topics[].manualPosition',
      1,
      'Manual topic position is not exported to XMind'
    )
  }

  for (const child of topic.children) {
    reportExportedTopic(child, theme, depth + 1, builder)
  }
}

/** Topic-style export findings, mirroring `topicStyleToXmindProperties`. */
function reportExportedTopicStyle(
  style: MindMapTopicStyleOverride | undefined,
  builder: ExportReportBuilder
): void {
  if (!style) return
  const border = style.borderStyle
  if (border === 'none') {
    builder.add(
      'preserved',
      'topics[].style.border-line-color',
      1,
      'Topic no-border style maps to an XMind no-border color'
    )
    builder.add(
      'preserved',
      'topics[].style.border-line-width',
      1,
      'Topic no-border style maps to a zero XMind border width'
    )
  } else {
    if (style.stroke !== undefined) {
      builder.add(
        'preserved',
        'topics[].style.border-line-color',
        1,
        'Topic border color maps to the XMind border color'
      )
    }
    if (style.borderWidth !== undefined) {
      builder.add(
        'preserved',
        'topics[].style.border-line-width',
        1,
        'Topic border width maps to the XMind border width'
      )
    }
    if (border === 'solid') {
      builder.add(
        'preserved',
        'topics[].style.border-line-pattern',
        1,
        'Solid border maps to the XMind solid border pattern'
      )
    } else if (border === 'dash') {
      builder.add(
        'preserved',
        'topics[].style.border-line-pattern',
        1,
        'Dashed border maps to the XMind dash border pattern'
      )
    } else if (border === 'hand-drawn-solid') {
      builder.add(
        'approximated',
        'topics[].style.border-line-pattern',
        1,
        'Hand-drawn border is approximated as a solid XMind border'
      )
    } else if (border === 'hand-drawn-dash') {
      builder.add(
        'approximated',
        'topics[].style.border-line-pattern',
        1,
        'Hand-drawn border is approximated as a dashed XMind border'
      )
    }
  }
  if (style.textDecoration !== undefined) {
    builder.add(
      'preserved',
      'topics[].style.fo:text-decoration',
      1,
      'Topic text decoration maps to the XMind text-decoration token'
    )
  }
  if (style.textTransform !== undefined) {
    if (style.textTransform === 'none') {
      builder.add(
        'approximated',
        'topics[].style.fo:text-transform',
        1,
        'No text transform is approximated by the XMind manual token'
      )
    } else {
      builder.add(
        'preserved',
        'topics[].style.fo:text-transform',
        1,
        'Topic text transform maps to the XMind text-transform token'
      )
    }
  }
  if (style.textAlign !== undefined) {
    builder.add(
      'preserved',
      'topics[].style.fo:text-align',
      1,
      'Topic text alignment maps to the XMind text-alignment token'
    )
  }

  if (style.fill !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.fill',
      1,
      'Topic fill has no XMind export mapping'
    )
  }
  if (style.textColor !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.textColor',
      1,
      'Topic text color has no XMind export mapping'
    )
  }
  if (style.fontFamily !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.fontFamily',
      1,
      'Topic font family has no XMind export mapping'
    )
  }
  if (style.fontSize !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.fontSize',
      1,
      'Topic font size has no XMind export mapping'
    )
  }
  if (style.fontWeight !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.fontWeight',
      1,
      'Topic font weight has no XMind export mapping'
    )
  }
  if (style.fontStyle !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.fontStyle',
      1,
      'Topic font style has no XMind export mapping'
    )
  }
  if (style.shape !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.shape',
      1,
      'Topic shape token has no XMind export mapping'
    )
  }
  if (style.fillPattern !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.fillPattern',
      1,
      'Topic fill-pattern texture has no XMind export mapping'
    )
  }
  if (style.widthMode !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.widthMode',
      1,
      'Topic width mode has no XMind export mapping'
    )
  }
  if (style.width !== undefined) {
    builder.add(
      'dropped',
      'topics[].style.width',
      1,
      'Fixed topic width has no XMind export mapping'
    )
  }
}

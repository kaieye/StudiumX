/**
 * Small, pure XMind import compatibility audit.
 *
 * The converter intentionally accepts more input than the v1/v2 mind-map
 * model can represent. This audit makes that boundary visible without
 * attempting to convert unsupported XMind features. It reports field paths
 * and counts only; foreign values are never copied into the report.
 */

export type XmindCompatibilityFinding = {
  /** A stable field path, with repeated collections written as `[]`. */
  path: string
  /** Number of occurrences represented by this finding. */
  count: number
  /** Human-readable, value-free explanation of the conversion outcome. */
  reason: string
}

export type XmindCompatibilityReport = {
  preserved: XmindCompatibilityFinding[]
  approximated: XmindCompatibilityFinding[]
  dropped: XmindCompatibilityFinding[]
  warnings: XmindCompatibilityFinding[]
}

type CompatibilityCategory = keyof XmindCompatibilityReport

type ObjectRecord = Record<string, unknown>

export type XmindCompatibilityReportOptions = {
  /** Embedded image `src` values successfully copied into workspace assets. */
  importedImagePaths?: ReadonlySet<string>
}

const VALID_STRUCTURE_CLASSES = new Set([
  'org.xmind.ui.logic.right',
  'org.xmind.ui.logic.balanced',
  'org.xmind.ui.logic.left',
  'org.xmind.ui.logic.map',
  'org.xmind.ui.logic.down',
  'org.xmind.ui.logic.up'
,
  'org.xmind.ui.map',
  'org.xmind.ui.map.clockwise',
  'org.xmind.ui.map.anticlockwise',
  'org.xmind.ui.org-chart.down',
  'org.xmind.ui.org-chart.up',
  'org.xmind.ui.tree.right',
  'org.xmind.ui.tree.left',
  'org.xmind.ui.brace.right',
  'org.xmind.ui.brace.left',
  'org.xmind.ui.timeline.horizontal',
  'org.xmind.ui.timeline.vertical',
  'org.xmind.ui.spreadsheet',
  'org.xmind.ui.spreadsheet.column',
  'org.xmind.ui.fishbone.rightHeaded',
  'org.xmind.ui.fishbone.leftHeaded'
])

const SHEET_FIELDS = new Set([
  'class',
  'id',
  'title',
  'structureClass',
  'rootTopic',
  'relationships'
])

const RELATIONSHIP_FIELDS = new Set([
  'class',
  'id',
  'end1',
  'end2',
  'end1Id',
  'end2Id',
  'from',
  'to',
  'title',
  'label',
  'style',
  'styles'
])

const TOPIC_FIELDS = new Set([
  'class',
  'id',
  'title',
  'note',
  'collapsed',
  'structureClass',
  'children',
  'image',
  'attachment',
  'style',
  'styles'
])

const CHILDREN_FIELDS = new Set(['attached'])

const EXTENSION_BAG_FIELDS = new Set(['extension', 'extensions', 'extensionData'])

const UNSUPPORTED_ELEMENT_FIELDS = new Set([
  'boundaries',
  'summaries',
  'callouts',
  'freeTopics',
  'markers',
  'labels',
  'links'
])

/**
 * XMind numbering pattern tokens that `xmindContentToDocument` imports into
 * the native `numbering.pattern` (see `xmind-converter.ts`).
 */
const XMIND_NUMBERING_TOKENS = new Set([
  'org.xmind.numbering.none',
  'org.xmind.numbering.arabic',
  'org.xmind.numbering.uppercase',
  'org.xmind.numbering.lowercase',
  'org.xmind.numbering.roman'
])

/**
 * Return a deterministic empty report. A new object is returned on every
 * call so callers can append findings without sharing mutable state.
 */
export function emptyXmindCompatibilityReport(): XmindCompatibilityReport {
  return {
    preserved: [],
    approximated: [],
    dropped: [],
    warnings: []
  }
}

/**
 * Audit an XMind `content.json` payload against the currently supported
 * StudiumX import boundary.
 *
 * This is deliberately independent from the converter: it can be run before
 * importing, in tests, or later by an IPC adapter without changing the
 * document conversion contract. Unknown and currently unsupported fields are
 * reported as dropped instead of being silently ignored.
 */
export function buildXmindImportCompatibilityReport(
  content: unknown,
  options: XmindCompatibilityReportOptions = {}
): XmindCompatibilityReport {
  const report = emptyXmindCompatibilityReport()
  const builder = new ReportBuilder(report)

  if (!Array.isArray(content)) {
    builder.add(
      'warnings',
      'content',
      1,
      'Expected content.json to contain a sheet array'
    )
    return report
  }

  builder.add(
    'preserved',
    'sheets',
    content.length,
    'Sheet collection maps to StudiumX sheets'
  )

  const seen = new WeakSet<object>()
  for (const rawSheet of content) {
    inspectSheet(rawSheet, builder, seen, options)
  }

  return report
}

class ReportBuilder {
  private readonly entries: Record<CompatibilityCategory, Map<string, XmindCompatibilityFinding>> = {
    preserved: new Map(),
    approximated: new Map(),
    dropped: new Map(),
    warnings: new Map()
  }

  public constructor(private readonly report: XmindCompatibilityReport) {}

  public add(
    category: CompatibilityCategory,
    path: string,
    count: number,
    reason: string
  ): void {
    if (count <= 0) return
    const key = `${path}\u0000${reason}`
    const categoryEntries = this.entries[category]
    const existing = categoryEntries.get(key)
    if (existing) {
      existing.count += count
      return
    }
    const finding = { path, count, reason }
    categoryEntries.set(key, finding)
    this.report[category].push(finding)
  }
}

function inspectSheet(
  rawSheet: unknown,
  builder: ReportBuilder,
  seen: WeakSet<object>,
  options: XmindCompatibilityReportOptions
): void {
  const sheet = asObject(rawSheet)
  if (!sheet) {
    builder.add('dropped', 'sheets[]', 1, 'Non-object sheet cannot be imported')
    builder.add('warnings', 'sheets[]', 1, 'Skipped malformed sheet entry')
    return
  }
  if (markSeen(sheet, builder, 'sheets[]', seen)) return

  reportUnknownFields(sheet, SHEET_FIELDS, 'sheets[]', builder)

  if (sheet.class === 'sheet') {
    builder.add('preserved', 'sheets[].class', 1, 'XMind sheet wrapper recognized')
  } else if (sheet.class !== undefined) {
    builder.add('dropped', 'sheets[].class', 1, 'Unsupported sheet wrapper class')
    builder.add('warnings', 'sheets[].class', 1, 'Unknown sheet wrapper class')
  }

  if (typeof sheet.id === 'string' && sheet.id.length > 0) {
    builder.add('preserved', 'sheets[].id', 1, 'Stable sheet id retained')
  } else {
    builder.add('dropped', 'sheets[].id', 1, 'Missing or empty sheet id')
    builder.add('warnings', 'sheets[].id', 1, 'Sheet without a stable id may be skipped')
  }

  if (typeof sheet.title === 'string') {
    builder.add('preserved', 'sheets[].title', 1, 'Sheet title retained')
  } else {
    builder.add('approximated', 'sheets[].title', 1, 'Missing title becomes an empty string')
    builder.add('warnings', 'sheets[].title', 1, 'Sheet title is missing or not a string')
  }

  if (sheet.structureClass === undefined) {
    builder.add(
      'approximated',
      'sheets[].structureClass',
      1,
      'Missing structure class defaults to the right layout'
    )
  } else if (isValidStructureClass(sheet.structureClass)) {
    builder.add(
      'preserved',
      'sheets[].structureClass',
      1,
      'Supported XMind layout class retained'
    )
  } else {
    builder.add(
      'dropped',
      'sheets[].structureClass',
      1,
      'Unknown structure class is not representable'
    )
    builder.add(
      'approximated',
      'sheets[].structureClass',
      1,
      'Unknown structure class falls back to the right layout'
    )
    builder.add('warnings', 'sheets[].structureClass', 1, 'Unknown structure class')
  }

  if (sheet.rootTopic === undefined) {
    builder.add('dropped', 'sheets[].rootTopic', 1, 'Missing root topic')
    builder.add('warnings', 'sheets[].rootTopic', 1, 'Sheet has no root topic')
  } else if (!isObject(sheet.rootTopic)) {
    builder.add('dropped', 'sheets[].rootTopic', 1, 'Malformed root topic')
    builder.add('warnings', 'sheets[].rootTopic', 1, 'Root topic is not an object')
  } else {
    builder.add('preserved', 'sheets[].rootTopic', 1, 'Root topic tree is supported')
    inspectTopic(sheet.rootTopic, builder, seen, options)
  }

  if (sheet.relationships !== undefined) {
    inspectRelationships(sheet.relationships, builder)
  }

  inspectStyleBlocks('sheets[]', sheet, builder)
  inspectElementCollections('sheets[]', sheet, builder)
}

/**
 * Walk the style blocks that ride on element collections (boundaries,
 * summaries, callouts). Elements themselves are unsupported at the import
 * boundary, so their style fields are reported per field with stable paths
 * instead of a whole-collection drop.
 */
function inspectElementCollections(
  ownerPath: string,
  owner: ObjectRecord,
  builder: ReportBuilder
): void {
  for (const key of ['boundaries', 'summaries', 'callouts']) {
    const raw = owner[key]
    if (raw === undefined) continue
    if (!Array.isArray(raw)) continue
    for (let index = 0; index < raw.length; index += 1) {
      const element = asObject(raw[index])
      if (element === null) continue
      inspectStyleBlocks(`${ownerPath}.${key}[]`, element, builder)
    }
  }
}

/**
 * Root of all per-style-field classification. Walks `style` (single block)
 * and `styles` (block list) on topics, relationships, or other holders.
 */
function inspectStyleBlocks(
  ownerPath: string,
  owner: ObjectRecord | undefined,
  builder: ReportBuilder
): void {
  if (!owner) return
  const style = owner.style
  if (style !== undefined) {
    if (isObject(style)) {
      inspectStyleBlock(builder, `${ownerPath}.style`, style)
    } else {
      builder.add('dropped', `${ownerPath}.style`, 1, 'Malformed style block is not retained')
    }
  }
  const styles = owner.styles
  if (styles !== undefined) {
    if (Array.isArray(styles)) {
      for (const raw of styles) {
        if (isObject(raw)) {
          inspectStyleBlock(builder, `${ownerPath}.styles[]`, raw)
        } else {
          builder.add('dropped', `${ownerPath}.styles[]`, 1, 'Malformed style block is not retained')
        }
      }
    } else {
      builder.add('dropped', `${ownerPath}.styles`, 1, 'Malformed style list is not retained')
    }
  }
}

/**
 * Report one style block. Properties are read from a `properties` bag when
 * present (canonical XMind shape), otherwise from the block's own keys
 * (flat shape used by some exports). Every known style property is reported
 * per field with a stable path.
 */
function inspectStyleBlock(
  builder: ReportBuilder,
  blockPath: string,
  block: ObjectRecord
): void {
  if (block.id !== undefined) {
    builder.add(
      'dropped',
      `${blockPath}.id`,
      1,
      'XMind style-block id is not retained by the StudiumX mind-map model'
    )
  }
  if (block.type !== undefined) {
    builder.add(
      'dropped',
      `${blockPath}.type`,
      1,
      'XMind style-block type metadata is not retained by the StudiumX mind-map model'
    )
  }

  const properties = asObject(block.properties)
  if (properties !== null) {
    for (const property of Object.keys(properties)) {
      inspectStyleProperty(builder, `${blockPath}.properties`, property, properties[property])
    }
    return
  }

  for (const property of Object.keys(block)) {
    if (property === 'id' || property === 'type') continue
    inspectStyleProperty(builder, blockPath, property, block[property])
  }
}

/**
 * Classify one XMind style property against the native topic-style mapping
 * (the same mapping the theme importer uses in `from-xmind-theme.ts`).
 * Properties below are the known/canonical XMind topic style vocabulary;
 * everything else is reported as dropped with a stable, value-free reason.
 */
function inspectStyleProperty(
  builder: ReportBuilder,
  basePath: string,
  property: string,
  value: unknown
): void {
  const path = `${basePath}.${safePropertyPath(property)}`

  switch (property) {
    case 'svg:fill':
      if (typeof value === 'string' && value !== 'none') {
        builder.add(
          'preserved',
          path,
          1,
          'Topic fill maps to the native topic fill'
        )
      } else if (value === 'none') {
        builder.add(
          'dropped',
          path,
          1,
          'Explicit XMind no-fill token is not retained by the native topic style'
        )
      } else {
        builder.add('dropped', path, 1, 'Malformed topic fill is not retained')
      }
      return

    case 'border-line-color':
      if (typeof value === 'string' && value !== 'none') {
        builder.add(
          'preserved',
          path,
          1,
          'Topic border color maps to the native topic stroke'
        )
      } else if (value === 'none') {
        builder.add(
          'approximated',
          path,
          1,
          'XMind no-border color token is represented by the native border style'
        )
      } else {
        builder.add('dropped', path, 1, 'Malformed topic border color is not retained')
      }
      return

    case 'border-line-width': {
      const width = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
      if (width === 0) {
        builder.add(
          'approximated',
          path,
          1,
          'Zero XMind border width is represented by the native no-border style'
        )
      } else if (Number.isFinite(width) && width > 0 && width <= 32) {
        builder.add(
          'preserved',
          path,
          1,
          'Topic border width maps to the native topic border width'
        )
      } else {
        builder.add(
          'dropped',
          path,
          1,
          'Topic border width falls outside the native supported range'
        )
      }
      return
    }

    case 'border-line-pattern':
      if (value === 'solid') {
        builder.add(
          'preserved',
          path,
          1,
          'Solid XMind border pattern maps to the native solid border'
        )
      } else if (value === 'dash') {
        builder.add(
          'preserved',
          path,
          1,
          'Dashed XMind border pattern maps to the native dashed border'
        )
      } else if (value === 'dot' || value === 'dash-dot' || value === 'dash-dot-dot') {
        builder.add(
          'approximated',
          path,
          1,
          'XMind border pattern is collapsed to the native dashed border'
        )
      } else {
        builder.add('dropped', path, 1, 'XMind border pattern has no native border-pattern mapping')
      }
      return

    case 'fo:color':
      if (typeof value === 'string' && value.length > 0) {
        builder.add(
          'preserved',
          path,
          1,
          'Topic text color maps to the native topic text color'
        )
      } else {
        builder.add('dropped', path, 1, 'Malformed topic text color is not retained')
      }
      return

    case 'fo:font-family':
      if (typeof value === 'string' && value.length > 0) {
        builder.add(
          'preserved',
          path,
          1,
          'Topic font family maps to the native topic font family'
        )
      } else {
        builder.add('dropped', path, 1, 'Malformed topic font family is not retained')
      }
      return

    case 'fo:font-size':
      if (typeof value === 'string' && Number.isFinite(Number.parseFloat(value))) {
        builder.add(
          'approximated',
          path,
          1,
          'XMind point font size is converted to CSS pixels'
        )
      } else {
        builder.add('dropped', path, 1, 'Malformed topic font size is not retained')
      }
      return

    case 'fo:font-weight':
      if (typeof value === 'string' && value.length > 0) {
        if (value === 'normal' || value === 'bold') {
          builder.add(
            'approximated',
            path,
            1,
            'Named XMind font weight is normalized to a CSS numeric weight'
          )
        } else {
          builder.add(
            'preserved',
            path,
            1,
            'Topic font weight maps to the native topic font weight'
          )
        }
      } else {
        builder.add('dropped', path, 1, 'Malformed topic font weight is not retained')
      }
      return

    case 'fo:font-style':
      if (value === 'normal' || value === 'italic') {
        builder.add(
          'preserved',
          path,
          1,
          'Topic font style maps to the native topic font style'
        )
      } else {
        builder.add('dropped', path, 1, 'Unsupported topic font style is not retained')
      }
      return

    case 'fo:text-decoration': {
      if (typeof value !== 'string') {
        builder.add(
          'dropped',
          path,
          1,
          'Malformed topic text decoration is not retained'
        )
        return
      }
      const tokens = new Set(value.trim().split(/\s+/).filter(Boolean))
      if (tokens.has('none') || tokens.has('underline') || tokens.has('line-through')) {
        builder.add(
          'preserved',
          path,
          1,
          'Topic text decoration maps to the native topic text decoration'
        )
      } else {
        builder.add(
          'dropped',
          path,
          1,
          'XMind text decoration has no native topic-style mapping'
        )
      }
      return
    }

    case 'fo:text-transform':
      if (value === 'manual') {
        builder.add(
          'approximated',
          path,
          1,
          'XMind manual text transform is represented by the native no-transform token'
        )
      } else if (
        value === 'none' ||
        value === 'uppercase' ||
        value === 'lowercase' ||
        value === 'capitalize'
      ) {
        builder.add(
          'preserved',
          path,
          1,
          'Topic text transform maps to the native topic text transform'
        )
      } else {
        builder.add('dropped', path, 1, 'XMind text transform has no native topic-style mapping')
      }
      return

    case 'fo:text-align':
      if (value === 'left' || value === 'center' || value === 'right') {
        builder.add(
          'preserved',
          path,
          1,
          'Topic text alignment maps to the native topic text alignment'
        )
      } else {
        builder.add('dropped', path, 1, 'Unsupported topic text alignment is not retained')
      }
      return

    case 'shape-class':
      if (
        typeof value === 'string' &&
        (value.includes('roundedRect') || value.includes('underline') || value.includes('fishbone'))
      ) {
        builder.add(
          'approximated',
          path,
          1,
          'XMind shape class is mapped to the closest native topic shape'
        )
      } else {
        builder.add(
          'dropped',
          path,
          1,
          'XMind topic shape class has no native topic-shape mapping'
        )
      }
      return

    case 'line-color':
      builder.add(
        'dropped',
        path,
        1,
        'Topic connector color has no depth-specific native theme mapping'
      )
      return

    case 'xmind:numbering':
      if (typeof value === 'string' && XMIND_NUMBERING_TOKENS.has(value)) {
        builder.add(
          'preserved',
          path,
          1,
          'XMind numbering token maps to the native numbering pattern'
        )
      } else if (typeof value === 'string' && value.startsWith('org.xmind.numbering.')) {
        builder.add(
          'dropped',
          path,
          1,
          'Unknown XMind numbering token is not retained'
        )
      } else {
        builder.add(
          'dropped',
          path,
          1,
          'Malformed XMind numbering token is not retained'
        )
      }
      return

    case 'xmind:numbering-tiered':
      if (value === 'true') {
        builder.add(
          'preserved',
          path,
          1,
          'XMind tiered-numbering flag maps to the native numbering tiered flag'
        )
      } else if (value === 'false') {
        builder.add(
          'approximated',
          path,
          1,
          'XMind tiered-numbering false flag is not retained and uses the native default'
        )
      } else {
        builder.add('dropped', path, 1, 'Malformed XMind numbering flag is not retained')
      }
      return

    case 'xmind:numbering-restart-at': {
      const parsed =
        typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
      if (Number.isFinite(parsed) && parsed >= 0) {
        builder.add('preserved', path, 1, 'XMind numbering restart index is retained')
      } else {
        builder.add('dropped', path, 1, 'Malformed XMind numbering restart index is not retained')
      }
      return
    }

    default:
      builder.add(
        'dropped',
        path,
        1,
        'XMind topic style property has no native theme mapping'
      )
  }
}

/** Keep style property names stable and value-free in report paths. */
function safePropertyPath(name: string): string {
  return /^[a-zA-Z0-9]+(?::[a-zA-Z-]+)?(?:-[a-zA-Z0-9]+)*$/.test(name)
    ? name
    : '<unknown-property>'
}

function inspectRelationships(raw: unknown, builder: ReportBuilder): void {
  if (!Array.isArray(raw)) {
    builder.add('dropped', 'sheets[].relationships', 1, 'Relationship list is not an array')
    builder.add('warnings', 'sheets[].relationships', 1, 'Malformed relationship list')
    return
  }

  let preservedCount = 0
  for (const rawRelationship of raw) {
    const relationship = asObject(rawRelationship)
    if (!relationship) {
      builder.add(
        'dropped',
        'sheets[].relationships[]',
        1,
        'Non-object relationship cannot be imported'
      )
      builder.add(
        'warnings',
        'sheets[].relationships[]',
        1,
        'Skipped malformed relationship entry'
      )
      continue
    }

    reportUnknownFields(relationship, RELATIONSHIP_FIELDS, 'sheets[].relationships[]', builder)

    if (relationship.class !== undefined && relationship.class !== 'relationship') {
      builder.add(
        'dropped',
        'sheets[].relationships[].class',
        1,
        'Unsupported relationship wrapper class'
      )
      builder.add(
        'warnings',
        'sheets[].relationships[].class',
        1,
        'Unknown relationship wrapper class'
      )
    }

    inspectStyleBlocks('sheets[].relationships[]', relationship, builder)

    if (typeof relationship.id !== 'string' || relationship.id.length === 0) {
      builder.add(
        'dropped',
        'sheets[].relationships[].id',
        1,
        'Missing or empty relationship id'
      )
      builder.add(
        'warnings',
        'sheets[].relationships[].id',
        1,
        'Relationship without a stable id cannot be retained'
      )
    }

    // XMind content commonly uses compact `end1Id`/`end2Id` fields, while
    // newer exports may use endpoint wrappers. Keep both forms in the
    // compatibility audit so a valid connector is not reported as dropped.
    const from = relationshipEndpointId(
      relationship.end1Id ?? relationship.end1 ?? relationship.from
    )
    const to = relationshipEndpointId(
      relationship.end2Id ?? relationship.end2 ?? relationship.to
    )
    if (!from) {
      builder.add(
        'dropped',
        'sheets[].relationships[].end1',
        1,
        'Missing relationship start topic id'
      )
      builder.add(
        'warnings',
        'sheets[].relationships[].end1',
        1,
        'Relationship start endpoint is malformed'
      )
    }
    if (!to) {
      builder.add(
        'dropped',
        'sheets[].relationships[].end2',
        1,
        'Missing relationship end topic id'
      )
      builder.add(
        'warnings',
        'sheets[].relationships[].end2',
        1,
        'Relationship end endpoint is malformed'
      )
    }

    const rawLabel =
      relationship.title !== undefined ? relationship.title : relationship.label
    const hasInvalidLabel = rawLabel !== undefined && typeof rawLabel !== 'string'
    if (hasInvalidLabel) {
      builder.add(
        'dropped',
        'sheets[].relationships[].title',
        1,
        'Non-string relationship label is not representable'
      )
      builder.add(
        'warnings',
        'sheets[].relationships[].title',
        1,
        'Relationship label has an unsupported value'
      )
    }

    if (
      typeof relationship.id === 'string' &&
      relationship.id.length > 0 &&
      from.length > 0 &&
      to.length > 0
    ) {
      preservedCount += 1
    }
  }

  builder.add(
    'preserved',
    'sheets[].relationships',
    preservedCount,
    'Sheet relationships map to StudiumX relationship elements'
  )
}

function inspectTopic(
  rawTopic: unknown,
  builder: ReportBuilder,
  seen: WeakSet<object>,
  options: XmindCompatibilityReportOptions
): void {
  const topic = asObject(rawTopic)
  if (!topic) {
    builder.add('dropped', 'topics[]', 1, 'Non-object topic cannot be imported')
    builder.add('warnings', 'topics[]', 1, 'Skipped malformed topic entry')
    return
  }
  if (markSeen(topic, builder, 'topics[]', seen)) return

  reportUnknownFields(topic, TOPIC_FIELDS, 'topics[]', builder)

  if (topic.class === 'topic') {
    builder.add('preserved', 'topics[].class', 1, 'XMind topic wrapper recognized')
  } else if (topic.class !== undefined) {
    builder.add('dropped', 'topics[].class', 1, 'Unsupported topic wrapper class')
    builder.add('warnings', 'topics[].class', 1, 'Unknown topic wrapper class')
  }

  if (typeof topic.id === 'string' && topic.id.length > 0) {
    builder.add('preserved', 'topics[].id', 1, 'Stable topic id retained')
  } else {
    builder.add('dropped', 'topics[].id', 1, 'Missing or empty topic id')
    builder.add('warnings', 'topics[].id', 1, 'Topic without a stable id may not be editable')
  }

  if (typeof topic.title === 'string') {
    builder.add('preserved', 'topics[].title', 1, 'Topic title retained')
  } else {
    builder.add('approximated', 'topics[].title', 1, 'Missing title becomes an empty string')
    builder.add('warnings', 'topics[].title', 1, 'Topic title is missing or not a string')
  }

  if (topic.note !== undefined) {
    if (typeof topic.note === 'string') {
      builder.add('preserved', 'topics[].note', 1, 'Topic note retained')
    } else {
      builder.add('dropped', 'topics[].note', 1, 'Non-string note is not representable')
      builder.add('warnings', 'topics[].note', 1, 'Topic note has an unsupported value')
    }
  }

  if (topic.collapsed !== undefined) {
    if (typeof topic.collapsed === 'boolean') {
      builder.add('preserved', 'topics[].collapsed', 1, 'Collapsed state retained')
    } else {
      builder.add('dropped', 'topics[].collapsed', 1, 'Non-boolean collapsed state is not representable')
      builder.add('warnings', 'topics[].collapsed', 1, 'Topic collapsed state has an unsupported value')
    }
  }

  inspectStyleBlocks('topics[]', topic, builder)

  if (topic.structureClass !== undefined) {
    if (isValidStructureClass(topic.structureClass)) {
      builder.add(
        'preserved',
        'topics[].structureClass',
        1,
        'Supported topic layout class retained'
      )
    } else {
      builder.add(
        'dropped',
        'topics[].structureClass',
        1,
        'Unknown topic structure class is not representable'
      )
      builder.add('warnings', 'topics[].structureClass', 1, 'Unknown topic structure class')
    }
  }

  if (topic.image !== undefined) {
    const imagePath = imageSourcePath(topic.image)
    if (imagePath !== undefined && options.importedImagePaths?.has(imagePath)) {
      builder.add(
        'approximated',
        'topics[].image',
        1,
        'Embedded XMind image copied into a workspace asset and referenced by the topic'
      )
    } else {
      builder.add(
        'dropped',
        'topics[].image',
        1,
        'Attachment or image was not migrated into workspace assets'
      )
      builder.add(
        'warnings',
        'topics[].image',
        1,
        'Attachment or image was not migrated into workspace assets'
      )
    }
  }

  if (topic.attachment !== undefined) {
    builder.add(
      'dropped',
      'topics[].attachment',
      1,
      'Attachment or image was not migrated into workspace assets'
    )
    builder.add(
      'warnings',
      'topics[].attachment',
      1,
      'Attachment or image was not migrated into workspace assets'
    )
  }

  if (topic.children === undefined) return
  if (!isObject(topic.children)) {
    builder.add('dropped', 'topics[].children', 1, 'Malformed children wrapper')
    builder.add('warnings', 'topics[].children', 1, 'Topic children is not an object')
    return
  }

  reportUnknownFields(topic.children, CHILDREN_FIELDS, 'topics[].children', builder)
  const attached = topic.children.attached
  if (attached === undefined) {
    builder.add('approximated', 'topics[].children.attached', 1, 'Missing attached list becomes an empty child list')
    return
  }
  if (!Array.isArray(attached)) {
    builder.add('dropped', 'topics[].children.attached', 1, 'Attached children is not an array')
    builder.add('warnings', 'topics[].children.attached', 1, 'Malformed attached child list')
    return
  }

  builder.add(
    'preserved',
    'topics[].children.attached',
    attached.length,
    'Attached topic tree is supported'
  )
  for (const child of attached) inspectTopic(child, builder, seen, options)
}

function reportUnknownFields(
  value: ObjectRecord,
  knownFields: ReadonlySet<string>,
  pathPrefix: string,
  builder: ReportBuilder
): void {
  for (const key of Object.keys(value)) {
    if (knownFields.has(key)) continue
    const path = `${pathPrefix}.${key}`
    builder.add('dropped', path, 1, 'Field is not representable by the StudiumX mind-map model')
    const warning = unsupportedFieldWarning(key)
    if (warning) builder.add('warnings', path, 1, warning)
  }
}

function markSeen(
  value: object,
  builder: ReportBuilder,
  path: string,
  seen: WeakSet<object>
): boolean {
  if (seen.has(value)) {
    builder.add('dropped', path, 1, 'Cyclic object is not valid JSON content')
    builder.add('warnings', path, 1, 'Cyclic content was not traversed')
    return true
  }
  seen.add(value)
  return false
}

function asObject(value: unknown): ObjectRecord | null {
  return isObject(value) ? value : null
}

function isObject(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidStructureClass(value: unknown): value is string {
  return typeof value === 'string' && VALID_STRUCTURE_CLASSES.has(value)
}

function relationshipEndpointId(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (!isObject(value)) return ''
  return typeof value.id === 'string' && value.id.length > 0 ? value.id : ''
}

function imageSourcePath(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  return typeof value.src === 'string' && value.src.length > 0 ? value.src : undefined
}

function isAttachmentField(key: string): boolean {
  return key === 'image' || key === 'attachment' || key === 'attachments' || key === 'thumbnail'
}

function unsupportedFieldWarning(key: string): string | undefined {
  if (isAttachmentField(key)) {
    return 'Attachment or image was not migrated into workspace assets'
  }
  if (isExtensionBagField(key)) {
    return 'Foreign extension bag was not retained at the XMind import boundary'
  }
  if (isUnsupportedElementField(key)) {
    return 'Unsupported XMind element metadata was not migrated into StudiumX elements'
  }
  return undefined
}

function isExtensionBagField(key: string): boolean {
  return EXTENSION_BAG_FIELDS.has(key)
}

function isUnsupportedElementField(key: string): boolean {
  return UNSUPPORTED_ELEMENT_FIELDS.has(key)
}

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
  'label'
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
  'attachment'
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
  'links',
  'style',
  'styles'
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

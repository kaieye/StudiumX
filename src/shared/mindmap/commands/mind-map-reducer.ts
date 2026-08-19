/**
 * Pure mind map command reducer.
 *
 * `applyMindMapCommand(document, command)` returns a new document plus the
 * exact inverse command needed to undo the change. The reducer never mutates
 * its inputs and validates the domain invariants (`../domain/invariants.ts`)
 * both before and after every command, so a command can never leave the
 * document in an inconsistent state.
 *
 * Undo semantics:
 * - `topic.remove` / `element.remove` / `sheet.remove` return inverse
 *   create/insert commands that carry the removed subtrees/elements, so undo
 *   restores content exactly (including original ids and positions).
 * - `selection.set-style` returns a transaction inverse that restores each
 *   topic's previous style independently.
 * - `transaction` applies inner commands sequentially; if any inner command
 *   fails the whole transaction is rejected and the document stays unchanged.
 */
import type {
  MindMapDocumentV2,
  MindMapElement,
  MindMapConnectorEndpoint,
  MindMapElementArrowShape,
  MindMapElementLinePattern,
  MindMapElementLineShape,
  MindMapElementOutlineShape,
  MindMapElementStyle,
  MindMapImageElement,
  MindMapLayoutSettings,
  MindMapSheetV2,
  MindMapTopicNumbering,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from '../domain/types'
import {
  DEFAULT_MIND_MAP_STRUCTURE_CLASS,
  DEFAULT_MIND_MAP_TOPIC_SHAPE,
  type MindMapStructureClass
} from '../mind-map-types'
import { STRUCTURE_TYPE_PRESETS } from '../structure-types'
import {
  collectTopicIds,
  validateMindMapDocumentV2,
  validateMindMapSheetV2,
  validateTopicTree
} from '../domain/invariants'
import type {
  MindMapCommand,
  MindMapCommandError,
  MindMapCommandErrorCode,
  MindMapCommandResult,
  MindMapElementUpdatePatch,
  MindMapImageUpdatePatch,
  MindMapTopicUpdatePatch
} from './mind-map-command-types'

const TOPIC_PATCH_FIELDS: ReadonlyArray<keyof MindMapTopicUpdatePatch> = [
  'title',
  'titleFormatting',
  'note',
  'collapsed',
  'labels',
  'markers',
  'links',
  'formula',
  'assetIds',
  'imagePlacement',
  'sourceRefs',
  'planning',
  'style',
  'manualPosition',
  'numbering'
]

const ELEMENT_ALLOWED_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  relationship: new Set(['label', 'from', 'to', 'style']),
  boundary: new Set(['label', 'topicId', 'children', 'style']),
  summary: new Set(['label', 'from', 'to', 'sourceTopicIds', 'summaryTopicId', 'style']),
  callout: new Set(['label', 'topicId', 'text', 'position', 'style']),
  'free-topic': new Set(['label', 'topicId', 'position', 'style']),
  shape: new Set(['label', 'labelFormatting', 'shape', 'position', 'width', 'height', 'style']),
  connector: new Set(['label', 'start', 'end', 'curveControlOffset', 'style'])
}

function error(command: MindMapCommand, code: MindMapCommandErrorCode, message: string): MindMapCommandResult {
  const err: MindMapCommandError = { code, message, command }
  return { ok: false, error: err }
}

function ok(document: MindMapDocumentV2, inverse: MindMapCommand): MindMapCommandResult {
  const validation = validateMindMapDocumentV2(document)
  if (!validation.ok) {
    return error(
      inverse,
      'INVALID_DOCUMENT',
      `result violates domain invariants: ${validation.errors.map((e) => e.message).join('; ')}`
    )
  }
  return { ok: true, document, inverse }
}

function cloneDocument(document: MindMapDocumentV2): MindMapDocumentV2 {
  return structuredClone(document)
}

function getSheet(document: MindMapDocumentV2, sheetId: string): MindMapSheetV2 | undefined {
  return document.sheets.find((sheet) => sheet.id === sheetId)
}

function findTopic(
  sheet: MindMapSheetV2,
  topicId: string
): { node: MindMapTopicV2; parent: MindMapTopicV2 | null; index: number } | undefined {
  const found = findTopicInChildren(sheet.root, null, topicId)
  if (found !== undefined) {
    return found
  }
  return undefined
}

function findTopicInChildren(
  node: MindMapTopicV2,
  parent: MindMapTopicV2 | null,
  topicId: string
): { node: MindMapTopicV2; parent: MindMapTopicV2 | null; index: number } | undefined {
  if (node.id === topicId) {
    return { node, parent, index: parent === null ? -1 : parent.children.indexOf(node) }
  }
  for (let i = 0; i < node.children.length; i += 1) {
    const found = findTopicInChildren(node.children[i], node, topicId)
    if (found !== undefined) return found
  }
  return undefined
}

function containsTopic(node: MindMapTopicV2, targetId: string): boolean {
  if (node.id === targetId) return true
  return node.children.some((child) => containsTopic(child, targetId))
}

function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(Math.floor(index), max))
}

function applyOptionField(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  inverse: Record<string, unknown>
): void {
  if (value === undefined) return
  const old = target[key]
  inverse[key] = old === undefined ? null : old
  if (value === null) {
    delete target[key]
  } else {
    target[key] = structuredClone(value)
  }
}

function mutateTopicWithPatch(node: MindMapTopicV2, patch: MindMapTopicUpdatePatch): MindMapTopicUpdatePatch {
  const record = node as unknown as Record<string, unknown>
  const inverseRecord: Record<string, unknown> = {}
  for (const key of TOPIC_PATCH_FIELDS) {
    applyOptionField(record, key, patch[key], inverseRecord)
  }
  return inverseRecord as MindMapTopicUpdatePatch
}

const TOPIC_NUMBERING_PATTERN_VALUES = new Set<NonNullable<MindMapTopicNumbering['pattern']>>([
  'none',
  'arabic',
  'uppercase',
  'lowercase',
  'roman'
])

function validateTopicNumbering(numbering: MindMapTopicNumbering | undefined): string[] {
  if (numbering === undefined) return []
  const errors: string[] = []
  if (
    numbering.pattern !== undefined &&
    !TOPIC_NUMBERING_PATTERN_VALUES.has(numbering.pattern)
  ) {
    errors.push(`pattern must be one of: ${[...TOPIC_NUMBERING_PATTERN_VALUES].join(', ')}`)
  }
  if (
    numbering.restartAt !== undefined &&
    (!Number.isFinite(numbering.restartAt) ||
      !Number.isInteger(numbering.restartAt) ||
      numbering.restartAt < 1 ||
      numbering.restartAt > 9999)
  ) {
    errors.push('restartAt must be a finite integer between 1 and 9999')
  }
  return errors
}

function validateTopicStyle(style: MindMapTopicStyleOverride | undefined): string[] {
  if (style === undefined) return []
  const errors: string[] = []
  if (style.fontSize !== undefined && (!Number.isFinite(style.fontSize) || style.fontSize <= 0)) {
    errors.push('fontSize must be a positive number')
  }
  if (style.borderWidth !== undefined && (!Number.isFinite(style.borderWidth) || style.borderWidth <= 0 || style.borderWidth > 32)) {
    errors.push('borderWidth must be greater than 0 and at most 32')
  }
  if (style.widthMode === 'fixed' && style.width === undefined) {
    errors.push('width is required when widthMode is fixed')
  }
  if (style.widthMode !== 'fixed' && style.width !== undefined) {
    errors.push('width is only allowed when widthMode is fixed')
  }
  if (style.width !== undefined && (!Number.isFinite(style.width) || style.width < 72 || style.width > 720)) {
    errors.push('width must be between 72 and 720')
  }
  return errors
}

const ELEMENT_ARROW_SHAPE_VALUES = new Set<MindMapElementArrowShape>([
  'none', 'dot', 'triangle', 'spearhead', 'square', 'diamond',
  'herringbone', 'double-arrow', 'anti-triangle', 'attached', 'hook'
])

const ELEMENT_LINE_SHAPE_VALUES = new Set<MindMapElementLineShape>([
  'curved', 'straight', 'angled', 'zigzag',
  'flexible-curved', 'flexible-angled', 'flexible-zigzag'
])

const ELEMENT_LINE_PATTERN_VALUES = new Set<MindMapElementLinePattern>([
  'solid', 'dash', 'dot', 'dash-dot', 'dash-dot-dot'
])

const ELEMENT_OUTLINE_SHAPE_VALUES = new Set<MindMapElementOutlineShape>([
  'rectangle', 'rounded-rectangle', 'ellipse', 'polygon',
  'scallops', 'waves', 'tension', 'bracket'
])

function validateElementStyle(style: MindMapElementStyle | undefined): string[] {
  if (style === undefined) return []
  const errors: string[] = []
  if (style.strokeWidth !== undefined && (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0)) {
    errors.push('strokeWidth must be a non-negative number')
  }
  if (style.fontSize !== undefined && (!Number.isFinite(style.fontSize) || style.fontSize <= 0)) {
    errors.push('fontSize must be a positive number')
  }
  if (style.beginArrow !== undefined && !ELEMENT_ARROW_SHAPE_VALUES.has(style.beginArrow)) {
    errors.push(`beginArrow must be one of: ${[...ELEMENT_ARROW_SHAPE_VALUES].join(', ')}`)
  }
  if (style.endArrow !== undefined && !ELEMENT_ARROW_SHAPE_VALUES.has(style.endArrow)) {
    errors.push(`endArrow must be one of: ${[...ELEMENT_ARROW_SHAPE_VALUES].join(', ')}`)
  }
  if (style.lineShape !== undefined && !ELEMENT_LINE_SHAPE_VALUES.has(style.lineShape)) {
    errors.push(`lineShape must be one of: ${[...ELEMENT_LINE_SHAPE_VALUES].join(', ')}`)
  }
  if (style.linePattern !== undefined && !ELEMENT_LINE_PATTERN_VALUES.has(style.linePattern)) {
    errors.push(`linePattern must be one of: ${[...ELEMENT_LINE_PATTERN_VALUES].join(', ')}`)
  }
  if (style.outlineShape !== undefined && !ELEMENT_OUTLINE_SHAPE_VALUES.has(style.outlineShape)) {
    errors.push(`outlineShape must be one of: ${[...ELEMENT_OUTLINE_SHAPE_VALUES].join(', ')}`)
  }
  return errors
}

function elementReferenceErrors(
  element: MindMapElement,
  topicIds: ReadonlySet<string>,
  shapeIds: ReadonlySet<string> = new Set()
): string[] {
  const errors: string[] = []
  switch (element.type) {
    case 'relationship':
      if (!topicIds.has(element.from)) errors.push(`relationship "${element.id}" references missing "from" node "${element.from}"`)
      if (!topicIds.has(element.to)) errors.push(`relationship "${element.id}" references missing "to" node "${element.to}"`)
      break
    case 'boundary':
      if (!topicIds.has(element.topicId)) errors.push(`boundary "${element.id}" references missing topic "${element.topicId}"`)
      if (element.children !== undefined) {
        for (const childId of element.children) {
          if (!topicIds.has(childId)) errors.push(`boundary "${element.id}" references missing child node "${childId}"`)
        }
      }
      break
    case 'summary':
      if (!topicIds.has(element.from)) errors.push(`summary "${element.id}" references missing "from" node "${element.from}"`)
      if (!topicIds.has(element.to)) errors.push(`summary "${element.id}" references missing "to" node "${element.to}"`)
      if (element.sourceTopicIds !== undefined && element.sourceTopicIds.length < 2) {
        errors.push(`summary "${element.id}" requires at least two source nodes`)
      }
      for (const sourceTopicId of element.sourceTopicIds ?? []) {
        if (!topicIds.has(sourceTopicId)) errors.push(`summary "${element.id}" references missing source node "${sourceTopicId}"`)
      }
      if (element.summaryTopicId !== undefined && !topicIds.has(element.summaryTopicId)) {
        errors.push(`summary "${element.id}" references missing output node "${element.summaryTopicId}"`)
      }
      break
    case 'callout':
      if (!topicIds.has(element.topicId)) errors.push(`callout "${element.id}" references missing topic "${element.topicId}"`)
      break
    case 'free-topic':
      if (!topicIds.has(element.topicId)) errors.push(`free-topic "${element.id}" references missing topic "${element.topicId}"`)
      break
    case 'shape':
      if (!Number.isFinite(element.position.x) || !Number.isFinite(element.position.y)) errors.push(`shape "${element.id}" position must contain finite coordinates`)
      if (!Number.isFinite(element.width) || element.width <= 0) errors.push(`shape "${element.id}" width must be positive`)
      if (!Number.isFinite(element.height) || element.height <= 0) errors.push(`shape "${element.id}" height must be positive`)
      break
    case 'connector':
      const endpoints: ReadonlyArray<readonly [string, MindMapConnectorEndpoint]> = [
        ['start', element.start],
        ['end', element.end]
      ]
      for (const [name, endpoint] of endpoints) {
        if (!Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) errors.push(`connector "${element.id}" ${name} must contain finite coordinates`)
        // A free connector endpoint may float on the canvas without a binding.
        const anchor = endpoint.anchor
        if (!anchor) continue
        const targetSet = anchor.targetType === 'topic' ? topicIds : shapeIds
        if (!targetSet.has(anchor.targetId)) errors.push(`connector "${element.id}" references missing ${anchor.targetType} "${anchor.targetId}"`)
      }
      if (
        element.curveControlOffset !== undefined
        && (!Number.isFinite(element.curveControlOffset.x) || !Number.isFinite(element.curveControlOffset.y))
      ) {
        errors.push(`connector "${element.id}" curveControlOffset must contain finite coordinates`)
      }
      if (
        element.start.anchor
        && element.end.anchor
        && element.start.anchor.targetType === element.end.anchor.targetType
        && element.start.anchor.targetId === element.end.anchor.targetId
      ) {
        errors.push(`connector "${element.id}" must connect two different targets`)
      }
      break
  }
  return errors
}

function elementRefIds(element: MindMapElement): string[] {
  switch (element.type) {
    case 'relationship':
      return [element.from, element.to]
    case 'boundary':
      return element.children === undefined ? [element.topicId] : [element.topicId, ...element.children]
    case 'summary':
      return [
        element.from,
        element.to,
        ...(element.sourceTopicIds ?? []),
        ...(element.summaryTopicId === undefined ? [] : [element.summaryTopicId])
      ]
    case 'callout':
      return [element.topicId]
    case 'free-topic':
      return [element.topicId]
    case 'shape':
      return []
    case 'connector':
      return [
        ...(element.start.anchor?.targetType === 'topic' ? [element.start.anchor.targetId] : []),
        ...(element.end.anchor?.targetType === 'topic' ? [element.end.anchor.targetId] : [])
      ]
  }
}

function mutateElementWithPatch(element: MindMapElement, patch: MindMapElementUpdatePatch): MindMapElementUpdatePatch {
  const record = element as unknown as Record<string, unknown>
  const inverseRecord: Record<string, unknown> = {}
  const keys = Object.keys(patch) as Array<keyof MindMapElementUpdatePatch>
  for (const key of keys) {
    applyOptionField(record, key, patch[key], inverseRecord)
  }
  return inverseRecord as MindMapElementUpdatePatch
}

function applyTopicInsert(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'topic.insert' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const parent = findTopic(sheet, command.parentId)
  if (parent === undefined) return error(command, 'PARENT_NOT_FOUND', `Parent topic "${command.parentId}" not found in sheet "${command.sheetId}"`)

  const treeErrors = validateTopicTree(sheet.id, command.node)
  if (treeErrors.length > 0) {
    return error(command, 'INVALID_PATCH', `Inserted topic violates tree invariants: ${treeErrors.map((e) => e.message).join('; ')}`)
  }
  const existingIds = new Set(collectTopicIds(sheet))
  const insertedIds = new Set(collectTopicIds({ ...sheet, root: command.node }))
  for (const id of insertedIds) {
    if (existingIds.has(id)) {
      return error(command, 'DUPLICATE_ID', `Topic id "${id}" already exists in sheet "${command.sheetId}"`)
    }
  }

  const insertIndex = clampIndex(command.index ?? parent.node.children.length, parent.node.children.length)
  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextParent = findTopic(nextSheet, command.parentId)
  if (nextParent === undefined) return error(command, 'PARENT_NOT_FOUND', `Parent topic "${command.parentId}" not found`)
  nextParent.node.children.splice(insertIndex, 0, structuredClone(command.node))

  const inverse: MindMapCommand = { type: 'topic.remove', sheetId: command.sheetId, topicId: command.node.id }
  return ok(next, inverse)
}

function applyTopicUpdate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'topic.update' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const topic = findTopic(sheet, command.topicId)
  if (topic === undefined) return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found in sheet "${command.sheetId}"`)

  const styleErrors = validateTopicStyle(command.patch.style ?? undefined)
  if (styleErrors.length > 0) return error(command, 'INVALID_STYLE', styleErrors.join('; '))

  const numberingErrors = validateTopicNumbering(command.patch.numbering ?? undefined)
  if (numberingErrors.length > 0) {
    return error(command, 'INVALID_NUMBERING', numberingErrors.join('; '))
  }

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextTopic = findTopic(nextSheet, command.topicId)
  if (nextTopic === undefined) return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found`)

  const inversePatch = mutateTopicWithPatch(nextTopic.node, command.patch)
  const inverse: MindMapCommand = { type: 'topic.update', sheetId: command.sheetId, topicId: command.topicId, patch: inversePatch }
  return ok(next, inverse)
}

function applyTopicMove(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'topic.move' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const topic = findTopic(sheet, command.topicId)
  if (topic === undefined) return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found in sheet "${command.sheetId}"`)
  if (topic.parent === null) return error(command, 'TOPIC_IS_ROOT', `Topic "${command.topicId}" is the root and cannot be moved`)
  const toParent = findTopic(sheet, command.toParentId)
  if (toParent === undefined) return error(command, 'PARENT_NOT_FOUND', `Target parent topic "${command.toParentId}" not found in sheet "${command.sheetId}"`)
  if (containsTopic(topic.node, command.toParentId)) {
    return error(command, 'CYCLIC_MOVE', `Cannot move topic "${command.topicId}" into its own descendant "${command.toParentId}"`)
  }

  const oldParentId = topic.parent.id
  const oldIndex = topic.index
  const requestedIndex = command.toIndex ?? 0

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextTopic = findTopic(nextSheet, command.topicId)
  if (nextTopic === undefined || nextTopic.parent === null) {
    return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found`)
  }
  const [moved] = nextTopic.parent.children.splice(nextTopic.index, 1)
  if (moved === undefined) return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found`)
  const nextToParent = findTopic(nextSheet, command.toParentId)
  if (nextToParent === undefined) return error(command, 'PARENT_NOT_FOUND', `Target parent topic "${command.toParentId}" not found`)
  const insertIndex = clampIndex(requestedIndex, nextToParent.node.children.length)
  nextToParent.node.children.splice(insertIndex, 0, moved)

  const inverse: MindMapCommand = {
    type: 'topic.move',
    sheetId: command.sheetId,
    topicId: command.topicId,
    toParentId: oldParentId,
    toIndex: oldIndex
  }
  return ok(next, inverse)
}

function applyTopicRemove(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'topic.remove' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const topic = findTopic(sheet, command.topicId)
  if (topic === undefined) return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found in sheet "${command.sheetId}"`)
  if (topic.parent === null) return error(command, 'TOPIC_IS_ROOT', `Topic "${command.topicId}" is the root and cannot be removed`)

  const removed = structuredClone(topic.node)
  const parentId = topic.parent.id
  const index = topic.index

  // Elements that reference any topic inside the removed subtree normally
  // disappear with it. A sibling-range summary is the exception while at least
  // two source topics survive: retarget it to the smaller source set so a
  // later deletion can still reparent its output correctly. Cross-branch
  // summaries persist their explicit source ids, so this applies equally to
  // summaries that span several branches.
  const removedTopicIds = new Set(collectTopicIds({ ...sheet, root: topic.node }))
  const retainedSummaryEndpoints = new Map<string, {
    from: string
    to: string
    sourceTopicIds?: string[]
  }>()
  for (const element of sheet.elements) {
    if (element.type !== 'summary' || element.summaryTopicId === undefined) continue
    if (removedTopicIds.has(element.summaryTopicId)) continue
    const explicitSourceIds = element.sourceTopicIds
    const from = findTopic(sheet, element.from)
    const to = findTopic(sheet, element.to)
    if (!from || !to) continue
    const coveredTopics = explicitSourceIds === undefined
      ? from.parent !== null && from.parent === to.parent
        ? from.parent.children.slice(Math.min(from.index, to.index), Math.max(from.index, to.index) + 1)
        : [from.node, to.node]
      : explicitSourceIds.map((topicId) => findTopic(sheet, topicId)?.node)
    if (coveredTopics.some((candidate) => candidate === undefined)) continue
    const resolvedTopics = coveredTopics as MindMapTopicV2[]
    if (!resolvedTopics.some((candidate) => removedTopicIds.has(candidate.id))) continue
    const remainingRange = resolvedTopics.filter((candidate) => !removedTopicIds.has(candidate.id))
    if (remainingRange.length >= 2) {
      retainedSummaryEndpoints.set(element.id, {
        from: remainingRange[0]!.id,
        to: remainingRange.at(-1)!.id,
        ...(explicitSourceIds === undefined
          ? {}
          : { sourceTopicIds: remainingRange.map((candidate) => candidate.id) })
      })
    }
  }
  const attachedElements = sheet.elements
    .map((element, elementIndex) => ({ element, elementIndex }))
    .filter(({ element }) =>
      !retainedSummaryEndpoints.has(element.id) &&
      elementRefIds(element).some((id) => removedTopicIds.has(id))
    )

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextTopic = findTopic(nextSheet, command.topicId)
  if (nextTopic === undefined || nextTopic.parent === null) {
    return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found`)
  }
  nextTopic.parent.children.splice(nextTopic.index, 1)
  const removedElementIds = new Set(attachedElements.map(({ element }) => element.id))
  nextSheet.elements = nextSheet.elements
    .filter((element) => !removedElementIds.has(element.id))
    .map((element) => {
      const endpoints = retainedSummaryEndpoints.get(element.id)
      return endpoints && element.type === 'summary'
        ? { ...element, ...endpoints }
        : element
    })

  // Images attached to any removed topic are removed with it (they reference a
  // now-missing topicId and would otherwise violate domain invariants).
  const removedImages = (nextSheet.images ?? []).filter((image) =>
    removedTopicIds.has(image.topicId ?? '')
  )
  const removedImageIds = new Set(removedImages.map((image) => image.id))
  const remainingImages = (nextSheet.images ?? []).filter((image) => !removedImageIds.has(image.id))
  nextSheet.images = remainingImages.length > 0 ? remainingImages : undefined

  const inverseCommands: MindMapCommand[] = [
    { type: 'topic.insert', sheetId: command.sheetId, parentId, index, node: removed }
  ]
  for (const { element, elementIndex } of attachedElements) {
    inverseCommands.push({
      type: 'element.create',
      sheetId: command.sheetId,
      index: elementIndex,
      element: structuredClone(element)
    })
  }
  for (const removedImage of removedImages) {
    inverseCommands.push({
      type: 'image.create',
      sheetId: command.sheetId,
      image: structuredClone(removedImage)
    })
  }
  for (const [elementId] of retainedSummaryEndpoints) {
    const original = sheet.elements.find((element) => element.id === elementId)
    if (!original || original.type !== 'summary') continue
    inverseCommands.push({
      type: 'element.update',
      sheetId: command.sheetId,
      elementId,
      patch: {
        from: original.from,
        to: original.to,
        ...(original.sourceTopicIds === undefined
          ? {}
          : { sourceTopicIds: [...original.sourceTopicIds] })
      }
    })
  }

  const inverse: MindMapCommand =
    inverseCommands.length === 1
      ? inverseCommands[0]!
      : { type: 'transaction', commands: inverseCommands }
  return ok(next, inverse)
}

function applyAssetCreate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'asset.create' }>): MindMapCommandResult {
  const asset = command.asset
  if (!asset || typeof asset.id !== 'string' || asset.id.length === 0 || typeof asset.fileName !== 'string') {
    return error(command, 'INVALID_PATCH', 'asset.create requires a valid asset reference')
  }
  if (document.assets.some((candidate) => candidate.id === asset.id)) {
    return error(command, 'DUPLICATE_ID', `Asset id "${asset.id}" already exists`)
  }
  const next = cloneDocument(document)
  next.assets.push(structuredClone(asset))
  return ok(next, { type: 'asset.remove', assetId: asset.id })
}

function collectAssetReferences(document: MindMapDocumentV2, assetId: string): number {
  let count = 0
  for (const sheet of document.sheets) {
    for (const image of sheet.images ?? []) {
      if (image.assetId === assetId) count += 1
    }
    const stack: MindMapTopicV2[] = [sheet.root]
    while (stack.length > 0) {
      const topic = stack.pop()
      if (!topic) continue
      if (topic.assetIds?.includes(assetId)) count += 1
      stack.push(...topic.children)
    }
  }
  return count
}

function applyAssetRemove(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'asset.remove' }>): MindMapCommandResult {
  const index = document.assets.findIndex((asset) => asset.id === command.assetId)
  if (index < 0) return error(command, 'ASSET_NOT_FOUND', `Asset "${command.assetId}" not found`)
  if (collectAssetReferences(document, command.assetId) > 0) {
    return error(command, 'INVALID_PATCH', `Asset "${command.assetId}" is still referenced by a topic`)
  }
  const removed = structuredClone(document.assets[index])
  const next = cloneDocument(document)
  next.assets.splice(index, 1)
  return ok(next, { type: 'asset.create', asset: removed })
}

function applyElementCreate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'element.create' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  if (sheet.elements.some((element) => element.id === command.element.id)) {
    return error(command, 'DUPLICATE_ID', `Element id "${command.element.id}" already exists in sheet "${command.sheetId}"`)
  }
  const topicIds = new Set(collectTopicIds(sheet))
  const shapeIds = new Set(sheet.elements.filter((element) => element.type === 'shape').map((element) => element.id))
  const refErrors = elementReferenceErrors(command.element, topicIds, shapeIds)
  if (refErrors.length > 0) return error(command, 'INVALID_PATCH', refErrors.join('; '))
  const styleErrors = validateElementStyle(command.element.style)
  if (styleErrors.length > 0) return error(command, 'INVALID_STYLE', styleErrors.join('; '))

  const insertIndex = clampIndex(command.index ?? sheet.elements.length, sheet.elements.length)
  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  nextSheet.elements.splice(insertIndex, 0, structuredClone(command.element))

  const inverse: MindMapCommand = { type: 'element.remove', sheetId: command.sheetId, elementId: command.element.id }
  return ok(next, inverse)
}

function applyElementUpdate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'element.update' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const element = sheet.elements.find((candidate) => candidate.id === command.elementId)
  if (element === undefined) return error(command, 'ELEMENT_NOT_FOUND', `Element "${command.elementId}" not found in sheet "${command.sheetId}"`)

  const allowed = ELEMENT_ALLOWED_FIELDS[element.type]
  const patchKeys = Object.keys(command.patch)
  for (const key of patchKeys) {
    if (allowed === undefined || !allowed.has(key)) {
      return error(command, 'INVALID_PATCH', `Field "${key}" is not allowed for element type "${element.type}"`)
    }
  }
  const styleErrors = validateElementStyle(command.patch.style ?? undefined)
  if (styleErrors.length > 0) return error(command, 'INVALID_STYLE', styleErrors.join('; '))

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextElement = nextSheet.elements.find((candidate) => candidate.id === command.elementId)
  if (nextElement === undefined) return error(command, 'ELEMENT_NOT_FOUND', `Element "${command.elementId}" not found`)

  const inversePatch = mutateElementWithPatch(nextElement, command.patch)
  const topicIds = new Set(collectTopicIds(nextSheet))
  const shapeIds = new Set(nextSheet.elements.filter((candidate) => candidate.type === 'shape').map((candidate) => candidate.id))
  const refErrors = elementReferenceErrors(nextElement, topicIds, shapeIds)
  if (refErrors.length > 0) return error(command, 'INVALID_PATCH', refErrors.join('; '))

  const inverse: MindMapCommand = {
    type: 'element.update',
    sheetId: command.sheetId,
    elementId: command.elementId,
    patch: inversePatch
  }
  return ok(next, inverse)
}

function applyElementRemove(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'element.remove' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const index = sheet.elements.findIndex((candidate) => candidate.id === command.elementId)
  if (index === -1) return error(command, 'ELEMENT_NOT_FOUND', `Element "${command.elementId}" not found in sheet "${command.sheetId}"`)
  const removed = structuredClone(sheet.elements[index])

  // Removing a shape also removes every connector attached to it as the same
  // undoable operation. Free endpoints remain valid on their own.
  const attachedConnectors: Array<{ element: MindMapElement; elementIndex: number }> = []
  if (removed.type === 'shape') {
    for (let elementIndex = 0; elementIndex < sheet.elements.length; elementIndex += 1) {
      const element = sheet.elements[elementIndex]!
      if (element.type !== 'connector') continue
      if (
        (element.start.anchor?.targetType === 'shape' && element.start.anchor.targetId === removed.id)
        || (element.end.anchor?.targetType === 'shape' && element.end.anchor.targetId === removed.id)
      ) {
        attachedConnectors.push({ element: structuredClone(element), elementIndex })
      }
    }
  }

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextIndex = nextSheet.elements.findIndex((candidate) => candidate.id === command.elementId)
  if (nextIndex === -1) return error(command, 'ELEMENT_NOT_FOUND', `Element "${command.elementId}" not found`)
  const removedElementIds = new Set([
    removed.id,
    ...attachedConnectors.map(({ element }) => element.id)
  ])
  nextSheet.elements = nextSheet.elements.filter((element) => !removedElementIds.has(element.id))

  const connectorsBeforeShape = attachedConnectors.filter(({ elementIndex }) => elementIndex < index).length
  const restoreCommands: MindMapCommand[] = [
    {
      type: 'element.create',
      sheetId: command.sheetId,
      // Shape targets must exist before their connectors can be recreated.
      // Inserting it before the removed preceding connectors preserves the
      // original ordering once those connectors are restored at their indexes.
      index: index - connectorsBeforeShape,
      element: removed
    },
    ...attachedConnectors
      .sort((a, b) => a.elementIndex - b.elementIndex)
      .map(({ element, elementIndex }): MindMapCommand => ({
        type: 'element.create',
        sheetId: command.sheetId,
        index: elementIndex,
        element
      }))
  ]
  const inverse: MindMapCommand = restoreCommands.length === 1
    ? restoreCommands[0]!
    : { type: 'transaction', commands: restoreCommands }
  return ok(next, inverse)
}

function imageReferenceErrors(image: MindMapImageElement, topicIds: Set<string>): string[] {
  const errors: string[] = []
  if (image.topicId !== undefined && !topicIds.has(image.topicId)) {
    errors.push(`image "${image.id}" references missing topic "${image.topicId}"`)
  }
  if (image.assetId === undefined || image.assetId.length === 0) {
    errors.push(`image "${image.id}" requires a non-empty assetId`)
  }
  if (!(image.width > 0) || !(image.height > 0)) {
    errors.push(`image "${image.id}" requires positive width and height`)
  }
  return errors
}

function applyImageCreate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'image.create' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  if (document.assets.findIndex((a) => a.id === command.image.assetId) < 0) {
    return error(command, 'ASSET_NOT_FOUND', `Asset "${command.image.assetId}" not found`)
  }
  if ((sheet.images ?? []).some((image) => image.id === command.image.id)) {
    return error(command, 'DUPLICATE_ID', `Image id "${command.image.id}" already exists in sheet "${command.sheetId}"`)
  }
  const topicIds = new Set(collectTopicIds(sheet))
  const refErrors = imageReferenceErrors(command.image, topicIds)
  if (refErrors.length > 0) return error(command, 'INVALID_PATCH', refErrors.join('; '))

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const images = nextSheet.images ?? (nextSheet.images = [])
  const insertIndex = clampIndex(command.index ?? images.length, images.length)
  images.splice(insertIndex, 0, structuredClone(command.image))

  const inverse: MindMapCommand = { type: 'image.remove', sheetId: command.sheetId, imageId: command.image.id }
  return ok(next, inverse)
}

function mutateImageWithPatch(image: MindMapImageElement, patch: MindMapImageUpdatePatch): MindMapImageUpdatePatch {
  const record = image as unknown as Record<string, unknown>
  const inverseRecord: Record<string, unknown> = {}
  for (const key of ['label', 'assetId', 'width', 'height', 'position', 'topicId', 'style'] as const) {
    const value = (patch as Record<string, unknown>)[key]
    if (value === undefined) continue
    inverseRecord[key] = record[key]
    record[key] = value === null ? undefined : value
  }
  return inverseRecord as MindMapImageUpdatePatch
}

function applyImageUpdate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'image.update' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const image = (sheet.images ?? []).find((candidate) => candidate.id === command.imageId)
  if (image === undefined) return error(command, 'ELEMENT_NOT_FOUND', `Image "${command.imageId}" not found in sheet "${command.sheetId}"`)

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextImage = (nextSheet.images ?? []).find((candidate) => candidate.id === command.imageId)
  if (nextImage === undefined) return error(command, 'ELEMENT_NOT_FOUND', `Image "${command.imageId}" not found`)

  const inversePatch = mutateImageWithPatch(nextImage, command.patch)
  const topicIds = new Set(collectTopicIds(nextSheet))
  const refErrors = imageReferenceErrors(nextImage, topicIds)
  if (refErrors.length > 0) return error(command, 'INVALID_PATCH', refErrors.join('; '))
  if (document.assets.findIndex((a) => a.id === nextImage.assetId) < 0) {
    return error(command, 'ASSET_NOT_FOUND', `Asset "${nextImage.assetId}" not found`)
  }

  const inverse: MindMapCommand = {
    type: 'image.update',
    sheetId: command.sheetId,
    imageId: command.imageId,
    patch: inversePatch
  }
  return ok(next, inverse)
}

function applyImageRemove(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'image.remove' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const images = sheet.images ?? []
  const index = images.findIndex((candidate) => candidate.id === command.imageId)
  if (index === -1) return error(command, 'ELEMENT_NOT_FOUND', `Image "${command.imageId}" not found in sheet "${command.sheetId}"`)
  const removed = structuredClone(images[index])

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextImages = nextSheet.images ?? (nextSheet.images = [])
  const nextIndex = nextImages.findIndex((candidate) => candidate.id === command.imageId)
  if (nextIndex === -1) return error(command, 'ELEMENT_NOT_FOUND', `Image "${command.imageId}" not found`)
  nextImages.splice(nextIndex, 1)

  const inverse: MindMapCommand = {
    type: 'image.create',
    sheetId: command.sheetId,
    index,
    image: removed
  }
  return ok(next, inverse)
}

function applySelectionSetStyle(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'selection.set-style' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const topicIds = new Set(collectTopicIds(sheet))
  for (const topicId of command.topicIds) {
    if (!topicIds.has(topicId)) {
      return error(command, 'TOPIC_NOT_FOUND', `Topic "${topicId}" not found in sheet "${command.sheetId}"`)
    }
  }
  const styleErrors = validateTopicStyle(command.style)
  if (styleErrors.length > 0) return error(command, 'INVALID_STYLE', styleErrors.join('; '))

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)

  const inverseCommands: MindMapCommand[] = []
  for (const topicId of command.topicIds) {
    const topic = findTopic(nextSheet, topicId)
    if (topic === undefined) continue
    const oldStyle = topic.node.style
    topic.node.style = structuredClone(command.style)
    inverseCommands.push({
      type: 'topic.update',
      sheetId: command.sheetId,
      topicId,
      patch: { style: oldStyle === undefined ? null : oldStyle }
    })
  }

  const inverse: MindMapCommand = { type: 'transaction', commands: inverseCommands }
  return ok(next, inverse)
}

function applySheetCreate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'sheet.create' }>): MindMapCommandResult {
  const providedSheet = command.sheet
  const sheetId = providedSheet?.id ?? command.sheetId
  const title = providedSheet?.title ?? command.title

  if (providedSheet !== undefined) {
    if (document.sheets.some((sheet) => sheet.id === providedSheet.id)) {
      return error(command, 'DUPLICATE_ID', `Sheet id "${providedSheet.id}" already exists`)
    }
    const sheetErrors = validateMindMapSheetV2(providedSheet)
    if (sheetErrors.length > 0) {
      return error(command, 'INVALID_PATCH', `Provided sheet violates invariants: ${sheetErrors.map((e) => e.message).join('; ')}`)
    }
  } else if (sheetId === undefined || title === undefined) {
    return error(command, 'INVALID_PATCH', 'sheet.create requires either "sheet" or both "sheetId" and "title"')
  } else if (document.sheets.some((sheet) => sheet.id === sheetId)) {
    return error(command, 'DUPLICATE_ID', `Sheet id "${sheetId}" already exists`)
  }

  const newSheet: MindMapSheetV2 =
    providedSheet !== undefined
      ? structuredClone(providedSheet)
      : {
          id: sheetId as string,
          title: title as string,
          root: { id: `${sheetId as string}-root`, title: title as string, children: [] },
          elements: [],
          layout: {
            structureClass: DEFAULT_MIND_MAP_STRUCTURE_CLASS,
            defaultTopicShape: DEFAULT_MIND_MAP_TOPIC_SHAPE
          }
        }

  const insertIndex = clampIndex(command.index ?? document.sheets.length, document.sheets.length)
  const next = cloneDocument(document)
  next.sheets.splice(insertIndex, 0, newSheet)

  const inverse: MindMapCommand = { type: 'sheet.remove', sheetId: newSheet.id }
  return ok(next, inverse)
}

function applySheetRename(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'sheet.rename' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const oldTitle = sheet.title
  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  nextSheet.title = command.title

  const inverse: MindMapCommand = { type: 'sheet.rename', sheetId: command.sheetId, title: oldTitle }
  return ok(next, inverse)
}

const VALID_STRUCTURE_CLASSES: ReadonlySet<MindMapStructureClass> = new Set(
  STRUCTURE_TYPE_PRESETS.map((preset) => preset.id)
)

const KNOWN_TOPIC_SHAPES = new Set([
  'roundedRect', 'rounded-rect', 'rect', 'ellipse', 'diamond', 'underline', 'fishbone', 'none',
  'quote', 'callout', 'bracket', 'arrow-right', 'arrow-left', 'heart', 'cloud',
  'star', 'parallelogram', 'hexagon'
])

const VALID_LINE_STYLES: ReadonlySet<NonNullable<MindMapLayoutSettings['lineStyle']>> = new Set([
  'curve',
  'straight',
  'elbow',
  'rounded-elbow',
  'bight',
  'fold',
  'rounded-fold'
])

const VALID_LINE_PATTERNS: ReadonlySet<NonNullable<MindMapLayoutSettings['linePattern']>> = new Set([
  'solid',
  'dash',
  'hand-drawn-solid',
  'hand-drawn-dash'
])

function applySheetUpdateLayout(
  document: MindMapDocumentV2,
  command: Extract<MindMapCommand, { type: 'sheet.update-layout' }>
): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) {
    return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  }

  const patch = command.patch
  if (patch.structureClass !== undefined && !VALID_STRUCTURE_CLASSES.has(patch.structureClass)) {
    return error(command, 'INVALID_PATCH', `Unknown structure class "${String(patch.structureClass)}"`)
  }
  if (patch.spacing !== undefined && patch.spacing !== null) {
    if (!Number.isFinite(patch.spacing) || patch.spacing < 0) {
      return error(command, 'INVALID_PATCH', 'Layout spacing must be a finite non-negative number')
    }
  }
  if (patch.lineStyle !== undefined && patch.lineStyle !== null && !VALID_LINE_STYLES.has(patch.lineStyle)) {
    return error(command, 'INVALID_PATCH', `Unknown connector line style "${String(patch.lineStyle)}"`)
  }
  if (patch.lineWidthScale !== undefined && patch.lineWidthScale !== null) {
    if (!Number.isFinite(patch.lineWidthScale) || patch.lineWidthScale <= 0 || patch.lineWidthScale > 4) {
      return error(command, 'INVALID_PATCH', 'Layout line-width scale must be a finite number in (0, 4]')
    }
  }
  if (patch.linePattern !== undefined && patch.linePattern !== null && !VALID_LINE_PATTERNS.has(patch.linePattern)) {
    return error(command, 'INVALID_PATCH', `Unknown branch line pattern "${String(patch.linePattern)}"`)
  }
  if (patch.defaultTopicShape !== undefined && patch.defaultTopicShape !== null && !KNOWN_TOPIC_SHAPES.has(patch.defaultTopicShape)) {
    return error(command, 'INVALID_PATCH', `Unknown default topic shape "${String(patch.defaultTopicShape)}"`)
  }
  if (patch.defaultTopicStyle !== undefined && patch.defaultTopicStyle !== null) {
    const styleErrors = validateTopicStyle(patch.defaultTopicStyle)
    if (styleErrors.length > 0) {
      return error(command, 'INVALID_PATCH', `Invalid default topic style: ${styleErrors.join('; ')}`)
    }
  }

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) {
    return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  }

  const previous = nextSheet.layout
  const inversePatch: Extract<MindMapCommand, { type: 'sheet.update-layout' }>['patch'] = {
    structureClass: previous.structureClass,
    direction: previous.direction ?? null,
    compact: previous.compact ?? null,
    spacing: previous.spacing ?? null,
    lineStyle: previous.lineStyle ?? null,
    lineWidthScale: previous.lineWidthScale ?? null,
    linePattern: previous.linePattern ?? null,
    tapered: previous.tapered ?? null,
    defaultTopicShape: previous.defaultTopicShape ?? null,
    defaultTopicStyle: previous.defaultTopicStyle ?? null
  }

  const nextLayout = { ...previous }
  if (patch.structureClass !== undefined) nextLayout.structureClass = patch.structureClass
  if (patch.direction !== undefined) {
    if (patch.direction === null) delete nextLayout.direction
    else nextLayout.direction = patch.direction
  }
  if (patch.compact !== undefined) {
    if (patch.compact === null) delete nextLayout.compact
    else nextLayout.compact = patch.compact
  }
  if (patch.spacing !== undefined) {
    if (patch.spacing === null) delete nextLayout.spacing
    else nextLayout.spacing = patch.spacing
  }
  if (patch.lineStyle !== undefined) {
    if (patch.lineStyle === null) delete nextLayout.lineStyle
    else nextLayout.lineStyle = patch.lineStyle
  }
  if (patch.lineWidthScale !== undefined) {
    if (patch.lineWidthScale === null) delete nextLayout.lineWidthScale
    else nextLayout.lineWidthScale = patch.lineWidthScale
  }
  if (patch.linePattern !== undefined) {
    if (patch.linePattern === null) delete nextLayout.linePattern
    else nextLayout.linePattern = patch.linePattern
  }
  if (patch.tapered !== undefined) {
    if (patch.tapered === null) delete nextLayout.tapered
    else nextLayout.tapered = patch.tapered
  }
  if (patch.defaultTopicShape !== undefined) {
    if (patch.defaultTopicShape === null) delete nextLayout.defaultTopicShape
    else nextLayout.defaultTopicShape = patch.defaultTopicShape
  }
  if (patch.defaultTopicStyle !== undefined) {
    if (patch.defaultTopicStyle === null) delete nextLayout.defaultTopicStyle
    else nextLayout.defaultTopicStyle = structuredClone(patch.defaultTopicStyle)
  }
  nextSheet.layout = nextLayout

  const inverse: MindMapCommand = {
    type: 'sheet.update-layout',
    sheetId: command.sheetId,
    patch: inversePatch
  }
  return ok(next, inverse)
}

/**
 * Reorder a sheet so it ends up at `toIndex` (0-based final index).
 *
 * Note: this intentionally differs from `domain/sheet-operations#reorderSheet`,
 * which interprets `toIndex` as a pre-removal drop slot. The command layer
 * uses the more intuitive "final index" semantics and documents it here.
 */
function applySheetReorder(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'sheet.reorder' }>): MindMapCommandResult {
  const fromIndex = document.sheets.findIndex((sheet) => sheet.id === command.sheetId)
  if (fromIndex === -1) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  if (!Number.isInteger(command.toIndex) || command.toIndex < 0) {
    return error(command, 'INVALID_INDEX', `toIndex must be a non-negative integer, got ${command.toIndex}`)
  }

  const next = cloneDocument(document)
  const [moved] = next.sheets.splice(fromIndex, 1)
  if (moved === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const insertIndex = clampIndex(command.toIndex, next.sheets.length)
  next.sheets.splice(insertIndex, 0, moved)

  const inverse: MindMapCommand = { type: 'sheet.reorder', sheetId: command.sheetId, toIndex: fromIndex }
  return ok(next, inverse)
}

function applySheetRemove(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'sheet.remove' }>): MindMapCommandResult {
  const index = document.sheets.findIndex((sheet) => sheet.id === command.sheetId)
  if (index === -1) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const removed = structuredClone(document.sheets[index])

  const next = cloneDocument(document)
  const nextIndex = next.sheets.findIndex((sheet) => sheet.id === command.sheetId)
  if (nextIndex === -1) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  next.sheets.splice(nextIndex, 1)

  const inverse: MindMapCommand = { type: 'sheet.create', index, sheet: removed }
  return ok(next, inverse)
}

function applyDocumentRename(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'document.rename' }>): MindMapCommandResult {
  const oldTitle = document.title
  const next = cloneDocument(document)
  next.title = command.title
  const inverse: MindMapCommand = { type: 'document.rename', title: oldTitle }
  return ok(next, inverse)
}

function applyDocumentApplyTheme(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'document.apply-theme' }>): MindMapCommandResult {
  const oldTheme = document.theme
  const next = cloneDocument(document)
  next.theme = structuredClone(command.theme)
  const inverse: MindMapCommand = { type: 'document.apply-theme', theme: oldTheme }
  return ok(next, inverse)
}

function applyTransaction(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'transaction' }>): MindMapCommandResult {
  let current = cloneDocument(document)
  const inverses: MindMapCommand[] = []
  for (const innerCommand of command.commands) {
    const result = applyMindMapCommand(current, innerCommand)
    if (!result.ok) {
      return error(
        command,
        'INVALID_TRANSACTION',
        `transaction failed at command ${inverses.length}: ${result.error.code} — ${result.error.message}`
      )
    }
    current = result.document
    inverses.push(result.inverse)
  }
  const inverse: MindMapCommand = { type: 'transaction', commands: inverses.reverse() }
  return ok(current, inverse)
}

/**
 * Pure command reducer. Validates the input document invariants, applies the
 * command immutably, validates the result invariants, and returns the inverse.
 */
export function applyMindMapCommand(document: MindMapDocumentV2, command: MindMapCommand): MindMapCommandResult {
  const inputValidation = validateMindMapDocumentV2(document)
  if (!inputValidation.ok) {
    return error(
      command,
      'INVALID_DOCUMENT',
      `input document violates invariants: ${inputValidation.errors.map((e) => e.message).join('; ')}`
    )
  }

  switch (command.type) {
    case 'topic.insert':
      return applyTopicInsert(document, command)
    case 'topic.update':
      return applyTopicUpdate(document, command)
    case 'topic.move':
      return applyTopicMove(document, command)
    case 'topic.remove':
      return applyTopicRemove(document, command)
    case 'asset.create':
      return applyAssetCreate(document, command)
    case 'asset.remove':
      return applyAssetRemove(document, command)
    case 'element.create':
      return applyElementCreate(document, command)
    case 'element.update':
      return applyElementUpdate(document, command)
    case 'element.remove':
      return applyElementRemove(document, command)
    case 'image.create':
      return applyImageCreate(document, command)
    case 'image.update':
      return applyImageUpdate(document, command)
    case 'image.remove':
      return applyImageRemove(document, command)
    case 'selection.set-style':
      return applySelectionSetStyle(document, command)
    case 'sheet.create':
      return applySheetCreate(document, command)
    case 'sheet.rename':
      return applySheetRename(document, command)
    case 'sheet.update-layout':
      return applySheetUpdateLayout(document, command)
    case 'sheet.reorder':
      return applySheetReorder(document, command)
    case 'sheet.remove':
      return applySheetRemove(document, command)
    case 'document.apply-theme':
      return applyDocumentApplyTheme(document, command)
    case 'document.rename':
      return applyDocumentRename(document, command)
    case 'transaction':
      return applyTransaction(document, command)
  }
}

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
import type { MindMapDocumentV2, MindMapElement, MindMapElementStyle, MindMapSheetV2, MindMapTopicStyleOverride, MindMapTopicV2 } from '../domain/types'
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
  MindMapTopicUpdatePatch
} from './mind-map-command-types'

const TOPIC_PATCH_FIELDS: ReadonlyArray<keyof MindMapTopicUpdatePatch> = [
  'title',
  'note',
  'collapsed',
  'labels',
  'markers',
  'links',
  'sourceRefs',
  'planning',
  'style',
  'manualPosition'
]

const ELEMENT_ALLOWED_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  relationship: new Set(['label', 'from', 'to', 'style']),
  boundary: new Set(['label', 'topicId', 'children', 'style']),
  summary: new Set(['label', 'from', 'to', 'style']),
  callout: new Set(['label', 'topicId', 'text', 'position', 'style']),
  'free-topic': new Set(['label', 'topicId', 'position', 'style'])
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

function validateTopicStyle(style: MindMapTopicStyleOverride | undefined): string[] {
  if (style === undefined) return []
  const errors: string[] = []
  if (style.fontSize !== undefined && (!Number.isFinite(style.fontSize) || style.fontSize <= 0)) {
    errors.push('fontSize must be a positive number')
  }
  return errors
}

function validateElementStyle(style: MindMapElementStyle | undefined): string[] {
  if (style === undefined) return []
  const errors: string[] = []
  if (style.strokeWidth !== undefined && (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0)) {
    errors.push('strokeWidth must be a non-negative number')
  }
  if (style.fontSize !== undefined && (!Number.isFinite(style.fontSize) || style.fontSize <= 0)) {
    errors.push('fontSize must be a positive number')
  }
  return errors
}

function elementReferenceErrors(element: MindMapElement, topicIds: ReadonlySet<string>): string[] {
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
      break
    case 'callout':
      if (!topicIds.has(element.topicId)) errors.push(`callout "${element.id}" references missing topic "${element.topicId}"`)
      break
    case 'free-topic':
      if (!topicIds.has(element.topicId)) errors.push(`free-topic "${element.id}" references missing topic "${element.topicId}"`)
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
      return [element.from, element.to]
    case 'callout':
      return [element.topicId]
    case 'free-topic':
      return [element.topicId]
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

  // Elements that reference any topic inside the removed subtree must be
  // removed too, otherwise the element-reference invariant breaks.
  const removedTopicIds = new Set(collectTopicIds({ ...sheet, root: topic.node }))
  const attachedElements = sheet.elements
    .map((element, elementIndex) => ({ element, elementIndex }))
    .filter(({ element }) => elementRefIds(element).some((id) => removedTopicIds.has(id)))

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextTopic = findTopic(nextSheet, command.topicId)
  if (nextTopic === undefined || nextTopic.parent === null) {
    return error(command, 'TOPIC_NOT_FOUND', `Topic "${command.topicId}" not found`)
  }
  nextTopic.parent.children.splice(nextTopic.index, 1)
  const removedElementIds = new Set(attachedElements.map(({ element }) => element.id))
  nextSheet.elements = nextSheet.elements.filter((element) => !removedElementIds.has(element.id))

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

  const inverse: MindMapCommand =
    inverseCommands.length === 1 && attachedElements.length === 0
      ? inverseCommands[0]!
      : { type: 'transaction', commands: inverseCommands }
  return ok(next, inverse)
}

function applyElementCreate(document: MindMapDocumentV2, command: Extract<MindMapCommand, { type: 'element.create' }>): MindMapCommandResult {
  const sheet = getSheet(document, command.sheetId)
  if (sheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  if (sheet.elements.some((element) => element.id === command.element.id)) {
    return error(command, 'DUPLICATE_ID', `Element id "${command.element.id}" already exists in sheet "${command.sheetId}"`)
  }
  const topicIds = new Set(collectTopicIds(sheet))
  const refErrors = elementReferenceErrors(command.element, topicIds)
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
  const refErrors = elementReferenceErrors(nextElement, topicIds)
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

  const next = cloneDocument(document)
  const nextSheet = getSheet(next, command.sheetId)
  if (nextSheet === undefined) return error(command, 'SHEET_NOT_FOUND', `Sheet "${command.sheetId}" not found`)
  const nextIndex = nextSheet.elements.findIndex((candidate) => candidate.id === command.elementId)
  if (nextIndex === -1) return error(command, 'ELEMENT_NOT_FOUND', `Element "${command.elementId}" not found`)
  nextSheet.elements.splice(nextIndex, 1)

  const inverse: MindMapCommand = {
    type: 'element.create',
    sheetId: command.sheetId,
    index,
    element: removed
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
          layout: { structureClass: 'org.xmind.ui.logic.right' }
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
    case 'element.create':
      return applyElementCreate(document, command)
    case 'element.update':
      return applyElementUpdate(document, command)
    case 'element.remove':
      return applyElementRemove(document, command)
    case 'selection.set-style':
      return applySelectionSetStyle(document, command)
    case 'sheet.create':
      return applySheetCreate(document, command)
    case 'sheet.rename':
      return applySheetRename(document, command)
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

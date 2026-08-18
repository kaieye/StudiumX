/**
 * Pure sheet lifecycle helpers for the v2 mind map model.
 *
 * All helpers are immutable: they return a new document and never mutate the
 * input. `copySheet` performs a deep copy with deterministic id remapping so
 * the resulting document still satisfies the id-uniqueness invariants.
 */
import type {
  MindMapConnectorEndpoint,
  MindMapDocumentV2,
  MindMapElement,
  MindMapSheetV2,
  MindMapTopicV2
} from './types'

export type MindMapSheetOperationErrorCode =
  | 'SHEET_NOT_FOUND'
  | 'INVALID_INDEX'

export class MindMapSheetOperationError extends Error {
  readonly code: MindMapSheetOperationErrorCode
  readonly sheetId?: string

  constructor(code: MindMapSheetOperationErrorCode, message: string, sheetId?: string) {
    super(message)
    this.name = 'MindMapSheetOperationError'
    this.code = code
    this.sheetId = sheetId
  }
}

function assertSheetFound(doc: MindMapDocumentV2, sheetId: string): MindMapSheetV2 {
  const sheet = doc.sheets.find((candidate) => candidate.id === sheetId)
  if (sheet === undefined) {
    throw new MindMapSheetOperationError(
      'SHEET_NOT_FOUND',
      `Sheet "${sheetId}" not found`,
      sheetId
    )
  }
  return sheet
}

/** Rename a sheet by id. Returns a new document; throws if the sheet is missing. */
export function renameSheet(
  doc: MindMapDocumentV2,
  sheetId: string,
  newTitle: string
): MindMapDocumentV2 {
  assertSheetFound(doc, sheetId)
  return {
    ...doc,
    sheets: doc.sheets.map((sheet) =>
      sheet.id === sheetId ? { ...sheet, title: newTitle } : sheet
    )
  }
}

/** Collect every id that must stay unique after a copy (sheet/topic/element/assets). */
function collectOccupiedIds(doc: MindMapDocumentV2): Set<string> {
  const occupied = new Set<string>(doc.assets.map((asset) => asset.id))
  for (const sheet of doc.sheets) {
    occupied.add(sheet.id)
    const stack: MindMapTopicV2[] = [sheet.root]
    while (stack.length > 0) {
      const topic = stack.pop()
      if (topic === undefined) continue
      occupied.add(topic.id)
      for (const child of topic.children) stack.push(child)
    }
    for (const element of sheet.elements) occupied.add(element.id)
  }
  return occupied
}

/** Deterministic copy id that avoids collisions with `occupied`. */
function uniqueCopyId(base: string, occupied: ReadonlySet<string>): string {
  let candidate = `${base}__copy`
  let n = 2
  while (occupied.has(candidate)) {
    candidate = `${base}__copy_${n}`
    n += 1
  }
  return candidate
}

function cloneTopic(
  topic: MindMapTopicV2,
  idMap: Map<string, string>,
  occupied: Set<string>
): MindMapTopicV2 {
  const newId = uniqueCopyId(topic.id, occupied)
  idMap.set(topic.id, newId)
  occupied.add(newId)
  return {
    ...topic,
    id: newId,
    children: topic.children.map((child) => cloneTopic(child, idMap, occupied))
  }
}

function cloneElement(
  element: MindMapElement,
  idMap: ReadonlyMap<string, string>,
  elementIdMap: ReadonlyMap<string, string>,
  occupied: Set<string>
): MindMapElement {
  const newElementId = elementIdMap.get(element.id) ?? uniqueCopyId(element.id, occupied)
  // `copySheet` pre-allocates every element id so connector anchors can be
  // remapped even when the target shape appears later in the array. Keep the
  // fallback for callers/tests that invoke this helper with a partial map.
  occupied.add(newElementId)
  const remap = (id: string): string => idMap.get(id) ?? id
  const remapElement = (id: string): string => elementIdMap.get(id) ?? id
  switch (element.type) {
    case 'relationship':
      return {
        ...element,
        id: newElementId,
        from: remap(element.from),
        to: remap(element.to)
      }
    case 'boundary':
      return {
        ...element,
        id: newElementId,
        topicId: remap(element.topicId),
        ...(element.children !== undefined
          ? { children: element.children.map(remap) }
          : {})
      }
    case 'summary':
      return {
        ...element,
        id: newElementId,
        from: remap(element.from),
        to: remap(element.to),
        ...(element.sourceTopicIds !== undefined
          ? { sourceTopicIds: element.sourceTopicIds.map(remap) }
          : {}),
        ...(element.summaryTopicId !== undefined
          ? { summaryTopicId: remap(element.summaryTopicId) }
          : {})
      }
    case 'callout':
      return {
        ...element,
        id: newElementId,
        topicId: remap(element.topicId)
      }
    case 'free-topic':
      return {
        ...element,
        id: newElementId,
        topicId: remap(element.topicId)
      }
    case 'shape':
      return {
        ...element,
        id: newElementId
      }
    case 'connector': {
      const remapEndpoint = (endpoint: MindMapConnectorEndpoint): MindMapConnectorEndpoint => ({
        ...endpoint,
        ...(endpoint.anchor
          ? {
              anchor: endpoint.anchor.targetType === 'topic'
                ? { ...endpoint.anchor, targetId: remap(endpoint.anchor.targetId) }
                : { ...endpoint.anchor, targetId: remapElement(endpoint.anchor.targetId) }
            }
          : {})
      })
      return {
        ...element,
        id: newElementId,
        start: remapEndpoint(element.start),
        end: remapEndpoint(element.end)
      }
    }
  }
}

/**
 * Deep-copy a sheet and insert the copy immediately after the source sheet.
 * All topic/element/sheet ids are remapped deterministically.
 */
export function copySheet(
  doc: MindMapDocumentV2,
  sheetId: string
): MindMapDocumentV2 {
  const sourceIndex = doc.sheets.findIndex((candidate) => candidate.id === sheetId)
  if (sourceIndex === -1) {
    throw new MindMapSheetOperationError('SHEET_NOT_FOUND', `Sheet "${sheetId}" not found`, sheetId)
  }
  const source = doc.sheets[sourceIndex]

  const occupied = collectOccupiedIds(doc)
  const idMap = new Map<string, string>()
  const newSheetId = uniqueCopyId(source.id, occupied)
  occupied.add(newSheetId)

  const copiedRoot = cloneTopic(source.root, idMap, occupied)
  const elementIdMap = new Map<string, string>()
  for (const element of source.elements) {
    const copiedId = uniqueCopyId(element.id, occupied)
    elementIdMap.set(element.id, copiedId)
    occupied.add(copiedId)
  }
  const copiedElements = source.elements.map((element) =>
    cloneElement(element, idMap, elementIdMap, occupied)
  )

  const copiedSheet: MindMapSheetV2 = {
    ...source,
    id: newSheetId,
    root: copiedRoot,
    elements: copiedElements
  }

  const sheets = [...doc.sheets]
  sheets.splice(sourceIndex + 1, 0, copiedSheet)
  return { ...doc, sheets }
}

/** Delete a sheet by id. Throws if the sheet is missing. */
export function deleteSheet(
  doc: MindMapDocumentV2,
  sheetId: string
): MindMapDocumentV2 {
  assertSheetFound(doc, sheetId)
  return { ...doc, sheets: doc.sheets.filter((sheet) => sheet.id !== sheetId) }
}

/**
 * Reorder a sheet to `toIndex`. Throws if the sheet is missing or the target
 * index is out of range.
 */
export function reorderSheet(
  doc: MindMapDocumentV2,
  sheetId: string,
  toIndex: number
): MindMapDocumentV2 {
  const fromIndex = doc.sheets.findIndex((candidate) => candidate.id === sheetId)
  if (fromIndex === -1) {
    throw new MindMapSheetOperationError('SHEET_NOT_FOUND', `Sheet "${sheetId}" not found`, sheetId)
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= doc.sheets.length) {
    throw new MindMapSheetOperationError(
      'INVALID_INDEX',
      `Target index ${toIndex} out of range [0, ${doc.sheets.length - 1}]`,
      sheetId
    )
  }

  const sheets = [...doc.sheets]
  const [moved] = sheets.splice(fromIndex, 1)
  if (moved === undefined) {
    throw new MindMapSheetOperationError('SHEET_NOT_FOUND', `Sheet "${sheetId}" not found`, sheetId)
  }

  // `toIndex` is the desired final index. After removing an item that was
  // before the target, the remaining array is one slot shorter, but inserting
  // at the same numeric index still places the moved sheet at that final
  // position (for example, A,B,C → move A to 2 ⇒ B,C,A).
  const adjustedIndex = toIndex
  sheets.splice(adjustedIndex, 0, moved)
  return { ...doc, sheets }
}

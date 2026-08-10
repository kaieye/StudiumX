/**
 * Domain invariants for the v2 mind map model.
 *
 * Invariants are the safety net the command reducers and importers rely on:
 * the topic tree must be well-formed (unique ids, no cycles), every element
 * must reference stable node ids that actually exist, and document/sheet
 * identities must be unique. Violations are reported as structured errors
 * with paths, never thrown ad hoc.
 */
import type {
  MindMapDocumentV2,
  MindMapElement,
  MindMapSheetV2,
  MindMapTopicV2
} from './types'

export type MindMapInvariantCode =
  | 'EMPTY_DOCUMENT_ID'
  | 'INVALID_REVISION'
  | 'INVALID_TIMESTAMP'
  | 'DUPLICATE_SHEET_ID'
  | 'EMPTY_SHEET_ID'
  | 'EMPTY_TOPIC_ID'
  | 'DUPLICATE_TOPIC_ID'
  | 'CYCLE_DETECTED'
  | 'EMPTY_ELEMENT_ID'
  | 'DUPLICATE_ELEMENT_ID'
  | 'UNKNOWN_ELEMENT_TYPE'
  | 'ELEMENT_REF_MISSING'
  | 'TOPIC_NOT_FOUND'

export type MindMapInvariantError = {
  code: MindMapInvariantCode
  message: string
  path: string[]
}

export type MindMapInvariantResult =
  | { ok: true }
  | { ok: false; errors: MindMapInvariantError[] }

const ELEMENT_TYPES = new Set([
  'relationship',
  'boundary',
  'summary',
  'callout',
  'free-topic'
] as const)

/**
 * Collect every topic id in the given sheet's tree (root included).
 * Deterministic: depth-first, pre-order.
 */
export function collectTopicIds(sheet: MindMapSheetV2): string[] {
  const ids: string[] = []
  const stack: MindMapTopicV2[] = [sheet.root]
  const visited = new Set<MindMapTopicV2>()
  while (stack.length > 0) {
    const topic = stack.pop()
    if (topic === undefined || visited.has(topic)) continue
    visited.add(topic)
    ids.push(topic.id)
    // Push children in reverse so pre-order matches document order.
    for (let i = topic.children.length - 1; i >= 0; i -= 1) {
      stack.push(topic.children[i])
    }
  }
  return ids
}

/** Validate a topic tree: non-empty ids, unique ids, no ancestor cycles. */
export function validateTopicTree(
  sheetId: string,
  root: MindMapTopicV2
): MindMapInvariantError[] {
  const errors: MindMapInvariantError[] = []
  const seen = new Set<string>()
  const ancestors = new Set<string>()

  const visit = (topic: MindMapTopicV2, path: string[]): void => {
    const currentPath = [...path, topic.id]
    if (typeof topic.id !== 'string' || topic.id.length === 0) {
      errors.push({
        code: 'EMPTY_TOPIC_ID',
        message: 'Topic id must be a non-empty string',
        path: [...currentPath, 'id']
      })
      return
    }
    // Stop descending once we are back on the ancestor path (cycle) or have
    // already fully processed this topic (duplicate id) — this keeps the
    // traversal terminating even for cyclic object graphs.
    if (ancestors.has(topic.id)) {
      errors.push({
        code: 'CYCLE_DETECTED',
        message: `Topic cycle detected at "${topic.id}"`,
        path: currentPath
      })
      return
    }
    if (seen.has(topic.id)) {
      errors.push({
        code: 'DUPLICATE_TOPIC_ID',
        message: `Duplicate topic id "${topic.id}" in sheet "${sheetId}"`,
        path: currentPath
      })
      return
    }
    seen.add(topic.id)
    ancestors.add(topic.id)

    if (!Array.isArray(topic.children)) {
      errors.push({
        code: 'EMPTY_TOPIC_ID',
        message: 'Topic children must be an array',
        path: [...currentPath, 'children']
      })
      ancestors.delete(topic.id)
      return
    }

    for (let i = 0; i < topic.children.length; i += 1) {
      visit(topic.children[i], [...currentPath, 'children', String(i)])
    }
    ancestors.delete(topic.id)
  }

  visit(root, ['root'])
  return errors
}

/** References a node id used by an element. */
type ElementRef = {
  field: string
  id: string
}

function elementRefs(element: MindMapElement): ElementRef[] {
  switch (element.type) {
    case 'relationship':
      return [
        { field: 'from', id: element.from },
        { field: 'to', id: element.to }
      ]
    case 'boundary': {
      const refs: ElementRef[] = [{ field: 'topicId', id: element.topicId }]
      if (element.children !== undefined) {
        for (const childId of element.children) {
          refs.push({ field: 'children', id: childId })
        }
      }
      return refs
    }
    case 'summary':
      return [
        { field: 'from', id: element.from },
        { field: 'to', id: element.to }
      ]
    case 'callout':
      return [{ field: 'topicId', id: element.topicId }]
    case 'free-topic':
      return [{ field: 'topicId', id: element.topicId }]
  }
}

/** Validate a sheet: tree invariants + element identity/reference invariants. */
export function validateMindMapSheetV2(sheet: MindMapSheetV2): MindMapInvariantError[] {
  const errors = validateTopicTree(sheet.id, sheet.root)
  const topicIds = new Set(collectTopicIds(sheet))

  if (typeof sheet.id !== 'string' || sheet.id.length === 0) {
    errors.push({
      code: 'EMPTY_SHEET_ID',
      message: 'Sheet id must be a non-empty string',
      path: ['id']
    })
  }

  const elementIds = new Set<string>()
  for (let i = 0; i < sheet.elements.length; i += 1) {
    const element = sheet.elements[i]
    const path = ['elements', String(i)]

    if (typeof element.id !== 'string' || element.id.length === 0) {
      errors.push({
        code: 'EMPTY_ELEMENT_ID',
        message: 'Element id must be a non-empty string',
        path: [...path, 'id']
      })
    } else if (elementIds.has(element.id)) {
      errors.push({
        code: 'DUPLICATE_ELEMENT_ID',
        message: `Duplicate element id "${element.id}"`,
        path: [...path, 'id']
      })
    }
    elementIds.add(element.id)

    if (!ELEMENT_TYPES.has(element.type)) {
      errors.push({
        code: 'UNKNOWN_ELEMENT_TYPE',
        message: `Unknown element type "${String(element.type)}"`,
        path: [...path, 'type']
      })
    }

    for (const ref of elementRefs(element)) {
      if (!topicIds.has(ref.id)) {
        errors.push({
          code: 'ELEMENT_REF_MISSING',
          message: `Element "${element.id}" references missing node id "${ref.id}" (${ref.field})`,
          path: [...path, ref.field]
        })
      }
    }
  }

  return errors
}

/** Validate a full v2 document. */
export function validateMindMapDocumentV2(
  doc: MindMapDocumentV2
): MindMapInvariantResult {
  const errors: MindMapInvariantError[] = []

  if (typeof doc.id !== 'string' || doc.id.length === 0) {
    errors.push({
      code: 'EMPTY_DOCUMENT_ID',
      message: 'Document id must be a non-empty string',
      path: ['id']
    })
  }
  if (!Number.isInteger(doc.revision) || doc.revision < 0) {
    errors.push({
      code: 'INVALID_REVISION',
      message: 'Document revision must be a non-negative integer',
      path: ['revision']
    })
  }
  if (typeof doc.createdAt !== 'string' || doc.createdAt.length === 0) {
    errors.push({
      code: 'INVALID_TIMESTAMP',
      message: 'createdAt must be a non-empty string',
      path: ['createdAt']
    })
  }
  if (typeof doc.updatedAt !== 'string' || doc.updatedAt.length === 0) {
    errors.push({
      code: 'INVALID_TIMESTAMP',
      message: 'updatedAt must be a non-empty string',
      path: ['updatedAt']
    })
  }

  const sheetIds = new Set<string>()
  for (let i = 0; i < doc.sheets.length; i += 1) {
    const sheet = doc.sheets[i]
    const path = ['sheets', String(i)]
    if (sheetIds.has(sheet.id)) {
      errors.push({
        code: 'DUPLICATE_SHEET_ID',
        message: `Duplicate sheet id "${sheet.id}"`,
        path: [...path, 'id']
      })
    }
    sheetIds.add(sheet.id)

    for (const err of validateMindMapSheetV2(sheet)) {
      errors.push({ ...err, path: [...path, ...err.path] })
    }
  }

  const assetIds = new Set<string>()
  for (let i = 0; i < doc.assets.length; i += 1) {
    const asset = doc.assets[i]
    if (assetIds.has(asset.id)) {
      errors.push({
        code: 'DUPLICATE_ELEMENT_ID',
        message: `Duplicate asset id "${asset.id}"`,
        path: ['assets', String(i), 'id']
      })
    }
    assetIds.add(asset.id)
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

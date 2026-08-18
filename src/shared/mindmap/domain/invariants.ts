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
  MindMapElementType,
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

const ELEMENT_TYPES: ReadonlySet<MindMapElementType> = new Set([
  'relationship',
  'boundary',
  'summary',
  'callout',
  'free-topic',
  'shape',
  'connector'
])

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
        { field: 'to', id: element.to },
        ...(element.sourceTopicIds ?? []).map((id, index) => ({
          field: `sourceTopicIds[${index}]`,
          id
        })),
        ...(element.summaryTopicId === undefined
          ? []
          : [{ field: 'summaryTopicId', id: element.summaryTopicId }])
      ]
    case 'callout':
      return [{ field: 'topicId', id: element.topicId }]
    case 'free-topic':
      return [{ field: 'topicId', id: element.topicId }]
    case 'shape':
    case 'connector':
      // Shapes have no topic references. Connector anchors are validated
      // against both topic and shape ids in validateMindMapSheetV2 below.
      return []
  }
}

/** Validate a sheet: tree invariants + element identity/reference invariants. */
export function validateMindMapSheetV2(sheet: MindMapSheetV2): MindMapInvariantError[] {
  const errors = validateTopicTree(sheet.id, sheet.root)
  const topicIds = new Set(collectTopicIds(sheet))
  // Connector anchors may point to a shape that appears later in the flat
  // element list, so collect shape ids before validating individual elements.
  const shapeIds = new Set(
    sheet.elements
      .filter((element) => element.type === 'shape')
      .map((element) => element.id)
  )

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

    if (element.type === 'shape') {
      if (!Number.isFinite(element.position.x) || !Number.isFinite(element.position.y)) {
        errors.push({
          code: 'ELEMENT_REF_MISSING',
          message: `Shape "${element.id}" position must contain finite coordinates`,
          path: [...path, 'position']
        })
      }
      if (!Number.isFinite(element.width) || element.width <= 0) {
        errors.push({
          code: 'ELEMENT_REF_MISSING',
          message: `Shape "${element.id}" width must be a positive number`,
          path: [...path, 'width']
        })
      }
      if (!Number.isFinite(element.height) || element.height <= 0) {
        errors.push({
          code: 'ELEMENT_REF_MISSING',
          message: `Shape "${element.id}" height must be a positive number`,
          path: [...path, 'height']
        })
      }
    }

    if (element.type === 'connector') {
      for (const [endpointName, endpoint] of [['start', element.start], ['end', element.end]] as const) {
        if (!Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) {
          errors.push({
            code: 'ELEMENT_REF_MISSING',
            message: `Connector "${element.id}" ${endpointName} must contain finite coordinates`,
            path: [...path, endpointName]
          })
        }
        // A free connector endpoint may float on the canvas without a binding.
        const anchor = endpoint.anchor
        if (!anchor) continue
        const targetExists = anchor.targetType === 'topic'
          ? topicIds.has(anchor.targetId)
          : shapeIds.has(anchor.targetId)
        if (!targetExists) {
          errors.push({
            code: 'ELEMENT_REF_MISSING',
            message: `Connector "${element.id}" references missing ${anchor.targetType} "${anchor.targetId}"`,
            path: [...path, endpointName, 'anchor', 'targetId']
          })
        }
      }
      if (
        element.curveControlOffset !== undefined
        && (!Number.isFinite(element.curveControlOffset.x) || !Number.isFinite(element.curveControlOffset.y))
      ) {
        errors.push({
          code: 'ELEMENT_REF_MISSING',
          message: `Connector "${element.id}" curveControlOffset must contain finite coordinates`,
          path: [...path, 'curveControlOffset']
        })
      }
      const startAnchor = element.start.anchor
      const endAnchor = element.end.anchor
      if (
        startAnchor
        && endAnchor
        && startAnchor.targetType === endAnchor.targetType
        && startAnchor.targetId === endAnchor.targetId
      ) {
        errors.push({
          code: 'ELEMENT_REF_MISSING',
          message: `Connector "${element.id}" must connect two different targets`,
          path: [...path, 'end', 'anchor']
        })
      }
    }
  }

  const imageIds = new Set<string>()
  for (let i = 0; i < (sheet.images ?? []).length; i += 1) {
    const image = sheet.images![i]
    const path = ['images', String(i)]

    if (typeof image.id !== 'string' || image.id.length === 0) {
      errors.push({
        code: 'EMPTY_ELEMENT_ID',
        message: 'Image id must be a non-empty string',
        path: [...path, 'id']
      })
    } else if (imageIds.has(image.id)) {
      errors.push({
        code: 'DUPLICATE_ELEMENT_ID',
        message: `Duplicate image id "${image.id}"`,
        path: [...path, 'id']
      })
    }
    imageIds.add(image.id)

    if (typeof image.width !== 'number' || !(image.width > 0)) {
      errors.push({
        code: 'ELEMENT_REF_MISSING',
        message: `Image "${image.id}" width must be a positive number`,
        path: [...path, 'width']
      })
    }
    if (typeof image.height !== 'number' || !(image.height > 0)) {
      errors.push({
        code: 'ELEMENT_REF_MISSING',
        message: `Image "${image.id}" height must be a positive number`,
        path: [...path, 'height']
      })
    }
    if (image.topicId !== undefined && !topicIds.has(image.topicId)) {
      errors.push({
        code: 'ELEMENT_REF_MISSING',
        message: `Image "${image.id}" references missing node id "${image.topicId}" (topicId)`,
        path: [...path, 'topicId']
      })
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

  for (let s = 0; s < doc.sheets.length; s += 1) {
    const sheet = doc.sheets[s]
    for (let i = 0; i < (sheet.images ?? []).length; i += 1) {
      const image = sheet.images![i]
      if (!assetIds.has(image.assetId)) {
        errors.push({
          code: 'ELEMENT_REF_MISSING',
          message: `Image "${image.id}" references missing asset id "${image.assetId}"`,
          path: ['sheets', String(s), 'images', String(i), 'assetId']
        })
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

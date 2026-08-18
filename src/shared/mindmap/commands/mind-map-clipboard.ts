/**
 * Clipboard payload types for the v2 mind map model.
 *
 * `copy` / `cut` payloads capture deep copies of the branch roots plus the
 * elements that reference those branches. `paste` carries the captured data
 * plus the target sheet/parent, and `buildPasteCommand` turns it into a single
 * `transaction` so a paste either lands completely or not at all.
 *
 * Ids are never regenerated inside this module: the caller supplies a `remap`
 * function when building a paste command so pasting into the same document
 * cannot collide with existing topic/element ids.
 */
import type { MindMapCommand } from './mind-map-command-types'
import type {
  MindMapConnectorEndpoint,
  MindMapElement,
  MindMapTopicV2
} from '../domain/types'

export type MindMapClipboardData = {
  /** Source document id (for audit / cross-document paste). */
  documentId: string
  /** Source sheet id. */
  sheetId: string
  /** Branch roots that were copied or cut (deep copies, original ids). */
  branches: MindMapTopicV2[]
  /** Elements that reference the copied/cut topics. */
  elements: MindMapElement[]
  /** ISO 8601 capture time. */
  capturedAt: string
}

export type MindMapCopyClipboardPayload = {
  kind: 'copy'
  data: MindMapClipboardData
}

export type MindMapCutClipboardPayload = {
  kind: 'cut'
  data: MindMapClipboardData
  /** Command that re-inserts the cut branches at their original location. */
  restoreCommand: MindMapCommand
}

export type MindMapPasteClipboardPayload = {
  kind: 'paste'
  data: MindMapClipboardData
  targetSheetId: string
  targetParentId: string
  /** Final 0-based index among the target parent's children (default append). */
  index?: number
}

export type MindMapClipboardPayload =
  | MindMapCopyClipboardPayload
  | MindMapCutClipboardPayload
  | MindMapPasteClipboardPayload

function remapTopic(node: MindMapTopicV2, remap: (oldId: string) => string): MindMapTopicV2 {
  return {
    ...node,
    id: remap(node.id),
    children: node.children.map((child) => remapTopic(child, remap))
  }
}

type ClipboardReferenceSets = Readonly<{
  topicIds: ReadonlySet<string>
  shapeIds: ReadonlySet<string>
}>

function collectClipboardTopicIds(branches: readonly MindMapTopicV2[]): Set<string> {
  const ids = new Set<string>()
  const stack = [...branches]
  while (stack.length > 0) {
    const topic = stack.pop()
    if (!topic) continue
    ids.add(topic.id)
    stack.push(...topic.children)
  }
  return ids
}

function remapConnectorEndpoint(
  endpoint: MindMapConnectorEndpoint,
  remap: (oldId: string) => string,
  references: ClipboardReferenceSets
): MindMapConnectorEndpoint | null {
  const { anchor, ...point } = endpoint
  if (!anchor) return null

  const ids = anchor.targetType === 'topic' ? references.topicIds : references.shapeIds
  // Both anchored targets must travel with a copied connector.
  if (!ids.has(anchor.targetId)) return null

  return {
    ...point,
    anchor: { ...anchor, targetId: remap(anchor.targetId) }
  }
}

function remapElement(
  element: MindMapElement,
  remap: (oldId: string) => string,
  references: ClipboardReferenceSets
): MindMapElement | null {
  switch (element.type) {
    case 'relationship':
      return { ...element, from: remap(element.from), to: remap(element.to) }
    case 'boundary':
      return {
        ...element,
        topicId: remap(element.topicId),
        ...(element.children !== undefined
          ? { children: element.children.map((id) => remap(id)) }
          : {})
      }
    case 'summary':
      return {
        ...element,
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
      return { ...element, topicId: remap(element.topicId) }
    case 'free-topic':
      return { ...element, topicId: remap(element.topicId) }
    case 'shape':
      // Shapes are independent of the topic tree, but their own ids may be
      // referenced by connector anchors in the same clipboard payload.
      return { ...element, id: remap(element.id) }
    case 'connector': {
      const start = remapConnectorEndpoint(element.start, remap, references)
      const end = remapConnectorEndpoint(element.end, remap, references)
      if (
        !start
        || !end
        || (start.anchor && end.anchor
          && start.anchor.targetType === end.anchor.targetType
          && start.anchor.targetId === end.anchor.targetId)
      ) {
        return null
      }
      return {
        ...element,
        id: remap(element.id),
        start,
        end
      }
    }
  }
}

/** Deep-remap every topic/element id in a clipboard payload. */
export function remapClipboardIds(
  data: MindMapClipboardData,
  remap: (oldId: string) => string
): { branches: MindMapTopicV2[]; elements: MindMapElement[] } {
  const references: ClipboardReferenceSets = {
    topicIds: collectClipboardTopicIds(data.branches),
    shapeIds: new Set(
      data.elements
        .filter((element): element is Extract<MindMapElement, { type: 'shape' }> => element.type === 'shape')
        .map((element) => element.id)
    )
  }
  const elements = data.elements
    .map((element) => remapElement(element, remap, references))
    .filter((element): element is MindMapElement => element !== null)
  return {
    branches: data.branches.map((branch) => remapTopic(branch, remap)),
    elements
  }
}

function orderElementsForCreate(elements: readonly MindMapElement[]): MindMapElement[] {
  // Connector anchors can point at shapes. Creating shapes first lets the
  // reducer validate every connector even when a clipboard payload happened
  // to serialize the connector before its target shape.
  return [
    ...elements.filter((element) => element.type === 'shape'),
    ...elements.filter((element) => element.type !== 'shape' && element.type !== 'connector'),
    ...elements.filter((element) => element.type === 'connector')
  ]
}

/**
 * Build a single all-or-nothing transaction that pastes the captured branches
 * (one `topic.insert` per root, in order) followed by the referenced elements.
 */
export function buildPasteCommand(
  payload: MindMapPasteClipboardPayload,
  remap: (oldId: string) => string
): MindMapCommand {
  const { branches, elements } = remapClipboardIds(payload.data, remap)
  const commands: MindMapCommand[] = []
  const baseIndex = payload.index ?? 0
  branches.forEach((branch, offset) => {
    commands.push({
      type: 'topic.insert',
      sheetId: payload.targetSheetId,
      parentId: payload.targetParentId,
      index: baseIndex + offset,
      node: branch
    })
  })
  for (const element of orderElementsForCreate(elements)) {
    commands.push({ type: 'element.create', sheetId: payload.targetSheetId, element })
  }
  return { type: 'transaction', commands }
}

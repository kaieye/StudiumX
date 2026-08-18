import {
  applyMindMapCommand,
  type MindMapCommand
} from '../../../../shared/mindmap/commands'
import { mindMapCommandSchema } from '../../../../shared/mindmap/commands/mind-map-proposal'
import type {
  MindMapDocumentV2,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'

/** A fully closed, schema-checked item recovered from an incomplete provider stream. */
export type MindMapStreamedProposalItem = {
  id: string
  command: MindMapCommand
}

/**
 * Renderer-only projection of a provider proposal. It deliberately carries a
 * cloned document rather than modifying the canonical editor document.
 */
export type MindMapGenerationPreview = {
  generationId: string
  document: MindMapDocumentV2
  /** Increments for every reducer command projected into this temporary view. */
  revision: number
  /** Topics added by the last reveal step, used only for a restrained canvas animation. */
  latestNodeIds: string[]
}

export type MindMapGenerationPreviewProjection = {
  preview: MindMapGenerationPreview
  applied: boolean
  latestNodeIds: string[]
}

function isWhitespace(value: string): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t'
}

/** Return the closing quote for a complete JSON string, respecting escapes. */
function jsonStringEnd(source: string, start: number): number | null {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') {
      // A JSON escape always consumes exactly the next source character. This
      // also correctly skips an escaped quote and a backslash before a quote.
      index += 1
      continue
    }
    if (char === '"') return index
  }
  return null
}

/**
 * Locate the opening `[` of the top-level proposal `items` property without
 * trying to parse an incomplete envelope. Provider chunks routinely end inside
 * a string or nested object, so a normal JSON parse is intentionally deferred
 * until an individual array item has closed.
 */
function findItemsArrayStart(source: string): number | null {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '"') continue
    const end = jsonStringEnd(source, index)
    if (end === null) return null

    let key: unknown
    try {
      key = JSON.parse(source.slice(index, end + 1))
    } catch {
      // A malformed string can never become a valid property token merely by
      // adding later chunks, so keep scanning for the next complete string.
      index = end
      continue
    }
    if (key !== 'items') {
      index = end
      continue
    }

    let cursor = end + 1
    while (cursor < source.length && isWhitespace(source[cursor] ?? '')) cursor += 1
    if (source[cursor] !== ':') {
      index = end
      continue
    }
    cursor += 1
    while (cursor < source.length && isWhitespace(source[cursor] ?? '')) cursor += 1
    if (source[cursor] === '[') return cursor
    index = end
  }
  return null
}

/**
 * Pull only complete top-level object entries out of the `items` array. Nested
 * braces, brackets, escaped quotes, and provider chunk boundaries are tracked
 * lexically so an unfinished object is never parsed or exposed to the canvas.
 */
function closedItemsArrayObjects(source: string, arrayStart: number): unknown[] {
  const items: unknown[] = []
  let depth = 1
  let objectStart: number | null = null

  for (let index = arrayStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"') {
      const end = jsonStringEnd(source, index)
      if (end === null) return items
      index = end
      continue
    }

    if (char === '{' || char === '[') {
      if (char === '{' && depth === 1) objectStart = index
      depth += 1
      continue
    }

    if (char !== '}' && char !== ']') continue
    depth -= 1
    if (depth < 0) return items

    if (char === '}' && depth === 1 && objectStart !== null) {
      try {
        items.push(JSON.parse(source.slice(objectStart, index + 1)))
      } catch {
        // The item was structurally closed but malformed. It is ignored here;
        // the host's full proposal boundary will report the final error.
      }
      objectStart = null
    }

    if (depth === 0) return items
  }

  return items
}

/**
 * Extract complete provider proposal items from cumulative streamed text.
 * Repeating the same cumulative text returns the same item ids, allowing the
 * caller to keep a stable `Set` for idempotent enqueueing.
 */
export function extractCompletedMindMapProposalItems(source: string): MindMapStreamedProposalItem[] {
  const arrayStart = findItemsArrayStart(source)
  if (arrayStart === null) return []

  const parsedItems: MindMapStreamedProposalItem[] = []
  for (const candidate of closedItemsArrayObjects(source, arrayStart)) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
    const item = candidate as { id?: unknown; command?: unknown }
    if (typeof item.id !== 'string' || item.id.trim().length === 0) continue
    const command = mindMapCommandSchema.safeParse(item.command)
    if (!command.success) continue
    parsedItems.push({ id: item.id, command: command.data })
  }
  return parsedItems
}

/** Return only items not already admitted by the generation's stable item-id set. */
export function newCompletedMindMapProposalItems(
  source: string,
  admittedItemIds: ReadonlySet<string>
): MindMapStreamedProposalItem[] {
  return extractCompletedMindMapProposalItems(source)
    .filter((item) => !admittedItemIds.has(item.id))
}

function splitTopicInsert(
  command: Extract<MindMapCommand, { type: 'topic.insert' }>
): MindMapCommand[] {
  const commands: MindMapCommand[] = []

  const append = (
    parentId: string,
    node: MindMapTopicV2,
    index: number | undefined
  ): void => {
    const { children, ...topic } = node
    commands.push({
      type: 'topic.insert',
      sheetId: command.sheetId,
      parentId,
      ...(index === undefined ? {} : { index }),
      node: { ...topic, children: [] }
    })
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children[childIndex]
      if (child) append(node.id, child, childIndex)
    }
  }

  append(command.parentId, command.node, command.index)
  return commands
}

/**
 * Expand a provider command into visually meaningful reducer steps. A nested
 * `topic.insert` becomes parent-first leaf inserts so every connector appears
 * together with its one new child. Other commands remain atomic; that is the
 * safe fallback for full-sheet/create commands which cannot be partially
 * reconstructed without inventing document state.
 */
export function expandMindMapGenerationPreviewCommand(command: MindMapCommand): MindMapCommand[] {
  if (command.type === 'topic.insert') return splitTopicInsert(command)
  if (command.type === 'transaction') {
    return command.commands.flatMap((nested) => expandMindMapGenerationPreviewCommand(nested))
  }
  return [command]
}

export function createMindMapGenerationPreview(
  generationId: string,
  document: MindMapDocumentV2
): MindMapGenerationPreview {
  return {
    generationId,
    document: structuredClone(document),
    revision: 0,
    latestNodeIds: []
  }
}

/**
 * Apply one already-validated command to a temporary preview only. Reducer
 * failures leave the previous projection intact; they never touch undo,
 * persistence, IPC, or the canonical document.
 */
export function projectMindMapGenerationPreviewCommand(
  preview: MindMapGenerationPreview,
  command: MindMapCommand
): MindMapGenerationPreviewProjection {
  const result = applyMindMapCommand(preview.document, command)
  if (!result.ok) {
    return { preview, applied: false, latestNodeIds: [] }
  }

  const latestNodeIds = command.type === 'topic.insert' ? [command.node.id] : []
  return {
    applied: true,
    latestNodeIds,
    preview: {
      ...preview,
      document: result.document,
      revision: preview.revision + 1,
      latestNodeIds
    }
  }
}

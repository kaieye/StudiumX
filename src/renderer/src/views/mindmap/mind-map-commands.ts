/**
 * Pure command builders for the v2 mind-map UI.
 *
 * Every keyboard action / node action / clipboard / duplicate / sheet action
 * is turned into a `MindMapCommand` here. The module has no React / DOM / IPC
 * dependencies so it can be unit-tested in isolation. Callers (the renderer
 * store or the canvas) dispatch the returned commands through
 * `useMindMapViewStore.dispatch`, which funnels them into the shared reducer
 * and undo/redo stack.
 */
import type {
  MindMapCommand,
  MindMapClipboardData,
  MindMapCopyClipboardPayload,
  MindMapCutClipboardPayload,
  MindMapPasteClipboardPayload
} from '../../../../shared/mindmap/commands'
import { buildPasteCommand } from '../../../../shared/mindmap/commands'
import { collectTopicIds } from '../../../../shared/mindmap/domain/invariants'
import { copySheet } from '../../../../shared/mindmap/domain/sheet-operations'
import { DEFAULT_MIND_MAP_TOPIC_SHAPE } from '../../../../shared/mindmap/mind-map-types'
import {
  applyMindMapQuickStyle,
  type MindMapQuickStylePreset
} from '../../../../shared/mindmap/quick-styles'
import type {
  MindMapDocumentV2,
  MindMapElement,
  MindMapSheetV2,
  MindMapSummary,
  MindMapTopicStyleOverride,
  MindMapTopicV2,
  MindMapTopicNumbering
} from '../../../../shared/mindmap/domain/types'

export type MindMapNodeRef = {
  node: MindMapTopicV2
  parent: MindMapTopicV2 | null
  index: number
}

/** Non-empty topic ids referenced by an element. */
export function elementRefIds(element: MindMapElement): string[] {
  switch (element.type) {
    case 'relationship':
      return [element.from, element.to]
    case 'boundary':
      return element.children === undefined
        ? [element.topicId]
        : [element.topicId, ...element.children]
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
        ...(element.start.anchor?.targetType === 'topic'
          ? [element.start.anchor.targetId]
          : []),
        ...(element.end.anchor?.targetType === 'topic'
          ? [element.end.anchor.targetId]
          : [])
      ]
  }
}

export function findTopicInSheet(
  sheet: MindMapSheetV2,
  topicId: string
): MindMapNodeRef | undefined {
  return findTopicInChildren(sheet.root, null, topicId)
}

function findTopicInChildren(
  node: MindMapTopicV2,
  parent: MindMapTopicV2 | null,
  topicId: string
): MindMapNodeRef | undefined {
  if (node.id === topicId) {
    return { node, parent, index: parent === null ? -1 : parent.children.indexOf(node) }
  }
  for (let i = 0; i < node.children.length; i += 1) {
    const found = findTopicInChildren(node.children[i], node, topicId)
    if (found !== undefined) return found
  }
  return undefined
}

/** Source topics covered by a summary. Sibling summaries include their range;
 * cross-branch summaries persist every explicitly selected source topic. */
function summarySourceTopics(
  sheet: MindMapSheetV2,
  summary: MindMapSummary
): MindMapTopicV2[] | undefined {
  if (summary.sourceTopicIds !== undefined) {
    const sourceTopics = summary.sourceTopicIds
      .map((topicId) => findTopicInSheet(sheet, topicId)?.node)
    return sourceTopics.every((topic): topic is MindMapTopicV2 => topic !== undefined)
      ? sourceTopics
      : undefined
  }
  const from = findTopicInSheet(sheet, summary.from)
  const to = findTopicInSheet(sheet, summary.to)
  if (!from || !to) return undefined
  if (from.parent !== null && from.parent === to.parent) {
    const firstIndex = Math.min(from.index, to.index)
    const lastIndex = Math.max(from.index, to.index)
    return from.parent.children.slice(firstIndex, lastIndex + 1)
  }
  return [from.node, to.node]
}

export function newTopicNode(
  title = '',
  defaultTopicStyle?: MindMapTopicStyleOverride,
  defaultTopicShape?: string
): MindMapTopicV2 {
  const style: MindMapTopicStyleOverride = {
    ...(defaultTopicStyle ?? {}),
    shape: defaultTopicStyle?.shape ?? defaultTopicShape ?? DEFAULT_MIND_MAP_TOPIC_SHAPE
  }
  return {
    id: crypto.randomUUID(),
    title,
    children: [],
    style
  }
}

/**
 * Apply a visual quick style to one or more topics as one undoable command.
 * The builder deliberately reads each target's existing local style so a
 * quick emphasis does not erase unrelated overrides (except `default`, which
 * is the explicit reset preset).
 */
export function buildApplyQuickStyleCommand(
  sheet: MindMapSheetV2,
  topicIds: readonly string[],
  preset: MindMapQuickStylePreset
): MindMapCommand | null {
  const targets = [...new Set(topicIds)]
    .map((topicId) => findTopicInSheet(sheet, topicId)?.node)
    .filter((topic): topic is MindMapTopicV2 => topic !== undefined)
  if (targets.length === 0) return null

  const commands: MindMapCommand[] = targets.map((topic) => ({
    type: 'topic.update',
    sheetId: sheet.id,
    topicId: topic.id,
    patch: { style: applyMindMapQuickStyle(topic.style, preset) }
  }))
  return commands.length === 1 ? commands[0] : { type: 'transaction', commands }
}

/** Tab: insert a child under `parentId`. */
export function buildInsertChildCommand(
  sheet: MindMapSheetV2,
  parentId: string
): { command: MindMapCommand; nodeId: string } {
  const node = newTopicNode('', sheet.layout.defaultTopicStyle, sheet.layout.defaultTopicShape)
  return {
    nodeId: node.id,
    command: { type: 'topic.insert', sheetId: sheet.id, parentId, node }
  }
}

/** Enter: insert a sibling after `topicId`; for the root, insert a child. */
export function buildInsertSiblingCommand(
  sheet: MindMapSheetV2,
  topicId: string
): { command: MindMapCommand; nodeId: string } | null {
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined) return null
  if (ref.parent === null) {
    return buildInsertChildCommand(sheet, topicId)
  }
  const node = newTopicNode('', sheet.layout.defaultTopicStyle, sheet.layout.defaultTopicShape)
  return {
    nodeId: node.id,
    command: {
      type: 'topic.insert',
      sheetId: sheet.id,
      parentId: ref.parent.id,
      index: ref.index + 1,
      node
    }
  }
}

/** Ctrl/Cmd+Enter: insert a sibling immediately before `topicId` (insert above). */
export function buildInsertAboveCommand(
  sheet: MindMapSheetV2,
  topicId: string
): { command: MindMapCommand; nodeId: string } | null {
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined) return null
  if (ref.parent === null) {
    return buildInsertChildCommand(sheet, topicId)
  }
  const node = newTopicNode('', sheet.layout.defaultTopicStyle, sheet.layout.defaultTopicShape)
  return {
    nodeId: node.id,
    command: {
      type: 'topic.insert',
      sheetId: sheet.id,
      parentId: ref.parent.id,
      index: ref.index,
      node
    }
  }
}

/** Shift+Tab: promote a topic to its grandparent's children (decrease indent). */
export function buildOutdentCommand(
  sheet: MindMapSheetV2,
  topicId: string
): MindMapCommand | null {
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined || ref.parent === null) return null
  const grandparent = findTopicInSheet(sheet, ref.parent.id)
  if (grandparent === undefined || grandparent.parent === null) {
    // The parent is the root: promote the topic to be the root's sibling,
    // which is impossible in a tree — so no-op.
    return null
  }
  const parentIndex = ref.parent.children.indexOf(ref.node)
  return {
    type: 'topic.move',
    sheetId: sheet.id,
    topicId,
    toParentId: grandparent.parent.id,
    toIndex: parentIndex + 1
  }
}

/** Space: toggle collapsed. */
export function buildToggleCollapseCommand(
  sheetId: string,
  topicId: string,
  collapsed: boolean
): MindMapCommand {
  return { type: 'topic.update', sheetId, topicId, patch: { collapsed } }
}

/** Delete/Backspace: remove a topic (root removal is disallowed → null). */
export function buildRemoveCommand(
  sheet: MindMapSheetV2,
  topicId: string
): MindMapCommand | null {
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined || ref.parent === null) return null
  return buildRemoveTopicsCommand(sheet, [topicId])
}

/** Delete several selected topics atomically, ignoring the root and descendants of selected ancestors. */
export function buildRemoveTopicsCommand(
  sheet: MindMapSheetV2,
  topicIds: readonly string[]
): MindMapCommand | null {
  // Root selection is intentionally ignored for deletion: the root itself
  // cannot be removed, and selecting it must not suppress removable children.
  // Keep only selected topics that have a parent when checking ancestor
  // coverage, while still preserving the caller's first-seen order.
  const uniqueIds = [...new Set(topicIds)]
  const selectedRemovable = new Set(
    uniqueIds.filter((topicId) => {
      const ref = findTopicInSheet(sheet, topicId)
      return ref !== undefined && ref.parent !== null
    })
  )
  const targets: MindMapTopicV2[] = []
  for (const topicId of uniqueIds) {
    const ref = findTopicInSheet(sheet, topicId)
    if (!ref || ref.parent === null) continue
    let ancestor: MindMapTopicV2 | null = ref.parent
    let covered = false
    while (ancestor) {
      if (selectedRemovable.has(ancestor.id)) {
        covered = true
        break
      }
      const parentRef = findTopicInSheet(sheet, ancestor.id)
      ancestor = parentRef?.parent ?? null
    }
    if (!covered) targets.push(ref.node)
  }
  if (targets.length === 0) return null

  // A modern summary owns an ordinary output topic. Maintain that output as
  // the covered sibling range shrinks, all inside the same undoable deletion:
  // - when the whole range goes away, delete the output too;
  // - when exactly one source topic remains, make the output its last child.
  // In the latter case the brace is naturally removed by the reducer because
  // one of its endpoints disappears, while the useful summary content remains
  // attached to the sole surviving topic.
  const removedTopicIds = new Set<string>()
  for (const target of targets) {
    for (const id of collectTopicIds({ ...sheet, root: target })) removedTopicIds.add(id)
  }
  const summaryOutputIdsToRemove = new Set<string>()
  const summaryOutputMoves = new Map<string, string>()
  for (const element of sheet.elements) {
    if (element.type !== 'summary' || element.summaryTopicId === undefined) continue
    const coveredTopics = summarySourceTopics(sheet, element)
    if (coveredTopics === undefined) continue
    const remainingRange = coveredTopics.filter((topic) => !removedTopicIds.has(topic.id))
    if (remainingRange.length === 0) {
      summaryOutputIdsToRemove.add(element.summaryTopicId)
    } else if (remainingRange.length === 1) {
      summaryOutputMoves.set(element.summaryTopicId, remainingRange[0].id)
    }
  }

  const moveCommands: MindMapCommand[] = []
  for (const [outputId, remainingTopicId] of summaryOutputMoves) {
    // An explicitly selected output (or one inside a selected parent branch)
    // is already being removed, so it cannot become a surviving child's node.
    if (removedTopicIds.has(outputId)) continue
    const output = findTopicInSheet(sheet, outputId)
    const remaining = findTopicInSheet(sheet, remainingTopicId)
    if (!output || output.parent === null || !remaining) continue
    moveCommands.push({
      type: 'topic.move',
      sheetId: sheet.id,
      topicId: outputId,
      toParentId: remainingTopicId,
      toIndex: remaining.node.children.length
    })
  }

  for (const outputId of summaryOutputIdsToRemove) {
    // Its containing source branch is already being removed, or the output was
    // explicitly selected, so no second command is necessary.
    if (removedTopicIds.has(outputId)) continue
    const output = findTopicInSheet(sheet, outputId)
    if (output !== undefined && output.parent !== null) {
      targets.push(output.node)
      for (const id of collectTopicIds({ ...sheet, root: output.node })) removedTopicIds.add(id)
    }
  }

  const commands: MindMapCommand[] = [
    ...moveCommands,
    ...targets.map((topic) => ({
      type: 'topic.remove' as const,
      sheetId: sheet.id,
      topicId: topic.id
    }))
  ]
  return commands.length === 1 ? commands[0] : { type: 'transaction', commands }
}

/** Apply one collapsed state to several selected topics atomically. */
export function buildToggleCollapseTopicsCommand(
  sheet: MindMapSheetV2,
  topicIds: readonly string[],
  collapsed: boolean
): MindMapCommand | null {
  const commands = [...new Set(topicIds)]
    .map((topicId) => findTopicInSheet(sheet, topicId)?.node)
    .filter((topic): topic is MindMapTopicV2 => topic !== undefined)
    .map((topic) => ({
      type: 'topic.update' as const,
      sheetId: sheet.id,
      topicId: topic.id,
      patch: { collapsed }
    }))
  if (commands.length === 0) return null
  return commands.length === 1 ? commands[0] : { type: 'transaction', commands }
}

/** F2 / inline edit commit. */
export function buildUpdateTitleCommand(
  sheetId: string,
  topicId: string,
  title: string
): MindMapCommand {
  return { type: 'topic.update', sheetId, topicId, patch: { title } }
}

function collectTopics(node: MindMapTopicV2): MindMapTopicV2[] {
  return [node, ...node.children.flatMap(collectTopics)]
}

type VisibleTopicEntry = { topic: MindMapTopicV2; depth: number }

/**
 * Return the currently visible topic tree. A collapsed topic is included, but
 * its descendants are intentionally not traversed because they are hidden.
 */
function collectVisibleTopics(root: MindMapTopicV2): VisibleTopicEntry[] {
  const entries: VisibleTopicEntry[] = []
  const visit = (topic: MindMapTopicV2, depth: number): void => {
    entries.push({ topic, depth })
    if (topic.collapsed === true) return
    for (const child of topic.children) visit(child, depth + 1)
  }
  visit(root, 0)
  return entries
}

function buildCollapseTopicsCommand(
  sheet: MindMapSheetV2,
  topics: readonly MindMapTopicV2[],
  collapsed: boolean
): MindMapCommand | null {
  const commands = topics
    .filter((topic) => topic.children.length > 0 && (topic.collapsed === true) !== collapsed)
    .map((topic) => ({
      type: 'topic.update' as const,
      sheetId: sheet.id,
      topicId: topic.id,
      patch: { collapsed }
    }))
  if (commands.length === 0) return null
  return commands.length === 1 ? commands[0] : { type: 'transaction', commands }
}

/**
 * Collapse the deepest currently expanded branch layer across the whole map.
 * Repeating the command walks back toward the root one visible layer at a time.
 */
export function buildCollapseLastLevelCommand(sheet: MindMapSheetV2): MindMapCommand | null {
  const visible = collectVisibleTopics(sheet.root)
  const expandable = visible.filter(
    ({ topic }) => topic.children.length > 0 && topic.collapsed !== true
  )
  if (expandable.length === 0) return null
  const deepestDepth = Math.max(...expandable.map(({ depth }) => depth))
  return buildCollapseTopicsCommand(
    sheet,
    expandable.filter(({ depth }) => depth === deepestDepth).map(({ topic }) => topic),
    true
  )
}

/**
 * Expand every visible collapsed branch once. Repeating the command reveals
 * the next child layer without recursively expanding newly revealed nodes.
 */
export function buildExpandNextLevelCommand(sheet: MindMapSheetV2): MindMapCommand | null {
  const visibleCollapsed = collectVisibleTopics(sheet.root)
    .map(({ topic }) => topic)
    .filter((topic) => topic.children.length > 0 && topic.collapsed === true)
  return buildCollapseTopicsCommand(sheet, visibleCollapsed, false)
}

/** Set the collapsed state for one topic's children. */
export function buildSetTopicChildrenCollapsedCommand(
  sheet: MindMapSheetV2,
  topicId: string,
  collapsed: boolean
): MindMapCommand | null {
  const ref = findTopicInSheet(sheet, topicId)
  return ref === undefined ? null : buildCollapseTopicsCommand(sheet, [ref.node], collapsed)
}

/** Set the collapsed state for all branch topics at the selected topic's level. */
export function buildSetSiblingTopicsCollapsedCommand(
  sheet: MindMapSheetV2,
  topicId: string,
  collapsed: boolean
): MindMapCommand | null {
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined || ref.parent === null) return null
  return buildCollapseTopicsCommand(sheet, ref.parent.children, collapsed)
}

export type MindMapTopicStylePropagationScope = 'siblings' | 'descendants'

/**
 * Apply one topic's complete local style override to a structural scope.
 * A transaction keeps the propagation atomic for undo/redo and persistence.
 */
export function buildPropagateTopicStyleCommand(
  sheet: MindMapSheetV2,
  topicId: string,
  scope: MindMapTopicStylePropagationScope
): MindMapCommand | null {
  const source = findTopicInSheet(sheet, topicId)
  if (source === undefined) return null

  const targets = scope === 'siblings'
    ? source.parent?.children.filter((topic) => topic.id !== topicId) ?? []
    : collectTopics(source.node).slice(1)
  if (targets.length === 0) return null

  const sourceStyle: MindMapTopicStyleOverride | null = source.node.style === undefined
    ? null
    : structuredClone(source.node.style)
  return {
    type: 'transaction',
    commands: targets.map((topic) => ({
      type: 'topic.update',
      sheetId: sheet.id,
      topicId: topic.id,
      patch: { style: sourceStyle === null ? null : structuredClone(sourceStyle) }
    }))
  }
}

/**
 * Copy one topic's complete numbering override to all of its siblings as one
 * undoable transaction (H-10). A topic with no local numbering propagates a
 * `null` patch so siblings clear their override too.
 */
export function buildPropagateTopicNumberingCommand(
  sheet: MindMapSheetV2,
  topicId: string
): MindMapCommand | null {
  const source = findTopicInSheet(sheet, topicId)
  if (source === undefined || source.parent === null) return null

  const siblings = source.parent.children.filter((topic) => topic.id !== topicId)
  if (siblings.length === 0) return null

  const sourceNumbering: MindMapTopicNumbering | null =
    source.node.numbering === undefined
      ? null
      : structuredClone(source.node.numbering)
  return {
    type: 'transaction',
    commands: siblings.map((topic) => ({
      type: 'topic.update',
      sheetId: sheet.id,
      topicId: topic.id,
      patch: {
        numbering: sourceNumbering === null ? null : structuredClone(sourceNumbering)
      }
    }))
  }
}


/** Return the topic path from `root` to `topicId`, inclusive. */
function topicPath(root: MindMapTopicV2, topicId: string): MindMapTopicV2[] | undefined {
  if (root.id === topicId) return [root]
  for (const child of root.children) {
    const childPath = topicPath(child, topicId)
    if (childPath !== undefined) return [root, ...childPath]
  }
  return undefined
}

/** Find the nearest shared ancestor for the supplied topic ids. */
function lowestCommonTopicAncestor(
  root: MindMapTopicV2,
  topicIds: readonly string[]
): MindMapTopicV2 | undefined {
  const paths = topicIds.map((topicId) => topicPath(root, topicId))
  if (paths.some((path) => path === undefined)) return undefined
  const resolvedPaths = paths as MindMapTopicV2[][]
  let common = resolvedPaths[0]![0]
  for (let index = 1; ; index += 1) {
    const candidate = resolvedPaths[0]![index]
    if (candidate === undefined || !resolvedPaths.every((path) => path[index]?.id === candidate.id)) break
    common = candidate
  }
  return common
}

/** The immediate child of `ancestor` that contains `topicId`, if any. */
function descendantBranchIndex(
  ancestor: MindMapTopicV2,
  topicId: string
): number | undefined {
  const path = topicPath(ancestor, topicId)
  if (path === undefined || path.length < 2) return undefined
  const branch = path[1]
  return ancestor.children.findIndex((child) => child.id === branch.id)
}

/**
 * Resolve the actual source topics for a summary selection. The root is not a
 * valid summary source, but a marquee spanning several branches can naturally
 * intersect it as well. Ignore that incidental root hit so selecting three or
 * more nodes across branches does not make the summary action unavailable.
 * Missing ids remain invalid and are checked by the caller.
 */
function summarySourceTopicIds(
  sheet: MindMapSheetV2,
  topicIds: readonly string[]
): string[] | null {
  const uniqueIds = [...new Set(topicIds)]
  const refs = uniqueIds.map((id) => findTopicInSheet(sheet, id))
  if (refs.some((ref) => ref === undefined)) return null
  return uniqueIds.filter((_, index) => refs[index]!.parent !== null)
}

/**
 * Whether the given topics can form a brace summary. Sibling selections keep
 * the traditional range behavior. Cross-branch selections attach their output
 * beneath the lowest common ancestor shared by every selected topic. An
 * incidental root topic from a marquee selection is ignored.
 */
export function canAddSummaryToTopics(
  sheet: MindMapSheetV2,
  topicIds: readonly string[]
): boolean {
  const sourceIds = summarySourceTopicIds(sheet, topicIds)
  if (sourceIds === null || sourceIds.length < 2) return false
  const refs = sourceIds
    .map((id) => findTopicInSheet(sheet, id))
    .filter((ref): ref is MindMapNodeRef => ref !== undefined)
  const parent = refs[0]!.parent
  if (parent !== null && refs.every((ref) => ref.parent === parent)) return true
  const commonAncestor = lowestCommonTopicAncestor(sheet.root, sourceIds)
  return commonAncestor !== undefined && sourceIds.every(
    (topicId) => descendantBranchIndex(commonAncestor, topicId) !== undefined
  )
}

/**
 * Build one atomic node-summary operation. Sibling selections summarize their
 * contiguous range; selections across different branches instead form a
 * cross-branch summary that persists every selected source topic.
 * The layout continues to position that ordinary topic beside its brace.
 */
export function buildAddSummaryCommand(
  sheet: MindMapSheetV2,
  topicIds: readonly string[],
  title = ''
): { command: MindMapCommand; summaryId: string; summaryTopicId: string } | null {
  const sourceIds = summarySourceTopicIds(sheet, topicIds)
  if (sourceIds === null || !canAddSummaryToTopics(sheet, sourceIds)) return null
  const refs = sourceIds
    .map((id) => findTopicInSheet(sheet, id))
    .filter((ref): ref is MindMapNodeRef => ref !== undefined)
  const sharedParent = refs[0]!.parent

  let outputParent: MindMapTopicV2
  let insertIndex: number
  let from: string
  let to: string
  if (sharedParent !== null && refs.every((ref) => ref.parent === sharedParent)) {
    const indices = refs.map((ref) => ref.index)
    from = sharedParent.children[Math.min(...indices)]!.id
    insertIndex = Math.max(...indices) + 1
    to = sharedParent.children[insertIndex - 1]!.id
    outputParent = sharedParent
  } else {
    const commonAncestor = lowestCommonTopicAncestor(sheet.root, sourceIds)
    if (commonAncestor === undefined) return null
    const branchIndices = sourceIds
      .map((topicId) => descendantBranchIndex(commonAncestor, topicId))
    if (branchIndices.some((index) => index === undefined)) return null
    outputParent = commonAncestor
    insertIndex = Math.max(...(branchIndices as number[])) + 1
    from = refs[0]!.node.id
    to = refs.at(-1)!.node.id
  }

  const summaryId = crypto.randomUUID()
  const summaryTopic = newTopicNode(title, sheet.layout.defaultTopicStyle, sheet.layout.defaultTopicShape)
  const element: MindMapSummary = {
    id: summaryId,
    type: 'summary',
    from,
    to,
    ...(sharedParent !== null && refs.every((ref) => ref.parent === sharedParent)
      ? {}
      : { sourceTopicIds: sourceIds }),
    summaryTopicId: summaryTopic.id
  }
  return {
    summaryId,
    summaryTopicId: summaryTopic.id,
    command: {
      type: 'transaction',
      commands: [
        {
          type: 'topic.insert',
          sheetId: sheet.id,
          parentId: outputParent.id,
          index: insertIndex,
          node: summaryTopic
        },
        { type: 'element.create', sheetId: sheet.id, element }
      ]
    }
  }
}

/** Deep-copy the selected branch plus any elements that reference it. */
export function captureClipboardData(
  document: MindMapDocumentV2,
  sheetId: string,
  topicId: string
): MindMapClipboardData | null {
  const sheet = document.sheets.find((candidate) => candidate.id === sheetId)
  if (sheet === undefined) return null
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined) return null

  const branch = structuredClone(ref.node)
  const branchIds = new Set(collectTopicIds({ ...sheet, root: ref.node }))
  const elements = sheet.elements
    .filter((element) => {
      if (element.type === 'connector') {
        // Branch copying has no independent free-shape selection. A connector
        // is portable only when both of its topic targets are inside the
        // copied branch; otherwise it would point back into the source map.
        return element.start.anchor?.targetType === 'topic'
          && element.end.anchor?.targetType === 'topic'
          && branchIds.has(element.start.anchor.targetId)
          && branchIds.has(element.end.anchor.targetId)
      }
      const refs = elementRefIds(element)
      // Copying a branch must not create an element whose topic references
      // point into the source map.
      if (refs.length === 0 || !refs.every((id) => branchIds.has(id))) return false
      // A linked summary is only portable when its covered range and output
      // topic are copied together. Copying its output alone must remain a
      // normal node operation rather than creating dangling brace references.
      return element.type !== 'summary' || refs.every((id) => branchIds.has(id))
    })
    .map((element) => structuredClone(element))

  return {
    documentId: document.id,
    sheetId,
    branches: [branch],
    elements,
    capturedAt: new Date().toISOString()
  }
}

/** Command that re-inserts a cut branch (plus its elements) where it was. */
function buildRestoreCommand(
  sheet: MindMapSheetV2,
  ref: MindMapNodeRef,
  data: MindMapClipboardData
): MindMapCommand {
  if (ref.parent === null) {
    // Root cannot be cut; this is defensive only.
    return { type: 'topic.insert', sheetId: sheet.id, parentId: sheet.id, node: data.branches[0]! }
  }
  const commands: MindMapCommand[] = [
    {
      type: 'topic.insert',
      sheetId: sheet.id,
      parentId: ref.parent.id,
      index: ref.index,
      node: structuredClone(ref.node)
    }
  ]
  for (const element of data.elements) {
    commands.push({ type: 'element.create', sheetId: sheet.id, element: structuredClone(element) })
  }
  return commands.length === 1 ? commands[0]! : { type: 'transaction', commands }
}

export function buildCopyPayload(
  document: MindMapDocumentV2,
  sheetId: string,
  topicId: string
): MindMapCopyClipboardPayload | null {
  const data = captureClipboardData(document, sheetId, topicId)
  if (data === null) return null
  return { kind: 'copy', data }
}

export function buildCutPayload(
  document: MindMapDocumentV2,
  sheetId: string,
  topicId: string
): MindMapCutClipboardPayload | null {
  const sheet = document.sheets.find((candidate) => candidate.id === sheetId)
  if (sheet === undefined) return null
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined || ref.parent === null) return null
  const data = captureClipboardData(document, sheetId, topicId)
  if (data === null) return null
  return { kind: 'cut', data, restoreCommand: buildRestoreCommand(sheet, ref, data) }
}

function makeRemap(): (oldId: string) => string {
  const map = new Map<string, string>()
  return (oldId: string) => {
    let next = map.get(oldId)
    if (next === undefined) {
      next = crypto.randomUUID()
      map.set(oldId, next)
    }
    return next
  }
}

export function buildPasteCommandForPayload(
  payload: MindMapPasteClipboardPayload,
  targetSheetId: string,
  targetParentId: string
): { command: MindMapCommand; pastedRootId: string | null } {
  const remap = makeRemap()
  const firstRootId = payload.data.branches[0]?.id
  const pastedRootId = firstRootId === undefined ? null : remap(firstRootId)
  return {
    pastedRootId,
    command: buildPasteCommand(
      { ...payload, targetSheetId, targetParentId },
      remap
    )
  }
}

/** Cmd/Ctrl+D: duplicate a branch immediately after itself. */
export function buildDuplicateCommand(
  document: MindMapDocumentV2,
  sheetId: string,
  topicId: string
): { command: MindMapCommand; pastedRootId: string } | null {
  const sheet = document.sheets.find((candidate) => candidate.id === sheetId)
  if (sheet === undefined) return null
  const ref = findTopicInSheet(sheet, topicId)
  if (ref === undefined || ref.parent === null) return null
  const data = captureClipboardData(document, sheetId, topicId)
  if (data === null) return null
  const remap = makeRemap()
  const pastedRootId = remap(topicId)
  const command = buildPasteCommand(
    {
      kind: 'paste',
      data,
      targetSheetId: sheetId,
      targetParentId: ref.parent.id,
      index: ref.index + 1
    },
    remap
  )
  return { command, pastedRootId }
}

/** Sheet copy: deep-copies the sheet and returns a `sheet.create` command. */
export function buildCopySheetCommand(
  document: MindMapDocumentV2,
  sheetId: string
): { command: MindMapCommand; newSheetId: string } | null {
  const sourceIndex = document.sheets.findIndex((candidate) => candidate.id === sheetId)
  if (sourceIndex === -1) return null
  const copied = copySheet(document, sheetId)
  const newSheet = copied.sheets[sourceIndex + 1]
  if (newSheet === undefined) return null
  return {
    newSheetId: newSheet.id,
    command: { type: 'sheet.create', index: sourceIndex + 1, sheet: newSheet }
  }
}

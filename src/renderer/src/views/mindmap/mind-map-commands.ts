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
import {
  applyMindMapQuickStyle,
  type MindMapQuickStylePreset
} from '../../../../shared/mindmap/quick-styles'
import type {
  MindMapDocumentV2,
  MindMapElement,
  MindMapSheetV2,
  MindMapTopicStyleOverride,
  MindMapTopicV2
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
      return [element.from, element.to]
    case 'callout':
      return [element.topicId]
    case 'free-topic':
      return [element.topicId]
  }
  return []
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

export function newTopicNode(title = ''): MindMapTopicV2 {
  return { id: crypto.randomUUID(), title, children: [] }
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
  sheetId: string,
  parentId: string
): { command: MindMapCommand; nodeId: string } {
  const node = newTopicNode()
  return {
    nodeId: node.id,
    command: { type: 'topic.insert', sheetId, parentId, node }
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
    return buildInsertChildCommand(sheet.id, topicId)
  }
  const node = newTopicNode()
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
    return buildInsertChildCommand(sheet.id, topicId)
  }
  const node = newTopicNode()
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
  return { type: 'topic.remove', sheetId: sheet.id, topicId }
}

/** F2 / inline edit commit. */
export function buildUpdateTitleCommand(
  sheetId: string,
  topicId: string,
  title: string
): MindMapCommand {
  return { type: 'topic.update', sheetId, topicId, patch: { title } }
}

/** Batch collapse/expand over every topic in a sheet. */
function collectTopics(node: MindMapTopicV2): MindMapTopicV2[] {
  return [node, ...node.children.flatMap(collectTopics)]
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

export function buildCollapseAllCommand(
  sheetId: string,
  root: MindMapTopicV2
): MindMapCommand {
  return {
    type: 'transaction',
    commands: collectTopics(root).map((topic) => ({
      type: 'topic.update',
      sheetId,
      topicId: topic.id,
      patch: { collapsed: true }
    }))
  }
}

export function buildExpandAllCommand(
  sheetId: string,
  root: MindMapTopicV2
): MindMapCommand {
  return {
    type: 'transaction',
    commands: collectTopics(root).map((topic) => ({
      type: 'topic.update',
      sheetId,
      topicId: topic.id,
      patch: { collapsed: false }
    }))
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
    .filter((element) => elementRefIds(element).some((id) => branchIds.has(id)))
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

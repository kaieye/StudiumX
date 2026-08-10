/**
 * Immutable node-selection boundary for the mind-map renderer.
 *
 * Selection is represented as an ordered list of stable topic ids rather than
 * a mutable Set so it can cross renderer seams, be compared in tests, and be
 * serialized by future UI state without leaking mutation. Helpers preserve
 * first-seen order and enforce uniqueness on every returned value.
 */
export type MindMapSelection = readonly string[]

/** Toggle one topic id while preserving the selection's existing order. */
export function toggleMindMapNodeSelection(
  selection: MindMapSelection,
  nodeId: string
): string[] {
  const normalized = uniqueSelectionIds(selection)
  const index = normalized.indexOf(nodeId)
  if (index === -1) return [...normalized, nodeId]
  return normalized.filter((id) => id !== nodeId)
}

/** Select every supplied topic id, preserving order and dropping duplicates. */
export function selectAllMindMapNodes(nodeIds: readonly string[]): string[] {
  return uniqueSelectionIds(nodeIds)
}

/** Return a fresh empty selection without mutating a prior selection. */
export function clearMindMapSelection(): string[] {
  return []
}

/** Check membership without exposing or mutating the selection representation. */
export function isMindMapNodeSelected(
  selection: MindMapSelection,
  nodeId: string
): boolean {
  return selection.includes(nodeId)
}

function uniqueSelectionIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

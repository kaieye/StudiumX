import type {
  AgentConversationSummary,
  TeachingAppState,
  WorkspaceItemKind
} from './teaching-types'

export type WorkspaceRemovalTarget = {
  relativePath: string
  kind: WorkspaceItemKind
}

export type WorkspaceRemovalUiSnapshot = {
  activeConversationId: string | null
  selectedCoursePreviewFile?: { relativePath: string } | null
  selectedCourseRelativePath?: string | null
}

export type WorkspaceRemovalUiPatch = {
  clearActiveConversation: boolean
  clearSelectedCoursePreview: boolean
  clearSelectedCourseFolder: boolean
}

export function deriveWorkspaceRemovalUiPatch(
  target: WorkspaceRemovalTarget,
  snapshot: WorkspaceRemovalUiSnapshot,
  nextState: Pick<TeachingAppState, 'activeWorkspace' | 'temporaryConversations'>
): WorkspaceRemovalUiPatch {
  return {
    clearActiveConversation: shouldClearActiveConversation(
      snapshot.activeConversationId,
      [
        ...(nextState.activeWorkspace?.conversations ?? []),
        ...(nextState.temporaryConversations ?? [])
      ]
    ),
    clearSelectedCoursePreview: pathRemovedByTarget(
      target,
      snapshot.selectedCoursePreviewFile?.relativePath ?? ''
    ),
    clearSelectedCourseFolder: pathRemovedByTarget(
      target,
      snapshot.selectedCourseRelativePath ?? ''
    )
  }
}

export function pathRemovedByTarget(target: WorkspaceRemovalTarget, relativePath: string): boolean {
  const removed = normalizeRelativePath(target.relativePath)
  const current = normalizeRelativePath(relativePath)
  if (!removed || !current) return false
  if (target.kind === 'directory') return current === removed || current.startsWith(`${removed}/`)
  return current === removed
}

function shouldClearActiveConversation(
  activeConversationId: string | null,
  nextConversations: AgentConversationSummary[]
): boolean {
  if (!activeConversationId) return false
  return !nextConversations.some((conversation) => conversation.id === activeConversationId)
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

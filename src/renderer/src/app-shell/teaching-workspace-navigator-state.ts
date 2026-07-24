import type { AgentConversationSummary, TeachingWorkspaceSummary, WorkspaceFileNode } from '../../../shared/teaching-types'
import { listSidebarWorkspaceFolders, type SidebarWorkspaceFolder } from '../../../shared/course-sidebar'
import {
  projectVisibleAgentConversationWorkspaces,
  projectVisibleSidebarConversations
} from '../agent-conversation-projection'
import type { PendingAgentConversation, SidebarConversationSummary } from '../agent-conversation-state'

export type TeachingWorkspaceNavigatorState = {
  coursesExpanded: boolean
  conversationsExpanded: boolean
  expandedPaths: Set<string>
  /** Sidebar folder highlight only; null means no folder is highlighted. */
  selectedFolderKey: string | null
  importDialogOpen: boolean
}

export type TeachingWorkspaceNavigatorAction =
  | { type: 'toggle-courses' }
  | { type: 'toggle-conversations' }
  | { type: 'toggle-path'; workspaceId: string; relativePath: string }
  | { type: 'ensure-path-expanded'; workspaceId: string; relativePath: string }
  | { type: 'select-folder'; workspaceId: string; relativePath: string }
  | { type: 'clear-folder-selection' }
  | { type: 'open-import-dialog' }
  | { type: 'close-import-dialog' }

export const initialTeachingWorkspaceNavigatorState: TeachingWorkspaceNavigatorState = {
  coursesExpanded: true,
  conversationsExpanded: true,
  expandedPaths: new Set(),
  selectedFolderKey: null,
  importDialogOpen: false
}

export function teachingWorkspaceNavigatorReducer(
  state: TeachingWorkspaceNavigatorState,
  action: TeachingWorkspaceNavigatorAction
): TeachingWorkspaceNavigatorState {
  switch (action.type) {
    case 'toggle-courses': {
      const coursesExpanded = !state.coursesExpanded
      return {
        ...state,
        coursesExpanded,
        expandedPaths: coursesExpanded ? state.expandedPaths : new Set()
      }
    }
    case 'toggle-conversations':
      return { ...state, conversationsExpanded: !state.conversationsExpanded }
    case 'toggle-path': {
      const key = workspaceNodeKey(action.workspaceId, action.relativePath)
      const expandedPaths = new Set(state.expandedPaths)
      if (expandedPaths.has(key)) expandedPaths.delete(key)
      else expandedPaths.add(key)
      return { ...state, expandedPaths }
    }
    case 'ensure-path-expanded': {
      const key = workspaceNodeKey(action.workspaceId, action.relativePath)
      if (state.expandedPaths.has(key)) return state
      const expandedPaths = new Set(state.expandedPaths)
      expandedPaths.add(key)
      return { ...state, expandedPaths }
    }
    case 'select-folder':
      return {
        ...state,
        selectedFolderKey: workspaceNodeKey(action.workspaceId, action.relativePath)
      }
    case 'clear-folder-selection':
      return state.selectedFolderKey === null ? state : { ...state, selectedFolderKey: null }
    case 'open-import-dialog':
      return { ...state, importDialogOpen: true }
    case 'close-import-dialog':
      return { ...state, importDialogOpen: false }
  }
}

export type TeachingWorkspaceNavigatorProjection = {
  workspaceFolders: SidebarWorkspaceFolder[]
  temporaryConversations: SidebarConversationSummary[]
}

export function projectTeachingWorkspaceNavigator(input: {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  temporaryConversations: AgentConversationSummary[]
  pendingAgentConversation: PendingAgentConversation | null
  showAllCourseFiles: boolean
}): TeachingWorkspaceNavigatorProjection {
  const visibleCourseWorkspaces = projectVisibleAgentConversationWorkspaces({
    workspaces: input.workspaces,
    activeWorkspace: null,
    selectedCourseWorkspaceId: null,
    pendingAgentConversation: input.pendingAgentConversation
  }).workspaces

  return {
    workspaceFolders: listSidebarWorkspaceFolders(visibleCourseWorkspaces, input.showAllCourseFiles),
    temporaryConversations: projectVisibleSidebarConversations({
      workspace: input.activeWorkspace,
      conversations: input.temporaryConversations,
      pendingAgentConversation: input.pendingAgentConversation
    })
  }
}

export function workspaceNodeKey(workspaceId: string, relativePath: string): string {
  return `${workspaceId}:${normalizeRelativePath(relativePath)}`
}

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

export function sameRelativePath(left: string, right: string): boolean {
  return normalizeRelativePath(left) === normalizeRelativePath(right)
}

export function isSidebarCourseFolderPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  // Default course root ("lessons") or a named course under courses/.
  return normalized === 'lessons' || /^courses\/[^/]+$/i.test(normalized)
}

/** Content folders under a course (or inlined default-course children). */
export function isSidebarContentFolderPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (normalized === 'conversation' || normalized === 'conversations' || normalized === 'lesson') return true
  return /^courses\/[^/]+\/(lesson|lessons|conversation|conversations)$/i.test(normalized)
}

export function isTeachingWorkspaceNavigatorNodeSelected(input: {
  node: WorkspaceFileNode
  lessonRelativePath: string | null
  activeConversationId: string | null
  lessonRelativePaths: readonly string[]
  conversation: { id: string } | null
  courseTree: boolean
  workspaceId: string
  selectedFolderKey: string | null
  isWorkspaceFolder: boolean
  isCourseFolder: boolean
  isContentFolder: boolean
}): boolean {
  const isCoursePreviewFile = input.courseTree && /\.(html|md)$/i.test(input.node.name)
  const isLesson = input.lessonRelativePaths.some((path) => sameRelativePath(path, input.node.relativePath))
  const isFileOrConversationSelected = Boolean(
    ((isLesson || isCoursePreviewFile) && input.node.absolutePath === input.lessonRelativePath) ||
      (input.conversation && input.conversation.id === input.activeConversationId)
  )
  if (isFileOrConversationSelected) return true

  // Folder rows share one exclusive selection with files/conversations.
  if (input.lessonRelativePath || input.activeConversationId) return false
  if (!input.isWorkspaceFolder && !input.isCourseFolder && !input.isContentFolder) return false
  // Folder chrome is driven solely by selectedFolderKey; collapse click clears it in the row handler.
  return input.selectedFolderKey === workspaceNodeKey(input.workspaceId, input.node.relativePath)
}
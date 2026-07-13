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
  importDialogOpen: boolean
}

export type TeachingWorkspaceNavigatorAction =
  | { type: 'toggle-courses' }
  | { type: 'toggle-conversations' }
  | { type: 'toggle-path'; workspaceId: string; relativePath: string }
  | { type: 'open-import-dialog' }
  | { type: 'close-import-dialog' }

export const initialTeachingWorkspaceNavigatorState: TeachingWorkspaceNavigatorState = {
  coursesExpanded: true,
  conversationsExpanded: true,
  expandedPaths: new Set(),
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
  return normalized === 'lessons' || /^courses\/[^/]+$/i.test(normalized)
}

export function isTeachingWorkspaceNavigatorNodeSelected(input: {
  node: WorkspaceFileNode
  lessonRelativePath: string | null
  activeConversationId: string | null
  lessonRelativePaths: readonly string[]
  conversation: { id: string } | null
  courseTree: boolean
}): boolean {
  const isCoursePreviewFile = input.courseTree && /\.(html|md)$/i.test(input.node.name)
  const isLesson = input.lessonRelativePaths.some((path) => sameRelativePath(path, input.node.relativePath))
  return Boolean(
    ((isLesson || isCoursePreviewFile) && input.node.absolutePath === input.lessonRelativePath) ||
      (input.conversation && input.conversation.id === input.activeConversationId)
  )
}
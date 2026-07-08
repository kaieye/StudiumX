import {
  courseRelativePathForAgentConversation,
  isCourseAgentConversationPath
} from '../../shared/agent-conversation-catalog'
import type {
  AgentConversationSummary,
  TeachingWorkspaceSummary
} from '../../shared/teaching-types'
import type {
  PendingAgentConversation,
  SidebarConversationSummary
} from './agent-conversation-state'

export type VisibleAgentConversationWorkspaces = {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  selectedCourseWorkspace: TeachingWorkspaceSummary | null
}

export function projectVisibleAgentConversationWorkspaces({
  workspaces,
  activeWorkspace,
  selectedCourseWorkspaceId,
  pendingAgentConversation
}: {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  selectedCourseWorkspaceId: string | null
  pendingAgentConversation: PendingAgentConversation | null
}): VisibleAgentConversationWorkspaces {
  const visibleWorkspaces = withPendingCourseConversation(workspaces, pendingAgentConversation)
  const activeVisibleWorkspace = activeWorkspace
    ? visibleWorkspaces.find((workspace) => workspace.id === activeWorkspace.id) ?? activeWorkspace
    : null
  const selectedCourseWorkspace = selectedCourseWorkspaceId
    ? visibleWorkspaces.find((workspace) => workspace.id === selectedCourseWorkspaceId) ?? activeVisibleWorkspace
    : activeVisibleWorkspace

  return {
    workspaces: visibleWorkspaces,
    activeWorkspace: activeVisibleWorkspace,
    selectedCourseWorkspace
  }
}

export function projectVisibleSidebarConversations({
  workspace,
  conversations,
  pendingAgentConversation
}: {
  workspace: TeachingWorkspaceSummary | null
  conversations: AgentConversationSummary[]
  pendingAgentConversation: PendingAgentConversation | null
}): SidebarConversationSummary[] {
  if (
    !pendingAgentConversation ||
    pendingAgentConversation.workspaceId !== workspace?.id ||
    isCourseAgentConversationPath(pendingAgentConversation.summary.relativePath)
  ) {
    return conversations
  }

  return upsertConversationSummary(conversations, pendingAgentConversation.summary)
}

function withPendingCourseConversation(
  workspaces: TeachingWorkspaceSummary[],
  pendingAgentConversation: PendingAgentConversation | null
): TeachingWorkspaceSummary[] {
  if (!pendingAgentConversation || !isCourseAgentConversationPath(pendingAgentConversation.summary.relativePath)) return workspaces
  const courseRelativePath = courseRelativePathForAgentConversation(pendingAgentConversation.summary.relativePath)
  if (!courseRelativePath) return workspaces

  let changed = false
  const nextWorkspaces = workspaces.map((workspace) => {
    if (workspace.id !== pendingAgentConversation.workspaceId) return workspace
    let workspaceChanged = false
    const conversations = upsertConversationSummary(workspace.conversations, pendingAgentConversation.summary)
    if (conversations !== workspace.conversations) workspaceChanged = true
    const courses = workspace.courses.map((course) => {
      if (!sameRelativePath(course.relativePath, courseRelativePath)) return course
      const courseConversations = upsertConversationSummary(course.conversations, pendingAgentConversation.summary)
      if (courseConversations === course.conversations) return course
      workspaceChanged = true
      return {
        ...course,
        conversations: courseConversations,
        sessionCount: course.sessions.length + courseConversations.length
      }
    })
    if (!workspaceChanged) return workspace
    changed = true
    return {
      ...workspace,
      conversations,
      courses
    }
  })

  return changed ? nextWorkspaces : workspaces
}

function upsertConversationSummary(
  conversations: AgentConversationSummary[],
  conversation: AgentConversationSummary
): SidebarConversationSummary[] {
  const withoutCurrent = conversations.filter((item) =>
    item.id !== conversation.id && !sameRelativePath(item.relativePath, conversation.relativePath)
  )
  if (withoutCurrent.length === conversations.length && conversations[0]?.id === conversation.id) return conversations
  return [conversation, ...withoutCurrent]
}

function sameRelativePath(left: string, right: string): boolean {
  return normalizeProjectionRelativePath(left) === normalizeProjectionRelativePath(right)
}

function normalizeProjectionRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

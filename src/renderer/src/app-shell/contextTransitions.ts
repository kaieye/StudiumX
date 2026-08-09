import { courseRelativePathForAgentConversation } from '../../../shared/agent-conversation-catalog'
import { courseRelativePathFromWorkspacePath } from '../../../shared/teaching-placement'
import type {
  AgentChatTurn,
  AgentConversationRecord,
  LessonSummary,
  TeachingAppState,
  TeachingWorkspaceSummary,
  WorkspaceMarkdownDocument,
  WorkspaceView
} from '../../../shared/teaching-types'
import type { PendingAgentConversation } from '../agent-conversation-state'

export type DialogMode = 'chat' | 'teaching'

export type CoursePreviewFile = {
  title: string
  relativePath: string
  absolutePath: string
}

export type ResourcePreviewFile = {
  id: string
  title: string
  html: string
}

export type AppShellTransitionPatch = {
  appState?: TeachingAppState
  view?: WorkspaceView
  overviewDialogMode?: DialogMode
  loading?: boolean
  lessonReaderOpen?: boolean
  selectedCoursePreviewFile?: CoursePreviewFile | null
  selectedResourcePreviewFile?: ResourcePreviewFile | null
  selectedMarkdownDocument?: WorkspaceMarkdownDocument | null
  markdownDraft?: string
  markdownSaving?: boolean
  selectedCourseRelativePath?: string | null
  selectedCourseWorkspaceId?: string | null
  taskPrompt?: string
  agentTurns?: AgentChatTurn[]
  activeConversationId?: string | null
  agentStatus?: string
  agentInput?: string
  agentToolsSupported?: boolean | null
  agentChatBusy?: boolean
  pendingAgentConversation?: PendingAgentConversation | null
}

export function clearMarkdownDocumentContext(): Pick<
  AppShellTransitionPatch,
  'selectedMarkdownDocument' | 'markdownDraft' | 'markdownSaving'
> {
  return {
    selectedMarkdownDocument: null,
    markdownDraft: '',
    markdownSaving: false
  }
}

export function closeLearningAssetReaderContext(): AppShellTransitionPatch {
  return {
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null,
    ...clearMarkdownDocumentContext()
  }
}

export function clearAgentConversationContext(): AppShellTransitionPatch {
  return {
    agentTurns: [],
    activeConversationId: null,
    agentStatus: '',
    agentInput: '',
    agentToolsSupported: null,
    agentChatBusy: false,
    pendingAgentConversation: null
  }
}

/**
 * Clears exclusive sidebar selection chrome without aborting an in-flight agent run.
 * Keeps pendingAgentConversation / agentChatBusy when the caller preserves them.
 */
export function clearSidebarSelectionChrome(
  appState?: TeachingAppState
): AppShellTransitionPatch {
  return {
    ...closeLearningAssetReaderContext(),
    activeConversationId: null,
    agentTurns: [],
    agentStatus: '',
    agentInput: '',
    agentToolsSupported: null,
    selectedCourseRelativePath: null,
    selectedCourseWorkspaceId: null,
    ...(appState
      ? {
          appState: {
            ...appState,
            selectedLessonPath: null,
            previewUrl: ''
          }
        }
      : {})
  }
}

const PRIMARY_SHELL_VIEWS = new Set<WorkspaceView>([
  'overview',
  'resources',
  'workbench',
  'review',
  'settings',
  'mindmap'
])

export function openPrimaryView(
  view: WorkspaceView,
  appState?: TeachingAppState
): AppShellTransitionPatch {
  // Content destinations (agent/lessons) may own conversation/file chrome.
  // Shell destinations (top-nav primary pages) take exclusive chrome.
  if (!PRIMARY_SHELL_VIEWS.has(view)) {
    return { view }
  }

  return {
    view,
    ...clearSidebarSelectionChrome(appState)
  }
}

export function openLessonLibrary(): AppShellTransitionPatch {
  return {
    view: 'lessons',
    ...closeLearningAssetReaderContext()
  }
}

export function openTeachingConversation(): AppShellTransitionPatch {
  return {
    view: 'overview',
    overviewDialogMode: 'teaching',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null,
    ...clearMarkdownDocumentContext()
  }
}

export function openWorkspaceTeaching(
  appState?: TeachingAppState
): AppShellTransitionPatch {
  // Clean teaching surface chrome. Callers that need to drop a non-busy pending
  // conversation should spread clearAgentConversationContext() themselves.
  return {
    ...openTeachingConversation(),
    ...clearSidebarSelectionChrome(appState)
  }
}

export function activateWorkspaceContext(input: {
  appState: TeachingAppState
  taskPrompt: string
  loading?: boolean
}): AppShellTransitionPatch {
  return {
    appState: input.appState,
    loading: input.loading,
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null,
    ...clearMarkdownDocumentContext(),
    selectedCourseRelativePath: null,
    selectedCourseWorkspaceId: null,
    taskPrompt: input.taskPrompt,
    ...clearAgentConversationContext()
  }
}

export function selectCourseFolderContext(input: {
  selectedCourseRelativePath: string | null
  workspaceId?: string | null
  targetWorkspace: TeachingWorkspaceSummary | null
  pendingAgentConversation?: PendingAgentConversation | null
}): AppShellTransitionPatch {
  const { selectedCourseRelativePath, targetWorkspace } = input
  const selectedCourse = selectedCourseRelativePath
    ? targetWorkspace?.courses.find((course) => sameRelativePath(course.relativePath, selectedCourseRelativePath)) ?? null
    : null
  const hasCourseContent = selectedCourseRelativePath
    ? Boolean(selectedCourse && selectedCourse.sessionCount > 0)
    : Boolean(targetWorkspace?.lessons.length)
  return {
    view: hasCourseContent ? 'lessons' : 'overview',
    overviewDialogMode: 'teaching',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null,
    ...clearMarkdownDocumentContext(),
    selectedCourseRelativePath,
    selectedCourseWorkspaceId: selectedCourse ? targetWorkspace?.id ?? null : null,
    // Selecting an empty course while a turn is still streaming must not
    // discard the in-memory draft. The runner needs it to finish and persist
    // the conversation after navigation.
    ...(!hasCourseContent && !input.pendingAgentConversation ? clearAgentConversationContext() : {})
  }
}

export function restorePendingConversationContext(
  pending: PendingAgentConversation,
  currentOverviewDialogMode: DialogMode
): AppShellTransitionPatch {
  const courseRelativePath = courseRelativePathForAgentConversation(pending.summary.relativePath)
  return {
    view: pending.mode === 'teaching' ? 'overview' : 'agent',
    overviewDialogMode: pending.mode === 'teaching' ? 'teaching' : currentOverviewDialogMode,
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    ...clearMarkdownDocumentContext(),
    agentTurns: pending.turns,
    activeConversationId: pending.summary.id,
    agentStatus: pending.status,
    agentToolsSupported: pending.toolsSupported,
    selectedCourseRelativePath: courseRelativePath,
    selectedCourseWorkspaceId: courseRelativePath ? pending.workspaceId : null
  }
}

export function openAgentConversationContext(input: {
  conversation: AgentConversationRecord
  workspaceId: string
  appState: TeachingAppState
  currentOverviewDialogMode: DialogMode
  currentTaskPrompt: string
}): AppShellTransitionPatch {
  const latestUserTurn = [...input.conversation.turns].reverse().find((turn) => turn.role === 'user')
  const conversationCourseRelativePath = courseRelativePathForAgentConversation(input.conversation.relativePath)
  const isTeachingConversation = Boolean(conversationCourseRelativePath)
  return {
    view: isTeachingConversation ? 'overview' : 'agent',
    overviewDialogMode: isTeachingConversation ? 'teaching' : input.currentOverviewDialogMode,
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    ...clearMarkdownDocumentContext(),
    // Sidebar chrome is exclusive: conversation selection clears file/lesson highlight.
    appState: {
      ...input.appState,
      selectedLessonPath: null,
      previewUrl: ''
    },
    agentTurns: input.conversation.turns,
    activeConversationId: input.conversation.id,
    agentStatus: '',
    agentToolsSupported: null,
    agentInput: '',
    selectedCourseRelativePath: conversationCourseRelativePath,
    selectedCourseWorkspaceId: conversationCourseRelativePath ? input.workspaceId : null,
    taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : input.currentTaskPrompt
  }
}

export function openLessonReaderContext(input: {
  appState: TeachingAppState
  workspace: TeachingWorkspaceSummary
  previewFile: CoursePreviewFile
  previewHtml: string
  courseRelativePath: string | null
}): { appState: TeachingAppState } & AppShellTransitionPatch {
  return {
    view: 'lessons',
    overviewDialogMode: 'teaching',
    lessonReaderOpen: true,
    selectedCoursePreviewFile: input.previewFile,
    selectedResourcePreviewFile: null,
    ...clearMarkdownDocumentContext(),
    // Sidebar chrome is exclusive: file selection clears conversation highlight.
    activeConversationId: null,
    appState: {
      ...input.appState,
      selectedLessonPath: input.previewFile.absolutePath,
      previewHtml: input.previewHtml,
      previewUrl: ''
    },
    selectedCourseRelativePath: input.courseRelativePath,
    selectedCourseWorkspaceId: input.workspace.id
  }
}

export function openWorkspaceMarkdownContext(input: {
  appState: TeachingAppState
  workspace: TeachingWorkspaceSummary
  file: CoursePreviewFile
  courseRelativePath: string | null
}): { appState: TeachingAppState } & AppShellTransitionPatch {
  return {
    view: 'lessons',
    overviewDialogMode: 'teaching',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null,
    selectedMarkdownDocument: {
      title: input.file.title,
      relativePath: input.file.relativePath,
      absolutePath: input.file.absolutePath,
      content: '',
      updatedAt: null
    },
    markdownDraft: '',
    markdownSaving: false,
    // Sidebar chrome is exclusive: file selection clears conversation highlight.
    activeConversationId: null,
    selectedCourseRelativePath: input.courseRelativePath,
    selectedCourseWorkspaceId: input.workspace.id,
    appState: { ...input.appState, selectedLessonPath: input.file.absolutePath }
  }
}

export function openResourceReaderContext(selectedResourcePreviewFile: ResourcePreviewFile): AppShellTransitionPatch {
  return {
    view: 'resources',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile,
    ...clearMarkdownDocumentContext()
  }
}

export function clearRemovedWorkspaceContext(input: {
  nextState: TeachingAppState
  previousView: WorkspaceView
  nextPrompt: string
  defaultPrompt: string
}): AppShellTransitionPatch {
  return {
    view: input.nextState.activeWorkspace ? input.previousView : 'overview',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    ...clearMarkdownDocumentContext(),
    selectedCourseRelativePath: null,
    selectedCourseWorkspaceId: null,
    taskPrompt: input.nextState.activeWorkspace?.lessons.length ? input.nextPrompt : input.defaultPrompt,
    ...clearAgentConversationContext()
  }
}

export function lessonToCoursePreviewFile(lesson: LessonSummary): CoursePreviewFile {
  return {
    title: lesson.sessionName || lesson.title,
    relativePath: lesson.relativePath,
    absolutePath: lesson.absolutePath
  }
}

export function courseRelativePathForFile(relativePath: string): string | null {
  return courseRelativePathFromWorkspacePath(relativePath)
}

function sameRelativePath(left: string, right: string): boolean {
  return normalizeRelativePath(left) === normalizeRelativePath(right)
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

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

export function openPrimaryView(view: WorkspaceView): AppShellTransitionPatch {
  return view === 'resources'
    ? { view, selectedResourcePreviewFile: null }
    : { view }
}

export function openLessonLibrary(): AppShellTransitionPatch {
  return {
    view: 'lessons',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null,
    ...clearMarkdownDocumentContext()
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

export function openWorkspaceTeaching(): AppShellTransitionPatch {
  return {
    ...clearAgentConversationContext(),
    ...openTeachingConversation(),
    selectedCourseRelativePath: null,
    selectedCourseWorkspaceId: null
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
    ...(!hasCourseContent ? clearAgentConversationContext() : {})
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

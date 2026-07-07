import type { AgentChatMessage, AgentConversationSummary } from './agent'
import type { TeachingGitWorkspaceInfo } from './git'

export type WorkspaceView = 'overview' | 'lessons' | 'agent' | 'resources' | 'studio' | 'review' | 'settings'

export type WorkflowStepState = 'done' | 'active' | 'waiting' | 'error'

export type ResourceSummary = {
  title: string
  detail: string
  tag: string
}

export type LearningRecordSummary = {
  title: string
  date: string
  relativePath: string
  absolutePath: string
}

export type WorkspaceFileNode = {
  name: string
  kind: 'directory' | 'file'
  relativePath: string
  absolutePath: string
  children?: WorkspaceFileNode[]
  truncated?: boolean
  pinned?: boolean
}

export type LessonSummary = {
  id: string
  title: string
  objective: string
  prompt: string
  createdAt: string
  durationMinutes: number
  courseId: string
  courseName: string
  courseRelativePath: string
  courseAbsolutePath: string
  sessionId: string
  sessionName: string
  sessionRelativePath: string
  sessionAbsolutePath: string
  relativePath: string
  absolutePath: string
  pinned?: boolean
}

export type TeachingSessionSummary = {
  id: string
  name: string
  relativePath: string
  absolutePath: string
  lesson: LessonSummary
}

export type TeachingCourseSummary = {
  id: string
  name: string
  relativePath: string
  absolutePath: string
  lessonCount: number
  sessionCount: number
  sessions: TeachingSessionSummary[]
  conversations: AgentConversationSummary[]
}

export type TeachingWorkspaceSummary = {
  id: string
  name: string
  rootPath: string
  missionPath: string
  resourcesPath: string
  lessonsDir: string
  recordsDir: string
  referenceDir: string
  reviewsDir: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  missionTitle: string
  missionExcerpt: string
  courses: TeachingCourseSummary[]
  fileTree: WorkspaceFileNode[]
  conversations: AgentConversationSummary[]
  resources: ResourceSummary[]
  records: LearningRecordSummary[]
  lessons: LessonSummary[]
  referenceCount: number
  assetsReady: boolean
  git: TeachingGitWorkspaceInfo | null
}

export type TeachingRuntimeState = {
  status: 'idle' | 'working' | 'error'
  currentStep: string
  queuedTasks: number
  providerLabel: string
}

export type TeachingAppState = {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  temporaryConversations: AgentConversationSummary[]
  previewHtml: string
  previewUrl: string
  selectedLessonPath: string | null
  runtime: TeachingRuntimeState
}

export type CreateWorkspacePayload = {
  name: string
  prompt: string
}

export type GenerateLessonPayload = {
  workspaceId: string
  prompt: string
  courseName?: string
  messages?: AgentChatMessage[]
}

export type UpdateMissionPayload = {
  workspaceId: string
  prompt: string
}

export type ApplyLessonStylePayload = {
  workspaceId: string
  styleId: string
}

export type ReadLessonPayload = {
  workspaceId: string
  lessonPath: string
}

export type ReadLessonResult = {
  html: string
  url: string
}

export type ImportWorkspaceResult = {
  canceled: boolean
  state: TeachingAppState | null
}

export type GenerateLessonResult = {
  kind: 'lesson'
  state: TeachingAppState
  lesson: LessonSummary
  source: 'ai' | 'fallback'
  reason?: string
}

export type PickDirectoryResult = {
  canceled: boolean
  path: string | null
}

export type OpenPathResult = {
  ok: boolean
  message?: string
}

export type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close'

export type WorkspaceItemKind = 'conversation' | 'file' | 'directory'
export type WorkspaceItemRemoveMode = 'list' | 'disk'

export type WorkspaceItemMetaPayload = {
  workspaceId: string
  relativePath: string
  /** null 清除该标志，省略则不变。 */
  pinned?: boolean | null
  archived?: boolean | null
}

export type WorkspaceItemRemovePayload = {
  workspaceId: string
  relativePath: string
  kind: WorkspaceItemKind
  mode?: WorkspaceItemRemoveMode
}

export type WorkspaceRemovePayload = {
  workspaceId: string
  mode?: WorkspaceItemRemoveMode
}

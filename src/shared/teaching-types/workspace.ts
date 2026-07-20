import type { AgentChatMessage, AgentConversationSummary } from './agent'
import type { TeachingWorkspaceChangeSummary } from './changes'
import type { TeachingGitWorkspaceInfo } from './git'
import type {
  LearningOutcomeRef,
  LearningSessionConversationRef,
  LearningSessionCourseRef,
  LearningSessionLessonRef
} from './learning-session'

export type WorkspaceView = 'overview' | 'lessons' | 'agent' | 'resources' | 'workbench' | 'review' | 'settings'

export type WorkflowStepState = 'done' | 'active' | 'waiting' | 'error'

/** UI-facing workspace grant for Agent file-tool access. */
export type AgentWorkspaceTrustState = 'trusted' | 'untrusted'

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

/** Existing catalog/UI shape retained until SX-P0-INTEGRATE migrates callers. */
export type TeachingSessionSummary = {
  id: string
  name: string
  relativePath: string
  absolutePath: string
  lesson: LessonSummary
}

type LearningSessionTeachingSummaryBase = {
  id: string
  workspaceId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  courseRef: LearningSessionCourseRef
  lessonRef: LearningSessionLessonRef | null
  conversationRefs: LearningSessionConversationRef[]
  version: number
  eventCount: number
  outcomeRef: LearningOutcomeRef | null
}

export type CanonicalTeachingSessionSummary = LearningSessionTeachingSummaryBase & {
  kind: 'canonical_learning_session'
  source: 'canonical'
  status: 'active' | 'completed'
  readOnly: false
  workspaceId: string
}

export type LegacyTeachingSessionProjectionSummary = LearningSessionTeachingSummaryBase & {
  kind: 'legacy_lesson_projection'
  source: 'legacy_lesson'
  status: 'legacy_read_only'
  readOnly: true
  lessonRef: LearningSessionLessonRef
  conversationRefs: []
  version: 0
  eventCount: 0
  outcomeRef: null
  completedAt: null
}

/** Deep, discriminated Session summary; canonical Sessions never carry a LessonSummary wrapper. */
export type LearningSessionTeachingSummary =
  | CanonicalTeachingSessionSummary
  | LegacyTeachingSessionProjectionSummary

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
  /** Always projected from the fail-closed persistent workspace grant. */
  agentWorkspaceTrust: AgentWorkspaceTrustState
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
  recentChangeSummary: TeachingWorkspaceChangeSummary | null
  changeHistory?: TeachingWorkspaceChangeSummary[]
}

export type CreateWorkspacePayload = {
  name: string
  prompt: string
}

/** Direct-UI lesson generation only; agent tool path never carries actionId. */
export type GenerateLessonPayload = {
  workspaceId: string
  /** RFC 4122 UUID v4 opaque caller action identity. */
  actionId: string
  prompt: string
  courseName?: string
  messages?: AgentChatMessage[]
}

export type DirectLessonActionStatusPayload = {
  workspaceId: string
  actionId: string
}

export type DirectLessonRejectedCode = 'invalid_request' | 'workspace_unavailable' | 'not_authorized'
export type DirectLessonConflictCode =
  | 'workspace_mismatch'
  | 'operation_mismatch'
  | 'request_mismatch'
  | 'external_mutation'
  | 'receipt_corrupt'
  | 'expired'
export type DirectLessonIndeterminateCode =
  | 'provider_outcome_unknown'
  | 'publication_unprovable'
  | 'projection_unprovable'
  | 'receipt_unavailable'

export type GenerateLessonSuccessResult = {
  disposition: 'succeeded' | 'reused'
  actionId: string
  kind: 'lesson'
  state: TeachingAppState
  lesson: LessonSummary
  source: 'ai' | 'fallback'
  reason?: string
  changeSummary?: TeachingWorkspaceChangeSummary | null
}

export type GenerateLessonFailureResult =
  | { disposition: 'rejected'; actionId: string; code: DirectLessonRejectedCode }
  | { disposition: 'conflict'; actionId: string; code: DirectLessonConflictCode }
  | { disposition: 'indeterminate'; actionId: string; code: DirectLessonIndeterminateCode }

export type UpdateMissionPayload = {
  workspaceId: string
  prompt: string
  /** Renderer-generated opaque non-secret UUID for exact-retry identity. */
  actionId: string
}

/**
 * Stable public result of a mission_update action. Non-success dispositions are
 * fail-closed: the client must not treat them as success or auto-retry side effects.
 */
export type MissionMutationResult =
  | { disposition: 'completed'; state: TeachingAppState }
  | { disposition: 'reused'; state: TeachingAppState }
  | { disposition: 'conflict'; retryable: false }
  | { disposition: 'indeterminate'; retryable: false }

/** Deliberately path-free renderer command for changing Agent workspace access. */
export type SetWorkspaceTrustPayload = {
  workspaceId: string
  trust: AgentWorkspaceTrustState
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

export type ReadWorkspaceMarkdownPayload = {
  workspaceId: string
  documentPath: string
}

export type WorkspaceMarkdownDocument = {
  title: string
  relativePath: string
  absolutePath: string
  content: string
  updatedAt: string | null
}

export type SaveWorkspaceMarkdownPayload = ReadWorkspaceMarkdownPayload & {
  content: string
}

export type SaveWorkspaceMarkdownResult = {
  state: TeachingAppState
  document: WorkspaceMarkdownDocument
}

export type ImportWorkspaceResult = {
  canceled: boolean
  state: TeachingAppState | null
}

export type GenerateLessonResult = GenerateLessonSuccessResult | GenerateLessonFailureResult

export type DirectLessonActionStatus =
  | { disposition: 'in_progress'; actionId: string }
  | GenerateLessonResult

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

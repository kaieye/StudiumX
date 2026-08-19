import { create } from 'zustand'
import { classifyExternalDestination } from '../../../shared/external-destination'
import i18n from '../i18n'
import { initialWorkspaceViewFromUrl } from '../study-space'
import { readStudySnapshot, persistStudySnapshot } from '../study-space/domain'
import { applyStudyProgressionAwards } from '../study-space/study-progression'
import { dispatchStudyProgressionFacts } from '../study-space/study-progression-events'
import { appendStudyAnalyticsFacts, createStudyAnalyticsFactId } from '../views/workbench/analytics/domain/activityLedger'
import { getLocalDateKey, getLocalTimezoneOffsetMinutes, resolvedLocalTimeZone } from '../views/workbench/analytics/domain/dateRange'
import type { StudyActivityFact } from '../../../shared/teaching-types/analytics'
import {
  applySettingsSideEffects,
  emptySettings,
  normalizeRendererSettings,
  runtimeProviderLabel
} from '../workflows/settings'
import {
  activeTeachingConversationSummary,
  agentTurnsToMessages,
  type PendingAgentConversation
} from '../agent-conversation-state'
import { AgentConversationTurnRunner } from './agent-conversation-runner'
import {
  createHtmlPreviewAdapter,
  createLearningAssetReader,
  createMarkdownDocumentAdapter,
  type LearningAssetReader
} from './learning-asset-reader'
import {
  createMindMapSourceJumpAdapter,
  type MindMapSourceJumpOpenResult
} from './mind-map-source-jump'
import {
  activateWorkspaceContext,
  clearAgentConversationContext,
  clearMarkdownDocumentContext,
  clearRemovedWorkspaceContext,
  lessonToCoursePreviewFile,
  openAgentConversationContext,
  openLessonLibrary as openLessonLibraryContext,
  openPrimaryView,
  openTeachingConversation,
  openWorkspaceTeaching,
  restorePendingConversationContext,
  selectCourseFolderContext,
  type CoursePreviewFile,
  type DialogMode,
  type ResourcePreviewFile
} from './contextTransitions'
import { type LessonStyleId } from '../../../shared/lesson-styles'
import type { MindMapSourceRef } from '../../../shared/mindmap/domain/types'
import { deriveWorkspaceRemovalUiPatch } from '../../../shared/workspace-removal-state'
import {
  operationFeedback,
  type OperationFeedback,
  type OperationFeedbackError,
  type OperationFeedbackNotificationSettings,
  type OperationNotificationIntent
} from './operationFeedback'
import {
  type AgentChatMessage,
  type AgentWorkspaceTrustState,
  type AgentChatMode,
  type AgentChatImageAttachment,
  type AgentChatTurn,
  type AgentConversationBranchStatus,
  type AgentConversationLookupScope,
  type AgentConversationRecord,
  type AgentConversationSessionTree,
  type CreateTeachingMemoryPayload,
  type LessonStreamChunk,
  type LessonSummary,
  type AgentResourceLimitLayer,
  type AgentResourceLimitScope,
  type AgentResourceMeter,
  type AgentRunTerminalNotice,
  type InterruptedAgentRun,
  type ListUpstreamModelsResult,
  type ProgressSummary,
  type ProbeProviderPayload,
  type ProbeProviderResult,
  type RemoveTeachingGitWorktreePayload,
  type ReviewCard,
  type SettingsSection,
  type TeachingGitBranchesResult,
  type TeachingGitWorktreesResult,
  type TeachingMemoryDiagnostics,
  type TeachingMemoryRecord,
  type TeachingAppState,
  type TeachingRuntimeState,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type TeachingWorkspaceSummary,
  type UpdateTeachingMemoryPayload,
  type WorkspaceMarkdownDocument,
  type WorkspaceItemKind,
  type WorkspaceItemRemoveMode,
  type WorkspaceView
} from '../../../shared/teaching-types'
import {
  appendStreamingPreview,
  beginLessonGeneration,
  directLessonDonePatch,
  effectsForAgentGeneratedLessons,
  effectsForGeneratedLesson,
  failLessonGeneration,
  failStreamingLessonGeneration,
  isDirectLessonSuccessResult,
  lessonGenerationDefaultRuntime,
  streamedLessonDonePatch,
  suggestedCourseName,
  updateStreamingStatus,
  type LessonGenerationNotificationIntent
} from './lessonGenerationFlow'
import type {
  GenerateLessonPayload
} from '../../../shared/teaching-types'

export type UserError = OperationFeedbackError

export type PetOperationError = {
  id: string
  source: 'agent' | 'lesson-generation'
  sourceId?: string
  targetId?: string
  error: UserError
  createdAt: number
}

export type PetOperationResult = {
  runId: string
  resultId: string
  targetId: string
  createdAt: number
}

export type { CoursePreviewFile, DialogMode, ResourcePreviewFile } from './contextTransitions'
export { lessonToCoursePreviewFile } from './contextTransitions'

type LessonGenerationOptions = {
  prompt?: string
  messages?: AgentChatMessage[]
}

export type StoreState = {
  view: WorkspaceView
  /** The shell view active just before Settings was opened; restored on close. */
  viewBeforeSettings: WorkspaceView | null
  settingsSection: SettingsSection
  sidebarCollapsed: boolean
  loading: boolean
  generating: boolean
  lessonGenerationRunId: string | null
  agentPetNotificationResult: PetOperationResult | null
  lessonGenerationPetNotificationResult: PetOperationResult | null
  error: UserError | null
  pendingWorkspaceTrustIds: Set<string>
  petNotificationErrors: PetOperationError[]
  searchQuery: string
  taskPrompt: string
  overviewDialogMode: DialogMode
  lessonReaderOpen: boolean
  selectedCoursePreviewFile: CoursePreviewFile | null
  selectedResourcePreviewFile: ResourcePreviewFile | null
  selectedMarkdownDocument: WorkspaceMarkdownDocument | null
  markdownDraft: string
  markdownSaving: boolean
  selectedCourseRelativePath: string | null
  selectedCourseWorkspaceId: string | null
  appState: TeachingAppState
  settings: TeachingSettingsV1
  setView: (view: WorkspaceView) => void
  setOverviewDialogMode: (mode: DialogMode) => void
  openLessonLibrary: () => void
  openTeachingConversationView: () => void
  openWorkspaceTeachingMode: () => void
  selectCourseFolder: (relativePath: string | null, workspaceId?: string | null) => void
  setSettingsSection: (section: SettingsSection) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  setSearchQuery: (query: string) => void
  setTaskPrompt: (prompt: string) => void
  clearError: () => void
  initialize: () => Promise<void>
  updateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  pickDefaultRoot: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: () => Promise<void>
  importWorkspace: () => Promise<boolean>
  importWorkspacePath: (rootPath: string) => Promise<boolean>
  updateMission: () => Promise<void>
  setWorkspaceTrust: (workspaceId: string, trust: AgentWorkspaceTrustState) => Promise<boolean>
  applyLessonStyle: (styleId: LessonStyleId) => Promise<void>
  generateLesson: (options?: LessonGenerationOptions) => Promise<void>
  generateLessonStream: (options?: LessonGenerationOptions) => Promise<void>
  loadLesson: (lesson: LessonSummary) => Promise<void>
  loadCourseHtmlFile: (file: CoursePreviewFile) => Promise<void>
  loadWorkspaceMarkdownFile: (file: CoursePreviewFile, workspaceId?: string | null) => Promise<void>
  /** Open only the file-level target of a mind-map source ref; block scroll is not implied. */
  openMindMapSource: (sourceRef: MindMapSourceRef, workspaceId?: string | null) => Promise<MindMapSourceJumpOpenResult | { ok: false; reason: 'workspace_unavailable' }>
  setMarkdownDraft: (content: string) => void
  saveMarkdownDocument: () => Promise<void>
  openResourceHtmlPreview: (file: ResourcePreviewFile) => void
  closeResourceHtmlPreview: () => void
  openPath: (path: string) => Promise<void>
  openImportLocation: (path?: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  showNotification: (title: string, body: string) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  listGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  removeGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<void>
  listMemory: (workspaceRoot?: string) => Promise<void>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<boolean>
  updateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<boolean>
  deleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  loadMemoryDiagnostics: () => Promise<void>
  loadReviewCards: () => Promise<void>
  recordProgress: (lessonId: string, results: Array<{ lessonId: string; question: string; correct: boolean }>) => Promise<void>
  reviewCards: ReviewCard[]
  progress: ProgressSummary | null
  memoryRecords: TeachingMemoryRecord[]
  memoryDiagnostics: TeachingMemoryDiagnostics | null
  agentTurns: AgentChatTurn[]
  activeConversationId: string | null
  activeConversationScope: AgentConversationLookupScope | null
  activeConversationRevision: number | null
  activeSessionTree: AgentConversationSessionTree | null
  agentChatBusy: boolean
  agentBusyAckMessage: string | null
  agentBusyFollowUpQueue: Array<{ text: string; mode?: AgentChatMode; skillIds?: string[]; imageAttachments?: AgentChatImageAttachment[] }>
  agentStatus: string
  agentInput: string
  agentInputHistory: string[]
  agentToolsSupported: boolean | null
  pendingAgentConversation: PendingAgentConversation | null
  gitBranchesRoot: string
  gitBranchesResult: TeachingGitBranchesResult | null
  gitBranchesLoading: boolean
  setAgentInput: (input: string) => void
  rememberAgentInput: (input: string) => void
  clearAgentChat: () => void
  cancelAgentChat: () => Promise<void>
  restorePendingAgentConversation: () => void
  loadGitBranches: (workspaceRoot: string, options?: { force?: boolean }) => Promise<void>
  setGitBranchesResult: (workspaceRoot: string, result: TeachingGitBranchesResult) => void
  loadAgentConversation: (conversationId: string, workspaceId?: string | null, scope?: AgentConversationLookupScope) => Promise<void>
  openAgentConversationBranch: (conversationId: string) => Promise<void>
  forkAgentConversationBranch: (conversationId: string, sourceTurnId: string | undefined, expectedRevision: number) => Promise<boolean>
  replayAgentConversationBranch: (conversationId?: string, sourceTurnId?: string) => Promise<AgentChatTurn[] | null>
  updateAgentConversationBranchStatus: (conversationId: string, status: AgentConversationBranchStatus, expectedRevision: number) => Promise<void>
  renameAgentConversation: (payload: { workspaceId?: string | null; conversationId: string; title: string; scope: AgentConversationLookupScope; expectedRevision?: number }) => Promise<void>
  agentChat: (inputOverride?: string, options?: { mode?: AgentChatMode; skillIds?: string[]; imageAttachments?: AgentChatImageAttachment[] }) => Promise<void>
  setWorkspaceItemMeta: (payload: { workspaceId?: string | null; relativePath: string; pinned?: boolean | null; archived?: boolean | null }) => Promise<void>
  removeWorkspaceItem: (payload: { workspaceId?: string | null; relativePath: string; kind: WorkspaceItemKind; mode?: WorkspaceItemRemoveMode }) => Promise<void>
  removeWorkspace: (payload: { workspaceId: string; mode?: WorkspaceItemRemoveMode }) => Promise<void>
}


// ================================================================
// Defaults
// ================================================================

const defaultRuntime: TeachingRuntimeState = lessonGenerationDefaultRuntime

const emptyAppState: TeachingAppState = {
  workspaces: [],
  activeWorkspace: null,
  temporaryConversations: [],
  previewHtml: '',
  previewUrl: '',
  selectedLessonPath: null,
  runtime: defaultRuntime,
  recentChangeSummary: null,
  changeHistory: []
}

const defaultPrompt = ''

const nextPrompt = '基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'

// ================================================================
// Operation feedback seam
// ================================================================

function operationFeedbackTranslate(key: string, interpolation?: Record<string, unknown>): string {
  return i18n.t(key, interpolation)
}

function isConversationRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('conversation branch revision conflict')
}

async function refreshConversationAfterRevisionConflict(input: {
  get: () => StoreState
  set: (patch: Partial<StoreState>) => void
  workspaceId: string
  conversationId: string
  scope: AgentConversationLookupScope
}): Promise<void> {
  const api = window.teachingSystem
  if (!api) return
  try {
    const workspace = input.get().appState.workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) return
    const tree = await api.readAgentConversationSessionTree({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      scope: input.scope
    })
    const branch = tree.branches.find((item) => item.conversationId === input.conversationId)
    if (!branch) return
    const refreshed = branch.status === 'active'
      ? await api.openAgentConversationBranch({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          scope: input.scope
        })
      : {
          conversation: await api.readAgentConversation({
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            scope: input.scope
          }),
          tree
        }
    if (input.get().appState.activeWorkspace?.id !== input.workspaceId) return
    const refreshedBranch = refreshed.tree.branches.find((item) => item.conversationId === refreshed.conversation.id)
    input.set({
      ...openAgentConversationContext({
        conversation: refreshed.conversation,
        workspaceId: input.workspaceId,
        appState: input.get().appState,
        currentOverviewDialogMode: input.get().overviewDialogMode,
        currentTaskPrompt: input.get().taskPrompt
      }),
      activeConversationScope: input.scope,
      activeConversationRevision: refreshed.conversation.branch?.revision ?? refreshedBranch?.revision ?? branch.revision,
      activeSessionTree: refreshed.tree,
      agentChatBusy: false,
      pendingAgentConversation: null,
      agentBusyFollowUpQueue: [],
      agentBusyAckMessage: null
    })
  } catch {
    // Best effort only. CAS conflicts are intentionally non-disruptive; a later
    // open still loads the durable canonical projection.
  }
}

function notificationSettings(settings: TeachingSettingsV1): OperationFeedbackNotificationSettings {
  return {
    enabled: settings.notifications.enabled,
    errors: settings.notifications.errors,
    lessonGenerated: settings.notifications.lessonGenerated,
    workspaceImported: settings.notifications.workspaceImported
  }
}

function deliverOperationNotification(
  notification: OperationNotificationIntent,
  deliver: (title: string, body: string) => Promise<void>
): void {
  if (notification.kind === 'workspace-imported') {
    void deliver(
      i18n.t('notify.imported.title'),
      i18n.t('notify.imported.body', { name: notification.workspaceName })
    )
    return
  }
  if (notification.kind === 'workspace-import-failed') {
    void deliver(i18n.t('notify.importFailed.title'), notification.message)
    return
  }
  if (notification.kind === 'lesson-generation-failed') {
    void deliver(i18n.t('notify.generateFailed.title'), notification.message)
    return
  }
  const suffix = notification.source === 'fallback'
    ? (notification.reason
        ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: notification.reason })
        : i18n.t('notify.lessonGenerated.fallbackNoReason'))
    : ''
  void deliver(
    i18n.t('notify.lessonGenerated.title'),
    i18n.t('notify.lessonGenerated.body', {
      title: notification.title,
      path: notification.path,
      suffix
    })
  )
}

function deliverOperationFeedback(
  feedback: OperationFeedback,
  deliver: (title: string, body: string) => Promise<void>
): void {
  if (feedback.notification) deliverOperationNotification(feedback.notification, deliver)
}


const MISSION_ACTION_STORAGE_PREFIX = 'studiumx:mission-action:'

type PendingMissionAction = {
  actionId: string
  prompt: string
  createdAt: number
}

const MISSION_ACTION_RETRY_WINDOW_MS = 60 * 60 * 1000

function missionActionStorageKey(workspaceId: string): string {
  return `${MISSION_ACTION_STORAGE_PREFIX}${workspaceId}`
}

function readPendingMissionAction(workspaceId: string): PendingMissionAction | null {
  try {
    const raw = sessionStorage.getItem(missionActionStorageKey(workspaceId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingMissionAction
    if (
      !parsed ||
      typeof parsed.actionId !== 'string' ||
      typeof parsed.prompt !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function resolveMissionActionId(workspaceId: string, prompt: string): string {
  const existing = readPendingMissionAction(workspaceId)
  const now = Date.now()
  if (
    existing &&
    existing.prompt === prompt &&
    now - existing.createdAt < MISSION_ACTION_RETRY_WINDOW_MS &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing.actionId)
  ) {
    return existing.actionId.toLowerCase()
  }
  const actionId = crypto.randomUUID().toLowerCase()
  try {
    sessionStorage.setItem(
      missionActionStorageKey(workspaceId),
      JSON.stringify({ actionId, prompt, createdAt: now } satisfies PendingMissionAction)
    )
  } catch {
    // sessionStorage may be unavailable; still proceed with a fresh in-memory id.
  }
  return actionId
}

function clearMissionActionId(workspaceId: string): void {
  try {
    sessionStorage.removeItem(missionActionStorageKey(workspaceId))
  } catch {
    // ignore
  }
}


// ================================================================
// Direct-UI lesson actionId lifecycle (ADR-0002)
// ================================================================

const DIRECT_LESSON_ACTION_STORAGE_PREFIX = 'studiumx:direct-lesson-action:'
const DIRECT_LESSON_OPERATION = 'direct_ui_lesson_generation/v1'
const DIRECT_LESSON_ACTION_RETRY_WINDOW_MS = 60 * 60 * 1000
const RFC4122_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PendingDirectLessonActionMarker = {
  workspaceId: string
  actionId: string
  operation: typeof DIRECT_LESSON_OPERATION
  createdAt: number
}

/** In-memory only: exact-payload match for lost-response retry. Never written to storage. */
type PendingDirectLessonActionMemory = PendingDirectLessonActionMarker & {
  payloadKey: string
}

const pendingDirectLessonActions = new Map<string, PendingDirectLessonActionMemory>()

function directLessonActionStorageKey(workspaceId: string): string {
  return `${DIRECT_LESSON_ACTION_STORAGE_PREFIX}${workspaceId}`
}

function createDirectLessonActionId(): string {
  // crypto.randomUUID is RFC 4122 v4 in modern Chromium/Electron.
  return crypto.randomUUID().toLowerCase()
}

/**
 * Canonical key for in-memory exact-payload retry only.
 * Not a content-dedupe key across actionIds and never persisted.
 */
export function directLessonPayloadKey(input: {
  workspaceId: string
  prompt: string
  courseName?: string
  messages: Array<{
    role: string
    content: string | null
    toolCallId?: string
    toolCalls?: Array<{ id: string; name: string; arguments: string }>
  }>
}): string {
  const messages = input.messages.map((message) => {
    const entry: Record<string, unknown> = {
      role: message.role,
      content: message.content === null ? null : message.content
    }
    if (message.toolCallId !== undefined) entry.toolCallId = message.toolCallId
    if (message.toolCalls !== undefined) {
      entry.toolCalls = message.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments
      }))
    }
    return entry
  })
  return JSON.stringify({
    operation: DIRECT_LESSON_OPERATION,
    workspaceId: input.workspaceId,
    prompt: input.prompt,
    courseName: input.courseName ?? null,
    messages
  })
}

function readPendingDirectLessonMarker(workspaceId: string): PendingDirectLessonActionMarker | null {
  try {
    const raw = sessionStorage.getItem(directLessonActionStorageKey(workspaceId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingDirectLessonActionMarker
    if (
      !parsed ||
      parsed.workspaceId !== workspaceId ||
      parsed.operation !== DIRECT_LESSON_OPERATION ||
      typeof parsed.actionId !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      !RFC4122_UUID_V4.test(parsed.actionId)
    ) {
      return null
    }
    return {
      workspaceId,
      actionId: parsed.actionId.toLowerCase(),
      operation: DIRECT_LESSON_OPERATION,
      createdAt: parsed.createdAt
    }
  } catch {
    return null
  }
}

function writePendingDirectLessonMarker(marker: PendingDirectLessonActionMarker): void {
  try {
    sessionStorage.setItem(
      directLessonActionStorageKey(marker.workspaceId),
      JSON.stringify({
        workspaceId: marker.workspaceId,
        actionId: marker.actionId,
        operation: marker.operation,
        createdAt: marker.createdAt
      } satisfies PendingDirectLessonActionMarker)
    )
  } catch {
    // sessionStorage may be unavailable; in-memory pending still works for lost-response.
  }
}

export function clearDirectLessonActionId(workspaceId: string): void {
  pendingDirectLessonActions.delete(workspaceId)
  try {
    sessionStorage.removeItem(directLessonActionStorageKey(workspaceId))
  } catch {
    // ignore
  }
}

/**
 * Resolve actionId for an explicit generate submit.
 * - New user confirm / payload change / prior conflict|indeterminate -> new UUID v4
 * - Same UI instance exact payload lost-response retry -> reuse in-memory pending id
 * - sessionStorage holds only {workspaceId, actionId, operation} for reload status poll
 */
export function resolveDirectLessonActionId(input: {
  workspaceId: string
  prompt: string
  courseName?: string
  messages: GenerateLessonPayload['messages']
  forceNew?: boolean
}): string {
  const now = Date.now()
  const payloadKey = directLessonPayloadKey({
    workspaceId: input.workspaceId,
    prompt: input.prompt,
    courseName: input.courseName,
    messages: (input.messages ?? []).map((message) => ({
      role: message.role,
      content: message.content ?? null,
      ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
      ...(message.toolCalls !== undefined
        ? {
            toolCalls: message.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              arguments: call.arguments
            }))
          }
        : {})
    }))
  })

  if (!input.forceNew) {
    const memory = pendingDirectLessonActions.get(input.workspaceId)
    if (
      memory &&
      memory.payloadKey === payloadKey &&
      now - memory.createdAt < DIRECT_LESSON_ACTION_RETRY_WINDOW_MS &&
      RFC4122_UUID_V4.test(memory.actionId)
    ) {
      writePendingDirectLessonMarker({
        workspaceId: memory.workspaceId,
        actionId: memory.actionId,
        operation: DIRECT_LESSON_OPERATION,
        createdAt: memory.createdAt
      })
      return memory.actionId
    }
  }

  const actionId = createDirectLessonActionId()
  const marker: PendingDirectLessonActionMemory = {
    workspaceId: input.workspaceId,
    actionId,
    operation: DIRECT_LESSON_OPERATION,
    createdAt: now,
    payloadKey
  }
  pendingDirectLessonActions.set(input.workspaceId, marker)
  writePendingDirectLessonMarker(marker)
  return actionId
}

function directLessonDispositionError(
  disposition: 'rejected' | 'conflict' | 'indeterminate',
  code?: string
): UserError {
  const key =
    disposition === 'conflict'
      ? 'errors.directLessonActionConflict'
      : disposition === 'indeterminate'
        ? 'errors.directLessonActionIndeterminate'
        : 'errors.directLessonActionRejected'
  return {
    message: i18n.t(`${key}.message`),
    severity: disposition === 'rejected' ? 'error' : 'warning',
    detail: i18n.t(`${key}.detail`, { code: code ?? disposition })
  }
}

export function toUserError(error: unknown): UserError {
  const feedback = operationFeedback({
    outcome: 'failure',
    error,
    translate: operationFeedbackTranslate
  })
  if (!feedback.visibleError) throw new Error('Operation feedback must classify failures.')
  return feedback.visibleError
}

// ================================================================
// Zustand Store
// ================================================================

const AGENT_INPUT_HISTORY_STORAGE_KEY = 'studiumx:agent-input-history'
const MAX_AGENT_INPUT_HISTORY = 20

function appendAgentInputHistory(history: string[], input: string): string[] {
  const value = input.trim()
  if (!value) return history
  const withoutCurrent = history.filter((item) => item !== value)
  return [...withoutCurrent, value].slice(-MAX_AGENT_INPUT_HISTORY)
}

export function mergeAgentInputHistory(...sources: Array<string[] | undefined>): string[] {
  return sources.flat().reduce<string[]>((history, input) => appendAgentInputHistory(history, input ?? ''), [])
}

function normalizeAgentInputHistory(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.reduce<string[]>((history, item) => {
    if (typeof item !== 'string') return history
    return appendAgentInputHistory(history, item)
  }, [])
}

function readPersistedAgentInputHistory(): string[] {
  try {
    const stored = window.localStorage.getItem(AGENT_INPUT_HISTORY_STORAGE_KEY)
    if (!stored) return []
    const history = normalizeAgentInputHistory(JSON.parse(stored))
    window.localStorage.setItem(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(history))
    return history
  } catch {
    return []
  }
}

function persistAgentInputHistory(history: string[]): void {
  try {
    window.localStorage.setItem(
      AGENT_INPUT_HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(-MAX_AGENT_INPUT_HISTORY))
    )
  } catch {
    // Input history is a convenience feature; storage failures should not block sending.
  }
}

function lessonEffectSettings(settings: TeachingSettingsV1) {
  return {
    autoOpenGeneratedLesson: settings.workspace.autoOpenGeneratedLesson,
    notificationsEnabled: settings.notifications.enabled,
    lessonGeneratedNotifications: settings.notifications.lessonGenerated
  }
}

function lessonGeneratedNotificationBody(intent: LessonGenerationNotificationIntent): string {
  const suffix = intent.source === 'fallback'
    ? (intent.reason
        ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: intent.reason })
        : i18n.t('notify.lessonGenerated.fallbackNoReason'))
    : ''
  return i18n.t('notify.lessonGenerated.body', { title: intent.title, path: intent.path, suffix })
}

function clearPetOperationErrors(
  errors: PetOperationError[],
  source: PetOperationError['source']
): PetOperationError[] {
  return errors.filter((error) => error.source !== source)
}

function recordPetOperationError(
  errors: PetOperationError[],
  input: Omit<PetOperationError, 'id' | 'createdAt'>,
  now = Date.now()
): PetOperationError[] {
  const sourceId = input.sourceId?.trim() || `lifecycle-${now}`
  const next: PetOperationError = {
    ...input,
    sourceId,
    id: `${input.source}:${sourceId}:failed:${now}`,
    createdAt: now
  }
  return [...clearPetOperationErrors(errors, input.source), next]
}

let petOperationSequence = 0
let agentRunSeed = 0

function nextPetOperationSequence(): number {
  petOperationSequence += 1
  return petOperationSequence
}

function nextAgentRunSeed(now = Date.now()): number {
  agentRunSeed = Math.max(agentRunSeed + 1, now)
  return agentRunSeed
}

function lessonGenerationRunId(workspaceId: string, now = Date.now()): string {
  return `${workspaceId}:${now}:${nextPetOperationSequence()}`
}

function createAgentConversationTurnRunner(
  get: () => StoreState,
  set: (patch: Partial<StoreState>) => void
): AgentConversationTurnRunner<UserError> {
  return new AgentConversationTurnRunner({
    getState: get,
    setState: (patch) => {
      const current = get()
      const sourceId = patch.pendingAgentConversation?.summary.id
        ?? current.pendingAgentConversation?.summary.id
        ?? current.activeConversationId
        ?? undefined
      const targetId = current.pendingAgentConversation?.summary.id
        ?? current.activeConversationId
        ?? undefined
      set({
        ...patch,
        ...(patch.agentChatBusy === true
          ? {
              error: null,
              agentPetNotificationResult: null,
              petNotificationErrors: clearPetOperationErrors(current.petNotificationErrors, 'agent')
            }
          : {}),
        ...(patch.error
          ? {
              petNotificationErrors: recordPetOperationError(current.petNotificationErrors, {
                source: 'agent',
                sourceId,
                targetId,
                error: patch.error
              })
            }
          : {})
      })
    },
    getApi: () => window.teachingSystem,
    toUserError,
    onGeneratedLessons: (lessons) => {
      const effects = effectsForAgentGeneratedLessons({
        lessons,
        settings: lessonEffectSettings(get().settings)
      })
      if (effects.openPath) void get().openPath(effects.openPath)
      if (effects.lessonGeneratedNotification) {
        void get().showNotification(
          i18n.t('notify.lessonGenerated.title'),
          lessonGeneratedNotificationBody(effects.lessonGeneratedNotification)
        )
      }
    },
    onRevisionConflict: async ({ workspaceId, conversationId, scope }) => {
      await refreshConversationAfterRevisionConflict({ get, set, workspaceId, conversationId, scope })
    },
    onCompletedTurn: ({ runId, conversationId }) => {
      set({
        agentPetNotificationResult: {
          runId,
          resultId: `${runId}:${conversationId}`,
          targetId: conversationId,
          createdAt: Date.now()
        }
      })
    },
    nextIdSeed: nextAgentRunSeed
  })
}

export const useAppStore = create<StoreState>((set, get) => {
  let learningAssetReader: LearningAssetReader | null = null
  let agentConversationTurnRunner: AgentConversationTurnRunner<UserError> | null = null
  // Settings controls can emit updates on every keystroke. Serialize their IPC
  // writes and corresponding state read-backs so an older response cannot win
  // the race against a newer setting value.
  let settingsUpdateQueue: Promise<void> = Promise.resolve()
  const enqueueSettingsUpdate = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = settingsUpdateQueue.then(operation, operation)
    settingsUpdateQueue = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }
  const getAgentConversationTurnRunner = (): AgentConversationTurnRunner<UserError> => {
    agentConversationTurnRunner ??= createAgentConversationTurnRunner(get, set)
    return agentConversationTurnRunner
  }

  const getLearningAssetReader = (): LearningAssetReader => {
    const api = window.teachingSystem
    learningAssetReader ??= createLearningAssetReader({
      htmlPreview: api ? createHtmlPreviewAdapter(api) : null,
      markdownDocument: api ? createMarkdownDocumentAdapter(api) : null,
      port: {
        getSnapshot: () => {
          const state = get()
          return {
            appState: state.appState,
            lessonReaderOpen: state.lessonReaderOpen,
            selectedCoursePreviewFile: state.selectedCoursePreviewFile,
            selectedResourcePreviewFile: state.selectedResourcePreviewFile,
            selectedMarkdownDocument: state.selectedMarkdownDocument,
            markdownDraft: state.markdownDraft,
            markdownSaving: state.markdownSaving,
            selectedCourseWorkspaceId: state.selectedCourseWorkspaceId
          }
        },
        applyPatch: (patch) => set({
          ...patch,
          ...(patch.activeConversationId === null
            ? { activeConversationScope: null, activeConversationRevision: null, activeSessionTree: null }
            : {})
        }),
        toError: toUserError,
        loadingPreviewHtml,
        emptyPreviewHtml
      }
    })
    return learningAssetReader
  }

  return ({
  view: initialWorkspaceViewFromUrl(),
  viewBeforeSettings: null,
  settingsSection: 'general',
  sidebarCollapsed: false,
  loading: true,
  generating: false,
  lessonGenerationRunId: null,
  agentPetNotificationResult: null,
  lessonGenerationPetNotificationResult: null,
  error: null,
  pendingWorkspaceTrustIds: new Set(),
  petNotificationErrors: [],
  searchQuery: '',
  taskPrompt: defaultPrompt,
  overviewDialogMode: 'chat',
  lessonReaderOpen: false,
  selectedCoursePreviewFile: null,
  selectedResourcePreviewFile: null,
  selectedMarkdownDocument: null,
  markdownDraft: '',
  markdownSaving: false,
  selectedCourseRelativePath: null,
  selectedCourseWorkspaceId: null,
  appState: emptyAppState,
  settings: emptySettings,
  reviewCards: [],
  progress: null,
  memoryRecords: [],
  memoryDiagnostics: null,
  agentTurns: [],
  activeConversationId: null,
  activeConversationScope: null,
  activeConversationRevision: null,
  activeSessionTree: null,
  agentChatBusy: false,
  agentBusyAckMessage: null,
  agentBusyFollowUpQueue: [],
  agentStatus: '',
  agentInput: '',
  agentInputHistory: readPersistedAgentInputHistory(),
  agentToolsSupported: null,
  pendingAgentConversation: null,
  gitBranchesRoot: '',
  gitBranchesResult: null,
  gitBranchesLoading: false,
  setAgentInput: (agentInput) => set({ agentInput }),
  rememberAgentInput: (input) => {
    const nextHistory = appendAgentInputHistory(get().agentInputHistory, input)
    set({ agentInputHistory: nextHistory })
    persistAgentInputHistory(nextHistory)
  },
  clearAgentChat: () => {
    if (get().agentChatBusy && get().pendingAgentConversation) {
      set({ agentTurns: [], activeConversationId: null, activeConversationScope: null, activeConversationRevision: null, activeSessionTree: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentBusyAckMessage: null, agentBusyFollowUpQueue: [] })
      return
    }
    set({ agentTurns: [], activeConversationId: null, activeConversationScope: null, activeConversationRevision: null, activeSessionTree: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentChatBusy: false, pendingAgentConversation: null, agentBusyAckMessage: null, agentBusyFollowUpQueue: [] })
  },
  cancelAgentChat: async () => {
    await getAgentConversationTurnRunner().cancel()
  },
  restorePendingAgentConversation: () => {
    const pending = get().pendingAgentConversation
    if (!pending) return
    set(restorePendingConversationContext(pending, get().overviewDialogMode))
  },
  loadGitBranches: async (workspaceRoot, options) => {
    const root = workspaceRoot.trim()
    const api = window.teachingSystem
    if (!root || !api) {
      set({ gitBranchesRoot: '', gitBranchesResult: null, gitBranchesLoading: false })
      return
    }
    const current = get()
    if (!options?.force && current.gitBranchesRoot === root && (current.gitBranchesResult || current.gitBranchesLoading)) return

    set({
      gitBranchesRoot: root,
      gitBranchesLoading: true,
      ...(current.gitBranchesRoot === root ? {} : { gitBranchesResult: null })
    })
    try {
      const result = await api.listGitBranches(root)
      if (get().gitBranchesRoot === root) {
        set({ gitBranchesResult: result, gitBranchesLoading: false })
      }
    } catch (error) {
      if (get().gitBranchesRoot === root) {
        set({ gitBranchesLoading: false, error: toUserError(error) })
      }
    }
  },
  setGitBranchesResult: (workspaceRoot, gitBranchesResult) => {
    const root = workspaceRoot.trim()
    set({ gitBranchesRoot: root, gitBranchesResult, gitBranchesLoading: false })
  },
  setView: (view) => {
    const current = get()
    const patch = openPrimaryView(view, current.appState)
    const clearsSelection = patch.activeConversationId === null
    const preservePending = clearsSelection && Boolean(current.agentChatBusy && current.pendingAgentConversation)
    set({
      ...patch,
      ...(clearsSelection
        ? {
            activeConversationScope: null,
            activeConversationRevision: null,
            activeSessionTree: null,
            ...(preservePending
              ? {
                  pendingAgentConversation: current.pendingAgentConversation,
                  agentChatBusy: true
                }
              : {
                  // Only drop pending when no run is in flight.
                  pendingAgentConversation: null,
                  agentChatBusy: false
                })
          }
        : {})
    })
    if (view === 'review') void get().loadReviewCards()
  },
  setOverviewDialogMode: (overviewDialogMode) => set({ overviewDialogMode }),
  openLessonLibrary: () => set(openLessonLibraryContext()),
  openTeachingConversationView: () => set(openTeachingConversation()),
  openWorkspaceTeachingMode: () => {
    // Top-nav "新对话" / workspace-folder entry: exclusive clean teaching chrome.
    // Do not abort an in-flight run; keep pending so the sidebar can restore it.
    const current = get()
    const preservePending = Boolean(current.agentChatBusy && current.pendingAgentConversation)
    set({
      ...openWorkspaceTeaching(current.appState),
      ...(preservePending
        ? {
            pendingAgentConversation: current.pendingAgentConversation,
            agentChatBusy: true
          }
        : {
            pendingAgentConversation: null,
            agentChatBusy: false
          }),
      activeConversationScope: null,
      activeConversationRevision: null,
      activeSessionTree: null
    })
  },
  selectCourseFolder: (selectedCourseRelativePath, workspaceId) => {
    const targetWorkspace = workspaceId
      ? get().appState.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
      : get().appState.activeWorkspace
    const patch = selectCourseFolderContext({
      selectedCourseRelativePath,
      workspaceId,
      targetWorkspace,
      pendingAgentConversation: get().pendingAgentConversation
    })
    set({
      ...patch,
      ...(patch.activeConversationId === null
        ? { activeConversationScope: null, activeConversationRevision: null, activeSessionTree: null }
        : {})
    })
  },
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  openSettings: (section = 'general') => {
    const current = get()
    const preservePending = Boolean(current.agentChatBusy && current.pendingAgentConversation)
    set({
      ...openPrimaryView('settings', current.appState),
      settingsSection: section,
      // Remember the shell view so closing Settings returns where the user was,
      // instead of always jumping back to the conversation/home page.
      ...(current.view !== 'settings' ? { viewBeforeSettings: current.view } : {}),
      activeConversationScope: null,
      activeConversationRevision: null,
      activeSessionTree: null,
      ...(preservePending
        ? {
            pendingAgentConversation: current.pendingAgentConversation,
            agentChatBusy: true
          }
        : {
            pendingAgentConversation: null,
            agentChatBusy: false
          })
    })
  },
  closeSettings: () => {
    const current = get()
    const target = current.viewBeforeSettings ?? 'overview'
    set({
      viewBeforeSettings: null,
      settingsSection: 'general',
      ...openPrimaryView(target, current.appState)
    })
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setTaskPrompt: (taskPrompt) => set({ taskPrompt }),
  clearError: () => set({ error: null, petNotificationErrors: [] }),
  initialize: async () => {
    set({ loading: true, error: null })
    const api = window.teachingSystem
    if (!api) {
      console.warn('[StudiumX] preload API is not available; renderer is running without window.teachingSystem.')
      set({ loading: false, error: null })
      return
    }
    try {
      const [state, rawSettings, interruptedRuns, terminalNotices] = await Promise.all([
        api.getState(),
        api.getSettings(),
        api.listInterruptedAgentRuns(),
        // Defensive compatibility for an older preload during a desktop upgrade.
        api.listTerminalAgentRunNotices?.() ?? []
      ])
      const settings = normalizeRendererSettings(rawSettings)
      applySettingsSideEffects(settings)
      // Startup recovery must never resurrect a conversation the user removed
      // from the list (archived): a durable interrupted/terminal run notice for
      // such a conversation would otherwise reload its content on every launch.
      const visibleConversationIds = new Set<string>([
        ...state.temporaryConversations.map((conversation) => conversation.id),
        ...state.workspaces.flatMap((workspace) => workspace.conversations.map((conversation) => conversation.id))
      ])
      const durableNoticesInCurrentWorkspace = [...interruptedRuns, ...terminalNotices]
        .filter((run) => state.activeWorkspace
          ? run.workspaceId === state.activeWorkspace.id
          : !run.workspaceId)
        .filter((run) => !run.conversationId || visibleConversationIds.has(run.conversationId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      // Open only the newest record; all remaining durable notices remain explicitly counted for review.
      const durableNotice = durableNoticesInCurrentWorkspace[0]
      let recoveryConversation: AgentConversationRecord | null = null
      let recoveryConversationScope: AgentConversationLookupScope | null = null
      let recoverySessionTree: AgentConversationSessionTree | null = null
      if (durableNotice?.workspaceId && durableNotice.conversationId) {
        const [workspaceConversation, temporaryConversation] = await Promise.all([
          api.readAgentConversation({
            workspaceId: durableNotice.workspaceId,
            conversationId: durableNotice.conversationId,
            scope: 'workspace'
          }).catch(() => null),
          api.readAgentConversation({
            workspaceId: durableNotice.workspaceId,
            conversationId: durableNotice.conversationId,
            scope: 'temporary'
          }).catch(() => null)
        ])
        if (Boolean(workspaceConversation) !== Boolean(temporaryConversation)) {
          recoveryConversation = workspaceConversation ?? temporaryConversation
          recoveryConversationScope = workspaceConversation ? 'workspace' : 'temporary'
        }
        if (recoveryConversation && recoveryConversationScope) {
          recoverySessionTree = await api.readAgentConversationSessionTree({
            workspaceId: durableNotice.workspaceId,
            conversationId: durableNotice.conversationId,
            scope: recoveryConversationScope
          }).catch(() => null)
        }
      }
      const recoveryTurns = durableNotice
        ? [...(recoveryConversation?.turns ?? []), durableAgentRunNotice(durableNotice, durableNoticesInCurrentWorkspace.length)]
        : []
      set({
        appState: state,
        settings,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false,
        agentTurns: recoveryTurns,
        activeConversationId: durableNotice?.conversationId ?? null,
        activeConversationScope: recoveryConversationScope,
        activeConversationRevision: recoveryConversation?.branch?.revision ?? (recoveryConversation ? 0 : null),
        activeSessionTree: recoverySessionTree,
        agentStatus: durableNotice
          ? durableNotice.status === 'interrupted'
            ? '上次运行已中断，需要人工确认；不会自动继续或重做。'
            : '上次运行已到达终态边界；不会自动继续或重放。请开始新的明确回合。'
          : '',
        agentChatBusy: false,
        agentBusyAckMessage: null,
        agentBusyFollowUpQueue: [],
        pendingAgentConversation: null
      })
      // Reload recovery: status poll only (workspaceId + actionId). Never auto-resubmit or reattach streams.
      const activeWorkspaceId = state.activeWorkspace?.id
      if (activeWorkspaceId) {
        const pending = readPendingDirectLessonMarker(activeWorkspaceId)
        if (pending) {
          try {
            const status = await api.getDirectLessonActionStatus({
              workspaceId: activeWorkspaceId,
              actionId: pending.actionId
            })
            if (status.disposition === 'in_progress') {
              set({
                generating: true,
                appState: {
                  ...get().appState,
                  runtime: {
                    ...get().appState.runtime,
                    status: 'working',
                    currentStep: 'recovering prior lesson generation',
                    queuedTasks: 1
                  }
                }
              })
            } else if (isDirectLessonSuccessResult(status)) {
              clearDirectLessonActionId(activeWorkspaceId)
              set({
                ...directLessonDonePatch({
                  result: status,
                  workspaceId: activeWorkspaceId,
                  nextPrompt
                }),
                generating: false
              })
            } else {
              clearDirectLessonActionId(activeWorkspaceId)
              set({
                generating: false,
                error: directLessonDispositionError(status.disposition, status.code)
              })
            }
          } catch {
            // Keep marker for a later explicit status poll / exact retry; never auto regenerate.
          }
        }
      }
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  updateSettings: async (patch) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const settings = normalizeRendererSettings(await enqueueSettingsUpdate(() => api.updateSettings(patch)))
      applySettingsSideEffects(settings)
      set({ settings, error: null })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  pickDefaultRoot: async () => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const currentPath = get().settings.workspace.defaultRoot
      const result = await api.pickDirectory(currentPath)
      if (result.canceled || !result.path) return
      await get().updateSettings({ workspace: { defaultRoot: result.path } })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  selectWorkspace: async (workspaceId) => {
    const api = window.teachingSystem
    if (!api) return
    set({ loading: true, error: null })
    try {
      const state = await api.selectWorkspace(workspaceId)
      set({
        ...activateWorkspaceContext({
          appState: state,
          taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
          loading: false
        }),
        activeConversationScope: null,
        activeConversationRevision: null,
        activeSessionTree: null
      })
      void get().loadReviewCards()
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  createWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return
    const name = window.prompt(i18n.t('dialogs.createNameTitle'), i18n.t('dialogs.createNameDefault'))
    if (!name) return
    const prompt = window.prompt(i18n.t('dialogs.createMissionTitle'), i18n.t('dialogs.createMissionDefault', { name }))
    if (!prompt) return
    set({ loading: true, error: null })
    try {
      const state = await api.createWorkspace({ name, prompt })
      set({
        ...activateWorkspaceContext({
          appState: state,
          taskPrompt: defaultPrompt,
          loading: false
        }),
        activeConversationScope: null,
        activeConversationRevision: null,
        activeSessionTree: null
      })
      void get().loadReviewCards()
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  importWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return false
    set({ loading: true, error: null })
    try {
      const result = await api.importWorkspace()
      if (result.canceled || !result.state) {
        set({ loading: false })
        return false
      }
      set({
        ...activateWorkspaceContext({
          appState: result.state,
          taskPrompt: result.state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
          loading: false
        }),
        activeConversationScope: null,
        activeConversationRevision: null,
        activeSessionTree: null
      })
      void get().loadReviewCards()
      const settings = get().settings
      const feedback = operationFeedback({
        outcome: 'workspace-imported',
        workspaceName: result.state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName'),
        notifications: notificationSettings(settings)
      })
      deliverOperationFeedback(feedback, get().showNotification)
      return true
    } catch (error) {
      const feedback = operationFeedback({
        outcome: 'failure',
        error,
        operation: 'workspace-import',
        notifications: notificationSettings(get().settings),
        translate: operationFeedbackTranslate
      })
      set({ loading: false, error: feedback.visibleError ?? toUserError(error) })
      deliverOperationFeedback(feedback, get().showNotification)
      return false
    }
  },
  importWorkspacePath: async (rootPath) => {
    const api = window.teachingSystem
    if (!api) return false
    const path = rootPath.trim()
    if (!path) {
      const feedback = operationFeedback({
        outcome: 'failure',
        error: new Error('Selected path'),
        translate: operationFeedbackTranslate
      })
      set({ error: feedback.visibleError ?? toUserError(new Error('Selected path')) })
      return false
    }
    set({ loading: true, error: null })
    try {
      const state = await api.importWorkspacePath(path)
      set({
        ...activateWorkspaceContext({
          appState: state,
          taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
          loading: false
        }),
        activeConversationScope: null,
        activeConversationRevision: null,
        activeSessionTree: null
      })
      void get().loadReviewCards()
      const settings = get().settings
      const feedback = operationFeedback({
        outcome: 'workspace-imported',
        workspaceName: state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName'),
        notifications: notificationSettings(settings)
      })
      deliverOperationFeedback(feedback, get().showNotification)
      return true
    } catch (error) {
      const feedback = operationFeedback({
        outcome: 'failure',
        error,
        operation: 'workspace-import',
        notifications: notificationSettings(get().settings),
        translate: operationFeedbackTranslate
      })
      set({ loading: false, error: feedback.visibleError ?? toUserError(error) })
      deliverOperationFeedback(feedback, get().showNotification)
      return false
    }
  },
  openImportLocation: async (path) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.openImportLocation(path)
      if (!result.ok) {
        set({ error: { message: i18n.t('errors.openPath'), severity: 'warning', detail: result.message } })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  updateMission: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    const newPrompt = window.prompt(i18n.t('dialogs.updateMissionTitle'), workspace.missionExcerpt)
    if (!newPrompt) return
    set({ loading: true, error: null })
    const actionId = resolveMissionActionId(workspace.id, newPrompt)
    try {
      const result = await api.updateMission({
        workspaceId: workspace.id,
        prompt: newPrompt,
        actionId
      })
      if (result.disposition === 'completed' || result.disposition === 'reused') {
        clearMissionActionId(workspace.id)
        set({ appState: result.state, loading: false, error: null })
        return
      }
      // conflict / indeterminate: fail closed; force a new action id on the next explicit submit.
      clearMissionActionId(workspace.id)
      set({
        loading: false,
        error: {
          message: i18n.t(
            result.disposition === 'conflict'
              ? 'errors.missionActionConflict.message'
              : 'errors.missionActionIndeterminate.message'
          ),
          severity: 'warning',
          detail: i18n.t(
            result.disposition === 'conflict'
              ? 'errors.missionActionConflict.detail'
              : 'errors.missionActionIndeterminate.detail'
          )
        }
      })
    } catch (error) {
      // Keep the same actionId for lost-response / thrown I/O retries of this exact submit.
      set({ loading: false, error: toUserError(error) })
    }
  },
  setWorkspaceTrust: async (workspaceId, trust) => {
    const api = window.teachingSystem
    if (!api) return false
    if (!get().appState.workspaces.some((workspace) => workspace.id === workspaceId)) return false
    if (get().pendingWorkspaceTrustIds.has(workspaceId)) return false

    const pendingWorkspaceTrustIds = new Set(get().pendingWorkspaceTrustIds)
    pendingWorkspaceTrustIds.add(workspaceId)
    set({ pendingWorkspaceTrustIds })
    try {
      // Keep the renderer request deliberately capability-narrow: no root path.
      const state = await api.setWorkspaceTrust({ workspaceId, trust })
      const completedWorkspaceTrustIds = new Set(get().pendingWorkspaceTrustIds)
      completedWorkspaceTrustIds.delete(workspaceId)
      set({ appState: state, pendingWorkspaceTrustIds: completedWorkspaceTrustIds })
      return true
    } catch (error) {
      const completedWorkspaceTrustIds = new Set(get().pendingWorkspaceTrustIds)
      completedWorkspaceTrustIds.delete(workspaceId)
      // Trust-operation failures remain visible through the existing global alert surface.
      set({ pendingWorkspaceTrustIds: completedWorkspaceTrustIds, error: toUserError(error) })
      return false
    }
  },
  applyLessonStyle: async (styleId) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const workspace = get().appState.activeWorkspace
      if (workspace) {
        const state = await api.applyLessonStyle({ workspaceId: workspace.id, styleId })
        set({ appState: state })
      }
      await get().updateSettings({ workspace: { lessonStyleId: styleId } })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  generateLesson: async (options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = (options?.prompt ?? get().taskPrompt).trim()
    const settings = get().settings
    if (!workspace || !prompt) return
    const lessonMessages = options?.messages ?? (
      activeTeachingConversationSummary({
        state: get().appState,
        workspaceId: workspace.id,
        activeConversationId: get().activeConversationId,
        pendingAgentConversation: get().pendingAgentConversation
      })
        ? agentTurnsToMessages(get().agentTurns)
        : []
    )
    if (
      settings.workspace.confirmBeforeGenerating &&
      !window.confirm(i18n.t('dialogs.confirmGenerate'))
    ) {
      return
    }
    const courseName = suggestedCourseName(workspace, prompt)
    const actionId = resolveDirectLessonActionId({
      workspaceId: workspace.id,
      prompt,
      courseName,
      messages: lessonMessages
    })
    const runId = lessonGenerationRunId(workspace.id)
    set({
      ...beginLessonGeneration({ appState: get().appState, providerLabel: runtimeProviderLabel(settings) }),
      lessonGenerationRunId: runId,
      lessonGenerationPetNotificationResult: null,
      petNotificationErrors: clearPetOperationErrors(get().petNotificationErrors, 'lesson-generation')
    })
    try {
      const result = await api.generateLesson({
        workspaceId: workspace.id,
        actionId,
        prompt,
        courseName,
        messages: lessonMessages
      })
      if (isDirectLessonSuccessResult(result)) {
        clearDirectLessonActionId(workspace.id)
        set({
          ...directLessonDonePatch({ result, workspaceId: workspace.id, nextPrompt }),
          lessonGenerationRunId: null,
          lessonGenerationPetNotificationResult: {
            runId,
            resultId: `${runId}:${result.lesson.id}`,
            targetId: result.lesson.relativePath,
            createdAt: Date.now()
          }
        })
        const effects = effectsForGeneratedLesson({
          lesson: result.lesson,
          source: result.source,
          reason: result.reason,
          settings: lessonEffectSettings(settings)
        })
        if (effects.openPath) void get().openPath(effects.openPath)
        if (effects.lessonGeneratedNotification) {
          void get().showNotification(i18n.t('notify.lessonGenerated.title'), lessonGeneratedNotificationBody(effects.lessonGeneratedNotification))
        }
        return
      }
      // rejected / conflict / indeterminate: fail closed; force a new actionId next submit.
      clearDirectLessonActionId(workspace.id)
      const userError = directLessonDispositionError(result.disposition, result.code)
      set({
        ...failLessonGeneration({ appState: get().appState, error: userError }),
        lessonGenerationRunId: null,
        petNotificationErrors: recordPetOperationError(get().petNotificationErrors, {
          source: 'lesson-generation',
          sourceId: runId,
          error: userError
        })
      })
    } catch (error) {
      // Keep the same actionId for lost-response / thrown I/O retries of this exact submit.
      const feedback = operationFeedback({
        outcome: 'failure',
        error,
        operation: 'lesson-generation',
        notifications: notificationSettings(settings),
        translate: operationFeedbackTranslate
      })
      const userError = feedback.visibleError ?? toUserError(error)
      set({
        ...failLessonGeneration({ appState: get().appState, error: userError }),
        lessonGenerationRunId: null,
        petNotificationErrors: recordPetOperationError(get().petNotificationErrors, {
          source: 'lesson-generation',
          sourceId: runId,
          error: userError
        })
      })
      deliverOperationFeedback(feedback, get().showNotification)
    }
  },
  generateLessonStream: async (options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = (options?.prompt ?? get().taskPrompt).trim()
    const settings = get().settings
    if (!workspace || !prompt) return
    const lessonMessages = options?.messages ?? (
      activeTeachingConversationSummary({
        state: get().appState,
        workspaceId: workspace.id,
        activeConversationId: get().activeConversationId,
        pendingAgentConversation: get().pendingAgentConversation
      })
        ? agentTurnsToMessages(get().agentTurns)
        : []
    )
    if (
      settings.workspace.confirmBeforeGenerating &&
      !window.confirm(i18n.t('dialogs.confirmGenerate'))
    ) {
      return
    }
    const courseName = suggestedCourseName(workspace, prompt)
    const actionId = resolveDirectLessonActionId({
      workspaceId: workspace.id,
      prompt,
      courseName,
      messages: lessonMessages
    })
    const runId = lessonGenerationRunId(workspace.id)
    set({
      ...beginLessonGeneration({ appState: get().appState, providerLabel: runtimeProviderLabel(settings) }),
      lessonGenerationRunId: runId,
      lessonGenerationPetNotificationResult: null,
      petNotificationErrors: clearPetOperationErrors(get().petNotificationErrors, 'lesson-generation')
    })
    let liveText = ''
    try {
      const done = await api.generateLessonStream(
        {
          workspaceId: workspace.id,
          actionId,
          prompt,
          courseName,
          messages: lessonMessages
        },
        (chunk: LessonStreamChunk) => {
          liveText += chunk.delta
          set(appendStreamingPreview({
            appState: get().appState,
            liveText,
            workspace,
            labels: {
              language: i18n.language,
              hint: i18n.t('preview.streamingHint'),
              placeholder: i18n.t('preview.streamingPlaceholder')
            }
          }))
        },
        (status) => {
          set(updateStreamingStatus({ appState: get().appState, status }))
        }
      )
      if ('error' in done && done.error) {
        // Transport/error envelope only; keep pending actionId for exact lost-response retry.
        // StreamIds are main-owned and never reattached after reload.
        const feedback = operationFeedback({
          outcome: 'failure',
          error: new Error(done.message),
          operation: 'lesson-generation',
          notifications: notificationSettings(settings),
          translate: operationFeedbackTranslate
        })
        const userError = feedback.visibleError ?? toUserError(new Error(done.message))
        set({
          ...failStreamingLessonGeneration(userError),
          lessonGenerationRunId: null,
          petNotificationErrors: recordPetOperationError(get().petNotificationErrors, {
            source: 'lesson-generation',
            sourceId: runId,
            error: userError
          })
        })
        deliverOperationFeedback(feedback, get().showNotification)
        return
      }
      if (!('error' in done) && 'disposition' in done) {
        if (done.disposition === 'succeeded' || done.disposition === 'reused') {
          clearDirectLessonActionId(workspace.id)
          const patch = streamedLessonDonePatch({ done, workspaceId: workspace.id, nextPrompt })
          if (patch) {
            set({
              ...patch,
              lessonGenerationRunId: null,
              lessonGenerationPetNotificationResult: {
                runId,
                resultId: `${runId}:${done.lesson.id}`,
                targetId: done.lesson.relativePath,
                createdAt: Date.now()
              }
            })
          }
          const effects = effectsForGeneratedLesson({
            lesson: done.lesson,
            source: done.source,
            reason: done.reason,
            settings: lessonEffectSettings(settings)
          })
          if (effects.openPath) void get().openPath(effects.openPath)
          if (effects.lessonGeneratedNotification) {
            void get().showNotification(i18n.t('notify.lessonGenerated.title'), lessonGeneratedNotificationBody(effects.lessonGeneratedNotification))
          }
          return
        }
        clearDirectLessonActionId(workspace.id)
        const failureCode = 'code' in done ? done.code : undefined
        const userError = directLessonDispositionError(done.disposition, failureCode)
        set({
          ...failStreamingLessonGeneration(userError),
          lessonGenerationRunId: null,
          petNotificationErrors: recordPetOperationError(get().petNotificationErrors, {
            source: 'lesson-generation',
            sourceId: runId,
            error: userError
          })
        })
        return
      }
    } catch (error) {
      // Keep pending actionId for exact lost-response retry; do not reattach old streamId.
      const userError = toUserError(error)
      set({
        ...failLessonGeneration({ appState: get().appState, error: userError }),
        lessonGenerationRunId: null,
        petNotificationErrors: recordPetOperationError(get().petNotificationErrors, {
          source: 'lesson-generation',
          sourceId: runId,
          error: userError
        })
      })
    }
  },
  loadAgentConversation: async (conversationId, workspaceId, scope = 'workspace') => {
    const api = window.teachingSystem
    if (!api) return
    const requestedWorkspaceId = workspaceId ?? get().appState.activeWorkspace?.id ?? null
    const workspace = requestedWorkspaceId
      ? get().appState.workspaces.find((item) => item.id === requestedWorkspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    set({ error: null })
    try {
      const initialTree = await api.readAgentConversationSessionTree({ workspaceId: workspace.id, conversationId, scope })
      const requestedBranch = initialTree.branches.find((branch) => branch.conversationId === conversationId)
      if (!requestedBranch) throw new Error('Conversation branch is missing from its session tree.')
      const result = requestedBranch.status === 'active'
        ? await api.openAgentConversationBranch({ workspaceId: workspace.id, conversationId, scope })
        : {
            conversation: await api.readAgentConversation({ workspaceId: workspace.id, conversationId, scope }),
            tree: initialTree
          }
      const nextAppState = workspace.id === get().appState.activeWorkspace?.id
        ? get().appState
        : await api.selectWorkspace(workspace.id)
      set({
        activeConversationScope: scope,
        ...openAgentConversationContext({
          conversation: result.conversation,
          workspaceId: workspace.id,
          appState: nextAppState,
          currentOverviewDialogMode: get().overviewDialogMode,
          currentTaskPrompt: get().taskPrompt
        }),
        activeConversationRevision: result.conversation.branch?.revision
          ?? result.tree.branches.find((branch) => branch.conversationId === result.conversation.id)?.revision
          ?? 0,
        activeSessionTree: result.tree
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  openAgentConversationBranch: async (conversationId) => {
    const api = window.teachingSystem
    const workspace = get().appState.activeWorkspace
    const scope = get().activeConversationScope ?? 'workspace'
    if (!api || !workspace) return
    set({ error: null })
    try {
      const result = await api.openAgentConversationBranch({ workspaceId: workspace.id, conversationId, scope })
      set({
        ...openAgentConversationContext({
          conversation: result.conversation,
          workspaceId: workspace.id,
          appState: get().appState,
          currentOverviewDialogMode: get().overviewDialogMode,
          currentTaskPrompt: get().taskPrompt
        }),
        activeConversationRevision: result.conversation.branch?.revision
          ?? result.tree.branches.find((branch) => branch.conversationId === result.conversation.id)?.revision
          ?? 0,
        activeSessionTree: result.tree
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  forkAgentConversationBranch: async (conversationId, sourceTurnId, expectedRevision) => {
    const api = window.teachingSystem
    const workspace = get().appState.activeWorkspace
    const sourceConversationId = conversationId
    const scope = get().activeConversationScope ?? 'workspace'
    if (!api || !workspace || !sourceConversationId) return false
    set({ error: null })
    try {
      const result = await api.forkAgentConversationBranch({
        workspaceId: workspace.id,
        conversationId: sourceConversationId,
        scope,
        sourceTurnId,
        expectedRevision
      })
      if (get().appState.activeWorkspace?.id !== workspace.id) return false
      set({
        ...openAgentConversationContext({
          conversation: result.conversation,
          workspaceId: workspace.id,
          appState: result.state,
          currentOverviewDialogMode: get().overviewDialogMode,
          currentTaskPrompt: get().taskPrompt
        }),
        activeConversationRevision: result.conversation.branch?.revision
          ?? result.tree.branches.find((branch) => branch.conversationId === result.conversation.id)?.revision
          ?? 0,
        activeSessionTree: result.tree
      })
      return true
    } catch (error) {
      if (!isConversationRevisionConflict(error)) {
        set({ error: toUserError(error) })
        return false
      }

      // CAS rejection proves this request did not create a child branch. Refresh
      // the source, validate the fork point still exists, then retry exactly once
      // with the current revision. Do not retry unknown IPC/network failures.
      await refreshConversationAfterRevisionConflict({
        get,
        set,
        workspaceId: workspace.id,
        conversationId: sourceConversationId,
        scope
      })
      const refreshed = get()
      const currentBranch = refreshed.activeSessionTree?.branches.find(
        (branch) => branch.conversationId === sourceConversationId
      )
      const sourceTurnStillExists = !sourceTurnId || refreshed.agentTurns.some((turn) => turn.id === sourceTurnId)
      if (
        refreshed.appState.activeWorkspace?.id !== workspace.id ||
        !currentBranch ||
        currentBranch.status !== 'active' ||
        !sourceTurnStillExists
      ) {
        set({ error: null })
        return false
      }
      try {
        const result = await api.forkAgentConversationBranch({
          workspaceId: workspace.id,
          conversationId: sourceConversationId,
          scope,
          sourceTurnId,
          expectedRevision: currentBranch.revision
        })
        if (get().appState.activeWorkspace?.id !== workspace.id) return false
        set({
          ...openAgentConversationContext({
            conversation: result.conversation,
            workspaceId: workspace.id,
            appState: result.state,
            currentOverviewDialogMode: get().overviewDialogMode,
            currentTaskPrompt: get().taskPrompt
          }),
          activeConversationRevision: result.conversation.branch?.revision
            ?? result.tree.branches.find((branch) => branch.conversationId === result.conversation.id)?.revision
            ?? 0,
          activeSessionTree: result.tree,
          error: null
        })
        return true
      } catch (retryError) {
        if (isConversationRevisionConflict(retryError)) {
          await refreshConversationAfterRevisionConflict({
            get,
            set,
            workspaceId: workspace.id,
            conversationId: sourceConversationId,
            scope
          })
          set({ error: null })
          return false
        }
        set({ error: toUserError(retryError) })
        return false
      }
    }
  },
  replayAgentConversationBranch: async (conversationId, sourceTurnId) => {
    const api = window.teachingSystem
    const workspace = get().appState.activeWorkspace
    const sourceConversationId = conversationId ?? get().activeConversationId
    const scope = get().activeConversationScope ?? 'workspace'
    if (!api || !workspace || !sourceConversationId) return null
    set({ error: null })
    try {
      const result = await api.replayAgentConversationBranch({
        workspaceId: workspace.id,
        conversationId: sourceConversationId,
        scope,
        sourceTurnId
      })
      return result.turns
    } catch (error) {
      set({ error: toUserError(error) })
      return null
    }
  },
  updateAgentConversationBranchStatus: async (conversationId, status, expectedRevision) => {
    const api = window.teachingSystem
    const workspace = get().appState.activeWorkspace
    const scope = get().activeConversationScope ?? 'workspace'
    if (!api || !workspace) return
    set({ error: null })
    try {
      const result = await api.updateAgentConversationBranchStatus({
        workspaceId: workspace.id,
        conversationId,
        scope,
        status,
        expectedRevision
      })
      if (get().appState.activeWorkspace?.id !== workspace.id) return
      const currentConversationId = get().activeConversationId
      const updatedIsCurrent = currentConversationId === result.conversation.id
      const openBranch = result.tree.branches.find((branch) => branch.branchId === result.tree.openBranchId)
      if (status === 'active') {
        set({
          ...openAgentConversationContext({
            conversation: result.conversation,
            workspaceId: workspace.id,
            appState: result.state,
            currentOverviewDialogMode: get().overviewDialogMode,
            currentTaskPrompt: get().taskPrompt
          }),
          activeConversationRevision: result.conversation.branch?.revision
            ?? result.tree.branches.find((branch) => branch.conversationId === result.conversation.id)?.revision
            ?? expectedRevision
            ?? 0,
          activeSessionTree: result.tree
        })
        return
      }
      if (updatedIsCurrent && openBranch && openBranch.conversationId !== result.conversation.id) {
        const opened = await api.openAgentConversationBranch({
          workspaceId: workspace.id,
          conversationId: openBranch.conversationId,
          scope
        })
        if (get().appState.activeWorkspace?.id !== workspace.id) return
        set({
          ...openAgentConversationContext({
            conversation: opened.conversation,
            workspaceId: workspace.id,
            appState: result.state,
            currentOverviewDialogMode: get().overviewDialogMode,
            currentTaskPrompt: get().taskPrompt
          }),
          activeConversationRevision: opened.conversation.branch?.revision
            ?? opened.tree.branches.find((branch) => branch.conversationId === opened.conversation.id)?.revision
            ?? 0,
          activeSessionTree: opened.tree
        })
        return
      }
      const currentBranch = result.tree.branches.find((branch) => branch.conversationId === currentConversationId)
      set({
        appState: result.state,
        activeSessionTree: result.tree,
        ...(currentBranch ? { activeConversationRevision: currentBranch.revision } : {})
      })
    } catch (error) {
      if (isConversationRevisionConflict(error)) {
        // Archive/restore/delete are stale state-changing intents. Refresh the
        // canonical tree but never replay them automatically.
        await refreshConversationAfterRevisionConflict({
          get,
          set,
          workspaceId: workspace.id,
          conversationId,
          scope
        })
        set({ error: null })
        return
      }
      set({ error: toUserError(error) })
    }
  },
  agentChat: async (inputOverride, options) => {
    await getAgentConversationTurnRunner().run({
      inputOverride,
      mode: options?.mode,
      skillIds: options?.skillIds,
      imageAttachments: options?.imageAttachments
    })
  },
  renameAgentConversation: async (payload) => {
    const api = window.teachingSystem
    const workspaceId = payload.workspaceId ?? get().appState.activeWorkspace?.id
    if (!api || !workspaceId) return
    try {
      const result = await api.renameAgentConversation({
        workspaceId,
        conversationId: payload.conversationId,
        title: payload.title,
        scope: payload.scope,
        ...(payload.expectedRevision === undefined ? {} : { expectedRevision: payload.expectedRevision })
      })
      set({ appState: result.state, error: null })
    } catch (error) {
      if (isConversationRevisionConflict(error)) {
        await refreshConversationAfterRevisionConflict({
          get,
          set,
          workspaceId,
          conversationId: payload.conversationId,
          scope: payload.scope
        })
        set({ error: null })
        return
      }
      set({ error: toUserError(error) })
    }
  },
  setWorkspaceItemMeta: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = payload.workspaceId
      ? get().appState.workspaces.find((item) => item.id === payload.workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    try {
      const state = await api.setWorkspaceItemMeta({
        workspaceId: workspace.id,
        relativePath: payload.relativePath,
        pinned: payload.pinned,
        archived: payload.archived
      })
      const archivesWorkspaceRoot = normalizeRelativePath(payload.relativePath) === '' && payload.archived === true
      const clearsCurrentContext =
        archivesWorkspaceRoot &&
        (get().appState.activeWorkspace?.id === workspace.id ||
          get().selectedCourseWorkspaceId === workspace.id ||
          get().pendingAgentConversation?.workspaceId === workspace.id)
      set({
        appState: state,
        error: null,
        ...(clearsCurrentContext
          ? {
              ...activateWorkspaceContext({
                appState: state,
                taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt
              }),
              activeConversationScope: null,
              activeConversationRevision: null,
              activeSessionTree: null
            }
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  removeWorkspaceItem: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = payload.workspaceId
      ? get().appState.workspaces.find((item) => item.id === payload.workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    const removalSnapshot = {
      activeConversationId: get().activeConversationId,
      pendingConversationId: get().pendingAgentConversation?.summary.id ?? null,
      selectedCoursePreviewFile: get().selectedCoursePreviewFile ?? get().selectedMarkdownDocument,
      selectedCourseRelativePath: get().selectedCourseRelativePath
    }
    try {
      const state = await api.removeWorkspaceItem({
        workspaceId: workspace.id,
        relativePath: payload.relativePath,
        kind: payload.kind,
        mode: payload.mode ?? 'disk'
      })
      const uiPatch = deriveWorkspaceRemovalUiPatch(payload, removalSnapshot, state)
      set({
        appState: state,
        error: null,
        ...(uiPatch.clearActiveConversation
          ? { ...clearAgentConversationContext(), activeConversationScope: null, activeConversationRevision: null, activeSessionTree: null }
          : {}),
        ...(uiPatch.clearSelectedCoursePreview
          ? { lessonReaderOpen: false, selectedCoursePreviewFile: null, ...clearMarkdownDocumentContext() }
          : {}),
        ...(uiPatch.clearSelectedCourseFolder
          ? { selectedCourseRelativePath: null, selectedCourseWorkspaceId: null }
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  removeWorkspace: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.workspaces.find((item) => item.id === payload.workspaceId)
    if (!workspace) return
    const previous = get()
    const clearsCurrentContext =
      previous.appState.activeWorkspace?.id === workspace.id ||
      previous.selectedCourseWorkspaceId === workspace.id ||
      previous.pendingAgentConversation?.workspaceId === workspace.id
    try {
      const state = await api.removeWorkspace({
        workspaceId: workspace.id,
        mode: payload.mode ?? 'disk'
      })
      set({
        appState: state,
        error: null,
        ...(clearsCurrentContext
          ? {
              ...clearRemovedWorkspaceContext({
                nextState: state,
                previousView: previous.view,
                nextPrompt,
                defaultPrompt
              }),
              activeConversationScope: null,
              activeConversationRevision: null,
              activeSessionTree: null
            }
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadLesson: async (lesson) => {
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    await getLearningAssetReader()?.openHtmlPreview({
      workspace,
      file: lessonToCoursePreviewFile(lesson),
      courseRelativePath: lesson.courseRelativePath
    })
  },
  loadCourseHtmlFile: async (file) => {
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    await getLearningAssetReader()?.openHtmlPreview({ workspace, file })
  },
  loadWorkspaceMarkdownFile: async (file, workspaceId) => {
    const workspace = workspaceId
      ? get().appState.workspaces.find((item) => item.id === workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    await getLearningAssetReader()?.openMarkdownDocument({ workspace, file })
  },
  openMindMapSource: async (sourceRef, workspaceId) => {
    const workspace = workspaceId === undefined || workspaceId === null
      ? get().appState.activeWorkspace
      : get().appState.workspaces.find((item) => item.id === workspaceId) ?? null
    if (!workspace) return { ok: false, reason: 'workspace_unavailable' }

    try {
      return await createMindMapSourceJumpAdapter({
        reader: getLearningAssetReader()
      }).open({ sourceRef, workspace })
    } catch (error) {
      set({ error: toUserError(error) })
      return {
        ok: false,
        reason: 'invalid_target',
        target: {
          kind: 'workspace',
          locator: null,
          readerPayload: null,
          canResolve: false
        }
      }
    }
  },
  setMarkdownDraft: (markdownDraft) => getLearningAssetReader()?.updateMarkdownDraft(markdownDraft),
  saveMarkdownDocument: async () => {
    await getLearningAssetReader()?.saveMarkdownDocument()
  },
  openResourceHtmlPreview: (selectedResourcePreviewFile) => {
    getLearningAssetReader()?.openResourcePreview(selectedResourcePreviewFile)
  },
  closeResourceHtmlPreview: () => getLearningAssetReader()?.close(),
  openPath: async (path) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.openPath(path)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? i18n.t('errors.openPath'))) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  openExternal: async (url) => {
    const api = window.teachingSystem
    if (!api) return
    const target = classifyExternalDestination(url)
    if (target.kind === 'blocked') {
      set({ error: toUserError(new Error(target.message)) })
      return
    }
    try {
      // The main-process IPC handler repeats this classification and applies privacy policy.
      const result = await api.openExternal(target.url)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? i18n.t('errors.openExternal'))) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  showNotification: async (title, body) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      await api.showNotification({ title, body })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  probeProvider: async (payload) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'StudiumX preload API unavailable.' }
    try {
      return await api.probeProvider(payload)
    } catch (error) {
      const feedback = operationFeedback({ outcome: 'failure', error, translate: operationFeedbackTranslate })
      return { ok: false, message: feedback.visibleError?.message ?? toUserError(error).message }
    }
  },
  listUpstreamModels: async (payload) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'StudiumX preload API unavailable.' }
    try {
      return await api.listUpstreamModels(payload)
    } catch (error) {
      const feedback = operationFeedback({ outcome: 'failure', error, translate: operationFeedbackTranslate })
      return { ok: false, message: feedback.visibleError?.message ?? toUserError(error).message }
    }
  },
  listGitWorktrees: async (workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, reason: 'error', message: 'StudiumX preload API unavailable.' }
    try {
      return await api.listGitWorktrees(workspaceRoot)
    } catch (error) {
      return { ok: false, reason: 'error', message: toUserError(error).message }
    }
  },
  removeGitWorktree: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.removeGitWorktree(payload)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? 'Failed to remove worktree.')) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  listMemory: async (workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const memoryRecords = await api.listMemory(workspaceRoot)
      set({ memoryRecords })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  createMemory: async (payload) => {
    const api = window.teachingSystem
    if (!api) return false
    try {
      const memory = await api.createMemory(payload)
      set((state) => ({ memoryRecords: [memory, ...state.memoryRecords.filter((item) => item.id !== memory.id)] }))
      void get().loadMemoryDiagnostics()
      return true
    } catch (error) {
      set({ error: toUserError(error) })
      return false
    }
  },
  updateMemory: async (memoryId, patch) => {
    const api = window.teachingSystem
    if (!api) return false
    try {
      const memory = await api.updateMemory(memoryId, patch)
      set((state) => ({
        memoryRecords: state.memoryRecords.map((item) => (item.id === memoryId ? memory : item))
      }))
      void get().loadMemoryDiagnostics()
      return true
    } catch (error) {
      set({ error: toUserError(error) })
      return false
    }
  },
  deleteMemory: async (memoryId, workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      await api.deleteMemory(memoryId, workspaceRoot)
      set((state) => ({ memoryRecords: state.memoryRecords.filter((item) => item.id !== memoryId) }))
      void get().loadMemoryDiagnostics()
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadMemoryDiagnostics: async () => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const memoryDiagnostics = await api.getMemoryDiagnostics()
      set({ memoryDiagnostics })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadReviewCards: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) {
      set({ reviewCards: [] })
      return
    }
    try {
      const result = await api.listReviewCards(workspace.id)
      set({ reviewCards: result.cards })
      void api.getProgress(workspace.id).then((res) => set({ progress: res.progress })).catch(() => {})
    } catch (error) {
      set({ error: toUserError(error), reviewCards: [] })
    }
  },
  recordProgress: async (lessonId, results) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    try {
      const res = await api.recordProgress({ workspaceId: workspace.id, lessonId, results })
      set({ progress: res.progress })

      // Review answers are recorded only after the canonical workspace write succeeds.
      // The local facts/progression below are a rebuildable analytics + game projection,
      // never a teaching or review-scheduler authority.
      const recordedAtMs = Date.now()
      const timeZone = resolvedLocalTimeZone()
      const localToday = getLocalDateKey(recordedAtMs, timeZone)
      const snapshot = readStudySnapshot()
      const recordedAt = new Date(recordedAtMs).toISOString()
      const reviewFacts: StudyActivityFact[] = results.map((result) => ({
        factVersion: 1,
        factKind: 'study_activity',
        id: createStudyAnalyticsFactId('review-answer', recordedAtMs),
        clientId: snapshot.clientId,
        occurredAt: recordedAt,
        recordedAt,
        localDate: localToday,
        timezoneOffsetMinutes: getLocalTimezoneOffsetMinutes(recordedAtMs, timeZone),
        activity: {
          kind: 'review_answered',
          workspaceId: workspace.id,
          lessonId,
          correct: result.correct
        }
      }))
      if (reviewFacts.length > 0) {
        appendStudyAnalyticsFacts(snapshot.clientId, reviewFacts, { localToday, updatedAt: recordedAt })
        const handledByStudyHost = dispatchStudyProgressionFacts(reviewFacts, localToday)
        if (!handledByStudyHost) {
          const awarded = applyStudyProgressionAwards(snapshot, reviewFacts, localToday)
          if (awarded !== snapshot) persistStudySnapshot(awarded)
        }
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  }
  })
})

type DurableAgentRunNotice = InterruptedAgentRun | AgentRunTerminalNotice

function durableAgentRunNotice(run: DurableAgentRunNotice, currentWorkspaceRunCount: number): AgentChatTurn {
  return run.status === 'interrupted'
    ? interruptedAgentRunNotice(run, currentWorkspaceRunCount)
    : terminalAgentRunNotice(run, currentWorkspaceRunCount)
}

function interruptedAgentRunNotice(run: InterruptedAgentRun, currentWorkspaceRunCount: number): AgentChatTurn {
  const waiting = run.previousStatus === 'waiting_for_permission'
    ? '退出时正在等待写入审批；旧审批已失效。'
    : run.previousStatus === 'waiting_for_elicitation'
      ? '退出时正在等待你的选择；旧问题不会自动恢复。'
      : run.previousStatus === 'awaiting_conversation_save'
        ? '回答已经确认，但最终 conversation 尚未完成结算。'
        : '退出时该运行仍在进行。'
  const pendingRuns = currentWorkspaceRunCount > 1
    ? `当前工作区共有 ${currentWorkspaceRunCount} 个中断运行需要人工确认。已自动打开最新一项；其余 ${currentWorkspaceRunCount - 1} 项仍需要检查。`
    : '当前工作区共有 1 个中断运行需要人工确认。'
  const review = run.operationReviewCount > 0
    ? ` 请先检查可能已执行的 ${run.operationReviewCount} 个写入；它们已开始但完成状态不明。`
    : ''
  const inputEvidence = run.userInputPreview
    ? `\n\n**本轮输入（已脱敏）**\n${run.userInputPreview}`
    : ''
  const confirmedEvidence = run.confirmedAssistantPreview
    ? `\n\n**已确认但未自动提交的回答（已脱敏）**\n${run.confirmedAssistantPreview}${run.confirmedAssistantTruncated ? '\n\n（恢复证据已截断。）' : ''}`
    : ''
  const partialEvidence = (run.unrecoverableAssistantDeltaBytes ?? 0) > 0 && !run.confirmedAssistantPreview
    ? `\n\n检测到约 ${run.unrecoverableAssistantDeltaBytes} 字节未完成流式片段；这些片段不会被当作最终回答。`
    : ''
  const boundaryEvidence = run.evidence?.length
    ? `\n\n**已持久化边界**\n${run.evidence.slice(-6).map((item) => `- ${item.title}${item.detail ? `：${item.detail}` : ''}`).join('\n')}`
    : ''
  const content = `上次 Agent 运行被中断，需要人工确认。${pendingRuns}${waiting}${review} 应用不会自动继续或重做此运行。${inputEvidence}${confirmedEvidence}${partialEvidence}${boundaryEvidence}\n\n请检查已有结果和可能的副作用后，明确输入“继续”或重新发送请求。`
  return {
    id: `interrupted-${run.runId}`,
    role: 'assistant',
    content,
    createdAt: run.interruptedAt,
    processEvents: [{
      id: `interrupted-event-${run.runId}`,
      kind: 'status',
      title: '运行中断',
      detail: run.reason,
      createdAt: run.interruptedAt
    }],
    metadata: {
      version: 1,
      runUsage: run.usage,
      provenance: { kind: 'recovery_notice' }
    }
  }
}

function terminalAgentRunNotice(run: AgentRunTerminalNotice, currentWorkspaceRunCount: number): AgentChatTurn {
  const noticeCount = currentWorkspaceRunCount > 1
    ? `当前工作区共有 ${currentWorkspaceRunCount} 个持久化运行提示需要检查。已自动打开最新一项；其余 ${currentWorkspaceRunCount - 1} 项仍需要检查。`
    : '当前工作区共有 1 个持久化运行提示需要检查。'
  const review = run.operationReviewCount > 0
    ? ` 请先检查可能已执行的 ${run.operationReviewCount} 个写入；它们已开始但完成状态不明。`
    : ''
  const terminal = run.usage.resourceGovernance?.terminal
  const resourceBoundary = terminal
    ? `\n\n**资源边界**\n- 层级：${resourceLayerLabel(terminal.layer)}\n- 计量：${resourceMeterLabel(terminal.meter)}\n- 已用 / 上限：${terminal.used} / ${terminal.limit}\n- 作用域：${resourceScopeLabel(terminal.scope)}`
    : ''
  const inputEvidence = run.userInputPreview
    ? `\n\n**本轮输入（已脱敏）**\n${run.userInputPreview}`
    : ''
  const confirmedEvidence = run.confirmedAssistantPreview
    ? `\n\n**已确认但未提交的回答（已脱敏）**\n${run.confirmedAssistantPreview}${run.confirmedAssistantTruncated ? '\n\n（恢复证据已截断。）' : ''}`
    : ''
  const partialEvidence = (run.unrecoverableAssistantDeltaBytes ?? 0) > 0 && !run.confirmedAssistantPreview
    ? `\n\n检测到约 ${run.unrecoverableAssistantDeltaBytes} 字节未完成流式片段；这些片段不会被当作最终回答。`
    : ''
  const boundaryEvidence = run.evidence?.length
    ? `\n\n**已持久化边界**\n${run.evidence.slice(-6).map((item) => `- ${item.title}${item.detail ? `：${item.detail}` : ''}`).join('\n')}`
    : ''
  const stopExplanation = run.stopReason === 'resource_limit'
    ? '上次 Agent 运行达到明确、可审计的资源边界后停止；这不是 provider 配额、计费状态或学习成功。'
    : run.stopReason === 'suspended'
      ? '上次 Agent 运行被紧急资源保险丝暂停；这不是 provider 配额、计费状态或学习成功。'
      : run.stopReason === 'no_progress'
        ? '上次 Agent 运行检测到重复操作未带来安全进展后停止；这不是 provider 配额、计费状态或学习成功。'
        : run.stopReason === 'context_unrecoverable'
          ? '上次 Agent 运行无法安全压缩上下文后停止；这不是 provider 配额、计费状态或学习成功。'
          : '上次 Agent 运行已用尽有界重试；这不是 provider 配额、计费状态或学习成功。'
  const terminalTitle = run.stopReason === 'retry_exhausted'
    ? '重试已用尽'
    : run.stopReason === 'no_progress'
      ? '重复操作未产生进展'
      : run.stopReason === 'context_unrecoverable'
        ? '上下文无法安全压缩'
        : '资源边界已停止'
  const content = `${stopExplanation}${noticeCount}${review} 没有创建 canonical conversation settlement；此只读提示不会自动继续，也不会重放 provider 或工具工作。${resourceBoundary}${inputEvidence}${confirmedEvidence}${partialEvidence}${boundaryEvidence}\n\n请检查已有结果和可能的副作用后，开始一个新的明确回合。`
  return {
    id: `terminal-${run.runId}`,
    role: 'assistant',
    content,
    createdAt: run.completedAt,
    processEvents: [{
      id: `terminal-event-${run.runId}`,
      kind: 'status',
      status: run.stopReason,
      title: terminalTitle,
      detail: stopExplanation,
      createdAt: run.completedAt
    }],
    metadata: {
      version: 1,
      runUsage: run.usage,
      provenance: { kind: 'recovery_notice' }
    }
  }
}

function resourceLayerLabel(layer: AgentResourceLimitLayer): string {
  return ({
    user_budget: '用户预算',
    deployment_policy: '部署策略',
    emergency_fuse: '紧急保险丝'
  })[layer]
}

function resourceMeterLabel(meter: AgentResourceMeter): string {
  return ({
    logical_requests: '逻辑请求',
    provider_transport_attempts: 'provider 传输尝试',
    tool_operation_attempts: '工具操作尝试',
    duration_ms: '运行时长（毫秒）',
    total_tokens: '总 token'
  })[meter]
}

function resourceScopeLabel(scope: AgentResourceLimitScope): string {
  return ({ task: '任务', run: '运行', workspace: '工作区', tenant: '租户', deployment: '部署' })[scope]
}


// ================================================================
// Store Helpers
// ================================================================

export function sameRelativePath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/') === right.replace(/\\/g, '/')
}


export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}


export function userTurnInputHistory(turns: AgentChatTurn[]): string[] {
  return turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content)
}


export function titleFromFileName(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{4}-/, '')
    .replace(/-reference$/i, '')
  const title = stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
  return title || fileName
}


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}


function emptyPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:680px;margin:0 auto;padding:46px 34px}p{color:#68778f;line-height:1.8}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}
</style></head><body><main><div class="badge">StudiumX</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(workspace.missionExcerpt)}</p><p>${escapeHtml(i18n.t('preview.emptyHint'))}</p></main></body></html>`
}


function loadingPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{display:grid;place-items:center;min-height:360px;padding:34px}p{color:#68778f}
</style></head><body><main><div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(i18n.t('preview.loadingHint'))}</p></div></main></body></html>`
}

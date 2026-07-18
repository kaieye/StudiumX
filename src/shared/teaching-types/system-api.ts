import type {
  AgentEventBusReplay,
  AgentRealtimeEvent,
  AgentChatStreamChunk,
  AgentChatStreamDone,
  AgentChatStreamPayload,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentProjectionInvalidation,
  InterruptedAgentRun,
  AgentConversationRecord,
  AgentConversationCheckpoint,
  AgentConversationSessionTree,
  ForkAgentConversationBranchPayload,
  ForkAgentConversationBranchResult,
  OpenAgentConversationBranchPayload,
  OpenAgentConversationBranchResult,
  CleanupAgentArtifactsPayload,
  CleanupAgentArtifactsResult,
  CreateAgentConversationCheckpointPayload,
  QueryAgentArchivedHistoryPayload,
  QueryAgentArchivedHistoryResult,
  RebuildAgentHistoryIndexPayload,
  RebuildAgentHistoryIndexResult,
  ResolveAgentConversationCheckpointPayload,
  ResolveAgentConversationCheckpointResult,
  AskAnswer,
  ReadAgentConversationPayload,
  ReadAgentConversationSessionTreePayload,
  RenameAgentConversationPayload,
  RenameAgentConversationResult,
  ReplayAgentConversationBranchPayload,
  ReplayAgentConversationBranchResult,
  ReplayAgentChatEventsPayload,
  SaveAgentConversationPayload,
  SaveAgentConversationResult,
  UpdateAgentConversationBranchStatusPayload,
  UpdateAgentConversationBranchStatusResult,
  ProjectAgentConversationSummariesPayload,
  ProjectAgentConversationSummariesResult
} from './agent'
import type {
  CreateTeachingMemoryPayload,
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  UpdateTeachingMemoryPayload
} from './memory'
import type {
  GenerateLessonStreamPayload,
  LessonStreamChunk,
  LessonStreamDone,
  LessonStreamStatus,
  ListUpstreamModelsResult,
  ProbeProviderPayload,
  ProbeProviderResult
} from './lesson'
import type {
  GetProgressResult,
  ListReviewCardsResult,
  RecordProgressPayload
} from './review'
import type {
  GitBranchPayload,
  RemoveTeachingGitWorktreePayload,
  TeachingGitBranchesResult,
  TeachingGitWorktreesResult
} from './git'
import type {
  ReadWorkspaceChangeDiffPayload,
  WorkspaceChangeDiffResult
} from './changes'
import type { ConnectorStatusesResult, NotificationPayload } from './system'
import type {
  ApplyLessonStylePayload,
  CreateWorkspacePayload,
  GenerateLessonPayload,
  GenerateLessonResult,
  ImportWorkspaceResult,
  OpenPathResult,
  PickDirectoryResult,
  ReadLessonPayload,
  ReadLessonResult,
  ReadWorkspaceMarkdownPayload,
  SaveWorkspaceMarkdownPayload,
  SaveWorkspaceMarkdownResult,
  TeachingAppState,
  UpdateMissionPayload,
  WorkspaceMarkdownDocument,
  WindowControlAction,
  WorkspaceItemMetaPayload,
  WorkspaceItemRemovePayload,
  WorkspaceRemovePayload
} from './workspace'
import type { TeachingSettingsPatch, TeachingSettingsV1 } from './settings'
import type { PreviewLessonInteractionIntent, PreviewLessonInteractionReceipt } from './lesson-interaction'
import type { SkillCatalogResult, SkillSummary } from './skill'
import type {
  AnalyticsExportRequest,
  AnalyticsExportResult,
  ClearAnalyticsRequest,
  ClearAnalyticsResult,
  LearningAnalyticsBundle,
  LearningAnalyticsRequest
} from './analytics'

import type { LearningOutcomeCommitResult } from './learning-outcome'

/** Versioned renderer command for committing a canonical Learning Session outcome. */
export type CommitLearningOutcomeRequest = {
  schemaVersion: 1
  type: 'commit'
  workspaceId: string
  sessionId: string
  operationId: string
}

export type TeachingSystemApi = {
  platform: NodeJS.Platform
  getState: () => Promise<TeachingAppState>
  getLearningAnalytics: (request: LearningAnalyticsRequest) => Promise<LearningAnalyticsBundle>
  exportLearningAnalytics: (request: AnalyticsExportRequest) => Promise<AnalyticsExportResult>
  clearLearningAnalytics: (request: ClearAnalyticsRequest) => Promise<ClearAnalyticsResult>
  getSettings: () => Promise<TeachingSettingsV1>
  updateSettings: (patch: TeachingSettingsPatch) => Promise<TeachingSettingsV1>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  createWorkspace: (payload: CreateWorkspacePayload) => Promise<TeachingAppState>
  importWorkspace: () => Promise<ImportWorkspaceResult>
  importWorkspacePath: (rootPath: string) => Promise<TeachingAppState>
  pickDirectory: (defaultPath?: string) => Promise<PickDirectoryResult>
  openImportLocation: (path?: string) => Promise<OpenPathResult>
  updateMission: (payload: UpdateMissionPayload) => Promise<TeachingAppState>
  applyLessonStyle: (payload: ApplyLessonStylePayload) => Promise<TeachingAppState>
  listSkills: () => Promise<SkillCatalogResult>
  installSkill: (skillId: string) => Promise<SkillSummary>
  generateLesson: (payload: GenerateLessonPayload) => Promise<GenerateLessonResult>
  readLesson: (payload: ReadLessonPayload) => Promise<ReadLessonResult>
  recordPreviewLessonInteraction: (intent: PreviewLessonInteractionIntent) => Promise<PreviewLessonInteractionReceipt>
  commitLearningOutcome: (request: CommitLearningOutcomeRequest) => Promise<LearningOutcomeCommitResult>
  readWorkspaceMarkdown: (payload: ReadWorkspaceMarkdownPayload) => Promise<WorkspaceMarkdownDocument>
  saveWorkspaceMarkdown: (payload: SaveWorkspaceMarkdownPayload) => Promise<SaveWorkspaceMarkdownResult>
  openPath: (path: string) => Promise<OpenPathResult>
  openExternal: (url: string) => Promise<OpenPathResult>
  showNotification: (payload: NotificationPayload) => Promise<void>
  controlWindow: (action: WindowControlAction) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  generateLessonStream: (
    payload: GenerateLessonStreamPayload,
    onChunk: (chunk: LessonStreamChunk) => void,
    onStatus: (status: LessonStreamStatus) => void
  ) => Promise<LessonStreamDone>
  onLessonStreamChunk: (handler: (chunk: LessonStreamChunk) => void) => () => void
  onLessonStreamStatus: (handler: (status: LessonStreamStatus) => void) => () => void
  agentChatStream: (
    payload: AgentChatStreamPayload,
    onChunk: (chunk: AgentChatStreamChunk) => void,
    onStatus: (status: AgentChatStreamStatus) => void,
    onTool: (event: AgentChatStreamToolEvent) => void,
    onInvalidation?: (event: AgentProjectionInvalidation) => void
  ) => Promise<AgentChatStreamDone>
  listInterruptedAgentRuns: () => Promise<InterruptedAgentRun[]>
  replayAgentChatEvents: (payload: ReplayAgentChatEventsPayload) => Promise<AgentEventBusReplay>
  cancelAgentChatStream: (streamId: string) => Promise<{ canceled: boolean }>
  answerAgentChatTool: (
    streamId: string,
    toolCallId: string,
    answers: AskAnswer[]
  ) => Promise<void>
  onAgentChatChunk: (handler: (chunk: AgentChatStreamChunk) => void) => () => void
  onAgentChatStatus: (handler: (status: AgentChatStreamStatus) => void) => () => void
  onAgentChatTool: (handler: (event: AgentChatStreamToolEvent) => void) => () => void
  onAgentChatEvent: (handler: (event: AgentRealtimeEvent) => void) => () => void
  saveAgentConversation: (payload: SaveAgentConversationPayload) => Promise<SaveAgentConversationResult>
  renameAgentConversation: (payload: RenameAgentConversationPayload) => Promise<RenameAgentConversationResult>
  readAgentConversation: (payload: ReadAgentConversationPayload) => Promise<AgentConversationRecord>
  projectAgentConversationSummaries: (payload: ProjectAgentConversationSummariesPayload) => Promise<ProjectAgentConversationSummariesResult>
  readAgentConversationSessionTree: (payload: ReadAgentConversationSessionTreePayload) => Promise<AgentConversationSessionTree>
  openAgentConversationBranch: (payload: OpenAgentConversationBranchPayload) => Promise<OpenAgentConversationBranchResult>
  forkAgentConversationBranch: (payload: ForkAgentConversationBranchPayload) => Promise<ForkAgentConversationBranchResult>
  replayAgentConversationBranch: (payload: ReplayAgentConversationBranchPayload) => Promise<ReplayAgentConversationBranchResult>
  updateAgentConversationBranchStatus: (payload: UpdateAgentConversationBranchStatusPayload) => Promise<UpdateAgentConversationBranchStatusResult>
  createAgentConversationCheckpoint: (payload: CreateAgentConversationCheckpointPayload) => Promise<AgentConversationCheckpoint>
  resolveAgentConversationCheckpoint: (payload: ResolveAgentConversationCheckpointPayload) => Promise<ResolveAgentConversationCheckpointResult>
  queryAgentArchivedHistory: (payload: QueryAgentArchivedHistoryPayload) => Promise<QueryAgentArchivedHistoryResult>
  rebuildAgentHistoryIndex: (payload: RebuildAgentHistoryIndexPayload) => Promise<RebuildAgentHistoryIndexResult>
  cleanupAgentArtifacts: (payload: CleanupAgentArtifactsPayload) => Promise<CleanupAgentArtifactsResult>
  setWorkspaceItemMeta: (payload: WorkspaceItemMetaPayload) => Promise<TeachingAppState>
  removeWorkspaceItem: (payload: WorkspaceItemRemovePayload) => Promise<TeachingAppState>
  removeWorkspace: (payload: WorkspaceRemovePayload) => Promise<TeachingAppState>
  listReviewCards: (workspaceId: string) => Promise<ListReviewCardsResult>
  recordProgress: (payload: RecordProgressPayload) => Promise<GetProgressResult>
  getProgress: (workspaceId: string) => Promise<GetProgressResult>
  listGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  removeGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<OpenPathResult>
  listGitBranches: (workspaceRoot: string) => Promise<TeachingGitBranchesResult>
  switchGitBranch: (payload: GitBranchPayload) => Promise<TeachingGitBranchesResult>
  createGitBranch: (payload: GitBranchPayload) => Promise<TeachingGitBranchesResult>
  readWorkspaceChangeDiff: (payload: ReadWorkspaceChangeDiffPayload) => Promise<WorkspaceChangeDiffResult>
  listMemory: (workspaceRoot?: string) => Promise<TeachingMemoryRecord[]>
  getMemoryDiagnostics: () => Promise<TeachingMemoryDiagnostics>
  getConnectorStatuses: () => Promise<ConnectorStatusesResult>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  updateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  deleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  openLogFile: () => Promise<OpenPathResult>
  openAppDataDir: () => Promise<OpenPathResult>
}

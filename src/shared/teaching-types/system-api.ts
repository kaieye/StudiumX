import type {
  AgentEventBusReplay,
  AgentRealtimeDeliveryEvent,
  AgentRealtimeEvent,
  AgentChatStreamChunk,
  AgentChatStreamDone,
  AgentChatStreamPayload,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentProjectionInvalidation,
  AgentRunTerminalNotice,
  InterruptedAgentRun,
  AgentConversationRecord,
  AgentConversationCheckpoint,
  AgentConversationSessionTree,
  ForkAgentConversationBranchPayload,
  ForkAgentConversationBranchResult,
  OpenAgentConversationBranchPayload,
  OpenAgentConversationBranchResult,
  CreateAgentConversationCheckpointPayload,
  ListAgentWriteRewindJournalPayload,
  ListAgentWriteRewindJournalResult,
  RestoreAgentWriteRewindPayload,
  RestoreAgentWriteRewindResult,
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
  ProjectAgentConversationSummariesResult,
  SteerAgentChatStreamPayload,
  SteerAgentChatStreamResult,
  FollowUpAgentChatStreamPayload,
  FollowUpAgentChatStreamResult,
  SubmitConversationTurnDisposition,
  SubmitConversationTurnIntent,
  CancelConversationTurnDisposition,
  CancelConversationTurnIntent
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
  DirectLessonActionStatus,
  DirectLessonActionStatusPayload,
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
  SetWorkspaceTrustPayload,
  TeachingAppState,
  MissionMutationResult,
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
  SkillOrchestrationPreviewRequest,
  SkillOrchestrationPreviewResult
} from './skill-orchestration'
import type {
  AnalyticsExportRequest,
  AnalyticsExportResult,
  ClearAnalyticsRequest,
  ClearAnalyticsResult,
  LearningAnalyticsBundle,
  LearningAnalyticsRequest
} from './analytics'

import type { LearningOutcomeCommitResult } from './learning-outcome'
import type { RunTeachingDoctorPayload, TeachingDoctorReport } from './teaching-doctor'
import type { TeachingPresentationActionPayload, TeachingPresentationActionResult, TeachingPresentationSnapshot } from './teaching-presentation'
import type { AgentSandboxReadiness } from './agent-sandbox'
import type {
  DecideTeachingTurnReviewPayload,
  DecideTeachingTurnReviewResult,
  GetTeachingTurnReviewLastBundleResult,
  ProjectTeachingTurnReviewHandoffPayload,
  ProjectTeachingTurnReviewHandoffResult,
  ProjectTeachingTurnReviewPayload,
  ProjectTeachingTurnReviewResult,
  SaveTeachingTurnReviewLastBundlePayload,
  SaveTeachingTurnReviewLastBundleResult
} from './teaching-turn-review-ipc'
import type {
  ProjectAgentSessionQueuePayload,
  ProjectAgentSessionQueueResult
} from './agent-session-queue'
import type { MindMapDocumentV2 } from '../mindmap/domain/types'
import type { MindMapSummary } from '../mindmap/mind-map-types'
import type {
  MindMapAccessPayload,
  MindMapAssetImportPayload,
  MindMapAssetImportResult,
  MindMapAssetReadPayload,
  MindMapAssetReadResult,
  MindMapCancelGenerationPayload,
  MindMapCreatePayload,
  MindMapMarkdownExportPayload,
  MindMapMarkdownImportPayload,
  MindMapPortableExportPayload,
  MindMapPortableImportPayload,
  MindMapOpmlExportPayload,
  MindMapOpmlImportPayload,
  MindMapPngExportPayload,
  MindMapSvgExportPayload,
  MindMapGeneratePayload,
  MindMapFlushPayload,
  MindMapImportDialogPayload,
  MindMapImportDialogResult,
  MindMapLibrary,
  MindMapListPayload,
  MindMapProposalApplyPayload,
  MindMapProposalApplyResult,
  MindMapProposalGeneratePayload,
  MindMapProposalGenerateResult,
  MindMapSourceRefreshApplyPayload,
  MindMapSourceRefreshApplyResult,
  MindMapSourceRefreshPayload,
  MindMapSourceRefreshPreviewResult,
  MindMapUpdatePayload,
  MindMapUpdateResult
} from './mindmap'
import type { MindMapStreamChunk, MindMapStreamStatus } from './mindmap'

/** Versioned renderer command for committing a canonical Learning Session outcome. */
export type CommitLearningOutcomeRequest = {
  schemaVersion: 1
  type: 'commit'
  workspaceId: string
  sessionId: string
  operationId: string
}

/** Byte totals for the in-progress update download (electron-updater ProgressInfo). */
export type AppUpdateProgress = {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

/**
 * Renderer-facing desktop update lifecycle, pushed from the main process via
 * the `appUpdateEvent` channel. `checking` with `manual: false` originates
 * from the scheduled background check and the dialog stays hidden for it.
 */
export type AppUpdateState =
  | { kind: 'idle' }
  | { kind: 'menu' }
  | { kind: 'checking'; manual: boolean }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; progress: AppUpdateProgress }
  | { kind: 'downloaded'; version: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string }

/** User actions a renderer dialog can request from the main-process updater. */
export type AppUpdateAction = 'download' | 'restart' | 'retry' | 'dismiss' | 'check'

/**
 * One installed system font family reported by the host (desktop only).
 * `value` is CSS-ready (quoted when the bare name needs it); the Web lane
 * returns no entries so the renderer falls back to the curated catalogue.
 */
export type SystemFontFamily = {
  /** Bare family name, e.g. "Georgia", ".SF NS". */
  family: string
  /** CSS-safe value for a `font-family` list, e.g. `"\".SF NS\""`. */
  value: string
}

export type TeachingSystemApi = {
  /** Native Electron platform, or the browser adapter's explicit web target. */
  platform: NodeJS.Platform | 'web'
  /**
   * Installed system font families (desktop only). Web returns an empty list;
   * the renderer then falls back to the curated web-safe catalogue. The
   * returned `value` is CSS-ready (quoted when needed) for a `font-family`.
   */
  listSystemFonts: () => Promise<readonly SystemFontFamily[]>
  getState: () => Promise<TeachingAppState>
  getLearningAnalytics: (request: LearningAnalyticsRequest) => Promise<LearningAnalyticsBundle>
  exportLearningAnalytics: (request: AnalyticsExportRequest) => Promise<AnalyticsExportResult>
  clearLearningAnalytics: (request: ClearAnalyticsRequest) => Promise<ClearAnalyticsResult>
  /** Explicit user-initiated desktop release check; a no-op in development. */
  checkForAppUpdates: () => Promise<void>
  /** Subscribes to desktop update lifecycle events; returns an unsubscribe. */
  onAppUpdateEvent: (handler: (state: AppUpdateState) => void) => () => void
  /** Opens the update dialog without starting a network check. */
  openAppUpdateDialog: () => Promise<void>
  /** Sends a user update-dialog action (check/download/restart/retry/dismiss) to main. */
  appUpdateAction: (action: AppUpdateAction) => Promise<void>
  getAppVersion: () => Promise<string>
  getSettings: () => Promise<TeachingSettingsV1>
  updateSettings: (patch: TeachingSettingsPatch) => Promise<TeachingSettingsV1>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  createWorkspace: (payload: CreateWorkspacePayload) => Promise<TeachingAppState>
  importWorkspace: () => Promise<ImportWorkspaceResult>
  importWorkspacePath: (rootPath: string) => Promise<TeachingAppState>
  pickDirectory: (defaultPath?: string) => Promise<PickDirectoryResult>
  openImportLocation: (path?: string) => Promise<OpenPathResult>
  updateMission: (payload: UpdateMissionPayload) => Promise<MissionMutationResult>
  setWorkspaceTrust: (payload: SetWorkspaceTrustPayload) => Promise<TeachingAppState>
  applyLessonStyle: (payload: ApplyLessonStylePayload) => Promise<TeachingAppState>
  listSkills: () => Promise<SkillCatalogResult>
  installSkill: (skillId: string) => Promise<SkillSummary>
  uninstallSkill: (skillId: string) => Promise<void>
  /**
   * Read-only skill orchestration preview (ADR-0014).
   * Same host assembly + pure `plan(...)` as a real turn. Never writes the
   * ledger, an outcome, Evidence, or the ADR-0014 continuity cursor.
   */
  previewSkillOrchestration: (
    request: SkillOrchestrationPreviewRequest
  ) => Promise<SkillOrchestrationPreviewResult>
  generateLesson: (payload: GenerateLessonPayload) => Promise<GenerateLessonResult>
  getDirectLessonActionStatus: (payload: DirectLessonActionStatusPayload) => Promise<DirectLessonActionStatus>
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
  /**
   * Submit one conversation-turn intent to the host (ADR-0004).
   * The host validates this narrow DTO and reads canonical conversation state;
   * callers cannot submit a replacement transcript or tool-sensitive payload.
   * Host parser/validator implementation is intentionally owned by the gateway
   * integration change; this public signature freezes its expected boundary.
   */
  submitConversationTurn: (
    intent: SubmitConversationTurnIntent
  ) => Promise<SubmitConversationTurnDisposition>
  /** Exact ADR-0004 host-lane cancellation; legacy stream cancellation remains compatibility-only. */
  cancelConversationTurn: (
    intent: CancelConversationTurnIntent
  ) => Promise<CancelConversationTurnDisposition>
  agentChatStream: (
    payload: AgentChatStreamPayload,
    onChunk: (chunk: AgentChatStreamChunk) => void,
    onStatus: (status: AgentChatStreamStatus) => void,
    onTool: (event: AgentChatStreamToolEvent) => void,
    onInvalidation?: (event: AgentProjectionInvalidation) => void
  ) => Promise<AgentChatStreamDone>
  listInterruptedAgentRuns: () => Promise<InterruptedAgentRun[]>
  /** Read-only resource/retry terminal projection; it never continues a prior run. */
  listTerminalAgentRunNotices: () => Promise<AgentRunTerminalNotice[]>
  replayAgentChatEvents: (payload: ReplayAgentChatEventsPayload) => Promise<AgentEventBusReplay>
  cancelAgentChatStream: (streamId: string) => Promise<{ canceled: boolean }>
  /** Mid-run steer on an active stream (≠ abort). Product autoDrain remains false (ADR-0004). */
  steerAgentChatStream: (payload: SteerAgentChatStreamPayload) => Promise<SteerAgentChatStreamResult>
  /** Mid-run follow-up queue/inject on an active stream. */
  followUpAgentChatStream: (payload: FollowUpAgentChatStreamPayload) => Promise<FollowUpAgentChatStreamResult>
  answerAgentChatTool: (
    streamId: string,
    toolCallId: string,
    answers: AskAnswer[]
  ) => Promise<void>
  onAgentChatChunk: (handler: (chunk: AgentChatStreamChunk) => void) => () => void
  onAgentChatStatus: (handler: (status: AgentChatStreamStatus) => void) => () => void
  onAgentChatTool: (handler: (event: AgentChatStreamToolEvent) => void) => () => void
  onAgentChatEvent: (handler: (event: AgentRealtimeDeliveryEvent) => void) => () => void
  /** OS suspend/resume fan-out (ADR-0011). Signal only — pin stays renderer dual-write. */
  onSystemPower: (handler: (event: import('../teaching-ipc-contract').SystemPowerEvent) => void) => () => void
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
  /** Rewind tool workspace writes for one agent run. Not a conversation prefix checkpoint. */
  restoreAgentWriteRewind: (payload: RestoreAgentWriteRewindPayload) => Promise<RestoreAgentWriteRewindResult>
  listAgentWriteRewindJournal: (payload: ListAgentWriteRewindJournalPayload) => Promise<ListAgentWriteRewindJournalResult>
  queryAgentArchivedHistory: (payload: QueryAgentArchivedHistoryPayload) => Promise<QueryAgentArchivedHistoryResult>
  rebuildAgentHistoryIndex: (payload: RebuildAgentHistoryIndexPayload) => Promise<RebuildAgentHistoryIndexResult>
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
  /** Read-only TeachingDoctor: assembles process crash-marker facts + pure report (ADR-0007). */
  runTeachingDoctor: (payload?: RunTeachingDoctorPayload) => Promise<TeachingDoctorReport>
  /**
   * Live agent sandbox readiness for Settings (Stage E).
   * Same resolveAgentSandboxReadiness as runtime/Doctor; secret-free.
   */
  getAgentSandboxReadiness: () => Promise<AgentSandboxReadiness>
  /** Read-only learner-safe canonical teaching projection for the active workspace. */
  getTeachingPresentation: () => Promise<TeachingPresentationSnapshot | null>
  /** Closed next-step command; host validates operation identity and revision before retry. */
  actOnTeachingPresentation: (payload: TeachingPresentationActionPayload) => Promise<TeachingPresentationActionResult>
  /**
   * Project teaching-turn review bundle (+ optional decision) to UI-safe DTO (ADR-0001).
   * No auto-apply; approved ids are not an apply plan.
   */
  projectTeachingTurnReview: (payload: ProjectTeachingTurnReviewPayload) => Promise<ProjectTeachingTurnReviewResult>
  /**
   * Validate human decision + project (same pure path; clearer decision-submit name).
   * Never installs skills / writes memory / mutates profile.
   */
  decideTeachingTurnReview: (payload: DecideTeachingTurnReviewPayload) => Promise<DecideTeachingTurnReviewResult>
  /**
   * Project post-approve handoff intents from approval projection or bundle+decision (ADR-0001).
   * Consent-gated routing DTO only — never auto-apply / installSkill / createMemory.
   */
  projectTeachingTurnReviewHandoff: (
    payload: ProjectTeachingTurnReviewHandoffPayload
  ) => Promise<ProjectTeachingTurnReviewHandoffResult>
  /**
   * Load last durable teaching-turn review snapshot from userData (ADR-0001).
   * Read-only product surface; never auto-applies.
   */
  getTeachingTurnReviewLastBundle: () => Promise<GetTeachingTurnReviewLastBundleResult>
  /**
   * Save last durable teaching-turn review snapshot to userData (ADR-0001).
   * Fail-closed payload only; durable cache only — never auto-apply.
   */
  saveTeachingTurnReviewLastBundle: (
    payload: SaveTeachingTurnReviewLastBundlePayload
  ) => Promise<SaveTeachingTurnReviewLastBundleResult>
  /**
   * Read-only project of active agent session queue via façade.projectQueue (ADR-0004).
   * Never drains / steers / aborts; product autoDrain remains false.
   */
  projectAgentSessionQueue: (payload: ProjectAgentSessionQueuePayload) => Promise<ProjectAgentSessionQueueResult>
  /**
   * Read StudyPlanningSnapshotV1 for a registered workspace (ADR-0011).
   * File-backed sole-writer; not localStorage.
   */
  readStudyPlanning: (payload: {
    workspaceRoot: string
  }) => Promise<
    | {
        ok: true
        snapshot: import('../study-planning').StudyPlanningSnapshotV1
        path: string
        source: 'canonical' | 'backup' | 'empty'
      }
    | { ok: false; error: { code: string; message: string } }
  >
  /**
   * Apply one StudyPlanning command with expectedRevision CAS (ADR-0011).
   * Exact actionId retry is process-local on the durable host.
   */
  applyStudyPlanning: (payload: {
    workspaceRoot: string
    expectedRevision: number
    command: import('../study-planning').StudyPlanningCommandEnvelope
  }) => Promise<import('../study-planning').ApplyResult & { path?: string }>
  /** Secret-free user MCP config (ADR-0013). */
  mcpGetConfig: () => Promise<import('../mcp/types').McpGetConfigResult>
  /**
   * Live Settings getter (ADR-0013): current store public projection.
   * Same secret-free DTO as mcpGetConfig; not a turn-level snapshot.
   */
  mcpGetMcpSettings: () => Promise<import('../mcp/types').McpGetConfigResult>
  /** CAS update of user MCP config (secret refs only). */
  mcpUpdateConfig: (payload: {
    expectedFingerprint: string
    config: unknown
    secretChanges?: import('../mcp/types').McpSecretInputChanges
  }) => Promise<import('../mcp/types').McpConfigUpdateResult>
  /**
   * CAS id-level ops apply (ADR-0013). Prefer over whole-document update when
   * mutating individual servers concurrently. Secret plaintext only via secretChanges.
   */
  mcpApplyMcpOps: (payload: {
    expectedFingerprint: string
    ops: readonly import('../mcp/mcp-ops').McpSettingsOp[]
    secretChanges?: import('../mcp/types').McpSecretInputChanges
  }) => Promise<import('../mcp/types').McpConfigUpdateResult>
  /** Temporary test-connect + tools/list for one server. */
  mcpTestServer: (payload: {
    serverId: string
    workspaceRoot?: string | null
  }) => Promise<import('../mcp/types').McpTestServerResult>
  /** Explicit user-initiated inventory refresh; never schedules background reconnects. */
  mcpRefreshServer: (
    payload: import('../mcp/ipc-contract').McpRefreshServerPayload
  ) => Promise<import('../mcp/types').McpTestServerResult>
  /** Explicit user-initiated OAuth authorization (secret-free response only). */
  mcpAuthorizeServer: (
    payload: import('../mcp/ipc-contract').McpAuthorizeServerPayload
  ) => Promise<
    | Readonly<{ ok: true; authorization: import('../mcp/oauth-types').McpOAuthAuthorizationPublicState }>
    | Readonly<{
        ok: false
        code: import('../mcp/types').McpErrorCode
        message: string
        authorization: import('../mcp/oauth-types').McpOAuthAuthorizationPublicState
      }>
  >
  /** Explicit OAuth revocation for one server (secret-free response only). */
  mcpRevokeAuthorization: (
    payload: import('../mcp/ipc-contract').McpRevokeAuthorizationPayload
  ) => Promise<
    | Readonly<{ ok: true; authorization: import('../mcp/oauth-types').McpOAuthAuthorizationPublicState }>
    | Readonly<{
        ok: false
        code: import('../mcp/types').McpErrorCode
        message: string
        authorization: import('../mcp/oauth-types').McpOAuthAuthorizationPublicState
      }>
  >
  /** Current process MCP connection view (no secrets). */
  mcpListRuntime: () => Promise<{
    ok: true
    servers: readonly import('../mcp/types').McpRuntimeServerView[]
  }>
  /**
   * Opt-in discovery auto-connect for eligible servers (ADR-0013).
   * No-op unless root enabled and autoConnect true; never tools/call.
   */
  mcpAutoConnectNow: (payload?: {
    workspaceRoot?: string | null
  }) => Promise<{
    ok: true
    results: readonly import('../mcp/types').McpTestServerResult[]
  }>
  /**
   * Secret-free multi-source effective view (ADR-0013).
   * Optional at runtime for older preload; Settings degrades when missing.
   */
  mcpGetEffectiveView: (payload?: {
    workspaceRoot?: string | null
  }) => Promise<import('../mcp/effective-view-public').McpGetEffectiveViewResult>
  /** Secret-free marketplace catalog + installs (ADR-0013). */
  mcpMarketplaceList: () => Promise<import('../mcp/marketplace-types').McpMarketplaceListResultV1>
  /** Pin install + enable user server; optional connect; never grants tool approval. */
  mcpMarketplaceInstall: (payload: {
    entryId: string
    connect?: boolean
    workspaceRoot?: string | null
  }) => Promise<import('../mcp/marketplace-types').McpMarketplaceInstallResultV1>
  mcpMarketplaceUninstall: (payload: {
    entryId: string
  }) => Promise<import('../mcp/marketplace-types').McpMarketplaceUninstallResultV1>
  /** Persist remote catalog URLs (no fetch; secret-free). */
  mcpMarketplaceSetCatalogUrls: (payload: {
    catalogUrls: readonly string[]
  }) => Promise<import('../mcp/ipc-contract').McpMarketplaceSetCatalogUrlsResult>
  /** Refresh remote catalogs for configured URLs (fail-soft; no telemetry). */
  mcpMarketplaceRefreshCatalog: () => Promise<
    import('../mcp/ipc-contract').McpMarketplaceRefreshCatalogResult
  >
  /** Push StudiumX user access token to main for system-default MCP auth. */
  mcpSetStudiumxAccessToken: (token: string | null) => Promise<void>
  /** List mind maps in the workspace (docs/mindmap §4). */
  listMindMaps: (payload: MindMapListPayload) => Promise<MindMapSummary[]>
  /** Aggregate library for the home page: home cards + one folder per workspace. */
  listMindMapLibrary: () => Promise<MindMapLibrary>
  /** Create a new empty mind map document. */
  createMindMap: (payload: MindMapCreatePayload) => Promise<MindMapDocumentV2>
  /** Read one mind map document. */
  readMindMap: (payload: MindMapAccessPayload) => Promise<MindMapDocumentV2>
  importMindMapAsset: (payload: MindMapAssetImportPayload) => Promise<MindMapAssetImportResult>
  readMindMapAsset: (payload: MindMapAssetReadPayload) => Promise<MindMapAssetReadResult>
  /** Update (persist) one mind map document. */
  updateMindMap: (payload: MindMapUpdatePayload) => Promise<MindMapUpdateResult>
  /** Delete one mind map document (idempotent). */
  deleteMindMap: (payload: MindMapAccessPayload) => Promise<void>
  /** AI-generate a mind map from a prompt, then persist and return it. */
  generateMindMap: (payload: MindMapGeneratePayload) => Promise<MindMapDocumentV2>
  /** Receive provider deltas for the active, generation-correlated preview. */
  onMindMapStreamChunk: (handler: (chunk: MindMapStreamChunk) => void) => () => void
  /** Receive lifecycle statuses for the active, generation-correlated preview. */
  onMindMapStreamStatus: (handler: (status: MindMapStreamStatus) => void) => () => void
  /** Receive the same ordered Agent process events rendered by the homepage conversation. */
  onMindMapAgentEvent: (handler: (event: AgentRealtimeEvent) => void) => () => void
  /** Cancel an in-flight AI mind-map generation (propagates to the provider request). */
  cancelMindMapGeneration: (payload: MindMapCancelGenerationPayload) => Promise<{ canceled: boolean }>
  /**
   * Open the native import dialog in the host, detect the format from the
   * selected file, and persist the imported document. Runs the whole picker +
   * read + persist boundary in the main process so it works on every platform.
   */
  importMindMapFile: (payload: MindMapImportDialogPayload) => Promise<MindMapImportDialogResult>
  /** Import the StudiumX Markdown tree/notes subset, persist it, and return the document. */
  importMindMapMarkdown: (payload: MindMapMarkdownImportPayload) => Promise<MindMapDocumentV2>
  /** Import the StudiumX OPML tree/notes subset, persist it, and return the document. */
  importMindMapOpml: (payload: MindMapOpmlImportPayload) => Promise<MindMapDocumentV2>
  /** Import a single-file StudiumX package with embedded media. */
  importMindMapPortable: (payload: MindMapPortableImportPayload) => Promise<MindMapDocumentV2>
  /** Flush pending mind map autosave before switching/closing/exporting. */
  flushMindMap: (payload: MindMapFlushPayload) => Promise<void>
  /** Preview source-anchor freshness without mutating the canonical document. */
  previewMindMapSourceRefresh: (
    payload: MindMapSourceRefreshPayload
  ) => Promise<MindMapSourceRefreshPreviewResult>
  /** Apply explicitly confirmed source metadata to every matching topic occurrence. */
  applyMindMapSourceRefresh: (
    payload: MindMapSourceRefreshApplyPayload
  ) => Promise<MindMapSourceRefreshApplyResult>
  /** Validate and CAS-apply reviewed AI proposal items through the reducer. */
  applyMindMapProposal: (payload: MindMapProposalApplyPayload) => Promise<MindMapProposalApplyResult>
  /** Generate a read-only, revision-bound provider proposal for later review/apply. */
  generateMindMapProposal: (
    payload: MindMapProposalGeneratePayload
  ) => Promise<MindMapProposalGenerateResult>
  /** Export one clean, durably acknowledged mind map as Markdown. */
  exportMindMapMarkdown: (payload: MindMapMarkdownExportPayload) => Promise<{ path: string }>
  /** Export one clean, durably acknowledged mind map as OPML. */
  exportMindMapOpml: (payload: MindMapOpmlExportPayload) => Promise<{ path: string }>
  /** Export one clean map as a portable `.sxmind` package with embedded media. */
  exportMindMapPortable: (payload: MindMapPortableExportPayload) => Promise<{ path: string }>
  /** Export one clean, durably acknowledged rendered sheet as SVG. */
  exportMindMapSvg: (payload: MindMapSvgExportPayload) => Promise<{ path: string }>
  /** Export one clean, durably acknowledged rendered sheet as PNG. */
  exportMindMapPng: (payload: MindMapPngExportPayload) => Promise<{ path: string }>
}

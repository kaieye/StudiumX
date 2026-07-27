import type { TeachingSystemApi } from './teaching-types'

export type TeachingInvokeCapability = {
  [Key in keyof TeachingSystemApi]: TeachingSystemApi[Key] extends (...args: any[]) => Promise<unknown>
    ? Key
    : never
}[keyof TeachingSystemApi]

export type TeachingEventChannel =
  | 'lessonStreamChunk'
  | 'lessonStreamStatus'
  | 'agentChatChunk'
  | 'agentChatStatus'
  | 'agentChatTool'
  | 'agentChatEvent'
  | 'systemPower'

/** OS power fan-out payload (ADR-0129 §4 OS bridge). Signal only — not timer authority. */
export type SystemPowerEvent = {
  kind: 'suspend' | 'resume'
  atMs: number
}

export const teachingInvokeChannels = {
  getState: 'teach:get-state',
  getLearningAnalytics: 'teach:get-learning-analytics',
  exportLearningAnalytics: 'teach:export-learning-analytics',
  clearLearningAnalytics: 'teach:clear-learning-analytics',
  getSettings: 'teach:get-settings',
  updateSettings: 'teach:update-settings',
  selectWorkspace: 'teach:select-workspace',
  createWorkspace: 'teach:create-workspace',
  importWorkspace: 'teach:import-workspace',
  importWorkspacePath: 'teach:import-workspace-path',
  pickDirectory: 'teach:pick-directory',
  openImportLocation: 'teach:open-import-location',
  updateMission: 'teach:update-mission',
  setWorkspaceTrust: 'teach:set-workspace-trust',
  applyLessonStyle: 'teach:apply-lesson-style',
  listSkills: 'teach:list-skills',
  installSkill: 'teach:install-skill',
  generateLesson: 'teach:generate-lesson',
  getDirectLessonActionStatus: 'teach:get-direct-lesson-action-status',
  readLesson: 'teach:read-lesson',
  recordPreviewLessonInteraction: 'teach:record-preview-lesson-interaction',
  commitLearningOutcome: 'teach:commit-learning-outcome',
  readWorkspaceMarkdown: 'teach:read-workspace-markdown',
  saveWorkspaceMarkdown: 'teach:save-workspace-markdown',
  openPath: 'teach:open-path',
  openExternal: 'teach:open-external',
  showNotification: 'teach:show-notification',
  controlWindow: 'teach:window-control',
  probeProvider: 'teach:probe-provider',
  listUpstreamModels: 'teach:list-upstream-models',
  generateLessonStream: 'teach:generate-lesson-stream',
  agentChatStream: 'teach:agent-chat-stream',
  listInterruptedAgentRuns: 'teach:list-interrupted-agent-runs',
  replayAgentChatEvents: 'teach:agent-chat-replay',
  cancelAgentChatStream: 'teach:cancel-agent-chat-stream',
  steerAgentChatStream: 'teach:agent-chat-steer',
  followUpAgentChatStream: 'teach:agent-chat-follow-up',
  answerAgentChatTool: 'teach:agent-chat-tool-answer',
  saveAgentConversation: 'teach:save-agent-conversation',
  renameAgentConversation: 'teach:rename-agent-conversation',
  readAgentConversation: 'teach:read-agent-conversation',
  projectAgentConversationSummaries: 'teach:project-agent-conversation-summaries',
  readAgentConversationSessionTree: 'teach:read-agent-conversation-session-tree',
  openAgentConversationBranch: 'teach:open-agent-conversation-branch',
  forkAgentConversationBranch: 'teach:fork-agent-conversation-branch',
  replayAgentConversationBranch: 'teach:replay-agent-conversation-branch',
  updateAgentConversationBranchStatus: 'teach:update-agent-conversation-branch-status',
  createAgentConversationCheckpoint: 'teach:create-agent-conversation-checkpoint',
  resolveAgentConversationCheckpoint: 'teach:resolve-agent-conversation-checkpoint',
  restoreAgentWriteRewind: 'teach:restore-agent-write-rewind',
  listAgentWriteRewindJournal: 'teach:list-agent-write-rewind-journal',
  queryAgentArchivedHistory: 'teach:query-agent-archived-history',
  rebuildAgentHistoryIndex: 'teach:rebuild-agent-history-index',
  setWorkspaceItemMeta: 'teach:set-workspace-item-meta',
  removeWorkspaceItem: 'teach:remove-workspace-item',
  removeWorkspace: 'teach:remove-workspace',
  listReviewCards: 'teach:list-review-cards',
  recordProgress: 'teach:record-progress',
  getProgress: 'teach:get-progress',
  listGitWorktrees: 'teach:list-git-worktrees',
  removeGitWorktree: 'teach:remove-git-worktree',
  listGitBranches: 'teach:list-git-branches',
  switchGitBranch: 'teach:switch-git-branch',
  createGitBranch: 'teach:create-git-branch',
  readWorkspaceChangeDiff: 'teach:read-workspace-change-diff',
  listMemory: 'teach:list-memory',
  getMemoryDiagnostics: 'teach:get-memory-diagnostics',
  getConnectorStatuses: 'teach:get-connector-statuses',
  createMemory: 'teach:create-memory',
  updateMemory: 'teach:update-memory',
  deleteMemory: 'teach:delete-memory',
  openLogFile: 'teach:open-log',
  openAppDataDir: 'teach:open-app-data-dir',
  runTeachingDoctor: 'teach:run-teaching-doctor',
  /** Live agent sandbox readiness (Stage E); secret-free. */
  getAgentSandboxReadiness: 'teach:get-agent-sandbox-readiness',
  getTeachingPresentation: 'teach:get-teaching-presentation',
  actOnTeachingPresentation: 'teach:act-on-teaching-presentation',
  projectTeachingTurnReview: 'teach:project-teaching-turn-review',
  decideTeachingTurnReview: 'teach:decide-teaching-turn-review',
  projectTeachingTurnReviewHandoff: 'teach:project-teaching-turn-review-handoff',
  getTeachingTurnReviewLastBundle: 'teach:get-teaching-turn-review-last-bundle',
  saveTeachingTurnReviewLastBundle: 'teach:save-teaching-turn-review-last-bundle',
  projectAgentSessionQueue: 'teach:project-agent-session-queue',
  readStudyPlanning: 'teach:read-study-planning',
  applyStudyPlanning: 'teach:apply-study-planning',
  mcpGetConfig: 'teach:mcp-get-config',
  /** Live settings getter (ADR-0147); current store, not turn snapshot. */
  mcpGetMcpSettings: 'teach:mcp-get-settings',
  mcpUpdateConfig: 'teach:mcp-update-config',
  /** Id-level CAS ops write (ADR-0147). */
  mcpApplyMcpOps: 'teach:mcp-apply-ops',
  mcpTestServer: 'teach:mcp-test-server',
  mcpRefreshServer: 'teach:mcp-refresh-server',
  mcpAuthorizeServer: 'teach:mcp-authorize-server',
  mcpRevokeAuthorization: 'teach:mcp-revoke-authorization',
  mcpListRuntime: 'teach:mcp-list-runtime',
  mcpAutoConnectNow: 'teach:mcp-auto-connect-now',
  mcpGetEffectiveView: 'teach:mcp-get-effective-view',
  mcpMarketplaceList: 'teach:mcp-marketplace-list',
  mcpMarketplaceInstall: 'teach:mcp-marketplace-install',
  mcpMarketplaceUninstall: 'teach:mcp-marketplace-uninstall',
  mcpMarketplaceSetCatalogUrls: 'teach:mcp-marketplace-set-catalog-urls',
  mcpMarketplaceRefreshCatalog: 'teach:mcp-marketplace-refresh-catalog'
} satisfies Record<TeachingInvokeCapability, string>

export const teachingEventChannels = {
  lessonStreamChunk: 'teach:generate-lesson-chunk',
  lessonStreamStatus: 'teach:generate-lesson-status',
  agentChatChunk: 'teach:agent-chat-chunk',
  agentChatStatus: 'teach:agent-chat-status',
  agentChatTool: 'teach:agent-chat-tool',
  agentChatEvent: 'teach:agent-chat-event',
  systemPower: 'teach:system-power'
} satisfies Record<TeachingEventChannel, string>

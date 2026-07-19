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
  openAppDataDir: 'teach:open-app-data-dir'
} satisfies Record<TeachingInvokeCapability, string>

export const teachingEventChannels = {
  lessonStreamChunk: 'teach:generate-lesson-chunk',
  lessonStreamStatus: 'teach:generate-lesson-status',
  agentChatChunk: 'teach:agent-chat-chunk',
  agentChatStatus: 'teach:agent-chat-status',
  agentChatTool: 'teach:agent-chat-tool',
  agentChatEvent: 'teach:agent-chat-event'
} satisfies Record<TeachingEventChannel, string>

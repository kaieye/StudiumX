import type {
  AgentChatStreamChunk,
  AgentChatStreamDone,
  AgentChatStreamPayload,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentConversationRecord,
  ReadAgentConversationPayload,
  SaveAgentConversationPayload,
  SaveAgentConversationResult
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
import type { NotificationPayload } from './system'
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
  TeachingAppState,
  UpdateMissionPayload,
  WindowControlAction,
  WorkspaceItemMetaPayload,
  WorkspaceItemRemovePayload,
  WorkspaceRemovePayload
} from './workspace'
import type { TeachingSettingsPatch, TeachingSettingsV1 } from './settings'

export type TeachingSystemApi = {
  platform: NodeJS.Platform
  getState: () => Promise<TeachingAppState>
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
  generateLesson: (payload: GenerateLessonPayload) => Promise<GenerateLessonResult>
  readLesson: (payload: ReadLessonPayload) => Promise<ReadLessonResult>
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
    onTool: (event: AgentChatStreamToolEvent) => void
  ) => Promise<AgentChatStreamDone>
  cancelAgentChatStream: (streamId: string) => Promise<{ canceled: boolean }>
  onAgentChatChunk: (handler: (chunk: AgentChatStreamChunk) => void) => () => void
  onAgentChatStatus: (handler: (status: AgentChatStreamStatus) => void) => () => void
  onAgentChatTool: (handler: (event: AgentChatStreamToolEvent) => void) => () => void
  saveAgentConversation: (payload: SaveAgentConversationPayload) => Promise<SaveAgentConversationResult>
  readAgentConversation: (payload: ReadAgentConversationPayload) => Promise<AgentConversationRecord>
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
  listMemory: (workspaceRoot?: string) => Promise<TeachingMemoryRecord[]>
  getMemoryDiagnostics: () => Promise<TeachingMemoryDiagnostics>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  updateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  deleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  openLogFile: () => Promise<OpenPathResult>
  openAppDataDir: () => Promise<OpenPathResult>
}

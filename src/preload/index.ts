import { contextBridge, ipcRenderer } from 'electron'
import type { TeachingSystemApi } from '../shared/teaching-types'
import type {
  AgentChatStreamChunk,
  AgentChatStreamDone,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  LessonStreamChunk,
  LessonStreamDone,
  LessonStreamStatus
} from '../shared/teaching-types'

/** Register an ipcRenderer listener and return an unsubscribe function. */
function registerIpcListener<T>(
  channel: string,
  handler: (payload: T) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TeachingSystemApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('teach:get-state'),
  getSettings: () => ipcRenderer.invoke('teach:get-settings'),
  updateSettings: (patch) => ipcRenderer.invoke('teach:update-settings', patch),
  selectWorkspace: (workspaceId) => ipcRenderer.invoke('teach:select-workspace', workspaceId),
  createWorkspace: (payload) => ipcRenderer.invoke('teach:create-workspace', payload),
  importWorkspace: () => ipcRenderer.invoke('teach:import-workspace'),
  importWorkspacePath: (rootPath) => ipcRenderer.invoke('teach:import-workspace-path', rootPath),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('teach:pick-directory', defaultPath),
  openImportLocation: (path) => ipcRenderer.invoke('teach:open-import-location', path),
  updateMission: (payload) => ipcRenderer.invoke('teach:update-mission', payload),
  applyLessonStyle: (payload) => ipcRenderer.invoke('teach:apply-lesson-style', payload),
  generateLesson: (payload) => ipcRenderer.invoke('teach:generate-lesson', payload),
  readLesson: (payload) => ipcRenderer.invoke('teach:read-lesson', payload),
  readWorkspaceMarkdown: (payload) => ipcRenderer.invoke('teach:read-workspace-markdown', payload),
  saveWorkspaceMarkdown: (payload) => ipcRenderer.invoke('teach:save-workspace-markdown', payload),
  openPath: (path) => ipcRenderer.invoke('teach:open-path', path),
  openExternal: (url) => ipcRenderer.invoke('teach:open-external', url),
  showNotification: (payload) => ipcRenderer.invoke('teach:show-notification', payload),
  controlWindow: (action) => ipcRenderer.invoke('teach:window-control', action),
  probeProvider: (payload) => ipcRenderer.invoke('teach:probe-provider', payload),
  listUpstreamModels: (payload) => ipcRenderer.invoke('teach:list-upstream-models', payload),
  generateLessonStream: (payload, onChunk, onStatus) => {
    const offChunk = registerIpcListener<LessonStreamChunk>('teach:generate-lesson-chunk', onChunk)
    const offStatus = registerIpcListener<LessonStreamStatus>('teach:generate-lesson-status', onStatus)
    return ipcRenderer
      .invoke('teach:generate-lesson-stream', payload)
      .finally(() => {
        offChunk()
        offStatus()
      }) as Promise<LessonStreamDone>
  },
  onLessonStreamChunk: (handler) => registerIpcListener<LessonStreamChunk>('teach:generate-lesson-chunk', handler),
  onLessonStreamStatus: (handler) => registerIpcListener<LessonStreamStatus>('teach:generate-lesson-status', handler),
  agentChatStream: (payload, onChunk, onStatus, onTool) => {
    const offChunk = registerIpcListener<AgentChatStreamChunk>('teach:agent-chat-chunk', onChunk)
    const offStatus = registerIpcListener<AgentChatStreamStatus>('teach:agent-chat-status', onStatus)
    const offTool = registerIpcListener<AgentChatStreamToolEvent>('teach:agent-chat-tool', onTool)
    return ipcRenderer
      .invoke('teach:agent-chat-stream', payload)
      .finally(() => {
        offChunk()
        offStatus()
        offTool()
      }) as Promise<AgentChatStreamDone>
  },
  cancelAgentChatStream: (streamId) => ipcRenderer.invoke('teach:cancel-agent-chat-stream', streamId),
  answerAgentChatTool: (streamId, toolCallId, answers) =>
    ipcRenderer.invoke('teach:agent-chat-tool-answer', { streamId, toolCallId, answers }),
  onAgentChatChunk: (handler) => registerIpcListener<AgentChatStreamChunk>('teach:agent-chat-chunk', handler),
  onAgentChatStatus: (handler) => registerIpcListener<AgentChatStreamStatus>('teach:agent-chat-status', handler),
  onAgentChatTool: (handler) => registerIpcListener<AgentChatStreamToolEvent>('teach:agent-chat-tool', handler),
  saveAgentConversation: (payload) => ipcRenderer.invoke('teach:save-agent-conversation', payload),
  readAgentConversation: (payload) => ipcRenderer.invoke('teach:read-agent-conversation', payload),
  setWorkspaceItemMeta: (payload) => ipcRenderer.invoke('teach:set-workspace-item-meta', payload),
  removeWorkspaceItem: (payload) => ipcRenderer.invoke('teach:remove-workspace-item', payload),
  removeWorkspace: (payload) => ipcRenderer.invoke('teach:remove-workspace', payload),
  listReviewCards: (workspaceId) => ipcRenderer.invoke('teach:list-review-cards', workspaceId),
  recordProgress: (payload) => ipcRenderer.invoke('teach:record-progress', payload),
  getProgress: (workspaceId) => ipcRenderer.invoke('teach:get-progress', workspaceId),
  listGitWorktrees: (workspaceRoot) => ipcRenderer.invoke('teach:list-git-worktrees', workspaceRoot),
  removeGitWorktree: (payload) => ipcRenderer.invoke('teach:remove-git-worktree', payload),
  listGitBranches: (workspaceRoot) => ipcRenderer.invoke('teach:list-git-branches', workspaceRoot),
  switchGitBranch: (payload) => ipcRenderer.invoke('teach:switch-git-branch', payload),
  createGitBranch: (payload) => ipcRenderer.invoke('teach:create-git-branch', payload),
  listMemory: (workspaceRoot) => ipcRenderer.invoke('teach:list-memory', workspaceRoot),
  getMemoryDiagnostics: () => ipcRenderer.invoke('teach:get-memory-diagnostics'),
  createMemory: (payload) => ipcRenderer.invoke('teach:create-memory', payload),
  updateMemory: (memoryId, patch) => ipcRenderer.invoke('teach:update-memory', memoryId, patch),
  deleteMemory: (memoryId, workspaceRoot) => ipcRenderer.invoke('teach:delete-memory', memoryId, workspaceRoot),
  openLogFile: () => ipcRenderer.invoke('teach:open-log'),
  openAppDataDir: () => ipcRenderer.invoke('teach:open-app-data-dir')
}

contextBridge.exposeInMainWorld('teachingSystem', api)

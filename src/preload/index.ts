import { contextBridge, ipcRenderer } from 'electron'
import type { TeachingSystemApi } from '../shared/teaching-types'
import { teachingEventChannels, teachingInvokeChannels } from '../shared/teaching-ipc-contract'
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
  getState: () => ipcRenderer.invoke(teachingInvokeChannels.getState),
  getSettings: () => ipcRenderer.invoke(teachingInvokeChannels.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(teachingInvokeChannels.updateSettings, patch),
  selectWorkspace: (workspaceId) => ipcRenderer.invoke(teachingInvokeChannels.selectWorkspace, workspaceId),
  createWorkspace: (payload) => ipcRenderer.invoke(teachingInvokeChannels.createWorkspace, payload),
  importWorkspace: () => ipcRenderer.invoke(teachingInvokeChannels.importWorkspace),
  importWorkspacePath: (rootPath) => ipcRenderer.invoke(teachingInvokeChannels.importWorkspacePath, rootPath),
  pickDirectory: (defaultPath) => ipcRenderer.invoke(teachingInvokeChannels.pickDirectory, defaultPath),
  openImportLocation: (path) => ipcRenderer.invoke(teachingInvokeChannels.openImportLocation, path),
  updateMission: (payload) => ipcRenderer.invoke(teachingInvokeChannels.updateMission, payload),
  applyLessonStyle: (payload) => ipcRenderer.invoke(teachingInvokeChannels.applyLessonStyle, payload),
  generateLesson: (payload) => ipcRenderer.invoke(teachingInvokeChannels.generateLesson, payload),
  readLesson: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readLesson, payload),
  openPath: (path) => ipcRenderer.invoke(teachingInvokeChannels.openPath, path),
  openExternal: (url) => ipcRenderer.invoke(teachingInvokeChannels.openExternal, url),
  showNotification: (payload) => ipcRenderer.invoke(teachingInvokeChannels.showNotification, payload),
  controlWindow: (action) => ipcRenderer.invoke(teachingInvokeChannels.controlWindow, action),
  probeProvider: (payload) => ipcRenderer.invoke(teachingInvokeChannels.probeProvider, payload),
  listUpstreamModels: (payload) => ipcRenderer.invoke(teachingInvokeChannels.listUpstreamModels, payload),
  generateLessonStream: (payload, onChunk, onStatus) => {
    const offChunk = registerIpcListener<LessonStreamChunk>(teachingEventChannels.lessonStreamChunk, onChunk)
    const offStatus = registerIpcListener<LessonStreamStatus>(teachingEventChannels.lessonStreamStatus, onStatus)
    return ipcRenderer
      .invoke(teachingInvokeChannels.generateLessonStream, payload)
      .finally(() => {
        offChunk()
        offStatus()
      }) as Promise<LessonStreamDone>
  },
  onLessonStreamChunk: (handler) => registerIpcListener<LessonStreamChunk>(teachingEventChannels.lessonStreamChunk, handler),
  onLessonStreamStatus: (handler) => registerIpcListener<LessonStreamStatus>(teachingEventChannels.lessonStreamStatus, handler),
  agentChatStream: (payload, onChunk, onStatus, onTool) => {
    const offChunk = registerIpcListener<AgentChatStreamChunk>(teachingEventChannels.agentChatChunk, onChunk)
    const offStatus = registerIpcListener<AgentChatStreamStatus>(teachingEventChannels.agentChatStatus, onStatus)
    const offTool = registerIpcListener<AgentChatStreamToolEvent>(teachingEventChannels.agentChatTool, onTool)
    return ipcRenderer
      .invoke(teachingInvokeChannels.agentChatStream, payload)
      .finally(() => {
        offChunk()
        offStatus()
        offTool()
      }) as Promise<AgentChatStreamDone>
  },
  cancelAgentChatStream: (streamId) => ipcRenderer.invoke(teachingInvokeChannels.cancelAgentChatStream, streamId),
  answerAgentChatTool: (streamId, toolCallId, answers) =>
    ipcRenderer.invoke(teachingInvokeChannels.answerAgentChatTool, { streamId, toolCallId, answers }),
  onAgentChatChunk: (handler) => registerIpcListener<AgentChatStreamChunk>(teachingEventChannels.agentChatChunk, handler),
  onAgentChatStatus: (handler) => registerIpcListener<AgentChatStreamStatus>(teachingEventChannels.agentChatStatus, handler),
  onAgentChatTool: (handler) => registerIpcListener<AgentChatStreamToolEvent>(teachingEventChannels.agentChatTool, handler),
  saveAgentConversation: (payload) => ipcRenderer.invoke(teachingInvokeChannels.saveAgentConversation, payload),
  readAgentConversation: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readAgentConversation, payload),
  setWorkspaceItemMeta: (payload) => ipcRenderer.invoke(teachingInvokeChannels.setWorkspaceItemMeta, payload),
  removeWorkspaceItem: (payload) => ipcRenderer.invoke(teachingInvokeChannels.removeWorkspaceItem, payload),
  removeWorkspace: (payload) => ipcRenderer.invoke(teachingInvokeChannels.removeWorkspace, payload),
  listReviewCards: (workspaceId) => ipcRenderer.invoke(teachingInvokeChannels.listReviewCards, workspaceId),
  recordProgress: (payload) => ipcRenderer.invoke(teachingInvokeChannels.recordProgress, payload),
  getProgress: (workspaceId) => ipcRenderer.invoke(teachingInvokeChannels.getProgress, workspaceId),
  listGitWorktrees: (workspaceRoot) => ipcRenderer.invoke(teachingInvokeChannels.listGitWorktrees, workspaceRoot),
  removeGitWorktree: (payload) => ipcRenderer.invoke(teachingInvokeChannels.removeGitWorktree, payload),
  listGitBranches: (workspaceRoot) => ipcRenderer.invoke(teachingInvokeChannels.listGitBranches, workspaceRoot),
  switchGitBranch: (payload) => ipcRenderer.invoke(teachingInvokeChannels.switchGitBranch, payload),
  createGitBranch: (payload) => ipcRenderer.invoke(teachingInvokeChannels.createGitBranch, payload),
  listMemory: (workspaceRoot) => ipcRenderer.invoke(teachingInvokeChannels.listMemory, workspaceRoot),
  getMemoryDiagnostics: () => ipcRenderer.invoke(teachingInvokeChannels.getMemoryDiagnostics),
  createMemory: (payload) => ipcRenderer.invoke(teachingInvokeChannels.createMemory, payload),
  updateMemory: (memoryId, patch) => ipcRenderer.invoke(teachingInvokeChannels.updateMemory, memoryId, patch),
  deleteMemory: (memoryId, workspaceRoot) => ipcRenderer.invoke(teachingInvokeChannels.deleteMemory, memoryId, workspaceRoot),
  openLogFile: () => ipcRenderer.invoke(teachingInvokeChannels.openLogFile),
  openAppDataDir: () => ipcRenderer.invoke(teachingInvokeChannels.openAppDataDir)
}

contextBridge.exposeInMainWorld('teachingSystem', api)

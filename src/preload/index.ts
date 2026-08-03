import { contextBridge, ipcRenderer } from 'electron'
import type { AppUpdateState, TeachingSystemApi } from '../shared/teaching-types'
import type { StudiumxMusicApi } from '../shared/music-types'
import { musicInvokeChannels } from '../shared/music-ipc-contract'
import { teachingEventChannels, teachingInvokeChannels } from '../shared/teaching-ipc-contract'
import {
  webRemoteControlEventChannels,
  webRemoteControlInvokeChannels
} from '../shared/web-remote-control/ipc-contract'
import type {
  WebRemoteControlRuntimeStatus,
  WebRemoteControlStartPayload
} from '../shared/web-remote-control'
import { createAgentRealtimeDelivery } from './agent-realtime-delivery'
import type {
  AgentRealtimeDeliveryEvent,
  AgentRealtimeEvent,
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
  getLearningAnalytics: (request) => ipcRenderer.invoke(teachingInvokeChannels.getLearningAnalytics, request),
  exportLearningAnalytics: (request) => ipcRenderer.invoke(teachingInvokeChannels.exportLearningAnalytics, request),
  clearLearningAnalytics: (request) => ipcRenderer.invoke(teachingInvokeChannels.clearLearningAnalytics, request),
  checkForAppUpdates: () => ipcRenderer.invoke(teachingInvokeChannels.checkForAppUpdates),
  onAppUpdateEvent: (handler) => registerIpcListener<AppUpdateState>(teachingEventChannels.appUpdateEvent, handler),
  openAppUpdateDialog: () => ipcRenderer.invoke(teachingInvokeChannels.openAppUpdateDialog),
  appUpdateAction: (action) => ipcRenderer.invoke(teachingInvokeChannels.appUpdateAction, action),
  getAppVersion: () => ipcRenderer.invoke(teachingInvokeChannels.getAppVersion),
  getSettings: () => ipcRenderer.invoke(teachingInvokeChannels.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(teachingInvokeChannels.updateSettings, patch),
  selectWorkspace: (workspaceId) => ipcRenderer.invoke(teachingInvokeChannels.selectWorkspace, workspaceId),
  createWorkspace: (payload) => ipcRenderer.invoke(teachingInvokeChannels.createWorkspace, payload),
  importWorkspace: () => ipcRenderer.invoke(teachingInvokeChannels.importWorkspace),
  importWorkspacePath: (rootPath) => ipcRenderer.invoke(teachingInvokeChannels.importWorkspacePath, rootPath),
  pickDirectory: (defaultPath) => ipcRenderer.invoke(teachingInvokeChannels.pickDirectory, defaultPath),
  openImportLocation: (path) => ipcRenderer.invoke(teachingInvokeChannels.openImportLocation, path),
  updateMission: (payload) => ipcRenderer.invoke(teachingInvokeChannels.updateMission, payload),
  setWorkspaceTrust: (payload) => ipcRenderer.invoke(teachingInvokeChannels.setWorkspaceTrust, payload),
  applyLessonStyle: (payload) => ipcRenderer.invoke(teachingInvokeChannels.applyLessonStyle, payload),
  listSkills: () => ipcRenderer.invoke(teachingInvokeChannels.listSkills),
  installSkill: (skillId) => ipcRenderer.invoke(teachingInvokeChannels.installSkill, skillId),
  uninstallSkill: (skillId) => ipcRenderer.invoke(teachingInvokeChannels.uninstallSkill, skillId),
  previewSkillOrchestration: (request) => ipcRenderer.invoke(teachingInvokeChannels.previewSkillOrchestration, request),
  generateLesson: (payload) => ipcRenderer.invoke(teachingInvokeChannels.generateLesson, payload),
  getDirectLessonActionStatus: (payload) => ipcRenderer.invoke(teachingInvokeChannels.getDirectLessonActionStatus, payload),
  readLesson: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readLesson, payload),
  recordPreviewLessonInteraction: (intent) => ipcRenderer.invoke(teachingInvokeChannels.recordPreviewLessonInteraction, intent),
  commitLearningOutcome: (request) => ipcRenderer.invoke(teachingInvokeChannels.commitLearningOutcome, request),
  readWorkspaceMarkdown: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readWorkspaceMarkdown, payload),
  saveWorkspaceMarkdown: (payload) => ipcRenderer.invoke(teachingInvokeChannels.saveWorkspaceMarkdown, payload),
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
  // ADR-0170 transport boundary: invoke-only. It intentionally does not subscribe
  // to any stream/event channel or synthesize a stream identity.
  submitConversationTurn: (intent) =>
    ipcRenderer.invoke(teachingInvokeChannels.submitConversationTurn, intent),
  cancelConversationTurn: (intent) =>
    ipcRenderer.invoke(teachingInvokeChannels.cancelConversationTurn, intent),
  agentChatStream: (payload, onChunk, onStatus, onTool, onInvalidation) => {
    const delivery = createAgentRealtimeDelivery({
      streamId: payload.streamId,
      replay: (streamId, afterSequence) =>
        ipcRenderer.invoke(teachingInvokeChannels.replayAgentChatEvents, { streamId, afterSequence }),
      onChunk,
      onStatus,
      onTool,
      onInvalidation
    })
    const offEvent = registerIpcListener<AgentRealtimeEvent>(teachingEventChannels.agentChatEvent, (event) => {
      void delivery.accept(event)
    })
    return ipcRenderer
      .invoke(teachingInvokeChannels.agentChatStream, payload)
      .then(async (result) => {
        await delivery.flush()
        return result
      })
      .finally(() => {
        offEvent()
      }) as Promise<AgentChatStreamDone>
  },
  listInterruptedAgentRuns: () => ipcRenderer.invoke(teachingInvokeChannels.listInterruptedAgentRuns),
  replayAgentChatEvents: (payload) =>
    ipcRenderer.invoke(teachingInvokeChannels.replayAgentChatEvents, payload),
  cancelAgentChatStream: (streamId) => ipcRenderer.invoke(teachingInvokeChannels.cancelAgentChatStream, streamId),
  steerAgentChatStream: (payload) => ipcRenderer.invoke(teachingInvokeChannels.steerAgentChatStream, payload),
  followUpAgentChatStream: (payload) => ipcRenderer.invoke(teachingInvokeChannels.followUpAgentChatStream, payload),
  answerAgentChatTool: (streamId, toolCallId, answers) =>
    ipcRenderer.invoke(teachingInvokeChannels.answerAgentChatTool, { streamId, toolCallId, answers }),
  onAgentChatChunk: (handler) => registerIpcListener<AgentChatStreamChunk>(teachingEventChannels.agentChatChunk, handler),
  onAgentChatStatus: (handler) => registerIpcListener<AgentChatStreamStatus>(teachingEventChannels.agentChatStatus, handler),
  onAgentChatTool: (handler) => registerIpcListener<AgentChatStreamToolEvent>(teachingEventChannels.agentChatTool, handler),
  onAgentChatEvent: (handler) => registerIpcListener<AgentRealtimeDeliveryEvent>(teachingEventChannels.agentChatEvent, handler),
  onSystemPower: (handler) => registerIpcListener(teachingEventChannels.systemPower, handler),
  saveAgentConversation: (payload) => ipcRenderer.invoke(teachingInvokeChannels.saveAgentConversation, payload),
  renameAgentConversation: (payload) => ipcRenderer.invoke(teachingInvokeChannels.renameAgentConversation, payload),
  readAgentConversation: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readAgentConversation, payload),
  projectAgentConversationSummaries: (payload) => ipcRenderer.invoke(teachingInvokeChannels.projectAgentConversationSummaries, payload),
  readAgentConversationSessionTree: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readAgentConversationSessionTree, payload),
  openAgentConversationBranch: (payload) => ipcRenderer.invoke(teachingInvokeChannels.openAgentConversationBranch, payload),
  forkAgentConversationBranch: (payload) => ipcRenderer.invoke(teachingInvokeChannels.forkAgentConversationBranch, payload),
  replayAgentConversationBranch: (payload) => ipcRenderer.invoke(teachingInvokeChannels.replayAgentConversationBranch, payload),
  updateAgentConversationBranchStatus: (payload) => ipcRenderer.invoke(teachingInvokeChannels.updateAgentConversationBranchStatus, payload),
  createAgentConversationCheckpoint: (payload) => ipcRenderer.invoke(teachingInvokeChannels.createAgentConversationCheckpoint, payload),
  resolveAgentConversationCheckpoint: (payload) => ipcRenderer.invoke(teachingInvokeChannels.resolveAgentConversationCheckpoint, payload),
  restoreAgentWriteRewind: (payload) => ipcRenderer.invoke(teachingInvokeChannels.restoreAgentWriteRewind, payload),
  listAgentWriteRewindJournal: (payload) => ipcRenderer.invoke(teachingInvokeChannels.listAgentWriteRewindJournal, payload),
  queryAgentArchivedHistory: (payload) => ipcRenderer.invoke(teachingInvokeChannels.queryAgentArchivedHistory, payload),
  rebuildAgentHistoryIndex: (payload) => ipcRenderer.invoke(teachingInvokeChannels.rebuildAgentHistoryIndex, payload),
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
  readWorkspaceChangeDiff: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readWorkspaceChangeDiff, payload),
  listMemory: (workspaceRoot) => ipcRenderer.invoke(teachingInvokeChannels.listMemory, workspaceRoot),
  getMemoryDiagnostics: () => ipcRenderer.invoke(teachingInvokeChannels.getMemoryDiagnostics),
  getConnectorStatuses: () => ipcRenderer.invoke(teachingInvokeChannels.getConnectorStatuses),
  createMemory: (payload) => ipcRenderer.invoke(teachingInvokeChannels.createMemory, payload),
  updateMemory: (memoryId, patch) => ipcRenderer.invoke(teachingInvokeChannels.updateMemory, memoryId, patch),
  deleteMemory: (memoryId, workspaceRoot) => ipcRenderer.invoke(teachingInvokeChannels.deleteMemory, memoryId, workspaceRoot),
  openLogFile: () => ipcRenderer.invoke(teachingInvokeChannels.openLogFile),
  openAppDataDir: () => ipcRenderer.invoke(teachingInvokeChannels.openAppDataDir),
  runTeachingDoctor: (payload) => ipcRenderer.invoke(teachingInvokeChannels.runTeachingDoctor, payload),
  getAgentSandboxReadiness: () => ipcRenderer.invoke(teachingInvokeChannels.getAgentSandboxReadiness),
  getTeachingPresentation: () => ipcRenderer.invoke(teachingInvokeChannels.getTeachingPresentation),
  actOnTeachingPresentation: (payload) => ipcRenderer.invoke(teachingInvokeChannels.actOnTeachingPresentation, payload),
  projectTeachingTurnReview: (payload) => ipcRenderer.invoke(teachingInvokeChannels.projectTeachingTurnReview, payload),
  decideTeachingTurnReview: (payload) => ipcRenderer.invoke(teachingInvokeChannels.decideTeachingTurnReview, payload),
  projectTeachingTurnReviewHandoff: (payload) => ipcRenderer.invoke(teachingInvokeChannels.projectTeachingTurnReviewHandoff, payload),
  getTeachingTurnReviewLastBundle: () => ipcRenderer.invoke(teachingInvokeChannels.getTeachingTurnReviewLastBundle),
  saveTeachingTurnReviewLastBundle: (payload) => ipcRenderer.invoke(teachingInvokeChannels.saveTeachingTurnReviewLastBundle, payload),
  projectAgentSessionQueue: (payload) => ipcRenderer.invoke(teachingInvokeChannels.projectAgentSessionQueue, payload),
  readStudyPlanning: (payload) => ipcRenderer.invoke(teachingInvokeChannels.readStudyPlanning, payload),
  applyStudyPlanning: (payload) => ipcRenderer.invoke(teachingInvokeChannels.applyStudyPlanning, payload),
  mcpGetConfig: () => ipcRenderer.invoke(teachingInvokeChannels.mcpGetConfig),
  mcpGetMcpSettings: () => ipcRenderer.invoke(teachingInvokeChannels.mcpGetMcpSettings),
  mcpUpdateConfig: (payload) => ipcRenderer.invoke(teachingInvokeChannels.mcpUpdateConfig, payload),
  mcpApplyMcpOps: (payload) => ipcRenderer.invoke(teachingInvokeChannels.mcpApplyMcpOps, payload),
  mcpTestServer: (payload) => ipcRenderer.invoke(teachingInvokeChannels.mcpTestServer, payload),
  mcpRefreshServer: (payload) => ipcRenderer.invoke(teachingInvokeChannels.mcpRefreshServer, payload),
  mcpAuthorizeServer: (payload) => ipcRenderer.invoke(teachingInvokeChannels.mcpAuthorizeServer, payload),
  mcpRevokeAuthorization: (payload) =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpRevokeAuthorization, payload),
  mcpListRuntime: () => ipcRenderer.invoke(teachingInvokeChannels.mcpListRuntime),
  mcpAutoConnectNow: (payload) =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpAutoConnectNow, payload),
  mcpGetEffectiveView: (payload) =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpGetEffectiveView, payload),
  mcpMarketplaceList: () => ipcRenderer.invoke(teachingInvokeChannels.mcpMarketplaceList),
  mcpMarketplaceInstall: (payload) =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpMarketplaceInstall, payload),
  mcpMarketplaceUninstall: (payload) =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpMarketplaceUninstall, payload),
  mcpMarketplaceSetCatalogUrls: (payload) =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpMarketplaceSetCatalogUrls, payload),
  mcpMarketplaceRefreshCatalog: () =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpMarketplaceRefreshCatalog),
  mcpSetStudiumxAccessToken: (token) =>
    ipcRenderer.invoke(teachingInvokeChannels.mcpSetStudiumxAccessToken, token)
}

const musicApi: StudiumxMusicApi = {
  getAccountStatus: (provider) => ipcRenderer.invoke(musicInvokeChannels.getAccountStatus, provider),
  openLogin: (provider) => ipcRenderer.invoke(musicInvokeChannels.openLogin, provider),
  logout: (provider) => ipcRenderer.invoke(musicInvokeChannels.logout, provider),
  search: (payload) => ipcRenderer.invoke(musicInvokeChannels.search, payload),
  getPlaybackUrl: (song) => ipcRenderer.invoke(musicInvokeChannels.getPlaybackUrl, song),
  getUserPlaylists: (provider) => ipcRenderer.invoke(musicInvokeChannels.getUserPlaylists, provider),
  getPlaylistTracks: (payload) => ipcRenderer.invoke(musicInvokeChannels.getPlaylistTracks, payload),
  getDailyRecommend: (provider) => ipcRenderer.invoke(musicInvokeChannels.getDailyRecommend, provider),
  getLikedSongs: (provider) => ipcRenderer.invoke(musicInvokeChannels.getLikedSongs, provider)
}

const webRemoteControlApi = {
  start: (payload?: WebRemoteControlStartPayload) =>
    ipcRenderer.invoke(webRemoteControlInvokeChannels.start, payload) as Promise<WebRemoteControlRuntimeStatus>,
  stop: () => ipcRenderer.invoke(webRemoteControlInvokeChannels.stop) as Promise<void>,
  resetPairing: (payload?: WebRemoteControlStartPayload) =>
    ipcRenderer.invoke(webRemoteControlInvokeChannels.resetPairing, payload) as Promise<WebRemoteControlRuntimeStatus>,
  getStatus: () =>
    ipcRenderer.invoke(webRemoteControlInvokeChannels.getStatus) as Promise<WebRemoteControlRuntimeStatus>,
  onStatusChanged: (handler: (status: WebRemoteControlRuntimeStatus) => void) =>
    registerIpcListener<WebRemoteControlRuntimeStatus>(webRemoteControlEventChannels.statusChanged, handler)
}

contextBridge.exposeInMainWorld('teachingSystem', api)
contextBridge.exposeInMainWorld('studiumxMusic', musicApi)
contextBridge.exposeInMainWorld('studiumxWebRemoteControl', webRemoteControlApi)


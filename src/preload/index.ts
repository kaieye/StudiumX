import { contextBridge, ipcRenderer } from 'electron'
import type { TeachingSystemApi } from '../shared/teaching-types'
import type {
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
  pickDirectory: (defaultPath) => ipcRenderer.invoke('teach:pick-directory', defaultPath),
  updateMission: (payload) => ipcRenderer.invoke('teach:update-mission', payload),
  generateLesson: (payload) => ipcRenderer.invoke('teach:generate-lesson', payload),
  readLesson: (payload) => ipcRenderer.invoke('teach:read-lesson', payload),
  openPath: (path) => ipcRenderer.invoke('teach:open-path', path),
  openExternal: (url) => ipcRenderer.invoke('teach:open-external', url),
  showNotification: (payload) => ipcRenderer.invoke('teach:show-notification', payload),
  controlWindow: (action) => ipcRenderer.invoke('teach:window-control', action),
  probeProvider: (payload) => ipcRenderer.invoke('teach:probe-provider', payload),
  listUpstreamModels: (providerId) => ipcRenderer.invoke('teach:list-upstream-models', providerId),
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
  listReviewCards: (workspaceId) => ipcRenderer.invoke('teach:list-review-cards', workspaceId),
  recordProgress: (payload) => ipcRenderer.invoke('teach:record-progress', payload),
  getProgress: (workspaceId) => ipcRenderer.invoke('teach:get-progress', workspaceId),
  openLogFile: () => ipcRenderer.invoke('teach:open-log'),
  openAppDataDir: () => ipcRenderer.invoke('teach:open-app-data-dir')
}

contextBridge.exposeInMainWorld('teachingSystem', api)

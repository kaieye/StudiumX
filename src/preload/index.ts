import { contextBridge, ipcRenderer } from 'electron'
import type { TeachingSystemApi } from '../shared/teaching-types'

const api: TeachingSystemApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('teach:get-state'),
  selectWorkspace: (workspaceId) => ipcRenderer.invoke('teach:select-workspace', workspaceId),
  createWorkspace: (payload) => ipcRenderer.invoke('teach:create-workspace', payload),
  importWorkspace: () => ipcRenderer.invoke('teach:import-workspace'),
  updateMission: (payload) => ipcRenderer.invoke('teach:update-mission', payload),
  generateLesson: (payload) => ipcRenderer.invoke('teach:generate-lesson', payload),
  readLesson: (payload) => ipcRenderer.invoke('teach:read-lesson', payload),
  openPath: (path) => ipcRenderer.invoke('teach:open-path', path)
}

contextBridge.exposeInMainWorld('teachingSystem', api)

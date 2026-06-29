import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('teachingSystem', {
  platform: process.platform
})

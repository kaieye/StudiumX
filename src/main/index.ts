import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TeachingWorkspaceService } from './teaching-workspace'
import type {
  CreateWorkspacePayload,
  GenerateLessonPayload,
  ReadLessonPayload,
  UpdateMissionPayload,
  WindowControlAction
} from '../shared/teaching-types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

function registerTeachingIpc(service: TeachingWorkspaceService): void {
  ipcMain.handle('teach:get-state', async () => service.getState())

  ipcMain.handle('teach:select-workspace', async (_, workspaceId: unknown) =>
    service.selectWorkspace(requireString(workspaceId, 'workspaceId'))
  )

  ipcMain.handle('teach:create-workspace', async (_, payload: unknown) =>
    service.createWorkspace(parseCreateWorkspacePayload(payload))
  )

  ipcMain.handle('teach:import-workspace', async () => {
    const mainWindow = BrowserWindow.getFocusedWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: '选择教学工作区',
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
        })
      : await dialog.showOpenDialog({
          title: '选择教学工作区',
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
        })
    const rootPath = result.filePaths[0]
    if (result.canceled || !rootPath) {
      return { canceled: true, state: null }
    }
    return {
      canceled: false,
      state: await service.importWorkspace(rootPath)
    }
  })

  ipcMain.handle('teach:update-mission', async (_, payload: unknown) =>
    service.updateMission(parseUpdateMissionPayload(payload))
  )

  ipcMain.handle('teach:generate-lesson', async (_, payload: unknown) =>
    service.generateLesson(parseGenerateLessonPayload(payload))
  )

  ipcMain.handle('teach:read-lesson', async (_, payload: unknown) =>
    service.readLesson(parseReadLessonPayload(payload))
  )

  ipcMain.handle('teach:open-path', async (_, rawPath: unknown) => {
    const target = resolve(String(rawPath ?? ''))
    const state = await service.getState()
    const allowed = state.workspaces.some((workspace) => isInside(workspace.rootPath, target))
    if (!allowed) {
      return { ok: false, message: 'Path is outside registered teaching workspaces.' }
    }
    const message = await shell.openPath(target)
    return { ok: message.length === 0, message: message || undefined }
  })

  ipcMain.handle('teach:window-control', (event, rawAction: unknown) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (!targetWindow) return

    const action = requireWindowControlAction(rawAction)
    if (action === 'minimize') {
      targetWindow.minimize()
      return
    }
    if (action === 'toggle-maximize') {
      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize()
      } else {
        targetWindow.maximize()
      }
      return
    }
    targetWindow.close()
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: 'AI Teaching System',
    backgroundColor: '#ffffff',
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerTeachingIpc(
    new TeachingWorkspaceService({
      registryPath: join(app.getPath('userData'), 'teachos-workspaces.json'),
      defaultRoot: join(app.getPath('documents'), 'TeachOS Workspaces')
    })
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function parseCreateWorkspacePayload(payload: unknown): CreateWorkspacePayload {
  const record = requireRecord(payload)
  return {
    name: requireString(record.name, 'name'),
    prompt: requireString(record.prompt, 'prompt')
  }
}

function parseUpdateMissionPayload(payload: unknown): UpdateMissionPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    prompt: requireString(record.prompt, 'prompt')
  }
}

function parseGenerateLessonPayload(payload: unknown): GenerateLessonPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    prompt: requireString(record.prompt, 'prompt')
  }
}

function parseReadLessonPayload(payload: unknown): ReadLessonPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    lessonPath: requireString(record.lessonPath, 'lessonPath')
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('IPC payload must be an object.')
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string') {
    throw new Error(`IPC payload field "${key}" must be a string.`)
  }
  return value
}

function requireWindowControlAction(value: unknown): WindowControlAction {
  if (value === 'minimize' || value === 'toggle-maximize' || value === 'close') {
    return value
  }
  throw new Error('Unsupported window control action.')
}

function isInside(rootPath: string, targetPath: string): boolean {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

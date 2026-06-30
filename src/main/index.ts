import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TeachingSettingsService } from './teaching-settings'
import { TeachingWorkspaceService } from './teaching-workspace'
import { Logger } from './logger'
import { TrayManager, setAppIsQuitting } from './tray'
import { probeModelProvider, fetchUpstreamModels } from './provider-connection'
import type {
  CreateWorkspacePayload,
  GenerateLessonPayload,
  GenerateLessonStreamPayload,
  ListUpstreamModelsResult,
  ModelEndpointFormat,
  NotificationPayload,
  ProbeProviderPayload,
  ReadLessonPayload,
  RecordProgressPayload,
  TeachingSettingsPatch,
  TeachingSettingsV1,
  UpdateMissionPayload,
  WindowControlAction
} from '../shared/teaching-types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)

let logger: Logger
let tray: TrayManager

function registerTeachingIpc(
  service: TeachingWorkspaceService,
  settingsService: TeachingSettingsService
): void {
  ipcMain.handle('teach:get-state', async () => service.getState())
  ipcMain.handle('teach:get-settings', async () => settingsService.load())
  ipcMain.handle('teach:update-settings', async (_, payload: unknown) => {
    const settings = await settingsService.patch(parseSettingsPatch(payload))
    void applyAppBehavior(settings)
    return settings
  })

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

  ipcMain.handle('teach:pick-directory', async (_, defaultPath: unknown) => {
    const mainWindow = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: '选择目录',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
      ...(typeof defaultPath === 'string' && defaultPath.trim() ? { defaultPath: defaultPath.trim() } : {})
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0] ?? null
    return { canceled: result.canceled || !path, path }
  })

  ipcMain.handle('teach:update-mission', async (_, payload: unknown) =>
    service.updateMission(parseUpdateMissionPayload(payload))
  )

  ipcMain.handle('teach:generate-lesson', async (_, payload: unknown) =>
    service.generateLesson(parseGenerateLessonPayload(payload))
  )

  ipcMain.handle('teach:generate-lesson-stream', async (event, payload: unknown) => {
    const parsed = parseGenerateLessonPayload(payload)
    const streamId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const sender = event.sender
    try {
      const result = await service.generateLessonStream(parsed, {
        streamId,
        onChunk: (chunk) => safeSend(sender, 'teach:generate-lesson-chunk', chunk),
        onStatus: (status) => safeSend(sender, 'teach:generate-lesson-status', status)
      })
      return { streamId, state: result.state, lesson: result.lesson, source: result.source, reason: result.reason }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.error(`Lesson stream failed: ${message}`)
      return { streamId, error: true as const, message }
    }
  })

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

  ipcMain.handle('teach:open-external', async (_, rawUrl: unknown) => {
    const settings = await settingsService.load()
    if (!settings.privacy.allowExternalLinks) {
      return { ok: false, message: 'External links are disabled in privacy settings.' }
    }
    const url = requireHttpUrl(rawUrl)
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('teach:show-notification', async (_, rawPayload: unknown) => {
    const settings = await settingsService.load()
    if (!settings.notifications.enabled) return
    if (!Notification.isSupported()) return
    const payload = parseNotificationPayload(rawPayload)
    new Notification({ title: payload.title, body: payload.body }).show()
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
      if (targetWindow.isMaximized()) targetWindow.unmaximize()
      else targetWindow.maximize()
      return
    }
    // close: respect close-to-tray via the TrayManager's close handler
    targetWindow.close()
  })

  // ---- Provider probe + upstream model list ----
  ipcMain.handle('teach:probe-provider', async (_, payload: unknown) => {
    const settings = await settingsService.load()
    const request = parseProbeProviderPayload(payload)
    return probeModelProvider(request, resolveProxyUrl(settings))
  })

  ipcMain.handle('teach:list-upstream-models', async (_, providerIdRaw: unknown) => {
    const settings = await settingsService.load()
    const providerId = requireString(providerIdRaw, 'providerId')
    const provider = settings.provider.providers.find((item) => item.id === providerId)
    if (!provider) return { ok: false, message: '未找到该 provider。' } satisfies ListUpstreamModelsResult
    return fetchUpstreamModels(provider, resolveProxyUrl(settings))
  })

  // ---- Review cards + progress ----
  ipcMain.handle('teach:list-review-cards', async (_, workspaceIdRaw: unknown) =>
    service.listReviewCards(requireString(workspaceIdRaw, 'workspaceId'))
  )

  ipcMain.handle('teach:record-progress', async (_, payload: unknown) =>
    service.recordProgress(parseRecordProgressPayload(payload))
  )

  ipcMain.handle('teach:get-progress', async (_, workspaceIdRaw: unknown) =>
    service.getProgress(requireString(workspaceIdRaw, 'workspaceId'))
  )

  // ---- Logging + diagnostics ----
  ipcMain.handle('teach:open-log', async () => {
    const message = await shell.openPath(logger.path)
    return { ok: message.length === 0, message: message || undefined }
  })

  ipcMain.handle('teach:open-app-data-dir', async () => {
    const message = await shell.openPath(app.getPath('userData'))
    return { ok: message.length === 0, message: message || undefined }
  })
}

function safeSend(sender: Electron.WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function resolveProxyUrl(settings: TeachingSettingsV1): string {
  return settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
}

/** Apply app-behavior settings (login item, tray, logging) to the live process. */
async function applyAppBehavior(settings: TeachingSettingsV1): Promise<void> {
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.appBehavior.openAtLogin,
      args: settings.appBehavior.startMinimized ? ['--hidden'] : []
    })
  } catch (error) {
    logger?.warn(`Failed to set login item: ${errorMessage(error)}`)
  }
  tray.configure(settings.appBehavior.closeAction, settings.locale)
  logger.configure(settings.log.enabled, settings.log.retentionDays)
}

function createWindow(hidden = false): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: 'TeachOS',
    backgroundColor: '#f7f9fe',
    frame: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  tray.attach(mainWindow)

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger?.error(`Preload failed at ${preloadPath}: ${error.stack ?? error.message}`)
  })

  mainWindow.once('ready-to-show', () => {
    if (!hidden) mainWindow.show()
  })

  if (hidden) {
    // start-minimized: show only the tray, keep window hidden until summoned
    void 0
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function focusExistingWindow(): void {
  const existingWindow = BrowserWindow.getAllWindows()[0]
  if (!existingWindow) return
  if (existingWindow.isMinimized()) existingWindow.restore()
  existingWindow.show()
  existingWindow.focus()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    const userDataPath = app.getPath('userData')
    const defaultRoot = join(app.getPath('documents'), 'TeachOS Workspaces')

    const settingsService = new TeachingSettingsService({ userDataPath, defaultRoot })
    const initialSettings = await settingsService.load()

    logger = new Logger({
      userDataPath,
      enabled: initialSettings.log.enabled,
      retentionDays: initialSettings.log.retentionDays
    })
    installConsoleSink(logger)

    tray = new TrayManager(logger)

    const workspaceService = new TeachingWorkspaceService({
      registryPath: join(userDataPath, 'teachos-workspaces.json'),
      defaultRoot,
      settingsProvider: () => settingsService.load()
    })

    registerTeachingIpc(workspaceService, settingsService)

    const startHidden = initialSettings.appBehavior.startMinimized || process.argv.includes('--hidden')
    createWindow(startHidden)

    void applyAppBehavior(initialSettings)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('second-instance', () => {
    focusExistingWindow()
  })

  app.on('before-quit', () => {
    setAppIsQuitting(true)
  })

  app.on('window-all-closed', () => {
    // With close-to-tray the window is hidden, not closed, so this only fires
    // on a real quit. Respect the platform convention otherwise.
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

function installConsoleSink(log: Logger): void {
  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  console.warn = (...args: unknown[]) => {
    log.warn(args.map(stringifyArg).join(' '))
    originalWarn(...args)
  }
  console.error = (...args: unknown[]) => {
    log.error(args.map(stringifyArg).join(' '))
    originalError(...args)
  }
}

function stringifyArg(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

function parseProbeProviderPayload(payload: unknown): ProbeProviderPayload {
  const record = requireRecord(payload)
  return {
    baseUrl: requireString(record.baseUrl, 'baseUrl'),
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    endpointFormat: requireEndpointFormat(record.endpointFormat)
  }
}

function parseRecordProgressPayload(payload: unknown): RecordProgressPayload {
  const record = requireRecord(payload)
  const results = Array.isArray(record.results) ? record.results : []
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    lessonId: requireString(record.lessonId, 'lessonId'),
    results: results.map((entry) => {
      const item = requireRecord(entry)
      return {
        lessonId: requireString(item.lessonId, 'lessonId'),
        question: requireString(item.question, 'question'),
        correct: item.correct === true
      }
    })
  }
}

function parseSettingsPatch(payload: unknown): TeachingSettingsPatch {
  return requireRecord(payload) as TeachingSettingsPatch
}

function parseNotificationPayload(payload: unknown): NotificationPayload {
  const record = requireRecord(payload)
  return {
    title: requireString(record.title, 'title'),
    body: requireString(record.body, 'body')
  }
}

function requireEndpointFormat(value: unknown): ModelEndpointFormat {
  if (
    value === 'chat_completions' ||
    value === 'responses' ||
    value === 'messages' ||
    value === 'custom_endpoint'
  ) {
    return value
  }
  throw new Error('IPC payload field "endpointFormat" must be a valid endpoint format.')
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('IPC payload must be an object.')
  }
  return value as Record<string, unknown>
}

function requireHttpUrl(value: unknown): string {
  const raw = requireString(value, 'url')
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Unsupported protocol.')
    }
    return parsed.toString()
  } catch {
    throw new Error('External URL must be a valid http(s) URL.')
  }
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

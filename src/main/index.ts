import { app, BrowserWindow, dialog, ipcMain, Notification, protocol, shell } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TeachingSettingsService } from './teaching-settings'
import { TeachingWorkspaceService } from './teaching-workspace'
import {
  createAndSwitchGitBranchForWorkspace,
  getGitBranchesForWorkspace,
  listGitWorktreesForWorkspace,
  removeGitWorktreeForWorkspace,
  switchGitBranchForWorkspace
} from './teaching-git'
import { Logger } from './logger'
import { TrayManager, setAppIsQuitting } from './tray'
import { probeModelProvider, fetchUpstreamModels } from './provider-connection'
import { isPathInsideConfiguredRoot, isPathInsideRoot } from './path-access'
import { cancelStreamAskPending, resolveAskPending } from './ai/ask-pending'
import {
  ensurePreviewBaseTag,
  injectPreviewMarkdownLinkBridge
} from '../shared/preview-markdown-bridge'
import {
  optionalString,
  parseAgentChatStreamPayload,
  parseApplyLessonStylePayload,
  parseCreateMemoryPayload,
  parseCreateWorkspacePayload,
  decodeToolAnswerPayload,
  parseGenerateLessonPayload,
  parseGitBranchPayload,
  parseListUpstreamModelsPayload,
  parseNotificationPayload,
  parseProbeProviderPayload,
  parseReadAgentConversationPayload,
  parseReadLessonPayload,
  parseReadWorkspaceMarkdownPayload,
  parseRecordProgressPayload,
  parseRemoveGitWorktreePayload,
  parseSaveAgentConversationPayload,
  parseSaveWorkspaceMarkdownPayload,
  parseSettingsPatch,
  parseUpdateMemoryPayload,
  parseUpdateMissionPayload,
  parseWorkspaceItemMetaPayload,
  parseWorkspaceItemRemovePayload,
  parseWorkspaceRemovePayload,
  requireHttpUrl,
  requireStreamId,
  requireString,
  requireWindowControlAction
} from './teaching-ipc-commands'
import type { TeachingSettingsV1 } from '../shared/teaching-types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const PREVIEW_PROTOCOL = 'teachos-preview'

let logger: Logger
let tray: TrayManager

protocol.registerSchemesAsPrivileged([
  {
    scheme: PREVIEW_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false
    }
  }
])

function registerTeachingIpc(
  service: TeachingWorkspaceService,
  settingsService: TeachingSettingsService
): void {
  const activeAgentChatStreams = new Map<string, AbortController>()

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

  ipcMain.handle('teach:import-workspace-path', async (_, rootPathRaw: unknown) =>
    service.importWorkspace(requireString(rootPathRaw, 'rootPath').trim())
  )

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

  ipcMain.handle('teach:open-import-location', async (_, rawPath: unknown) => {
    const settings = await settingsService.load()
    const requestedPath = optionalString(rawPath)
    const basePath = requestedPath ?? (settings.workspace.defaultRoot || app.getPath('documents'))
    const target = resolve(basePath)
    if (!requestedPath) {
      await mkdir(target, { recursive: true }).catch(() => {})
    }
    const message = await shell.openPath(target)
    return { ok: message.length === 0, message: message || undefined }
  })

  ipcMain.handle('teach:update-mission', async (_, payload: unknown) =>
    service.updateMission(parseUpdateMissionPayload(payload))
  )

  ipcMain.handle('teach:apply-lesson-style', async (_, payload: unknown) =>
    service.applyLessonStyle(parseApplyLessonStylePayload(payload))
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
      return { streamId, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.error(`Lesson stream failed: ${message}`)
      return { streamId, error: true as const, message }
    }
  })

  ipcMain.handle('teach:agent-chat-stream', async (event, payload: unknown) => {
    const parsed = parseAgentChatStreamPayload(payload)
    const streamId = parsed.streamId ?? `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const sender = event.sender
    const controller = new AbortController()
    activeAgentChatStreams.set(streamId, controller)
    try {
      const result = await service.agentChatStream(parsed, {
        streamId,
        signal: controller.signal,
        onChunk: (chunk) => safeSend(sender, 'teach:agent-chat-chunk', chunk),
        onStatus: (status) => safeSend(sender, 'teach:agent-chat-status', status),
        onTool: (toolEvent) => safeSend(sender, 'teach:agent-chat-tool', toolEvent)
      })
      if ('canceled' in result) {
        return { streamId, canceled: true as const }
      }
      if ('error' in result) {
        return { streamId, error: true as const, message: result.message }
      }
      return { streamId, ...result }
    } catch (error) {
      if (controller.signal.aborted) {
        return { streamId, canceled: true as const }
      }
      const message = error instanceof Error ? error.message : String(error)
      logger?.error(`Agent chat stream failed: ${message}`)
      return { streamId, error: true as const, message }
    } finally {
      if (activeAgentChatStreams.get(streamId) === controller) {
        activeAgentChatStreams.delete(streamId)
      }
    }
  })

  ipcMain.handle('teach:cancel-agent-chat-stream', async (_, rawStreamId: unknown) => {
    const streamId = requireStreamId(rawStreamId)
    const controller = activeAgentChatStreams.get(streamId)
    if (controller) {
      controller.abort()
      activeAgentChatStreams.delete(streamId)
    }
    // Reject any in-flight ask resolvers so their blocked handlers don't dangle.
    cancelStreamAskPending(streamId)
    return { canceled: true }
  })

  ipcMain.handle('teach:agent-chat-tool-answer', async (_, payload: unknown) => {
    const decoded = decodeToolAnswerPayload(payload)
    resolveAskPending(decoded.streamId, decoded.toolCallId, decoded.answers)
    return { ok: true }
  })

  ipcMain.handle('teach:save-agent-conversation', async (_, payload: unknown) =>
    service.saveAgentConversation(parseSaveAgentConversationPayload(payload))
  )

  ipcMain.handle('teach:read-agent-conversation', async (_, payload: unknown) =>
    service.readAgentConversation(parseReadAgentConversationPayload(payload))
  )

  ipcMain.handle('teach:set-workspace-item-meta', async (_, payload: unknown) =>
    service.setWorkspaceItemMeta(parseWorkspaceItemMetaPayload(payload))
  )

  ipcMain.handle('teach:remove-workspace-item', async (_, payload: unknown) =>
    service.removeWorkspaceItem(parseWorkspaceItemRemovePayload(payload))
  )

  ipcMain.handle('teach:remove-workspace', async (_, payload: unknown) =>
    service.removeWorkspace(parseWorkspaceRemovePayload(payload))
  )

  ipcMain.handle('teach:read-lesson', async (_, payload: unknown) =>
    service.readLesson(parseReadLessonPayload(payload))
  )

  ipcMain.handle('teach:read-workspace-markdown', async (_, payload: unknown) =>
    service.readWorkspaceMarkdown(parseReadWorkspaceMarkdownPayload(payload))
  )

  ipcMain.handle('teach:save-workspace-markdown', async (_, payload: unknown) =>
    service.saveWorkspaceMarkdown(parseSaveWorkspaceMarkdownPayload(payload))
  )

  ipcMain.handle('teach:open-path', async (_, rawPath: unknown) => {
    const target = resolve(String(rawPath ?? ''))
    const state = await service.getState()
    const settings = await settingsService.load()
    const allowed =
      state.workspaces.some((workspace) => isPathInsideRoot(workspace.rootPath, target)) ||
      isPathInsideConfiguredRoot(settings.worktree.rootPath, target) ||
      isPathInsideConfiguredRoot(settings.workspace.defaultRoot, target)
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

  ipcMain.handle('teach:list-upstream-models', async (_, payload: unknown) => {
    const settings = await settingsService.load()
    const request = parseListUpstreamModelsPayload(payload, settings.provider.providers)
    if (!request) return { ok: false, message: '未找到该 provider。' }
    return fetchUpstreamModels(request, resolveProxyUrl(settings))
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

  ipcMain.handle('teach:list-git-worktrees', async (_, workspaceRootRaw: unknown) => {
    const settings = await settingsService.load()
    return listGitWorktreesForWorkspace(
      requireString(workspaceRootRaw, 'workspaceRoot'),
      settings.worktree.rootPath
    )
  })

  ipcMain.handle('teach:remove-git-worktree', async (_, payload: unknown) => {
    const settings = await settingsService.load()
    const request = parseRemoveGitWorktreePayload(payload)
    return removeGitWorktreeForWorkspace({
      workspaceRoot: request.workspaceRoot,
      worktreePath: request.worktreePath,
      worktreeRoot: settings.worktree.rootPath
    })
  })

  ipcMain.handle('teach:list-git-branches', async (_, workspaceRootRaw: unknown) =>
    getGitBranchesForWorkspace(requireString(workspaceRootRaw, 'workspaceRoot'))
  )

  ipcMain.handle('teach:switch-git-branch', async (_, payload: unknown) => {
    const request = parseGitBranchPayload(payload)
    return switchGitBranchForWorkspace(request.workspaceRoot, request.branch)
  })

  ipcMain.handle('teach:create-git-branch', async (_, payload: unknown) => {
    const request = parseGitBranchPayload(payload)
    return createAndSwitchGitBranchForWorkspace(request.workspaceRoot, request.branch)
  })

  ipcMain.handle('teach:list-memory', async (_, workspaceRootRaw: unknown) =>
    service.listMemory(optionalString(workspaceRootRaw))
  )

  ipcMain.handle('teach:get-memory-diagnostics', async () =>
    service.getMemoryDiagnostics()
  )

  ipcMain.handle('teach:create-memory', async (_, payload: unknown) =>
    service.createMemory(parseCreateMemoryPayload(payload))
  )

  ipcMain.handle('teach:update-memory', async (_, memoryIdRaw: unknown, patchRaw: unknown) =>
    service.updateMemory(requireString(memoryIdRaw, 'memoryId'), parseUpdateMemoryPayload(patchRaw))
  )

  ipcMain.handle('teach:delete-memory', async (_, memoryIdRaw: unknown, workspaceRootRaw: unknown) =>
    service.deleteMemory(requireString(memoryIdRaw, 'memoryId'), optionalString(workspaceRootRaw))
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

function registerPreviewProtocol(service: TeachingWorkspaceService): void {
  protocol.handle(PREVIEW_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url)
      const workspaceId = decodeURIComponent(url.hostname)
      const relativePath = url.pathname
        .split('/')
        .filter(Boolean)
        .map((part) => decodeURIComponent(part))
        .join('/')
      const file = await service.resolvePreviewFile(workspaceId, relativePath)
      if (!file) return new Response('Not found', { status: 404 })
      const body = await readFile(file.absolutePath)
      const responseBody = file.mimeType.startsWith('text/html')
        ? injectPreviewMarkdownLinkBridge(
            ensurePreviewBaseTag(body.toString('utf8'), request.url)
          )
        : body
      return new Response(responseBody, {
        headers: {
          'Content-Type': file.mimeType,
          'Cache-Control': 'no-store'
        }
      })
    } catch (error) {
      logger?.warn(`Preview protocol failed: ${errorMessage(error)}`)
      return new Response('Preview unavailable', { status: 500 })
    }
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

    registerPreviewProtocol(workspaceService)
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

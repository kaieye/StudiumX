import { app, BrowserWindow, dialog, ipcMain, Notification, protocol, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
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
import type {
  AgentChatMessage,
  AgentChatStreamPayload,
  AgentChatTurn,
  CreateWorkspacePayload,
  CreateTeachingMemoryPayload,
  GenerateLessonPayload,
  GenerateLessonStreamPayload,
  GitBranchPayload,
  ModelEndpointFormat,
  NotificationPayload,
  ProbeProviderPayload,
  ReadAgentConversationPayload,
  ReadLessonPayload,
  RemoveTeachingGitWorktreePayload,
  WorkspaceItemKind,
  WorkspaceItemMetaPayload,
  WorkspaceItemRemovePayload,
  RecordProgressPayload,
  SaveAgentConversationPayload,
  TeachingSettingsPatch,
  TeachingSettingsV1,
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload,
  WindowControlAction
} from '../shared/teaching-types'

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
      return { streamId, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.error(`Lesson stream failed: ${message}`)
      return { streamId, error: true as const, message }
    }
  })

  ipcMain.handle('teach:agent-chat-stream', async (event, payload: unknown) => {
    const parsed = parseAgentChatStreamPayload(payload)
    const streamId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const sender = event.sender
    try {
      const result = await service.agentChatStream(parsed, {
        streamId,
        onChunk: (chunk) => safeSend(sender, 'teach:agent-chat-chunk', chunk),
        onStatus: (status) => safeSend(sender, 'teach:agent-chat-status', status),
        onTool: (toolEvent) => safeSend(sender, 'teach:agent-chat-tool', toolEvent)
      })
      if ('error' in result) {
        return { streamId, error: true as const, message: result.message }
      }
      return { streamId, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.error(`Agent chat stream failed: ${message}`)
      return { streamId, error: true as const, message }
    }
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

  ipcMain.handle('teach:read-lesson', async (_, payload: unknown) =>
    service.readLesson(parseReadLessonPayload(payload))
  )

  ipcMain.handle('teach:open-path', async (_, rawPath: unknown) => {
    const target = resolve(String(rawPath ?? ''))
    const state = await service.getState()
    const settings = await settingsService.load()
    const allowed =
      state.workspaces.some((workspace) => isInside(workspace.rootPath, target)) ||
      isInside(settings.worktree.rootPath, target)
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
      return new Response(body, {
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
    prompt: requireString(record.prompt, 'prompt'),
    courseName: optionalString(record.courseName),
    messages: parseAgentChatMessages(record.messages)
  }
}

function parseAgentChatMessages(value: unknown): AgentChatMessage[] {
  const rawMessages = Array.isArray(value) ? value : []
  const messages: AgentChatMessage[] = []
  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const role = m.role
    if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') continue
    messages.push({
      role,
      content: typeof m.content === 'string' ? m.content : m.content === null ? null : '',
      toolCallId: typeof m.toolCallId === 'string' ? m.toolCallId : undefined,
      toolCalls: Array.isArray(m.toolCalls)
        ? m.toolCalls.map((tc) => {
            const t = (tc ?? {}) as Record<string, unknown>
            return {
              id: typeof t.id === 'string' ? t.id : '',
              name: typeof t.name === 'string' ? t.name : '',
              arguments: typeof t.arguments === 'string' ? t.arguments : ''
            }
          })
        : undefined
    })
  }
  return messages
}

function parseAgentChatStreamPayload(payload: unknown): AgentChatStreamPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
    mode: record.mode === 'teaching' ? 'teaching' : record.mode === 'temporary' ? 'temporary' : undefined,
    messages: parseAgentChatMessages(record.messages),
    userInput: requireString(record.userInput, 'userInput')
  }
}

function parseSaveAgentConversationPayload(payload: unknown): SaveAgentConversationPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    conversationId: optionalString(record.conversationId) ?? null,
    selectedLessonPath:
      typeof record.selectedLessonPath === 'string'
        ? record.selectedLessonPath
        : record.selectedLessonPath === null
          ? null
          : undefined,
    selectedCourseRelativePath:
      typeof record.selectedCourseRelativePath === 'string'
        ? record.selectedCourseRelativePath
        : record.selectedCourseRelativePath === null
          ? null
          : undefined,
    courseName: optionalString(record.courseName),
    turns: Array.isArray(record.turns)
      ? record.turns.filter((turn): turn is AgentChatTurn => Boolean(turn) && typeof turn === 'object') as AgentChatTurn[]
      : []
  }
}

function parseReadAgentConversationPayload(payload: unknown): ReadAgentConversationPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    conversationId: requireString(record.conversationId, 'conversationId')
  }
}

function parseWorkspaceItemMetaPayload(payload: unknown): WorkspaceItemMetaPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    relativePath: requireString(record.relativePath, 'relativePath'),
    pinned: record.pinned === null ? null : typeof record.pinned === 'boolean' ? record.pinned : undefined,
    archived: record.archived === null ? null : typeof record.archived === 'boolean' ? record.archived : undefined
  }
}

function parseWorkspaceItemRemovePayload(payload: unknown): WorkspaceItemRemovePayload {
  const record = requireRecord(payload)
  const kind = requireString(record.kind, 'kind') as WorkspaceItemKind
  if (kind !== 'conversation' && kind !== 'file' && kind !== 'directory') {
    throw new Error('IPC payload field "kind" must be one of: conversation, file, directory.')
  }
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    relativePath: requireString(record.relativePath, 'relativePath'),
    kind
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

function parseListUpstreamModelsPayload(
  payload: unknown,
  providers: Array<{ id: string; baseUrl: string; apiKey: string; endpointFormat: ModelEndpointFormat }>
): ProbeProviderPayload | null {
  const providerIdPayload = payload && typeof payload === 'object'
    ? payload as { providerId?: unknown }
    : null
  const providerId = typeof payload === 'string'
    ? payload
    : typeof providerIdPayload?.providerId === 'string'
      ? providerIdPayload.providerId
      : ''
  if (providerId) {
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) return null
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      endpointFormat: provider.endpointFormat
    }
  }
  return parseProbeProviderPayload(payload)
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

function parseCreateMemoryPayload(payload: unknown): CreateTeachingMemoryPayload {
  const record = requireRecord(payload)
  return {
    content: requireString(record.content, 'content'),
    scope: requireMemoryScope(record.scope),
    tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : [],
    confidence: typeof record.confidence === 'number' ? record.confidence : Number(record.confidence),
    workspaceRoot: optionalString(record.workspaceRoot)
  }
}

function parseUpdateMemoryPayload(payload: unknown): UpdateTeachingMemoryPayload {
  const record = requireRecord(payload)
  return {
    ...(record.content !== undefined ? { content: requireString(record.content, 'content') } : {}),
    ...(record.tags !== undefined ? { tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : [] } : {}),
    ...(record.confidence !== undefined ? { confidence: typeof record.confidence === 'number' ? record.confidence : Number(record.confidence) } : {}),
    ...(record.disabled !== undefined ? { disabled: record.disabled === true } : {}),
    ...(record.workspaceRoot !== undefined ? { workspaceRoot: optionalString(record.workspaceRoot) } : {})
  }
}

function parseSettingsPatch(payload: unknown): TeachingSettingsPatch {
  return requireRecord(payload) as TeachingSettingsPatch
}

function parseRemoveGitWorktreePayload(payload: unknown): RemoveTeachingGitWorktreePayload {
  const record = requireRecord(payload)
  return {
    workspaceRoot: requireString(record.workspaceRoot, 'workspaceRoot'),
    worktreePath: requireString(record.worktreePath, 'worktreePath')
  }
}

function parseGitBranchPayload(payload: unknown): GitBranchPayload {
  const record = requireRecord(payload)
  return {
    workspaceRoot: requireString(record.workspaceRoot, 'workspaceRoot'),
    branch: requireString(record.branch, 'branch')
  }
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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function requireMemoryScope(value: unknown): 'user' | 'workspace' | 'project' {
  if (value === 'user' || value === 'workspace' || value === 'project') return value
  throw new Error('IPC payload field "scope" must be a valid memory scope.')
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

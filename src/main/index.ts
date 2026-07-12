import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, protocol, safeStorage, shell } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TeachingSettingsService } from './teaching-settings'
import { TeachingWorkspaceService } from './teaching-workspace'
import { SkillLibraryService } from './skill-library'
import {
  createAndSwitchGitBranchForWorkspace,
  getGitBranchesForWorkspace,
  listGitWorktreesForWorkspace,
  removeGitWorktreeForWorkspace,
  switchGitBranchForWorkspace
} from './teaching-git'
import { Logger } from './logger'
import { TrayManager, setAppIsQuitting } from './tray'
import { copyFirstExistingLegacyFileIfMissing, legacyUserDataCandidatePaths } from './app-data-migration'
import { probeModelProvider, fetchUpstreamModels } from './provider-connection'
import { resolveOptionalRegisteredWorkspaceRoot, resolveRegisteredWorkspaceRoot } from './teaching-workspace-access'
import { isPathInsideConfiguredRoot, isRealPathInsideRoot } from './path-access'
import { openExternalHttpUrl } from './external-links'
import {
  ensurePreviewBaseTag,
  injectPreviewMarkdownLinkBridge,
  LEGACY_PREVIEW_PROTOCOL,
  PREVIEW_PROTOCOL
} from '../shared/preview-markdown-bridge'
import { cancelStreamAskPending, resolveAskPending } from './ai/ask-pending'
import {
  cancelStreamToolPermissionPending,
  resolveToolPermissionPending
} from './ai/tool-permission-pending'
import {
  decodeToolAnswerPayload,
  optionalString,
  parseAgentChatStreamPayload,
  parseApplyLessonStylePayload,
  parseCreateMemoryPayload,
  parseCreateWorkspacePayload,
  parseGenerateLessonPayload,
  parseGitBranchPayload,
  parseListUpstreamModelsPayload,
  parseNotificationPayload,
  parseProbeProviderPayload,
  parseReadAgentConversationPayload,
  parseReadLessonPayload,
  parseReadWorkspaceChangeDiffPayload,
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
  requireStreamId,
  requireString,
  requireWindowControlAction
} from './teaching-ipc-commands'
import type { TeachingSettingsV1 } from '../shared/teaching-types'
import { teachingEventChannels, teachingInvokeChannels } from '../shared/teaching-ipc-contract'
import type { AgentEventBus } from './ai/agent-event-bus'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const APP_NAME = 'StudiumX'
const REGISTRY_FILE_NAME = 'studiumx-workspaces.json'
const LEGACY_REGISTRY_FILE_NAME = 'teachos-workspaces.json'
const SETTINGS_FILE_NAME = 'studiumx-settings.json'
const LEGACY_SETTINGS_FILE_NAME = 'teachos-settings.json'

let logger: Logger
let tray: TrayManager

protocol.registerSchemesAsPrivileged(
  [PREVIEW_PROTOCOL, LEGACY_PREVIEW_PROTOCOL].map((scheme) => ({
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false
    }
  }))
)

function registerTeachingIpc(
  service: TeachingWorkspaceService,
  settingsService: TeachingSettingsService,
  skillLibraryService: SkillLibraryService
): void {
  const activeAgentChatStreams = new Map<string, AbortController>()
  const retainedAgentEventBuses = new Map<string, AgentEventBus>()

  const retainAgentEventBus = (streamId: string, eventBus: AgentEventBus): void => {
    retainedAgentEventBuses.delete(streamId)
    retainedAgentEventBuses.set(streamId, eventBus)
    while (retainedAgentEventBuses.size > 32) {
      const oldestStreamId = retainedAgentEventBuses.keys().next().value
      if (typeof oldestStreamId !== 'string') break
      retainedAgentEventBuses.delete(oldestStreamId)
    }
  }

  const resolveGitWorkspaceRoot = async (rawWorkspaceRoot: string) => {
    const state = await service.getState()
    return resolveRegisteredWorkspaceRoot(state.workspaces, rawWorkspaceRoot)
  }

  const resolveOptionalWorkspaceRoot = async (rawWorkspaceRoot: string | undefined) => {
    const state = await service.getState()
    return resolveOptionalRegisteredWorkspaceRoot(state.workspaces, rawWorkspaceRoot)
  }

  ipcMain.handle(teachingInvokeChannels.getState, async () => service.getState())
  ipcMain.handle(teachingInvokeChannels.getSettings, async () => settingsService.load())
  ipcMain.handle(teachingInvokeChannels.listInterruptedAgentRuns, async () => service.listInterruptedAgentRuns())
  ipcMain.handle(teachingInvokeChannels.updateSettings, async (_, payload: unknown) => {
    const settings = await settingsService.patch(parseSettingsPatch(payload))
    void applyAppBehavior(settings)
    return settings
  })

  ipcMain.handle(teachingInvokeChannels.selectWorkspace, async (_, workspaceId: unknown) =>
    service.selectWorkspace(requireString(workspaceId, 'workspaceId'))
  )

  ipcMain.handle(teachingInvokeChannels.createWorkspace, async (_, payload: unknown) =>
    service.createWorkspace(parseCreateWorkspacePayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.importWorkspace, async () => {
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

  ipcMain.handle(teachingInvokeChannels.importWorkspacePath, async (_, rootPathRaw: unknown) =>
    service.importWorkspace(requireString(rootPathRaw, 'rootPath').trim())
  )

  ipcMain.handle(teachingInvokeChannels.pickDirectory, async (_, defaultPath: unknown) => {
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

  ipcMain.handle(teachingInvokeChannels.openImportLocation, async (_, rawPath: unknown) => {
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

  ipcMain.handle(teachingInvokeChannels.updateMission, async (_, payload: unknown) =>
    service.updateMission(parseUpdateMissionPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.applyLessonStyle, async (_, payload: unknown) =>
    service.applyLessonStyle(parseApplyLessonStylePayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.listSkills, async () => skillLibraryService.listSkills())
  ipcMain.handle(teachingInvokeChannels.installSkill, async (_, skillIdRaw: unknown) =>
    skillLibraryService.installSkill(requireString(skillIdRaw, 'skillId'))
  )

  ipcMain.handle(teachingInvokeChannels.generateLesson, async (_, payload: unknown) =>
    service.generateLesson(parseGenerateLessonPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.generateLessonStream, async (event, payload: unknown) => {
    const parsed = parseGenerateLessonPayload(payload)
    const streamId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const sender = event.sender
    try {
      const result = await service.generateLessonStream(parsed, {
        streamId,
        onChunk: (chunk) => safeSend(sender, teachingEventChannels.lessonStreamChunk, chunk),
        onStatus: (status) => safeSend(sender, teachingEventChannels.lessonStreamStatus, status)
      })
      return { streamId, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.error(`Lesson stream failed: ${message}`)
      return { streamId, error: true as const, message }
    }
  })

  ipcMain.handle(teachingInvokeChannels.agentChatStream, async (event, payload: unknown) => {
    const parsed = parseAgentChatStreamPayload(payload)
    const streamId = parsed.streamId ?? `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const sender = event.sender
    const controller = new AbortController()
    activeAgentChatStreams.set(streamId, controller)
    try {
      const result = await service.agentChatStream(parsed, {
        streamId,
        signal: controller.signal,
        onChunk: (chunk) => safeSend(sender, teachingEventChannels.agentChatChunk, chunk),
        onStatus: (status) => safeSend(sender, teachingEventChannels.agentChatStatus, status),
        onTool: (toolEvent) => safeSend(sender, teachingEventChannels.agentChatTool, toolEvent),
        onRealtimeEvent: (realtimeEvent) =>
          safeSend(sender, teachingEventChannels.agentChatEvent, realtimeEvent),
        onEventBusReady: (eventBus) => retainAgentEventBus(streamId, eventBus)
      })
      if ('canceled' in result) {
        return { streamId, ...result }
      }
      if ('error' in result) {
        return { streamId, ...result }
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

  ipcMain.handle(teachingInvokeChannels.replayAgentChatEvents, async (_, rawPayload: unknown) => {
    const payload = rawPayload && typeof rawPayload === 'object'
      ? rawPayload as { streamId?: unknown; afterSequence?: unknown }
      : {}
    const streamId = requireStreamId(payload.streamId)
    const afterSequence = typeof payload.afterSequence === 'number' && Number.isFinite(payload.afterSequence)
      ? Math.max(0, Math.floor(payload.afterSequence))
      : 0
    const eventBus = retainedAgentEventBuses.get(streamId)
    if (eventBus) return eventBus.replayAfter(afterSequence)
    return {
      streamId,
      available: false,
      requestedAfterSequence: afterSequence,
      fromSequence: afterSequence + 1,
      nextSequence: afterSequence + 1,
      hasGap: true,
      droppedEvents: 0,
      droppedBytes: 0,
      events: []
    }
  })

  ipcMain.handle(teachingInvokeChannels.cancelAgentChatStream, async (_, rawStreamId: unknown) => {
    const streamId = requireStreamId(rawStreamId)
    const controller = activeAgentChatStreams.get(streamId)
    if (controller) {
      controller.abort()
      activeAgentChatStreams.delete(streamId)
    }
    cancelStreamAskPending(streamId)
    cancelStreamToolPermissionPending(streamId)
    return { canceled: Boolean(controller) }
  })

  ipcMain.handle(teachingInvokeChannels.answerAgentChatTool, async (_, payload: unknown) => {
    const decoded = decodeToolAnswerPayload(payload)
    const resolvedAsk = resolveAskPending(decoded.streamId, decoded.toolCallId, decoded.answers)
    if (!resolvedAsk) {
      resolveToolPermissionPending(decoded.streamId, decoded.toolCallId, decoded.answers)
    }
    return { ok: true }
  })

  ipcMain.handle(teachingInvokeChannels.saveAgentConversation, async (_, payload: unknown) =>
    service.saveAgentConversation(parseSaveAgentConversationPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.readAgentConversation, async (_, payload: unknown) =>
    service.readAgentConversation(parseReadAgentConversationPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.setWorkspaceItemMeta, async (_, payload: unknown) =>
    service.setWorkspaceItemMeta(parseWorkspaceItemMetaPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.removeWorkspaceItem, async (_, payload: unknown) =>
    service.removeWorkspaceItem(parseWorkspaceItemRemovePayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.removeWorkspace, async (_, payload: unknown) =>
    service.removeWorkspace(parseWorkspaceRemovePayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.readLesson, async (_, payload: unknown) =>
    service.readLesson(parseReadLessonPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.readWorkspaceMarkdown, async (_, payload: unknown) =>
    service.readWorkspaceMarkdown(parseReadWorkspaceMarkdownPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.readWorkspaceChangeDiff, async (_, payload: unknown) =>
    service.readWorkspaceChangeDiff(parseReadWorkspaceChangeDiffPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.saveWorkspaceMarkdown, async (_, payload: unknown) =>
    service.saveWorkspaceMarkdown(parseSaveWorkspaceMarkdownPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.openPath, async (_, rawPath: unknown) => {
    const target = resolve(String(rawPath ?? ''))
    const state = await service.getState()
    const settings = await settingsService.load()
    const lexicalAllowedRoots = [
      ...state.workspaces.map((workspace) => workspace.rootPath),
      settings.worktree.rootPath,
      settings.workspace.defaultRoot
    ].filter((rootPath) => isPathInsideConfiguredRoot(rootPath, target))
    const allowed = (
      lexicalAllowedRoots.length > 0 &&
      (await Promise.all(lexicalAllowedRoots.map((rootPath) => isRealPathInsideRoot(rootPath, target)))).some(Boolean)
    )
    if (!allowed) {
      return { ok: false, message: 'Path is outside registered teaching workspaces.' }
    }
    const message = await shell.openPath(target)
    return { ok: message.length === 0, message: message || undefined }
  })

  ipcMain.handle(teachingInvokeChannels.openExternal, async (_, rawUrl: unknown) => {
    const settings = await settingsService.load()
    return openExternalHttpUrl(rawUrl, settings, (url) => shell.openExternal(url))
  })

  ipcMain.handle(teachingInvokeChannels.showNotification, async (_, rawPayload: unknown) => {
    const settings = await settingsService.load()
    if (!settings.notifications.enabled) return
    if (!Notification.isSupported()) return
    const payload = parseNotificationPayload(rawPayload)
    new Notification({ title: payload.title, body: payload.body }).show()
  })

  ipcMain.handle(teachingInvokeChannels.controlWindow, (event, rawAction: unknown) => {
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
  ipcMain.handle(teachingInvokeChannels.probeProvider, async (_, payload: unknown) => {
    const settings = await settingsService.load()
    const request = parseProbeProviderPayload(payload)
    return probeModelProvider(request, resolveProxyUrl(settings))
  })

  ipcMain.handle(teachingInvokeChannels.listUpstreamModels, async (_, payload: unknown) => {
    const settings = await settingsService.load()
    const request = parseListUpstreamModelsPayload(payload, settings.provider.providers)
    if (!request) return { ok: false, message: '未找到该 provider。' }
    return fetchUpstreamModels(request, resolveProxyUrl(settings))
  })

  // ---- Review cards + progress ----
  ipcMain.handle(teachingInvokeChannels.listReviewCards, async (_, workspaceIdRaw: unknown) =>
    service.listReviewCards(requireString(workspaceIdRaw, 'workspaceId'))
  )

  ipcMain.handle(teachingInvokeChannels.recordProgress, async (_, payload: unknown) =>
    service.recordProgress(parseRecordProgressPayload(payload))
  )

  ipcMain.handle(teachingInvokeChannels.getProgress, async (_, workspaceIdRaw: unknown) =>
    service.getProgress(requireString(workspaceIdRaw, 'workspaceId'))
  )

  ipcMain.handle(teachingInvokeChannels.listGitWorktrees, async (_, workspaceRootRaw: unknown) => {
    const settings = await settingsService.load()
    return listGitWorktreesForWorkspace(
      requireString(workspaceRootRaw, 'workspaceRoot'),
      settings.worktree.rootPath
    )
  })

  ipcMain.handle(teachingInvokeChannels.removeGitWorktree, async (_, payload: unknown) => {
    const settings = await settingsService.load()
    const request = parseRemoveGitWorktreePayload(payload)
    const access = await resolveGitWorkspaceRoot(request.workspaceRoot)
    if (!access.ok) return { ok: false, message: access.message }
    return removeGitWorktreeForWorkspace({
      workspaceRoot: access.rootPath,
      worktreePath: request.worktreePath,
      worktreeRoot: settings.worktree.rootPath
    })
  })

  ipcMain.handle(teachingInvokeChannels.listGitBranches, async (_, workspaceRootRaw: unknown) => {
    const access = await resolveGitWorkspaceRoot(requireString(workspaceRootRaw, 'workspaceRoot'))
    if (!access.ok) return access
    return getGitBranchesForWorkspace(access.rootPath)
  })

  ipcMain.handle(teachingInvokeChannels.switchGitBranch, async (_, payload: unknown) => {
    const request = parseGitBranchPayload(payload)
    const access = await resolveGitWorkspaceRoot(request.workspaceRoot)
    if (!access.ok) return access
    return switchGitBranchForWorkspace(access.rootPath, request.branch)
  })

  ipcMain.handle(teachingInvokeChannels.createGitBranch, async (_, payload: unknown) => {
    const request = parseGitBranchPayload(payload)
    const access = await resolveGitWorkspaceRoot(request.workspaceRoot)
    if (!access.ok) return access
    return createAndSwitchGitBranchForWorkspace(access.rootPath, request.branch)
  })

  ipcMain.handle(teachingInvokeChannels.listMemory, async (_, workspaceRootRaw: unknown) => {
    const access = await resolveOptionalWorkspaceRoot(optionalString(workspaceRootRaw))
    if (!access.ok) throw new Error(access.message)
    return service.listMemory(access.rootPath)
  })

  ipcMain.handle(teachingInvokeChannels.getMemoryDiagnostics, async () =>
    service.getMemoryDiagnostics()
  )

  ipcMain.handle(teachingInvokeChannels.getConnectorStatuses, async () =>
    service.getConnectorStatuses()
  )

  ipcMain.handle(teachingInvokeChannels.createMemory, async (_, payload: unknown) => {
    const request = parseCreateMemoryPayload(payload)
    const access = await resolveOptionalWorkspaceRoot(request.workspaceRoot)
    if (!access.ok) throw new Error(access.message)
    if (request.scope !== 'user' && !access.rootPath) {
      throw new Error('Workspace memory requires a registered teaching workspace.')
    }
    return service.createMemory({ ...request, workspaceRoot: access.rootPath })
  })

  ipcMain.handle(teachingInvokeChannels.updateMemory, async (_, memoryIdRaw: unknown, patchRaw: unknown) => {
    const patch = parseUpdateMemoryPayload(patchRaw)
    const access = await resolveOptionalWorkspaceRoot(patch.workspaceRoot)
    if (!access.ok) throw new Error(access.message)
    return service.updateMemory(requireString(memoryIdRaw, 'memoryId'), { ...patch, workspaceRoot: access.rootPath })
  })

  ipcMain.handle(teachingInvokeChannels.deleteMemory, async (_, memoryIdRaw: unknown, workspaceRootRaw: unknown) => {
    const access = await resolveOptionalWorkspaceRoot(optionalString(workspaceRootRaw))
    if (!access.ok) throw new Error(access.message)
    return service.deleteMemory(requireString(memoryIdRaw, 'memoryId'), access.rootPath)
  })

  // ---- Logging + diagnostics ----
  ipcMain.handle(teachingInvokeChannels.openLogFile, async () => {
    const message = await shell.openPath(logger.path)
    return { ok: message.length === 0, message: message || undefined }
  })

  ipcMain.handle(teachingInvokeChannels.openAppDataDir, async () => {
    const message = await shell.openPath(app.getPath('userData'))
    return { ok: message.length === 0, message: message || undefined }
  })
}

function registerPreviewProtocol(service: TeachingWorkspaceService): void {
  const handlePreviewRequest = async (request: Request): Promise<Response> => {
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
        ? injectPreviewMarkdownLinkBridge(ensurePreviewBaseTag(body.toString('utf8'), request.url))
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
  }

  protocol.handle(PREVIEW_PROTOCOL, handlePreviewRequest)
  protocol.handle(LEGACY_PREVIEW_PROTOCOL, handlePreviewRequest)
}

function safeSend(sender: Electron.WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function resolveProxyUrl(settings: TeachingSettingsV1): string {
  return settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
}

function buildWindowsTitleBarOverlay(): Electron.TitleBarOverlay {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f5f5' : '#1f1f1f',
    height: 32
  }
}

const MAC_WINDOW_BUTTON_POSITION = { x: 22, y: 23 }

/** Apply app-behavior settings (login item, tray, logging) to the live process. */
async function applyAppBehavior(settings: TeachingSettingsV1): Promise<void> {
  try {
    nativeTheme.themeSource = settings.theme
    if (process.platform === 'win32') {
      for (const targetWindow of BrowserWindow.getAllWindows()) {
        if (!targetWindow.isDestroyed()) {
          targetWindow.setTitleBarOverlay(buildWindowsTitleBarOverlay())
        }
      }
    }
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

function buildDesktopWindowVisualOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'win32') {
    return {
      backgroundColor: '#00000000',
      titleBarStyle: 'hidden',
      titleBarOverlay: buildWindowsTitleBarOverlay(),
      backgroundMaterial: 'acrylic'
    }
  }

  if (process.platform === 'darwin') {
    return {
      backgroundColor: '#00000000',
      titleBarStyle: 'hidden',
      trafficLightPosition: MAC_WINDOW_BUTTON_POSITION,
      vibrancy: 'under-window',
      visualEffectState: 'active'
    }
  }

  return {
    backgroundColor: '#f7f9fe',
    frame: false
  }
}

function createWindow(
  settingsService: TeachingSettingsService,
  hidden = false
): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: APP_NAME,
    autoHideMenuBar: true,
    show: false,
    ...buildDesktopWindowVisualOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonPosition(MAC_WINDOW_BUTTON_POSITION)
  }

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
    void openWindowExternalUrl(url, settingsService)
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
    app.setName(APP_NAME)
    app.setAppUserModelId('com.local.studiumx')

    const appDataPath = app.getPath('appData')
    const userDataPath = app.getPath('userData')
    const defaultRoot = join(app.getPath('documents'), `${APP_NAME} Workspaces`)
    const registryPath = join(userDataPath, REGISTRY_FILE_NAME)
    const legacyUserDataPaths = legacyUserDataCandidatePaths(appDataPath, userDataPath)
    await copyFirstExistingLegacyFileIfMissing(registryPath, [
      join(userDataPath, LEGACY_REGISTRY_FILE_NAME),
      ...legacyUserDataPaths.map((path) => join(path, LEGACY_REGISTRY_FILE_NAME))
    ])
    await copyFirstExistingLegacyFileIfMissing(join(userDataPath, SETTINGS_FILE_NAME), [
      join(userDataPath, LEGACY_SETTINGS_FILE_NAME),
      ...legacyUserDataPaths.map((path) => join(path, LEGACY_SETTINGS_FILE_NAME))
    ])

    const settingsService = new TeachingSettingsService({
      userDataPath,
      defaultRoot,
      secretStorage: safeStorage
    })
    const initialSettings = await settingsService.load()

    logger = new Logger({
      userDataPath,
      enabled: initialSettings.log.enabled,
      retentionDays: initialSettings.log.retentionDays
    })
    installConsoleSink(logger)

    tray = new TrayManager(logger)

    const skillLibraryService = new SkillLibraryService({
      builtInRoots: [
        join(process.resourcesPath, 'builtin-skills'),
        join(app.getAppPath(), 'resources', 'builtin-skills'),
        join(process.cwd(), 'resources', 'builtin-skills')
      ]
    })
    await skillLibraryService.listSkills()

    const workspaceService = new TeachingWorkspaceService({
      registryPath,
      defaultRoot,
      settingsProvider: () => settingsService.load(),
      skillLibraryService
    })
    await workspaceService.reconcileInterruptedAgentRuns()

    registerPreviewProtocol(workspaceService)
    registerTeachingIpc(workspaceService, settingsService, skillLibraryService)

    const startHidden = initialSettings.appBehavior.startMinimized || process.argv.includes('--hidden')
    createWindow(settingsService, startHidden)

    void applyAppBehavior(initialSettings)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(settingsService)
      }
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

async function openWindowExternalUrl(rawUrl: string, settingsService: TeachingSettingsService): Promise<void> {
  try {
    const settings = await settingsService.load()
    const result = await openExternalHttpUrl(rawUrl, settings, (url) => shell.openExternal(url))
    if (!result.ok) {
      logger?.warn(`External link blocked: ${result.message ?? 'Unknown reason.'}`)
    }
  } catch (error) {
    logger?.warn(`External link blocked: ${errorMessage(error)}`)
  }
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

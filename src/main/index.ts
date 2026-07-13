import { app, BrowserWindow, nativeTheme, protocol, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TeachingSettingsService } from './teaching-settings'
import { TeachingWorkspaceService } from './teaching-workspace'
import { SkillLibraryService } from './skill-library'
import { LearningAnalyticsService } from './teaching/services/learning-analytics'
import { registerTeachingIpcGateway } from './teaching-ipc-gateway'
import { Logger } from './logger'
import { TrayManager, setAppIsQuitting } from './tray'
import { createAppDataMigrationPlan } from './app-data-migration-plan'
import { openExternalHttpUrl } from './external-links'
import { LEGACY_PREVIEW_PROTOCOL, PREVIEW_PROTOCOL } from '../shared/preview-markdown-bridge'
import type { TeachingSettingsV1 } from '../shared/teaching-types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const APP_NAME = 'StudiumX'

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

function registerPreviewProtocol(service: TeachingWorkspaceService): void {
  const handlePreviewRequest = async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const workspaceId = url.hostname
      const relativePath = rawPreviewPath(request.url)
      if (relativePath === null) return new Response('Not found', { status: 404 })
      const preview = await service.readPreviewDocument(workspaceId, relativePath, request.url)
      if (!preview) return new Response('Not found', { status: 404 })
      return new Response(new Uint8Array(preview.body), {
        headers: {
          'Content-Type': preview.mimeType,
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

/** Preserve URL escaping so document resolution can reject encoded traversal before URL normalization. */
function rawPreviewPath(requestUrl: string): string | null {
  const schemeEnd = requestUrl.indexOf('://')
  if (schemeEnd < 0) return null
  const authorityEnd = requestUrl.indexOf('/', schemeEnd + 3)
  if (authorityEnd < 0) return ''
  return requestUrl.slice(authorityEnd + 1).split(/[?#]/, 1)[0] ?? ''
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
    const appDataMigration = createAppDataMigrationPlan({ appDataPath, userDataPath })
    await appDataMigration.apply()
    const { registryPath } = appDataMigration

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

    const learningAnalyticsService = new LearningAnalyticsService({
      appDataRoot: userDataPath,
      listWorkspaceSummaries: () => workspaceService.listWorkspaceSummariesForAnalytics(),
      readConversation: (workspaceId, conversationId) => workspaceService.readAgentConversation({
        workspaceId,
        conversationId
      }),
      getProgress: (workspaceId) => workspaceService.getProgress(workspaceId),
      listReviewCards: (workspaceId) => workspaceService.listReviewCards(workspaceId),
      listMemory: (workspaceRoot) => workspaceService.listMemory(workspaceRoot),
      getMemoryDiagnostics: () => workspaceService.getMemoryDiagnostics(),
      listSkills: () => skillLibraryService.listSkills(),
      loadSettings: () => settingsService.load(),
      getConnectorStatuses: () => workspaceService.getConnectorStatuses(),
      listWorkspaceChanges: (workspaceId) => workspaceService.listWorkspaceChangesForAnalytics(workspaceId)
    })

    registerPreviewProtocol(workspaceService)
    registerTeachingIpcGateway({
      workspaceService,
      settingsService,
      skillLibraryService,
      learningAnalyticsService,
      logger,
      applyAppBehavior
    })

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

import { app, BrowserWindow, nativeTheme, protocol, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TeachingSettingsService } from './teaching-settings'
import { TeachingWorkspaceService } from './teaching-workspace'
import { SkillLibraryService } from './skill-library'
import { LearningAnalyticsService } from './teaching/services/learning-analytics'
import { registerTeachingIpcGateway } from './teaching-ipc-gateway'
import { registerMusicIpcGateway } from './music/music-ipc-gateway'
import { Logger } from './logger'
import { TrayManager, setAppIsQuitting } from './tray'
import { createAppDataMigrationPlan } from './app-data-migration-plan'
import { openExternalHttpUrl } from './external-links'
import { createApplicationRuntime, type ApplicationRuntime } from './application-runtime'
import { LEGACY_PREVIEW_PROTOCOL, PREVIEW_PROTOCOL } from '../shared/preview-markdown-bridge'
import type { TeachingSettingsV1 } from '../shared/teaching-types'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const APP_NAME = 'StudiumX'

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

function registerPreviewProtocol(service: TeachingWorkspaceService, logger: Logger): void {
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
      logger.warn(`Preview protocol failed: ${errorMessage(error)}`)
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
async function applyAppBehavior(
  settings: TeachingSettingsV1,
  tray: TrayManager,
  logger: Logger
): Promise<void> {
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
    logger.warn(`Failed to set login item: ${errorMessage(error)}`)
  }
  tray.configure(settings.appBehavior.closeAction, settings.locale)
  logger.configure(settings.log.enabled, settings.log.retentionDays)
}

function buildDesktopWindowVisualOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'win32') {
    return {
      // Keep the native drag strip opaque; acrylic remains visible through a transparent overlay.
      backgroundColor: '#f7f9fe',
      titleBarStyle: 'hidden',
      titleBarOverlay: buildWindowsTitleBarOverlay(),
      backgroundMaterial: 'none'
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
  tray: TrayManager,
  logger: Logger,
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
    logger.error(`Preload failed at ${preloadPath}: ${error.stack ?? error.message}`)
  })

  mainWindow.once('ready-to-show', () => {
    if (!hidden) mainWindow.show()
  })

  if (hidden) {
    // start-minimized: show only the tray, keep window hidden until summoned
    void 0
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openWindowExternalUrl(url, settingsService, logger)
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
  let runtime: ApplicationRuntime | undefined

  app.whenReady().then(async () => {
    app.setName(APP_NAME)
    app.setAppUserModelId('com.local.studiumx')

    const appDataPath = app.getPath('appData')
    const userDataPath = app.getPath('userData')
    const defaultRoot = join(app.getPath('documents'), `${APP_NAME} Workspaces`)
    const appDataMigration = createAppDataMigrationPlan({ appDataPath, userDataPath })

    runtime = createApplicationRuntime({
      prepare: () => appDataMigration.apply(),
      create: async () => {
        const settingsService = new TeachingSettingsService({
          userDataPath,
          defaultRoot,
          secretStorage: safeStorage
        })
        const initialSettings = await settingsService.load()
        const logger = new Logger({
          userDataPath,
          enabled: initialSettings.log.enabled,
          retentionDays: initialSettings.log.retentionDays
        })
        logger.captureConsole()

        const tray = new TrayManager(logger)
        const skillLibraryService = new SkillLibraryService({
          builtInRoots: [
            join(process.resourcesPath, 'builtin-skills'),
            join(app.getAppPath(), 'resources', 'builtin-skills'),
            join(process.cwd(), 'resources', 'builtin-skills')
          ]
        })
        await skillLibraryService.listSkills()

        const workspaceService = new TeachingWorkspaceService({
          registryPath: appDataMigration.registryPath,
          defaultRoot,
          settingsProvider: () => settingsService.load(),
          skillLibraryService
        })
        return {
          settingsService,
          initialSettings,
          logger,
          tray,
          skillLibraryService,
          workspaceService
        }
      },
      recover: async (services) => {
        await services.workspaceService.reconcileInterruptedAgentRuns()

        const learningAnalyticsService = new LearningAnalyticsService({
          appDataRoot: userDataPath,
          listWorkspaceSummaries: () => services.workspaceService.listWorkspaceSummariesForAnalytics(),
          listTemporaryConversationSummaries: () => services.workspaceService.listTemporaryConversationSummariesForAnalytics(),
          readTemporaryConversation: (workspaceId, conversationId) => services.workspaceService.readTemporaryConversationForAnalytics(
            workspaceId,
            conversationId
          ),
          readConversation: (workspaceId, conversationId) => services.workspaceService.readAgentConversation({
            workspaceId,
            conversationId
          }),
          getProgress: (workspaceId) => services.workspaceService.getProgress(workspaceId),
          listReviewCards: (workspaceId) => services.workspaceService.listReviewCards(workspaceId),
          listMemory: (workspaceRoot) => services.workspaceService.listMemory(workspaceRoot),
          getMemoryDiagnostics: () => services.workspaceService.getMemoryDiagnostics(),
          listSkills: () => services.skillLibraryService.listSkills(),
          loadSettings: () => services.settingsService.load(),
          getConnectorStatuses: () => services.workspaceService.getConnectorStatuses(),
          listWorkspaceChanges: (workspaceId) => services.workspaceService.listWorkspaceChangesForAnalytics(workspaceId)
        })

        return { ...services, learningAnalyticsService }
      },
      register: ({
        workspaceService,
        settingsService,
        skillLibraryService,
        learningAnalyticsService,
        logger,
        tray
      }) => {
        registerPreviewProtocol(workspaceService, logger)
        registerTeachingIpcGateway({
          workspaceService,
          settingsService,
          skillLibraryService,
          learningAnalyticsService,
          logger,
          applyAppBehavior: (settings) => applyAppBehavior(settings, tray, logger)
        })

        registerMusicIpcGateway()
},
      open: ({ settingsService, initialSettings, tray, logger }) => {
        const startHidden = initialSettings.appBehavior.startMinimized || process.argv.includes('--hidden')
        createWindow(settingsService, tray, logger, startHidden)
      },
      applyBehavior: ({ initialSettings, tray, logger }) => {
        void applyAppBehavior(initialSettings, tray, logger)
      },
      activate: ({ settingsService, tray, logger }) => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow(settingsService, tray, logger)
        }
      },
      drain: ({ logger }) => logger.shutdown()
    })

    await runtime.start()

    app.on('activate', () => {
      runtime?.activate()
    })
  })

  app.on('second-instance', () => {
    focusExistingWindow()
  })

  app.on('before-quit', (event) => {
    setAppIsQuitting(true)
    const shutdown = runtime?.beginShutdown()
    if (!shutdown) return

    event.preventDefault()
    void shutdown.finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    // With close-to-tray the window is hidden, not closed, so this only fires
    // on a real quit. Respect the platform convention otherwise.
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

async function openWindowExternalUrl(
  rawUrl: string,
  settingsService: TeachingSettingsService,
  logger: Logger
): Promise<void> {
  try {
    const settings = await settingsService.load()
    const result = await openExternalHttpUrl(rawUrl, settings, (url) => shell.openExternal(url))
    if (!result.ok) {
      logger.warn(`External link blocked: ${result.message ?? 'Unknown reason.'}`)
    }
  } catch (error) {
    logger.warn(`External link blocked: ${errorMessage(error)}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

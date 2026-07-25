import { useEffect, useReducer, useRef } from 'react'
import { TEACHING_MODEL_PROVIDER_PRESETS } from '../../../shared/teaching-types'
import type {
  CreateTeachingMemoryPayload,
  ListUpstreamModelsResult,
  ProbeProviderPayload,
  ProbeProviderResult,
  RemoveTeachingGitWorktreePayload,
  SettingsSection,
  TeachingGitWorktreesResult,
  TeachingMemoryRecord,
  TeachingMemoryScope,
  TeachingModelProviderProfile,
  TeachingSettingsPatch,
  TeachingSettingsV1,
  TeachingWorkspaceSummary,
  UpdateTeachingMemoryPayload
} from '../../../shared/teaching-types'

export type TeachingWorkspaceConfigurationAdapter = {
  updateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  listGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  removeGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<void>
  listMemory: (workspaceRoot?: string) => Promise<void>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<boolean>
  updateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<boolean>
  deleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  loadMemoryDiagnostics: () => Promise<void>
}

export type TeachingWorkspaceConfigurationStatus =
  | { kind: 'connecting' }
  | { kind: 'pulling' }
  | { kind: 'success'; latencyMs: number; modelCount: number }
  | { kind: 'synced'; modelCount: number }
  | { kind: 'reset' }
  | { kind: 'failure'; message: string }

export type TeachingMemoryDialog =
  | null
  | { mode: 'create' }
  | { mode: 'edit' | 'view'; memory: TeachingMemoryRecord }

export type TeachingMemoryDraft = {
  content: string
  scope: TeachingMemoryScope
  tags: string
  confidence: number
}

type ConfigurationState = {
  provider: {
    busy: boolean
    status: TeachingWorkspaceConfigurationStatus | null
  }
  worktrees: {
    result: TeachingGitWorktreesResult | null
    loading: boolean
    busyPath: string | null
  }
  memory: {
    scopeFilter: 'all' | TeachingMemoryScope
    dialog: TeachingMemoryDialog
    draft: TeachingMemoryDraft
    busy: boolean
    error: string | null
  }
}

export type TeachingWorkspaceSettingsPath =
  | 'theme'
  | 'locale'
  | 'density'
  | 'uiFontScale'
  | 'appBehavior.closeAction'
  | 'appBehavior.openAtLogin'
  | 'appBehavior.startMinimized'
  | 'log.enabled'
  | 'log.retentionDays'
  | 'generator.model'
  | 'generator.reasoningEffort'
  | 'generator.temperature'
  | 'generator.maxOutputTokens'
  | 'generator.lessonDurationMinutes'
  | 'generator.includeRetrievalPractice'
  | 'generator.generateReference'
  | 'generator.structuredOutput'
  | 'generator.streaming'
  | 'generator.requestTimeoutMs'
  | 'tools.enabled'
  | 'tools.workspaceRead'
  | 'tools.approvalMode'
  | 'tools.workspaceShell'
  | 'tools.sandboxMode'
  | 'tools.windowsSandboxLevel'
  | 'tools.webSearch'
  | 'tools.webFetch'
  | 'tools.maxIterations'
  | 'webSearch.backend'
  | 'webSearch.fallbackEnabled'
  | 'webSearch.maxResults'
  | 'webSearch.firecrawlApiKey'
  | 'webSearch.firecrawlApiUrl'
  | 'webSearch.parallelApiKey'
  | 'webSearch.parallelSearchMode'
  | 'webSearch.tavilyApiKey'
  | 'webSearch.exaApiKey'
  | 'webSearch.searxngUrl'
  | 'webSearch.braveApiKey'
  | 'webSearch.xaiApiKey'
  | 'webSearch.xaiModel'
  | 'workspace.confirmBeforeGenerating'
  | 'workspace.autoOpenGeneratedLesson'
  | 'workspace.showAllCourseFiles'
  | 'memory.enabled'
  | 'memory.maxInjected'
  | 'notifications.enabled'
  | 'notifications.lessonGenerated'
  | 'notifications.workspaceImported'
  | 'notifications.errors'
  | 'privacy.maskApiKeys'
  | 'privacy.allowExternalLinks'
  | 'provider.proxy.enabled'
  | 'provider.proxy.url'
  | 'webRemoteControl.enabled'
  | 'webRemoteControl.bindMode'
  | 'webRemoteControl.port'
  | 'webRemoteControl.relayMode'
  | 'webRemoteControl.externalRelayWsUrl'
  | 'webRemoteControl.externalMobileBaseUrl'

/** Builds persisted-setting patches from domain setting names, keeping patch shape out of the view. */
export function buildTeachingWorkspaceSettingsPatch(
  path: TeachingWorkspaceSettingsPath,
  value: unknown
): TeachingSettingsPatch {
  switch (path) {
    case 'theme':
    case 'locale':
    case 'density':
    case 'uiFontScale':
      return { [path]: value } as TeachingSettingsPatch
    case 'appBehavior.closeAction':
      return { appBehavior: { closeAction: value as TeachingSettingsV1['appBehavior']['closeAction'], closeToTray: value === 'tray' } }
    case 'appBehavior.openAtLogin':
    case 'appBehavior.startMinimized':
      return { appBehavior: { [path.slice('appBehavior.'.length)]: value } }
    case 'log.enabled':
    case 'log.retentionDays':
      return { log: { [path.slice('log.'.length)]: value } }
    case 'generator.model':
    case 'generator.reasoningEffort':
    case 'generator.temperature':
    case 'generator.maxOutputTokens':
    case 'generator.lessonDurationMinutes':
    case 'generator.includeRetrievalPractice':
    case 'generator.generateReference':
    case 'generator.structuredOutput':
    case 'generator.streaming':
    case 'generator.requestTimeoutMs':
      return { generator: { [path.slice('generator.'.length)]: value } }
    case 'tools.enabled':
    case 'tools.workspaceRead':
    case 'tools.approvalMode':
    case 'tools.workspaceShell':
    case 'tools.sandboxMode':
    case 'tools.windowsSandboxLevel':
    case 'tools.webSearch':
    case 'tools.webFetch':
    case 'tools.maxIterations':
      return { tools: { [path.slice('tools.'.length)]: value } }
    case 'webSearch.backend':
    case 'webSearch.fallbackEnabled':
    case 'webSearch.maxResults':
    case 'webSearch.firecrawlApiKey':
    case 'webSearch.firecrawlApiUrl':
    case 'webSearch.parallelApiKey':
    case 'webSearch.parallelSearchMode':
    case 'webSearch.tavilyApiKey':
    case 'webSearch.exaApiKey':
    case 'webSearch.searxngUrl':
    case 'webSearch.braveApiKey':
    case 'webSearch.xaiApiKey':
    case 'webSearch.xaiModel':
      return { webSearch: { [path.slice('webSearch.'.length)]: value } } as TeachingSettingsPatch
    case 'workspace.confirmBeforeGenerating':
    case 'workspace.autoOpenGeneratedLesson':
    case 'workspace.showAllCourseFiles':
      return { workspace: { [path.slice('workspace.'.length)]: value } }
    case 'memory.enabled':
    case 'memory.maxInjected':
      return { memory: { [path.slice('memory.'.length)]: value } }
    case 'notifications.enabled':
    case 'notifications.lessonGenerated':
    case 'notifications.workspaceImported':
    case 'notifications.errors':
      return { notifications: { [path.slice('notifications.'.length)]: value } }
    case 'privacy.maskApiKeys':
    case 'privacy.allowExternalLinks':
      return { privacy: { [path.slice('privacy.'.length)]: value } }
    case 'provider.proxy.enabled':
    case 'provider.proxy.url':
      return { provider: { proxy: { [path.slice('provider.proxy.'.length)]: value } } }
    case 'webRemoteControl.enabled':
    case 'webRemoteControl.bindMode':
    case 'webRemoteControl.port':
    case 'webRemoteControl.relayMode':
    case 'webRemoteControl.externalRelayWsUrl':
    case 'webRemoteControl.externalMobileBaseUrl':
      return {
        webRemoteControl: {
          [path.slice('webRemoteControl.'.length)]: value
        }
      } as TeachingSettingsPatch
  }
}

export type TeachingWorkspaceConfiguration = ReturnType<typeof createTeachingWorkspaceConfiguration>

export function createTeachingWorkspaceConfiguration({
  adapter,
  getSettings,
  getWorkspaceRoot,
  onStateChange
}: {
  adapter: TeachingWorkspaceConfigurationAdapter
  getSettings: () => TeachingSettingsV1
  getWorkspaceRoot: () => string | undefined
  onStateChange?: () => void
}) {
  let state: ConfigurationState = {
    provider: { busy: false, status: null },
    worktrees: { result: null, loading: false, busyPath: null },
    memory: {
      scopeFilter: 'all',
      dialog: null,
      draft: emptyMemoryDraft(),
      busy: false,
      error: null
    }
  }

  const publish = (next: ConfigurationState): void => {
    state = next
    onStateChange?.()
  }
  const updateProviderState = (provider: ConfigurationState['provider']): void => publish({ ...state, provider })
  const updateWorktreesState = (worktrees: ConfigurationState['worktrees']): void => publish({ ...state, worktrees })
  const updateMemoryState = (memory: ConfigurationState['memory']): void => publish({ ...state, memory })

  const resolveProvider = (providerId: string): TeachingModelProviderProfile | null => {
    const settings = getSettings()
    const existing = settings.provider.providers.find((provider) => provider.id === providerId)
    if (existing) return existing
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === providerId)
    return preset ? { ...preset, apiKey: '' } : null
  }

  const persistProvider = async (providerId: string, patch: Partial<TeachingModelProviderProfile>, options?: { syncModel?: boolean; activate?: boolean }): Promise<void> => {
    const settings = getSettings()
    const current = resolveProvider(providerId)
    if (!current) return
    const nextProvider = { ...current, ...patch }
    const exists = settings.provider.providers.some((provider) => provider.id === providerId)
    const providers = exists
      ? settings.provider.providers.map((provider) => provider.id === providerId ? nextProvider : provider)
      : [...settings.provider.providers, nextProvider]
    const syncModel = options?.syncModel && settings.generator.providerId === providerId
    await adapter.updateSettings({
      provider: {
        ...(options?.activate ? { activeProviderId: providerId } : {}),
        providers
      },
      ...(syncModel ? { generator: { model: nextProvider.models[0] ?? '' } } : {})
    })
  }

  const refreshMemory = async (): Promise<void> => {
    try {
      await adapter.listMemory(getWorkspaceRoot())
      await adapter.loadMemoryDiagnostics()
      if (state.memory.error) updateMemoryState({ ...state.memory, error: null })
    } catch (error) {
      updateMemoryState({ ...state.memory, error: errorMessage(error) })
    }
  }

  const refreshWorktrees = async (): Promise<void> => {
    const workspaceRoot = getWorkspaceRoot()
    if (!workspaceRoot) {
      updateWorktreesState({ ...state.worktrees, result: null, loading: false })
      return
    }
    updateWorktreesState({ ...state.worktrees, loading: true })
    try {
      const result = await adapter.listGitWorktrees(workspaceRoot)
      updateWorktreesState({ ...state.worktrees, result, loading: false })
    } catch (error) {
      updateWorktreesState({
        ...state.worktrees,
        loading: false,
        result: { ok: false, reason: 'error', message: errorMessage(error) }
      })
    }
  }

  return {
    get state(): Readonly<ConfigurationState> {
      return state
    },

    updateSetting: (path: TeachingWorkspaceSettingsPath, value: unknown): Promise<void> =>
      adapter.updateSettings(buildTeachingWorkspaceSettingsPatch(path, value)),

    clearProviderStatus: (): void => {
      if (state.provider.status) updateProviderState({ ...state.provider, status: null })
    },

    selectGenerationProvider: async (providerId: string): Promise<void> => {
      const settings = getSettings()
      const provider = resolveProvider(providerId)
      if (!provider) return
      await adapter.updateSettings({
        provider: { activeProviderId: provider.id },
        generator: { providerId: provider.id, model: provider.models[0] ?? '', endpointFormat: provider.endpointFormat },
        ...(settings.provider.providers.some((item) => item.id === provider.id)
          ? {}
          : { provider: { activeProviderId: provider.id, providers: [...settings.provider.providers, provider] } })
      })
    },

    selectModelProvider: async (providerId: string): Promise<void> => {
      const settings = getSettings()
      const provider = resolveProvider(providerId)
      if (!provider) return
      const providers = settings.provider.providers.some((item) => item.id === provider.id)
        ? settings.provider.providers
        : [...settings.provider.providers, provider]
      await adapter.updateSettings({
        provider: { activeProviderId: provider.id, providers },
        generator: { providerId: provider.id, model: provider.models[0] ?? '', endpointFormat: provider.endpointFormat }
      })
    },

    updateModelProvider: (providerId: string, patch: Partial<TeachingModelProviderProfile>): Promise<void> =>
      persistProvider(providerId, patch),

    updateModelProviderModels: (providerId: string, models: string[], syncGeneratorModel = true): Promise<void> =>
      persistProvider(providerId, { models }, { syncModel: syncGeneratorModel }),

    probeModelProvider: async (providerId: string): Promise<void> => {
      const provider = resolveProvider(providerId)
      if (!provider) return
      updateProviderState({ busy: true, status: { kind: 'connecting' } })
      try {
        const result = await adapter.probeProvider(toProbePayload(provider))
        updateProviderState({
          busy: false,
          status: result.ok
            ? { kind: 'success', latencyMs: result.latencyMs, modelCount: result.modelIds.length }
            : { kind: 'failure', message: result.message }
        })
      } catch (error) {
        updateProviderState({ busy: false, status: { kind: 'failure', message: errorMessage(error) } })
      }
    },

    refreshModelProviderModels: async (providerId: string): Promise<void> => {
      const provider = resolveProvider(providerId)
      if (!provider) return
      updateProviderState({ busy: true, status: { kind: 'pulling' } })
      try {
        const result = await adapter.listUpstreamModels(toProbePayload(provider))
        if (!result.ok) {
          updateProviderState({ busy: false, status: { kind: 'failure', message: result.message } })
          return
        }
        await persistProvider(providerId, { models: result.modelIds }, { syncModel: result.modelIds.length > 0 })
        updateProviderState({ busy: false, status: { kind: 'synced', modelCount: result.modelIds.length } })
      } catch (error) {
        updateProviderState({ busy: false, status: { kind: 'failure', message: errorMessage(error) } })
      }
    },

    resetModelProvider: async (providerId: string): Promise<void> => {
      const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === providerId)
      if (!preset) return
      const provider = resolveProvider(providerId)
      const resetProvider = { ...preset, apiKey: provider?.apiKey ?? '' }
      const settings = getSettings()
      const providers = settings.provider.providers.some((item) => item.id === providerId)
        ? settings.provider.providers.map((item) => item.id === providerId ? resetProvider : item)
        : [...settings.provider.providers, resetProvider]
      try {
        await adapter.updateSettings({
          provider: { activeProviderId: providerId, providers },
          generator: { providerId, model: resetProvider.models[0] ?? '', endpointFormat: resetProvider.endpointFormat }
        })
        updateProviderState({ busy: false, status: { kind: 'reset' } })
      } catch (error) {
        updateProviderState({ busy: false, status: { kind: 'failure', message: errorMessage(error) } })
      }
    },

    refreshWorktrees,

    removeWorktree: async (worktreePath: string): Promise<void> => {
      const workspaceRoot = getWorkspaceRoot()
      if (!workspaceRoot) return
      updateWorktreesState({ ...state.worktrees, busyPath: worktreePath })
      try {
        await adapter.removeGitWorktree({ workspaceRoot, worktreePath })
        await refreshWorktrees()
      } catch (error) {
        updateWorktreesState({
          ...state.worktrees,
          result: { ok: false, reason: 'error', message: errorMessage(error) }
        })
      } finally {
        updateWorktreesState({ ...state.worktrees, busyPath: null })
      }
    },

    refreshMemory,

    refreshForSection: async (section: SettingsSection): Promise<void> => {
      if (section === 'memory') {
        await refreshMemory()
        return
      }
      if (section === 'worktree') {
        await refreshWorktrees()
      }
    },

    setMemoryScopeFilter: (scopeFilter: 'all' | TeachingMemoryScope): void =>
      updateMemoryState({ ...state.memory, scopeFilter }),

    filterMemoryRecords: (records: TeachingMemoryRecord[]): TeachingMemoryRecord[] =>
      state.memory.scopeFilter === 'all'
        ? records
        : records.filter((record) => record.scope === state.memory.scopeFilter),

    beginCreateMemory: (): void =>
      updateMemoryState({ ...state.memory, draft: emptyMemoryDraft(), dialog: { mode: 'create' }, error: null }),

    beginEditMemory: (memory: TeachingMemoryRecord): void =>
      updateMemoryState({
        ...state.memory,
        draft: { content: memory.content, scope: memory.scope, tags: memory.tags.join(', '), confidence: memory.confidence ?? 1 },
        dialog: { mode: 'edit', memory },
        error: null
      }),

    viewMemory: (memory: TeachingMemoryRecord): void =>
      updateMemoryState({ ...state.memory, dialog: { mode: 'view', memory }, error: null }),

    closeMemoryDialog: (): void => updateMemoryState({ ...state.memory, dialog: null, error: null }),

    setMemoryDraft: (draft: TeachingMemoryDraft): void => updateMemoryState({ ...state.memory, draft }),

    saveMemoryDraft: async (): Promise<boolean> => {
      const dialog = state.memory.dialog
      const draft = state.memory.draft
      const payload: CreateTeachingMemoryPayload = {
        content: draft.content.trim(),
        scope: draft.scope,
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        confidence: draft.confidence,
        workspaceRoot: getWorkspaceRoot()
      }
      if (!payload.content || !dialog || dialog.mode === 'view') return false
      updateMemoryState({ ...state.memory, busy: true, error: null })
      try {
        const saved = dialog.mode === 'edit'
          ? await adapter.updateMemory(dialog.memory.id, payload)
          : await adapter.createMemory(payload)
        if (!saved) return false
        updateMemoryState({ ...state.memory, dialog: null })
        await refreshMemory()
        return true
      } catch (error) {
        updateMemoryState({ ...state.memory, error: errorMessage(error) })
        return false
      } finally {
        updateMemoryState({ ...state.memory, busy: false })
      }
    },

    disableMemory: async (memoryId: string): Promise<void> => {
      updateMemoryState({ ...state.memory, busy: true, error: null })
      try {
        const updated = await adapter.updateMemory(memoryId, { disabled: true, workspaceRoot: getWorkspaceRoot() })
        if (updated) await refreshMemory()
      } catch (error) {
        updateMemoryState({ ...state.memory, error: errorMessage(error) })
      } finally {
        updateMemoryState({ ...state.memory, busy: false })
      }
    },

    deleteMemory: async (memoryId: string): Promise<void> => {
      updateMemoryState({ ...state.memory, busy: true, error: null })
      try {
        await adapter.deleteMemory(memoryId, getWorkspaceRoot())
        await refreshMemory()
      } catch (error) {
        updateMemoryState({ ...state.memory, error: errorMessage(error) })
      } finally {
        updateMemoryState({ ...state.memory, busy: false })
      }
    }
  }
}

function emptyMemoryDraft(): TeachingMemoryDraft {
  return { content: '', scope: 'workspace', tags: '', confidence: 1 }
}

function toProbePayload(provider: TeachingModelProviderProfile): ProbeProviderPayload {
  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    endpointFormat: provider.endpointFormat,
    ...(provider.customHeaders?.length ? { customHeaders: provider.customHeaders } : {})
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useTeachingWorkspaceConfiguration({
  section,
  settings,
  activeWorkspace,
  adapter
}: {
  section: SettingsSection
  settings: TeachingSettingsV1
  activeWorkspace: TeachingWorkspaceSummary | null
  adapter: TeachingWorkspaceConfigurationAdapter
}): TeachingWorkspaceConfiguration {
  const latest = useRef({ settings, activeWorkspace, adapter })
  latest.current = { settings, activeWorkspace, adapter }
  const [, render] = useReducer((count: number) => count + 1, 0)
  const configurationRef = useRef<TeachingWorkspaceConfiguration | null>(null)

  if (!configurationRef.current) {
    const current = (): typeof latest.current => latest.current
    configurationRef.current = createTeachingWorkspaceConfiguration({
      getSettings: () => current().settings,
      getWorkspaceRoot: () => current().activeWorkspace?.rootPath,
      adapter: {
        updateSettings: (patch) => current().adapter.updateSettings(patch),
        probeProvider: (payload) => current().adapter.probeProvider(payload),
        listUpstreamModels: (payload) => current().adapter.listUpstreamModels(payload),
        listGitWorktrees: (workspaceRoot) => current().adapter.listGitWorktrees(workspaceRoot),
        removeGitWorktree: (payload) => current().adapter.removeGitWorktree(payload),
        listMemory: (workspaceRoot) => current().adapter.listMemory(workspaceRoot),
        createMemory: (payload) => current().adapter.createMemory(payload),
        updateMemory: (memoryId, patch) => current().adapter.updateMemory(memoryId, patch),
        deleteMemory: (memoryId, workspaceRoot) => current().adapter.deleteMemory(memoryId, workspaceRoot),
        loadMemoryDiagnostics: () => current().adapter.loadMemoryDiagnostics()
      },
      onStateChange: render
    })
  }

  const configuration = configurationRef.current
  useEffect(() => {
    if (section !== 'memory') return
    void configuration.refreshMemory()
  }, [configuration, section, activeWorkspace?.rootPath])
  useEffect(() => {
    if (section !== 'worktree') return
    void configuration.refreshWorktrees()
  }, [configuration, section, activeWorkspace?.rootPath, settings.worktree.rootPath])
  return configuration
}

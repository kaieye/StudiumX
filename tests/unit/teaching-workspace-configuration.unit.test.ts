import { describe, expect, it } from 'vitest'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'
import type {
  CreateTeachingMemoryPayload,
  TeachingMemoryRecord,
  TeachingSettingsPatch
} from '../../src/shared/teaching-types'
import {
  createTeachingWorkspaceConfiguration,
  type TeachingWorkspaceConfigurationAdapter
} from '../../src/renderer/src/workflows/teaching-workspace-configuration'

const workspaceRoot = 'C:\\Teaching\\algebra'

function memory(id: string, scope: TeachingMemoryRecord['scope']): TeachingMemoryRecord {
  return {
    id,
    content: `${scope} memory`,
    scope,
    tags: [],
    confidence: 1,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z'
  }
}

function createAdapter(overrides: Partial<TeachingWorkspaceConfigurationAdapter> = {}): TeachingWorkspaceConfigurationAdapter {
  return {
    updateSettings: async (_patch: TeachingSettingsPatch) => {},
    probeProvider: async () => ({ ok: true, latencyMs: 12, modelIds: ['model-a'] }),
    listUpstreamModels: async () => ({ ok: true, modelIds: ['model-a'] }),
    listGitWorktrees: async () => ({
      ok: true,
      repositoryRoot: workspaceRoot,
      primaryWorktreePath: workspaceRoot,
      worktreeRoot: `${workspaceRoot}\\.worktrees`,
      worktrees: []
    }),
    removeGitWorktree: async () => {},
    listMemory: async () => {},
    createMemory: async (_payload: CreateTeachingMemoryPayload) => true,
    updateMemory: async () => true,
    deleteMemory: async () => {},
    loadMemoryDiagnostics: async () => {},
    ...overrides
  }
}

describe('teaching workspace configuration flow', () => {
  it('orders provider probing and model refresh before publishing their settled state', async () => {
    const events: string[] = []
    const settings = createTeachingSettingsDefaults(workspaceRoot)
    const configuration = createTeachingWorkspaceConfiguration({
      adapter: createAdapter({
        probeProvider: async (payload) => {
          events.push(`probe:${payload.baseUrl}`)
          return { ok: true, latencyMs: 24, modelIds: ['remote-a'] }
        },
        listUpstreamModels: async (payload) => {
          events.push(`list:${payload.baseUrl}`)
          return { ok: true, modelIds: ['remote-a', 'remote-b'] }
        },
        updateSettings: async (patch) => {
          events.push(`persist:${patch.provider?.providers?.find((provider) => provider.id === 'deepseek')?.models.join(',')}`)
        }
      }),
      getSettings: () => settings,
      getWorkspaceRoot: () => workspaceRoot,
      onStateChange: () => events.push(`state:${configuration.state.provider.status?.kind ?? 'idle'}:${configuration.state.provider.busy}`)
    })

    await configuration.probeModelProvider('deepseek')
    await configuration.refreshModelProviderModels('deepseek')

    expect(events).toEqual([
      'state:connecting:true',
      `probe:${settings.provider.providers.find((provider) => provider.id === 'deepseek')!.baseUrl}`,
      'state:success:false',
      'state:pulling:true',
      `list:${settings.provider.providers.find((provider) => provider.id === 'deepseek')!.baseUrl}`,
      'persist:remote-a,remote-b',
      'state:synced:false'
    ])
    expect(configuration.state.provider.status).toEqual({ kind: 'synced', modelCount: 2 })
  })

  it('clears the busy worktree path and records a failed removal without refreshing', async () => {
    const events: string[] = []
    const configuration = createTeachingWorkspaceConfiguration({
      adapter: createAdapter({
        removeGitWorktree: async () => {
          events.push('remove')
          throw new Error('git refused removal')
        },
        listGitWorktrees: async () => {
          events.push('refresh')
          throw new Error('should not refresh')
        }
      }),
      getSettings: () => createTeachingSettingsDefaults(workspaceRoot),
      getWorkspaceRoot: () => workspaceRoot
    })

    await configuration.removeWorktree(`${workspaceRoot}\\.worktrees\\topic`)

    expect(events).toEqual(['remove'])
    expect(configuration.state.worktrees.busyPath).toBeNull()
    expect(configuration.state.worktrees.result).toEqual({
      ok: false,
      reason: 'error',
      message: 'git refused removal'
    })
  })

  it('syncs generator.endpointFormat when updating the active provider upstream format', async () => {
    const settings = createTeachingSettingsDefaults(workspaceRoot)
    const captured: TeachingSettingsPatch[] = []
    const configuration = createTeachingWorkspaceConfiguration({
      adapter: createAdapter({
        updateSettings: async (patch) => {
          captured.push(patch)
        }
      }),
      getSettings: () => settings,
      getWorkspaceRoot: () => workspaceRoot
    })

    await configuration.updateModelProviderEndpointFormat('deepseek', 'messages')

    expect(captured).toHaveLength(1)
    const patch = captured[0]!
    expect(patch.provider?.providers?.find((provider) => provider.id === 'deepseek')?.endpointFormat).toBe('messages')
    expect(patch.generator?.endpointFormat).toBe('messages')
  })

  it('updates a non-active provider upstream format without touching generator.endpointFormat', async () => {
    const settings = createTeachingSettingsDefaults(workspaceRoot)
    expect(settings.generator.providerId).toBe('deepseek')
    const captured: TeachingSettingsPatch[] = []
    const configuration = createTeachingWorkspaceConfiguration({
      adapter: createAdapter({
        updateSettings: async (patch) => {
          captured.push(patch)
        }
      }),
      getSettings: () => settings,
      getWorkspaceRoot: () => workspaceRoot
    })

    await configuration.updateModelProviderEndpointFormat('glm', 'responses')

    expect(captured).toHaveLength(1)
    const patch = captured[0]!
    expect(patch.provider?.providers?.find((provider) => provider.id === 'glm')?.endpointFormat).toBe('responses')
    expect(patch.generator?.endpointFormat).toBeUndefined()
  })

  it('filters learner memory and refreshes records and diagnostics after a successful mutation', async () => {
    const events: string[] = []
    const configuration = createTeachingWorkspaceConfiguration({
      adapter: createAdapter({
        createMemory: async (payload) => {
          events.push(`create:${payload.content}:${payload.workspaceRoot}`)
          return true
        },
        listMemory: async (root) => {
          events.push(`list:${root}`)
        },
        loadMemoryDiagnostics: async () => {
          events.push('diagnostics')
        }
      }),
      getSettings: () => createTeachingSettingsDefaults(workspaceRoot),
      getWorkspaceRoot: () => workspaceRoot
    })
    const records = [memory('user', 'user'), memory('workspace', 'workspace'), memory('project', 'project')]

    configuration.setMemoryScopeFilter('workspace')
    expect(configuration.filterMemoryRecords(records)).toEqual([records[1]])

    configuration.beginCreateMemory()
    configuration.setMemoryDraft({ content: '  Review equations  ', scope: 'workspace', tags: ' algebra, review, ', confidence: 0.8 })
    await configuration.saveMemoryDraft()

    expect(events).toEqual([
      `create:Review equations:${workspaceRoot}`,
      `list:${workspaceRoot}`,
      'diagnostics'
    ])
    expect(configuration.state.memory.dialog).toBeNull()
    expect(configuration.state.memory.busy).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import type { TeachingAppState, TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

const originalState = useAppStore.getState()
const updatedAt = '2026-07-17T08:00:00.000Z'

function workspace(trust: TeachingWorkspaceSummary['agentWorkspaceTrust'] = 'untrusted'): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1', name: 'Physics', rootPath: '/workspace', missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/resources', lessonsDir: '/workspace/lessons', recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference', reviewsDir: '/workspace/reviews', createdAt: updatedAt, updatedAt,
    agentWorkspaceTrust: trust, missionTitle: 'Physics', missionExcerpt: 'Learn physics', courses: [], fileTree: [],
    conversations: [], resources: [], records: [], lessons: [], referenceCount: 0, assetsReady: true, git: null
  }
}

function state(trust: TeachingWorkspaceSummary['agentWorkspaceTrust']): TeachingAppState {
  const activeWorkspace = workspace(trust)
  return {
    workspaces: [activeWorkspace], activeWorkspace, temporaryConversations: [], previewHtml: '', previewUrl: '',
    selectedLessonPath: null, runtime: { status: 'idle', currentStep: '', queuedTasks: 0, providerLabel: '' },
    recentChangeSummary: null
  }
}

beforeEach(() => {
  useAppStore.setState({ ...originalState, appState: state('untrusted'), error: null, loading: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('appStore workspace trust', () => {
  it('forwards only the registered workspace id and binary trust enum, then replaces app state', async () => {
    const nextState = state('trusted')
    const setWorkspaceTrust = vi.fn(async () => nextState)
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { setWorkspaceTrust } as Partial<TeachingSystemApi>
    })

    await expect(useAppStore.getState().setWorkspaceTrust('workspace-1', 'trusted')).resolves.toBe(true)

    expect(setWorkspaceTrust).toHaveBeenCalledWith({ workspaceId: 'workspace-1', trust: 'trusted' })
    expect(setWorkspaceTrust.mock.calls[0]?.[0]).toEqual({ workspaceId: 'workspace-1', trust: 'trusted' })
    expect(useAppStore.getState().appState.activeWorkspace?.agentWorkspaceTrust).toBe('trusted')
    expect(useAppStore.getState().pendingWorkspaceTrustIds).toEqual(new Set())
  })

  it('tracks pending trust updates by workspace without using global loading', async () => {
    let resolveUpdate: (value: TeachingAppState) => void = () => {}
    const setWorkspaceTrust = vi.fn(() => new Promise<TeachingAppState>((resolve) => { resolveUpdate = resolve }))
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { setWorkspaceTrust } as Partial<TeachingSystemApi>
    })

    const update = useAppStore.getState().setWorkspaceTrust('workspace-1', 'trusted')
    expect(useAppStore.getState().pendingWorkspaceTrustIds).toEqual(new Set(['workspace-1']))
    expect(useAppStore.getState().loading).toBe(false)

    resolveUpdate(state('trusted'))
    await expect(update).resolves.toBe(true)
    expect(useAppStore.getState().pendingWorkspaceTrustIds).toEqual(new Set())
  })


  it('preserves an existing global error while a successful trust update is pending and after it completes', async () => {
    const existingError = { message: 'Existing global alert', severity: 'warning' as const }
    let resolveUpdate: (value: TeachingAppState) => void = () => {}
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { setWorkspaceTrust: vi.fn(() => new Promise<TeachingAppState>((resolve) => { resolveUpdate = resolve })) } as Partial<TeachingSystemApi>
    })
    useAppStore.setState({ error: existingError })

    const update = useAppStore.getState().setWorkspaceTrust('workspace-1', 'trusted')
    expect(useAppStore.getState().error).toEqual(existingError)

    resolveUpdate(state('trusted'))
    await expect(update).resolves.toBe(true)
    expect(useAppStore.getState().error).toEqual(existingError)
  })

  it('clears pending trust state and preserves an API failure in the global error surface', async () => {
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { setWorkspaceTrust: vi.fn().mockRejectedValue(new Error('Trust update failed')) } as Partial<TeachingSystemApi>
    })

    await expect(useAppStore.getState().setWorkspaceTrust('workspace-1', 'trusted')).resolves.toBe(false)
    expect(useAppStore.getState().pendingWorkspaceTrustIds).toEqual(new Set())
    expect(useAppStore.getState().error).toMatchObject({ message: 'Trust update failed' })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'
import type { TeachingSettingsPatch, TeachingSettingsV1, TeachingSystemApi } from '../../src/shared/teaching-types'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'

const originalState = useAppStore.getState()
const workspaceRoot = 'C:/StudiumX/workspaces'

beforeEach(() => {
  useAppStore.setState({
    ...originalState,
    settings: createTeachingSettingsDefaults(workspaceRoot),
    error: null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('appStore settings updates', () => {
  it('serializes rapid settings writes so an earlier response cannot overwrite the latest model', async () => {
    const first = createTeachingSettingsDefaults(workspaceRoot)
    const activeProvider = first.provider.providers.find((provider) => provider.id === first.generator.providerId)!
    const firstModel = activeProvider.models[0]!
    const secondModel = activeProvider.models[1]!
    first.generator.model = firstModel
    const second = createTeachingSettingsDefaults(workspaceRoot)
    second.generator.model = secondModel
    const resolvers: Array<(settings: TeachingSettingsV1) => void> = []
    const updateSettings = vi.fn((_: TeachingSettingsPatch) => new Promise<TeachingSettingsV1>((resolve) => resolvers.push(resolve)))
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { updateSettings } as Partial<TeachingSystemApi>
    })

    const firstUpdate = useAppStore.getState().updateSettings({ generator: { model: firstModel } })
    const secondUpdate = useAppStore.getState().updateSettings({ generator: { model: secondModel } })

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    expect(updateSettings).toHaveBeenLastCalledWith({ generator: { model: firstModel } })

    resolvers.shift()!(first)
    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2))
    expect(updateSettings).toHaveBeenLastCalledWith({ generator: { model: secondModel } })

    resolvers.shift()!(second)
    await Promise.all([firstUpdate, secondUpdate])

    expect(useAppStore.getState().settings.generator.model).toBe(secondModel)
  })
})

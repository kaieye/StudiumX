import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'

const originalState = useAppStore.getState()

afterEach(() => {
  vi.restoreAllMocks()
  useAppStore.setState({ ...originalState })
})

describe('appStore settings open/close navigation', () => {
  it('restores the previous shell view after closing settings', () => {
    useAppStore.setState({ view: 'lessons', viewBeforeSettings: null })
    useAppStore.getState().openSettings('account')

    const opened = useAppStore.getState()
    expect(opened.view).toBe('settings')
    expect(opened.settingsSection).toBe('account')
    expect(opened.viewBeforeSettings).toBe('lessons')

    useAppStore.getState().closeSettings()
    const closed = useAppStore.getState()
    expect(closed.view).toBe('lessons')
    expect(closed.viewBeforeSettings).toBeNull()
  })

  it('keeps the remembered view when switching settings sections', () => {
    useAppStore.setState({ view: 'overview', viewBeforeSettings: null })
    useAppStore.getState().openSettings('general')
    useAppStore.getState().openSettings('provider')

    const opened = useAppStore.getState()
    expect(opened.view).toBe('settings')
    expect(opened.settingsSection).toBe('provider')
    // Section switches inside Settings must not overwrite the remembered view.
    expect(opened.viewBeforeSettings).toBe('overview')
  })

  it('falls back to the conversation/home view when no prior view was remembered', () => {
    useAppStore.setState({ view: 'settings', viewBeforeSettings: null })
    useAppStore.getState().closeSettings()
    expect(useAppStore.getState().view).toBe('overview')
  })
})

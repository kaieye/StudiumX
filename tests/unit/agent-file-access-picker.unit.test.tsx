import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentFileAccessPicker } from '../../src/renderer/src/App'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { emptySettings } from '../../src/renderer/src/workflows/settings'
import { renderUi, screen, setupUser, waitFor } from '../helpers/render'

const originalState = useAppStore.getState()

function resetStore(): void {
  useAppStore.setState({
    ...originalState,
    settings: {
      ...emptySettings,
      tools: {
        ...emptySettings.tools,
        approvalMode: 'request_approval'
      }
    },
    error: null,
    updateSettings: vi.fn(async (patch) => {
      const approvalMode = patch.tools?.approvalMode
      if (!approvalMode) return
      useAppStore.setState((state) => ({
        settings: {
          ...state.settings,
          tools: {
            ...state.settings.tools,
            approvalMode
          }
        }
      }))
    })
  })
}

describe('AgentFileAccessPicker', () => {
  beforeEach(resetStore)
  afterEach(() => useAppStore.setState(originalState))

  it('switches the dialog permission mode and closes the menu after settings persist', async () => {
    const user = setupUser()
    renderUi(<AgentFileAccessPicker />)

    const trigger = screen.getByRole('button', { name: /Agent 权限模式：请求批准|Agent permission mode: Request approval/i })
    await user.click(trigger)

    const menu = screen.getByRole('menu', { name: /Agent 权限模式|Agent permission mode/i })
    const fullAccess = screen.getByRole('menuitemradio', { name: /完全访问|Full access/i })
    expect(menu).toBeInTheDocument()
    expect(fullAccess).toHaveAttribute('aria-checked', 'false')

    await user.click(fullAccess)

    await waitFor(() => {
      expect(useAppStore.getState().updateSettings).toHaveBeenCalledWith({
        tools: { approvalMode: 'full_access' }
      })
      expect(useAppStore.getState().settings.tools.approvalMode).toBe('full_access')
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agent 权限模式：完全访问|Agent permission mode: Full access/i }))
      .toHaveClass('is-full_access')
  })
})

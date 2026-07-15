import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptySettings } from '../../src/renderer/src/workflows/settings'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { AppPet } from '../../src/renderer/src/views/pet/AppPet'
import { renderUi, screen, setupUser, waitFor } from '../helpers/render'

const originalState = useAppStore.getState()

function resetStore(): void {
  useAppStore.setState({
    ...originalState,
    settings: {
      ...emptySettings,
      pet: {
        ...emptySettings.pet,
        enabled: true,
        displayName: 'Boba',
        size: 112
      }
    },
    generating: false,
    agentChatBusy: false,
    agentTurns: [],
    pendingAgentConversation: null,
    error: null
  })
}

describe('AppPet accessibility', () => {
  beforeEach(resetStore)
  afterEach(() => useAppStore.setState(originalState))

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' ']
  ])('opens the Pet Assistant with %s and restores mascot focus on close', async (_label, key) => {
    const user = setupUser()
    const { container } = renderUi(<AppPet />)
    const mascot = container.querySelector<HTMLButtonElement>('.app-pet-mascot')
    expect(mascot).not.toBeNull()

    expect(mascot).toHaveAttribute('aria-haspopup', 'dialog')
    expect(mascot).toHaveAttribute('aria-controls', 'pet-assistant-dialog')
    expect(mascot).toHaveAttribute('aria-expanded', 'false')

    mascot!.focus()
    await user.keyboard(key)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('id', 'pet-assistant-dialog')
    expect(mascot).toHaveAttribute('aria-expanded', 'true')

    const closeButton = await screen.findByRole('button', { name: /关闭对话|close conversation/i })
    await user.click(closeButton)

    await waitFor(() => {
      expect(mascot).toHaveFocus()
      expect(mascot).toHaveAttribute('aria-expanded', 'false')
    })
  })
})

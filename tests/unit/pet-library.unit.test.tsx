import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { emptySettings } from '../../src/renderer/src/workflows/settings'
import { PetLibrary } from '../../src/renderer/src/views/resources/PetLibrary'
import { fireEvent, renderUi, screen } from '../helpers/render'

const originalState = useAppStore.getState()
const updateSettings = vi.fn(async () => {})

function resetStore(): void {
  updateSettings.mockClear()
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
    updateSettings
  })
}

describe('PetLibrary settings', () => {
  beforeEach(resetStore)
  afterEach(() => useAppStore.setState(originalState))

  it('previews and commits the bounded pet size once on blur', () => {
    renderUi(<PetLibrary onBack={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: /宠物尺寸|pet size/i })

    expect(slider).toHaveAttribute('min', '80')
    expect(slider).toHaveAttribute('max', '224')
    expect(slider).toHaveAttribute('step', '8')
    expect(slider).toHaveValue('112')

    fireEvent.change(slider, { target: { value: '160' } })
    expect(screen.getByText('160px')).toBeInTheDocument()
    fireEvent.blur(slider)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ pet: { size: 160 } })

    fireEvent.blur(slider)
    expect(updateSettings).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import i18n from '../../src/renderer/src/i18n'
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
  beforeEach(async () => {
    resetStore()
    await i18n.changeLanguage('zh-CN')
  })
  afterEach(() => {
    vi.useRealTimers()
    useAppStore.setState(originalState)
  })

  it('renders complete notification preferences in Chinese and English', async () => {
    const { unmount } = renderUi(<PetLibrary onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Pet 通知偏好' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /仅显示需要操作的通知/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '通知来源' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '安静 30 分钟' })).toBeInTheDocument()

    unmount()
    await i18n.changeLanguage('en-US')
    renderUi(<PetLibrary onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Pet notifications' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Only show items that need action/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Notification sources' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quiet for 1 hour' })).toBeInTheDocument()
  })

  it('persists notification state and source preferences as nested patches', () => {
    renderUi(<PetLibrary onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /仅显示需要操作的通知/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Agent$/ }))

    expect(updateSettings).toHaveBeenNthCalledWith(1, {
      pet: { notificationPreferences: { actionableOnly: true } }
    })
    expect(updateSettings).toHaveBeenNthCalledWith(2, {
      pet: { notificationPreferences: { sources: { agent: false } } }
    })
  })

  it('starts and ends temporary quiet mode with an absolute expiry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T10:00:00.000Z'))
    const { unmount } = renderUi(<PetLibrary onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '安静 30 分钟' }))
    expect(updateSettings).toHaveBeenLastCalledWith({
      pet: {
        notificationPreferences: {
          quietUntil: Date.parse('2026-07-15T10:30:00.000Z')
        }
      }
    })

    unmount()
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        pet: {
          ...state.settings.pet,
          notificationPreferences: {
            ...state.settings.pet.notificationPreferences,
            quietUntil: Date.parse('2026-07-15T11:00:00.000Z')
          }
        }
      }
    }))
    renderUi(<PetLibrary onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '结束安静模式' }))

    expect(updateSettings).toHaveBeenLastCalledWith({
      pet: { notificationPreferences: { quietUntil: null } }
    })
  })

  it('renames the pet to the selected pet when the name is still a built-in default', () => {
    renderUi(<PetLibrary onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Shinchan/ }))

    expect(updateSettings).toHaveBeenCalledWith({
      pet: { appearance: 'shinchan', displayName: 'Shinchan' }
    })
  })

  it('keeps a customized pet name when switching appearance', () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        pet: { ...state.settings.pet, displayName: 'Pikachu' }
      }
    }))
    renderUi(<PetLibrary onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Shinchan/ }))

    expect(updateSettings).toHaveBeenCalledWith({
      pet: { appearance: 'shinchan', displayName: 'Pikachu' }
    })
  })

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

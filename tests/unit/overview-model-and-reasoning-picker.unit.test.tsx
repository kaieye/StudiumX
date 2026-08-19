import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import i18n from '../../src/renderer/src/i18n'
import { OverviewModelAndReasoningPicker } from '../../src/renderer/src/ui/overview-composer-pickers'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'
import type { TeachingSettingsPatch, TeachingSettingsV1, TeachingSystemApi } from '../../src/shared/teaching-types'

const originalState = useAppStore.getState()
const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')

function pickerSettings(): TeachingSettingsV1 {
  const settings = createTeachingSettingsDefaults('/workspace')
  const provider = {
    ...settings.provider.providers[0]!,
    id: 'custom',
    name: 'Picker test provider',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5-mini', 'gpt-5']
  }

  return {
    ...settings,
    locale: 'en-US',
    theme: 'light',
    provider: {
      ...settings.provider,
      activeProviderId: provider.id,
      providers: [provider]
    },
    generator: {
      ...settings.generator,
      providerId: provider.id,
      model: 'gpt-5-mini',
      reasoningEffort: 'low'
    }
  }
}

describe('OverviewModelAndReasoningPicker', () => {
  let updateSettings: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    let persisted = pickerSettings()
    updateSettings = vi.fn(async (patch: TeachingSettingsPatch) => {
      persisted = {
        ...persisted,
        generator: {
          ...persisted.generator,
          ...patch.generator
        }
      }
      return persisted
    })

    useAppStore.setState({
      ...originalState,
      settings: persisted,
      error: null
    })
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      value: { updateSettings } as Partial<TeachingSystemApi>
    })
  })

  afterEach(() => {
    useAppStore.setState(originalState)
    if (originalTeachingSystemDescriptor) {
      Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
    } else {
      delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
    }
    vi.restoreAllMocks()
  })

  it('keeps model and reasoning effort on one trigger and drills into either choice', async () => {
    const user = userEvent.setup()
    const modelTitle = i18n.t('generation.model.label')
    const reasoningTitle = i18n.t('reasoning.title')
    const lowLabel = i18n.t('reasoning.effort.low')

    render(<OverviewModelAndReasoningPicker />)

    const trigger = screen.getByRole('button', {
      name: `${modelTitle}: gpt-5-mini; ${reasoningTitle}: ${lowLabel}`
    })
    expect(trigger).toHaveTextContent(`gpt-5-mini·${lowLabel}`)

    await user.click(trigger)
    expect(screen.getByRole('menu', { name: `${modelTitle} ${reasoningTitle}` })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: new RegExp(`^${modelTitle}`) })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: new RegExp(`^${reasoningTitle}`) })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: new RegExp(`^${modelTitle}`) }))
    expect(screen.getByRole('listbox', { name: modelTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'gpt-5' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: modelTitle })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: new RegExp(`^${modelTitle}`) })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('persists model and reasoning selections through the shared settings action', async () => {
    const user = userEvent.setup()
    const modelTitle = i18n.t('generation.model.label')
    const reasoningTitle = i18n.t('reasoning.title')
    const highLabel = i18n.t('reasoning.effort.high')

    render(<OverviewModelAndReasoningPicker />)

    const trigger = screen.getByRole('button', {
      name: `${modelTitle}: gpt-5-mini; ${reasoningTitle}: ${i18n.t('reasoning.effort.low')}`
    })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: new RegExp(`^${modelTitle}`) }))
    await user.click(screen.getByRole('button', { name: 'gpt-5' }))

    await waitFor(() => {
      expect(updateSettings).toHaveBeenLastCalledWith({
        generator: { providerId: 'custom', model: 'gpt-5' }
      })
    })
    await waitFor(() => {
      expect(trigger).toHaveTextContent(`gpt-5·${i18n.t('reasoning.effort.low')}`)
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: new RegExp(`^${reasoningTitle}`) }))
    await user.click(screen.getByRole('button', { name: highLabel }))

    await waitFor(() => {
      expect(updateSettings).toHaveBeenLastCalledWith({ generator: { reasoningEffort: 'high' } })
    })
    await waitFor(() => {
      expect(trigger).toHaveTextContent(`gpt-5·${highLabel}`)
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

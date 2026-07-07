import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TEACHING_MODEL_PROVIDER_PRESETS,
  type ListUpstreamModelsResult,
  type ProbeProviderPayload,
  type ProbeProviderResult,
  type TeachingModelProviderProfile,
  type TeachingSettingsPatch,
  type TeachingSettingsV1
} from '../../../../../shared/teaching-types'
import {
  activeModelProvider,
  modelListProbeSupportedForProvider,
  modelSettingsProviderIds,
  reasoningEffortLabel,
  reasoningEffortOptionsForSettings,
  selectedReasoningEffort
} from '../../../workflows/settings'

export function ModelProviderSettingsSection({
  settings,
  onUpdateSettings,
  onProbeProvider,
  onListUpstreamModels,
  onOpenExternal
}: {
  settings: TeachingSettingsV1
  onUpdateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  onProbeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  onListUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  onOpenExternal: (url: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const providersById = new Map(settings.provider.providers.map((provider) => [provider.id, provider]))
  const visibleModelProviders = modelSettingsProviderIds.map((id) => {
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === id)!
    return providersById.get(id) ?? { ...preset, apiKey: '' }
  })
  const activeProvider = activeModelProvider(settings)
  const activeModelSettingsProvider =
    visibleModelProviders.find((provider) => provider.id === activeProvider.id) ?? visibleModelProviders[0]!
  const isCustomModelProvider = activeModelSettingsProvider.id === 'custom'
  const activeModelValue = activeModelSettingsProvider.models[0] ?? ''
  const activeProviderProbePayload = {
    baseUrl: activeModelSettingsProvider.baseUrl,
    apiKey: activeModelSettingsProvider.apiKey,
    endpointFormat: activeModelSettingsProvider.endpointFormat
  } satisfies ProbeProviderPayload
  const [providerStatus, setProviderStatus] = useState<string>('')
  const [providerBusy, setProviderBusy] = useState(false)
  const [apiKeyVisible, setApiKeyVisible] = useState(() => !settings.privacy.maskApiKeys)

  useEffect(() => {
    setProviderStatus('')
    setApiKeyVisible(!settings.privacy.maskApiKeys)
  }, [activeModelSettingsProvider.id, settings.privacy.maskApiKeys])

  const updateProvider = (patch: Partial<TeachingModelProviderProfile>): void => {
    const currentProvider = settings.provider.providers.find((provider) => provider.id === activeModelSettingsProvider.id)
    const providers = currentProvider
      ? settings.provider.providers.map((provider) =>
          provider.id === activeModelSettingsProvider.id ? { ...provider, ...patch } : provider
        )
      : [...settings.provider.providers, { ...activeModelSettingsProvider, ...patch }]
    void onUpdateSettings({
      provider: {
        providers
      }
    })
  }

  const updateProviderModels = (models: string[], syncGeneratorModel = true): void => {
    const currentProvider = settings.provider.providers.find((provider) => provider.id === activeModelSettingsProvider.id)
    const providers = currentProvider
      ? settings.provider.providers.map((provider) =>
          provider.id === activeModelSettingsProvider.id ? { ...provider, models } : provider
        )
      : [...settings.provider.providers, { ...activeModelSettingsProvider, models }]
    void onUpdateSettings({
      provider: {
        providers
      },
      ...(syncGeneratorModel && settings.generator.providerId === activeModelSettingsProvider.id
        ? { generator: { model: models[0] ?? '' } }
        : {})
    })
  }

  const selectModelProvider = (providerId: string): void => {
    const provider = visibleModelProviders.find((item) => item.id === providerId) ?? activeModelSettingsProvider
    const hasProvider = settings.provider.providers.some((item) => item.id === provider.id)
    void onUpdateSettings({
      provider: {
        activeProviderId: provider.id,
        providers: hasProvider ? settings.provider.providers : [...settings.provider.providers, provider]
      },
      generator: {
        providerId: provider.id,
        model: provider.models[0] ?? '',
        endpointFormat: provider.endpointFormat
      }
    })
  }

  const probeActiveProvider = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus(t('model.statusConnecting'))
    const result = await onProbeProvider(activeProviderProbePayload)
    setProviderBusy(false)
    setProviderStatus(result.ok ? t('model.statusOk', { latency: result.latencyMs, count: result.modelIds.length }) : result.message)
  }

  const pullActiveProviderModels = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus(t('model.statusPulling'))
    const result = await onListUpstreamModels(activeProviderProbePayload)
    setProviderBusy(false)
    if (!result.ok) {
      setProviderStatus(result.message)
      return
    }
    updateProviderModels(result.modelIds, result.modelIds.length > 0)
    setProviderStatus(t('model.statusSynced', { count: result.modelIds.length }))
  }

  const resetActiveProviderToPreset = async (): Promise<void> => {
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === activeModelSettingsProvider.id)
    if (!preset) return
    const resetProvider = { ...preset, apiKey: activeModelSettingsProvider.apiKey }
    const providers = settings.provider.providers.some((provider) => provider.id === resetProvider.id)
      ? settings.provider.providers.map((provider) =>
          provider.id === resetProvider.id ? resetProvider : provider
        )
      : [...settings.provider.providers, resetProvider]
    await onUpdateSettings({
      provider: {
        activeProviderId: resetProvider.id,
        providers
      },
      generator: {
        providerId: resetProvider.id,
        model: resetProvider.models[0] ?? '',
        endpointFormat: resetProvider.endpointFormat
      }
    })
    setProviderStatus(t('model.statusReset'))
  }

  return (
    <SettingsPanel
      title={t('model.title')}
      subtitle={t('model.subtitle')}
    >
      <SettingsCard>
        <SettingsRow label="Provider">
          <SettingsSelect
            value={activeModelSettingsProvider.id}
            options={visibleModelProviders.map((provider) => ({
              value: provider.id,
              label: provider.id === 'custom' ? 'Custom' : provider.name
            }))}
            onChange={selectModelProvider}
          />
        </SettingsRow>
        <SettingsRow label={t('model.apiKey.label')}>
          <div className="settings-inline-group">
            <SettingsTextInput
              type={apiKeyVisible ? 'text' : 'password'}
              value={activeModelSettingsProvider.apiKey}
              placeholder={t('model.apiKey.placeholder')}
              onChange={(apiKey) => updateProvider({ apiKey })}
            />
            <button
              className="icon-button soft"
              type="button"
              aria-label={apiKeyVisible ? t('model.apiKey.hide') : t('model.apiKey.show')}
              title={apiKeyVisible ? t('model.apiKey.hide') : t('model.apiKey.show')}
              onClick={() => setApiKeyVisible((visible) => !visible)}
            >
              {apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label={t('model.baseUrl')}>
          <SettingsTextInput
            value={activeModelSettingsProvider.baseUrl}
            onChange={(baseUrl) => updateProvider({ baseUrl })}
          />
        </SettingsRow>
        <SettingsRow label={t('model.models.label')}>
          {isCustomModelProvider ? (
            <SettingsTextInput
              value={activeModelValue}
              onChange={(model) => updateProviderModels(model ? [model] : [])}
            />
          ) : (
            <SettingsSelect
              value={
                activeModelSettingsProvider.models.includes(settings.generator.model)
                  ? settings.generator.model
                  : (activeModelSettingsProvider.models[0] ?? '')
              }
              options={activeModelSettingsProvider.models.map((model) => ({ value: model, label: model }))}
              onChange={(model) => {
                updateProviderModels([
                  model,
                  ...activeModelSettingsProvider.models.filter((item) => item !== model)
                ])
              }}
            />
          )}
        </SettingsRow>
        <SettingsRow label={t('reasoning.title')} detail={t('reasoning.settingsDetail')}>
          <SegmentedControl
            value={selectedReasoningEffort(settings)}
            options={reasoningEffortOptionsForSettings(settings).map((effort) => ({
              value: effort,
              label: reasoningEffortLabel(effort),
              icon: BrainCircuit
            }))}
            onChange={(reasoningEffort) => void onUpdateSettings({ generator: { reasoningEffort } })}
          />
        </SettingsRow>
        <SettingsRow label={t('model.actions.label')}>
          <div className="settings-actions">
            <button className="ghost-button" type="button" onClick={() => void probeActiveProvider()} disabled={providerBusy}>
              {providerBusy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
              {t('model.actions.test')}
            </button>
            <button className="ghost-button" type="button" onClick={() => void pullActiveProviderModels()} disabled={providerBusy || !modelListProbeSupportedForProvider(activeModelSettingsProvider)}>
              <RefreshCw size={15} />
              {t('model.actions.pull')}
            </button>
            <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeModelSettingsProvider.docsUrl)} disabled={isCustomModelProvider || !activeModelSettingsProvider.docsUrl}>
              <ExternalLink size={15} />
              {t('model.actions.docs')}
            </button>
            <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeModelSettingsProvider.apiKeyUrl)} disabled={isCustomModelProvider || !activeModelSettingsProvider.apiKeyUrl}>
              <KeyRound size={15} />
              {t('model.actions.key')}
            </button>
            <button className="ghost-button" type="button" onClick={() => void resetActiveProviderToPreset()}>
              <RefreshCw size={15} />
              {t('model.actions.reset')}
            </button>
          </div>
        </SettingsRow>
        {providerStatus ? (
          <div className="settings-empty-note" role="status" aria-live="polite">
            {providerStatus}
          </div>
        ) : null}
      </SettingsCard>
    </SettingsPanel>
  )
}

function SettingsPanel({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="settings-panel-body">{children}</div>
    </div>
  )
}

function SettingsCard({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`settings-card ${className}`}>{children}</div>
}

function SettingsRow({
  label,
  detail,
  children
}: {
  label: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented-control">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            className={option.value === value ? 'is-active' : ''}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon size={14} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function SettingsTextInput({
  value,
  placeholder,
  type = 'text',
  onChange
}: {
  value: string
  placeholder?: string
  type?: 'text' | 'password'
  onChange: (value: string) => void
}) {
  return (
    <input
      className="settings-input"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function SettingsSelect<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    setHighlightedIndex(Math.max(0, options.findIndex((option) => option.value === value)))
  }, [options, value])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const toggleOpen = (): void => {
    if (!options.length) return
    setOpen((current) => !current)
  }

  const selectOption = (nextValue: T): void => {
    onChange(nextValue)
    setOpen(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!options.length) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) {
        const option = options[highlightedIndex] ?? selectedOption
        if (option) selectOption(option.value)
        return
      }
      setOpen(true)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlightedIndex((current) => {
        const baseIndex = current < 0 ? Math.max(0, options.findIndex((option) => option.value === value)) : current
        return (baseIndex + direction + options.length) % options.length
      })
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(Math.max(0, options.length - 1))
    }
  }

  return (
    <div className={`settings-select ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        className="settings-select-trigger"
        type="button"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
      >
        <span className="settings-select-trigger-copy">
          <span className="settings-select-trigger-value">{selectedOption?.label ?? ''}</span>
        </span>
        <ChevronDown className="settings-select-trigger-icon" size={15} />
      </button>

      {open && (
        <div className="settings-select-menu" id={listId} role="listbox" aria-activedescendant={`${listId}-${highlightedIndex}`}>
          {options.map((option, index) => {
            const selected = option.value === value
            const highlighted = index === highlightedIndex
            return (
              <button
                aria-selected={selected}
                className={`settings-select-option ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                id={`${listId}-${index}`}
                key={option.value}
                role="option"
                type="button"
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option.value)}
              >
                <span>{option.label}</span>
                {selected && <CheckCircle2 size={14} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

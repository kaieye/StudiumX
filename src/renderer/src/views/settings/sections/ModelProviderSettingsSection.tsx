import {
  BrainCircuit,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useState } from 'react'
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
import {
  SegmentedControl,
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSelect,
  SettingsTextInput
} from '../SettingsPrimitives'

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

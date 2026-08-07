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
  type TeachingModelProviderProfile,
  type TeachingSettingsV1
} from '../../../../../shared/teaching-types'
import {
  activeModelProvider,
  endpointFormatLabel,
  MODEL_ENDPOINT_FORMAT_SELECTOR_OPTIONS,
  modelListProbeSupportedForProvider,
  modelSettingsProviderIds,
  reasoningEffortLabel,
  reasoningEffortOptionsForSettings,
  selectedEndpointFormat,
  selectedReasoningEffort
} from '../../../workflows/settings'
import {
  type TeachingWorkspaceConfiguration,
  type TeachingWorkspaceConfigurationStatus
} from '../../../workflows/teaching-workspace-configuration'
import {
  SettingsCard,
  SettingsComboBox,
  SettingsPanel,
  SettingsRow,
  SettingsSelect,
  SettingsTextInput
} from '../SettingsPrimitives'

export function ModelProviderSettingsSection({
  settings,
  configuration,
  onOpenExternal
}: {
  settings: TeachingSettingsV1
  configuration: TeachingWorkspaceConfiguration
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
  const { provider: providerOperation } = configuration.state
  const [apiKeyVisible, setApiKeyVisible] = useState(() => !settings.privacy.maskApiKeys)

  useEffect(() => {
    configuration.clearProviderStatus()
    setApiKeyVisible(!settings.privacy.maskApiKeys)
  }, [activeModelSettingsProvider.id, configuration, settings.privacy.maskApiKeys])

  const updateProvider = (patch: Partial<TeachingModelProviderProfile>): void => {
    void configuration.updateModelProvider(activeModelSettingsProvider.id, patch)
  }

  const updateProviderModels = (models: string[], syncGeneratorModel = true): void => {
    void configuration.updateModelProviderModels(activeModelSettingsProvider.id, models, syncGeneratorModel)
  }

  const selectModelProvider = (providerId: string): void => {
    void configuration.selectModelProvider(providerId)
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
          <div className="settings-api-key-field">
            <SettingsTextInput
              type={apiKeyVisible ? 'text' : 'password'}
              value={activeModelSettingsProvider.apiKey}
              placeholder={t('model.apiKey.placeholder')}
              onChange={(apiKey) => updateProvider({ apiKey })}
            />
            <button
              className="settings-api-key-visibility"
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
        <SettingsRow
          label={t('model.endpointFormat.label')}
          detail={t('model.endpointFormat.detail')}
        >
          <SettingsSelect
            ariaLabel={t('model.endpointFormat.label')}
            value={selectedEndpointFormat(settings)}
            options={MODEL_ENDPOINT_FORMAT_SELECTOR_OPTIONS.map((format) => ({
              value: format,
              label: endpointFormatLabel(format)
            }))}
            onChange={(endpointFormat) => void configuration.updateModelProviderEndpointFormat(
              activeModelSettingsProvider.id,
              endpointFormat
            )}
          />
        </SettingsRow>
        <SettingsRow label={t('model.models.label')}>
          <SettingsComboBox
            ariaLabel={t('model.models.label')}
            value={settings.generator.model}
            options={activeModelSettingsProvider.models}
            placeholder={t('model.models.placeholder')}
            onInput={(model) => void configuration.updateSetting('generator.model', model)}
            onSelect={(model) => {
              updateProviderModels([
                model,
                ...activeModelSettingsProvider.models.filter((item) => item !== model)
              ])
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('reasoning.title')}>
          <SettingsSelect
            ariaLabel={t('reasoning.title')}
            value={selectedReasoningEffort(settings)}
            options={reasoningEffortOptionsForSettings(settings).map((effort) => ({
              value: effort,
              label: reasoningEffortLabel(effort),
              icon: BrainCircuit
            }))}
            onChange={(reasoningEffort) => void configuration.updateSetting('generator.reasoningEffort', reasoningEffort)}
          />
        </SettingsRow>
        <SettingsRow label={t('model.actions.label')}>
          <div className="settings-actions">
            <button className="ghost-button" type="button" onClick={() => void configuration.probeModelProvider(activeModelSettingsProvider.id)} disabled={providerOperation.busy}>
              {providerOperation.busy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
              {t('model.actions.test')}
            </button>
            <button className="ghost-button" type="button" onClick={() => void configuration.refreshModelProviderModels(activeModelSettingsProvider.id)} disabled={providerOperation.busy || !modelListProbeSupportedForProvider(activeModelSettingsProvider)}>
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
            <button className="ghost-button" type="button" onClick={() => void configuration.resetModelProvider(activeModelSettingsProvider.id)}>
              <RefreshCw size={15} />
              {t('model.actions.reset')}
            </button>
          </div>
        </SettingsRow>
        {providerOperation.status ? (
          <div className="settings-empty-note" role="status" aria-live="polite">
            {providerStatusText(providerOperation.status, t)}
          </div>
        ) : null}
      </SettingsCard>
    </SettingsPanel>
  )
}

function providerStatusText(
  status: TeachingWorkspaceConfigurationStatus,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  switch (status.kind) {
    case 'connecting':
      return t('model.statusConnecting')
    case 'pulling':
      return t('model.statusPulling')
    case 'success':
      return t('model.statusOk', { latency: status.latencyMs, count: status.modelCount })
    case 'synced':
      return t('model.statusSynced', { count: status.modelCount })
    case 'reset':
      return t('model.statusReset')
    case 'failure':
      return status.message
  }
}

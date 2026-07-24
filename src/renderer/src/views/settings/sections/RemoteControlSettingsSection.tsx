import { Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TeachingSettingsV1 } from '../../../../../shared/teaching-types'
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSelect,
  SettingsTextInput,
  ToggleSwitch
} from '../SettingsPrimitives'

type RemoteControlSettingsSectionProps = {
  settings: TeachingSettingsV1
  updateSetting: (path: string, value: unknown) => Promise<void> | void
}

export function RemoteControlSettingsSection({
  settings,
  updateSetting
}: RemoteControlSettingsSectionProps) {
  const { t } = useTranslation()
  const remote = settings.webRemoteControl

  return (
    <SettingsPanel title={t('settings.remote.title')} subtitle={t('settings.remote.subtitle')}>
      <SettingsCard>
        <div className="settings-inline-note">
          <Smartphone size={16} />
          <span>{t('settings.remote.note')}</span>
        </div>
        <SettingsRow label={t('settings.remote.enabled.label')} detail={t('settings.remote.enabled.detail')}>
          <ToggleSwitch
            checked={remote.enabled}
            ariaLabel={t('settings.remote.enabled.label')}
            onChange={(enabled) => void updateSetting('webRemoteControl.enabled', enabled)}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.remote.bindMode.label')} detail={t('settings.remote.bindMode.detail')}>
          <SettingsSelect
            value={remote.bindMode}
            onChange={(bindMode) => void updateSetting('webRemoteControl.bindMode', bindMode)}
            options={[
              { value: 'loopback', label: t('settings.remote.bindMode.loopback') },
              { value: 'lan', label: t('settings.remote.bindMode.lan') }
            ]}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.remote.port.label')} detail={t('settings.remote.port.detail')}>
          <SettingsTextInput
            value={String(remote.port ?? 0)}
            placeholder="0"
            onChange={(raw) => {
              const port = Math.max(0, Math.min(65535, Number.parseInt(raw, 10) || 0))
              void updateSetting('webRemoteControl.port', port)
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.remote.relayMode.label')} detail={t('settings.remote.relayMode.detail')}>
          <SettingsSelect
            value={remote.relayMode}
            onChange={(relayMode) => void updateSetting('webRemoteControl.relayMode', relayMode)}
            options={[
              { value: 'lan', label: t('settings.remote.relayMode.lan') },
              { value: 'external', label: t('settings.remote.relayMode.external') }
            ]}
          />
        </SettingsRow>
        {remote.relayMode === 'external' ? (
          <>
            <SettingsRow
              label={t('settings.remote.externalRelayWsUrl.label')}
              detail={t('settings.remote.externalRelayWsUrl.detail')}
            >
              <SettingsTextInput
                value={remote.externalRelayWsUrl}
                placeholder="wss://relay.example.com/ws"
                onChange={(externalRelayWsUrl) =>
                  void updateSetting('webRemoteControl.externalRelayWsUrl', externalRelayWsUrl)
                }
              />
            </SettingsRow>
            <SettingsRow
              label={t('settings.remote.externalMobileBaseUrl.label')}
              detail={t('settings.remote.externalMobileBaseUrl.detail')}
            >
              <SettingsTextInput
                value={remote.externalMobileBaseUrl}
                placeholder="https://remote.example.com/"
                onChange={(externalMobileBaseUrl) =>
                  void updateSetting('webRemoteControl.externalMobileBaseUrl', externalMobileBaseUrl)
                }
              />
            </SettingsRow>
          </>
        ) : null}
      </SettingsCard>
    </SettingsPanel>
  )
}

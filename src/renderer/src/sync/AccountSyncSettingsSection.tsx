/**
 * Account & Sync settings section UI.
 *
 * Wired into the Settings shell under the "account" nav section. The top of
 * the panel renders a Livo-style account card (avatar, display name, login
 * badge and logout. Authentication happens at the application login gate, so
 * this page only exposes the signed-in account and a manual sync action. The
 * sync action reads the local canonical study-planning snapshot (READ-ONLY)
 * and pushes it to the server. Sync code NEVER writes back to local teaching
 * authority.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap, LogOut, RefreshCw } from 'lucide-react'
import { useAppStore } from '../app-shell/appStore'
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  ToggleSwitch
} from '../views/settings/SettingsPrimitives'
import { createSyncApiClient } from './sync-api-client'
import {
  clearSyncAuth,
  ensureDeviceId,
  getSyncAccessToken,
  getSyncState,
  setAnalyticsSyncEnabled,
  setSyncAuth,
  useSyncState
} from './sync-store'
import { useAnalyticsUploadBlocked } from './today-analytics-sync'
import {
  createStudyPlanningSyncBridge,
  readLocalStudyPlanningSnapshot
} from './sync-engine-bridge'

export function AccountSyncSettingsSection() {
  const { t } = useTranslation()
  const syncState = useSyncState()
  const workspaceRoot = useAppStore((state) => state.appState.activeWorkspace?.rootPath ?? null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const apiClient = useMemo(
    () =>
      createSyncApiClient({
        baseUrl: syncState.baseUrl,
        getAccessToken: getSyncAccessToken,
        getRefreshToken: () => getSyncState().refreshToken,
        onTokenRefreshed: (accessToken, refreshToken) =>
          setSyncAuth({ accessToken, refreshToken, user: getSyncState().user }),
        onTokenExpired: clearSyncAuth
      }),
    [syncState.baseUrl]
  )

  const handleLogout = useCallback(async () => {
    if (!syncState.refreshToken) {
      clearSyncAuth()
      setMessage(t('account.logout.cleared', { defaultValue: '已清除本地登录' }))
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await apiClient.logout(syncState.refreshToken)
      clearSyncAuth()
      setMessage(t('account.logout.done', { defaultValue: '已退出登录' }))
    } catch (err) {
      clearSyncAuth()
      setMessage(
        `${t('account.logout.error', { defaultValue: '退出登录出错（已清除本地）' })}：${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
    }
  }, [apiClient, syncState.refreshToken, t])

  const handleSync = useCallback(async () => {
    if (!workspaceRoot) {
      setMessage(t('account.sync.openWorkspace', { defaultValue: '请先打开工作区' }))
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const deviceId = ensureDeviceId()
      const local = await readLocalStudyPlanningSnapshot(window.teachingSystem, workspaceRoot)
      if (!local.ok) {
        setMessage(`${t('account.sync.readFailed', { defaultValue: '无法读取本地规划' })}：${local.message}`)
        return
      }
      const bridge = createStudyPlanningSyncBridge({ apiClient, deviceId })
      const result = await bridge.pushStudyPlanning(local.snapshot)
      if (!result.ok) {
        if (result.code === 'conflict') {
          setMessage(
            result.serverRevision !== undefined
              ? t('account.sync.conflictWithRevisions', {
                  defaultValue:
                    '检测到同步冲突：本地 r{{localRevision}}，服务端 r{{serverRevision}}。为保护两端数据，未覆盖任何数据。',
                  localRevision: local.snapshot.revision,
                  serverRevision: result.serverRevision
                })
              : t('account.sync.conflict', {
                  defaultValue: '检测到同步冲突：服务端存在更高版本。为保护两端数据，未覆盖任何数据。'
                })
          )
          return
        }
        setMessage(`${t('account.sync.failed', { defaultValue: '同步失败' })}：${result.message}`)
        return
      }
      const revisionSuffix = result.serverRevision !== undefined ? ` (r${result.serverRevision})` : ''
      setMessage(
        `${t(
          result.status === 'up_to_date' ? 'account.sync.upToDate' : 'account.sync.done',
          { defaultValue: result.status === 'up_to_date' ? '已是最新状态' : '同步完成' }
        )}${revisionSuffix}`
      )
    } catch (err) {
      setMessage(
        `${t('account.sync.error', { defaultValue: '同步出错' })}：${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
    }
  }, [apiClient, workspaceRoot, t])

  const loggedIn = Boolean(syncState.accessToken)
  const uploadBlocked = useAnalyticsUploadBlocked()
  const displayName =
    syncState.user?.nickname || syncState.user?.id || t('account.status.loggedIn', { defaultValue: '已登录' })
  const localName = t('account.status.local', { defaultValue: '本地模式' })
  const deviceLabel = syncState.deviceId ?? t('account.device.none', { defaultValue: '未生成' })

  return (
    <SettingsPanel
      title={t('account.title', { defaultValue: '账号与同步' })}
      subtitle={t('account.subtitle', {
        defaultValue: '登录 StudiumX-Server 以同步学习计划（教学资产始终以本地为权威）。'
      })}
    >
      {/* Account card - Livo-style avatar + name + badge + logout */}
      <div className="account-card">
        {syncState.user?.avatarUrl ? (
          <img
            className="account-card-avatar"
            src={syncState.user.avatarUrl}
            alt={displayName}
          />
        ) : (
          <span className="account-card-avatar-fallback" aria-hidden="true">
            <GraduationCap size={26} strokeWidth={1.8} />
          </span>
        )}
        <div className="account-card-body">
          <p className="account-card-name">{loggedIn ? displayName : localName}</p>
          <p className="account-card-meta">
            <span
              className={`account-badge ${loggedIn ? 'account-badge--on' : 'account-badge--off'}`}
            >
              {loggedIn
                ? t('account.badge.online', { defaultValue: '已登录' })
                : t('account.badge.local', { defaultValue: '本地' })}
            </span>
            {loggedIn && syncState.user?.id ? <span>{syncState.user.id}</span> : null}
          </p>
        </div>
        <div className="account-card-action">
          {loggedIn ? (
            <button
              type="button"
              className="ghost-button"
              onClick={handleLogout}
              disabled={busy}
              aria-label={t('account.logout.label', { defaultValue: '退出登录' })}
            >
              <LogOut size={14} />
              {t('account.logout.label', { defaultValue: '退出登录' })}
            </button>
          ) : null}
        </div>
      </div>

      <SettingsCard>
        <SettingsRow
          label={t('account.device.label', { defaultValue: '设备 ID' })}
          detail={t('account.device.detail', { defaultValue: '同步设备标识' })}
        >
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{deviceLabel}</span>
        </SettingsRow>

        <SettingsRow
          label={t('account.analyticsSync.label', { defaultValue: '学习分析同步' })}
          detail={t('account.analyticsSync.detail', {
            defaultValue: '上传今日专注数据并参与全平台专注超越对比'
          })}
        >
          <ToggleSwitch
            checked={syncState.analyticsSyncEnabled === true}
            disabled={!loggedIn}
            ariaLabel={t('account.analyticsSync.label', { defaultValue: '学习分析同步' })}
            onChange={setAnalyticsSyncEnabled}
          />
        </SettingsRow>
        {uploadBlocked && syncState.analyticsSyncEnabled === true ? (
          <div className="settings-card-feedback" role="status" aria-live="polite">
            {t('account.analyticsSync.uploadBlocked', {
              defaultValue: '服务端未开启上传，已暂停学习分析同步'
            })}
          </div>
        ) : null}

        <SettingsRow
          label={t('account.sync.now', { defaultValue: '立即同步' })}
          detail={t('account.sync.nowDetail', { defaultValue: '将本地学习计划快照推送至服务端' })}
        >
          <button
            type="button"
            className="ghost-button account-sync-now-button"
            onClick={handleSync}
            disabled={busy || !workspaceRoot}
            aria-label={t('account.sync.now', { defaultValue: '立即同步' })}
            title={t('account.sync.now', { defaultValue: '立即同步' })}
          >
            <RefreshCw
              size={17}
              strokeWidth={2}
              className={busy ? 'account-sync-now-icon--spinning' : undefined}
              aria-hidden="true"
            />
          </button>
        </SettingsRow>

        {message ? (
          <div className="settings-card-feedback" role="status" aria-live="polite">
            {message}
          </div>
        ) : null}
      </SettingsCard>
    </SettingsPanel>
  )
}

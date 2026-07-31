/**
 * Account & Sync settings section UI.
 *
 * Wired into the Settings shell under the "account" nav section. The top of
 * the panel renders a Livo-style account card (avatar, display name, login
 * badge, logout). WeChat QR login is driven by loginWithWechatQr (desktop
 * popup + polling flow). The "立即同步" button reads the local canonical
 * study-planning snapshot (READ-ONLY) and pushes it to the server. Sync code
 * NEVER writes back to local teaching authority.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap, LogOut } from 'lucide-react'
import { useAppStore } from '../app-shell/appStore'
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  ToggleSwitch
} from '../views/settings/SettingsPrimitives'
import { createSyncApiClient } from './sync-api-client'
import { loginWithWechatQr } from './wechat-qr-login'
import {
  clearSyncAuth,
  ensureDeviceId,
  getSyncAccessToken,
  setSyncAuth,
  setSyncEnabled,
  useSyncState,
  type SyncAuthUser
} from './sync-store'
import {
  createStudyPlanningSyncBridge,
  readLocalStudyPlanningSnapshot
} from './sync-engine-bridge'

export function AccountSyncSettingsSection() {
  const { t } = useTranslation()
  const syncState = useSyncState()
  const workspaceRoot = useAppStore((state) => state.appState.activeWorkspace?.rootPath ?? null)
  const [loginProgress, setLoginProgress] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const apiClient = useMemo(
    () =>
      createSyncApiClient({
        baseUrl: syncState.baseUrl,
        getAccessToken: getSyncAccessToken,
        onTokenExpired: clearSyncAuth
      }),
    [syncState.baseUrl]
  )

  const handleLogin = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    setLoginProgress(t('account.login.opening', { defaultValue: '正在获取登录链接…' }))
    try {
      ensureDeviceId()
      const controller = new AbortController()
      const result = await loginWithWechatQr(
        apiClient,
        (status) => setLoginProgress(status),
        controller.signal,
      )
      if (result.ok) {
        setSyncAuth({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: (result.user as SyncAuthUser | undefined) ?? null,
        })
        setMessage(t('account.login.success', { defaultValue: '登录成功' }))
      } else {
        setMessage(`${t('account.login.failed', { defaultValue: '登录失败' })}：${result.error}`)
      }
    } catch (err) {
      setMessage(
        `${t('account.login.failed', { defaultValue: '登录失败' })}：${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
      setLoginProgress(null)
    }
  }, [apiClient, t])

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
    if (!syncState.enabled) {
      setMessage(t('account.sync.enableFirst', { defaultValue: '请先启用同步' }))
      return
    }
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
        setMessage(`${t('account.sync.failed', { defaultValue: '同步失败' })}：${result.message}`)
        return
      }
      const revisionSuffix = result.serverRevision !== undefined ? ` (r${result.serverRevision})` : ''
      setMessage(`${t('account.sync.done', { defaultValue: '同步完成' })}：${result.status}${revisionSuffix}`)
    } catch (err) {
      setMessage(
        `${t('account.sync.error', { defaultValue: '同步出错' })}：${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
    }
  }, [apiClient, syncState.enabled, workspaceRoot, t])

  const loggedIn = Boolean(syncState.accessToken)
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
          label={t('account.wechat.label', { defaultValue: '微信登录' })}
          detail={t('account.wechat.detail', { defaultValue: '扫码登录 StudiumX-Server' })}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {loggedIn ? null : (
              <button type="button" onClick={handleLogin} disabled={busy}>
                {busy && loginProgress
                  ? t('account.login.inProgress', { defaultValue: '登录中…' })
                  : t('account.wechat.signIn', { defaultValue: '微信扫码登录' })}
              </button>
            )}
            {loginProgress ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loginProgress}</span>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('account.device.label', { defaultValue: '设备 ID' })}
          detail={t('account.device.detail', { defaultValue: '同步设备标识' })}
        >
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{deviceLabel}</span>
        </SettingsRow>

        <SettingsRow
          label={t('account.sync.enable', { defaultValue: '启用同步' })}
          detail={t('account.sync.enableDetail', { defaultValue: '仅用户主动开启后才会同步' })}
        >
          <ToggleSwitch
            checked={syncState.enabled}
            ariaLabel={t('account.sync.enable', { defaultValue: '启用同步' })}
            onChange={setSyncEnabled}
          />
        </SettingsRow>

        <SettingsRow
          label={t('account.sync.now', { defaultValue: '立即同步' })}
          detail={t('account.sync.nowDetail', { defaultValue: '将本地学习计划快照推送至服务端' })}
        >
          <button
            type="button"
            onClick={handleSync}
            disabled={busy || !syncState.enabled || !workspaceRoot}
          >
            {t('account.sync.now', { defaultValue: '立即同步' })}
          </button>
        </SettingsRow>

        {message ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>{message}</div>
        ) : null}
      </SettingsCard>
    </SettingsPanel>
  )
}

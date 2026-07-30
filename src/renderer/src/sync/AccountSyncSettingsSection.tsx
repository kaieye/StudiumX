/**
 * Account & Sync settings section UI.
 *
 * User-initiated + login-gated only. WeChat QR flow is a later phase — for now
 * a placeholder code input drives loginWechat. The "立即同步" button reads the
 * local canonical study-planning snapshot (READ-ONLY) and pushes it to the
 * server. Sync code NEVER writes back to local teaching authority.
 *
 * Not yet wired into the settings shell — that is a later integration task.
 */

import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '../app-shell/appStore'
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsTextInput,
  ToggleSwitch
} from '../views/settings/SettingsPrimitives'
import { createSyncApiClient } from './sync-api-client'
import {
  clearSyncAuth,
  ensureDeviceId,
  getSyncAccessToken,
  setSyncAuth,
  setSyncEnabled,
  useSyncState
} from './sync-store'
import {
  createStudyPlanningSyncBridge,
  readLocalStudyPlanningSnapshot
} from './sync-engine-bridge'

export function AccountSyncSettingsSection() {
  const syncState = useSyncState()
  const workspaceRoot = useAppStore((state) => state.appState.activeWorkspace?.rootPath ?? null)
  const [code, setCode] = useState('')
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
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setMessage('请输入微信授权码')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      ensureDeviceId()
      const res = await apiClient.loginWechat(trimmedCode, 'desktop')
      setSyncAuth({ accessToken: res.accessToken, refreshToken: res.refreshToken, user: res.user ?? null })
      setMessage('登录成功')
      setCode('')
    } catch (err) {
      setMessage(`登录失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [apiClient, code])

  const handleLogout = useCallback(async () => {
    if (!syncState.refreshToken) {
      clearSyncAuth()
      setMessage('已清除本地登录')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await apiClient.logout(syncState.refreshToken)
      clearSyncAuth()
      setMessage('已退出登录')
    } catch (err) {
      clearSyncAuth()
      setMessage(`退出登录出错（已清除本地）：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [apiClient, syncState.refreshToken])

  const handleSync = useCallback(async () => {
    if (!syncState.enabled) {
      setMessage('请先启用同步')
      return
    }
    if (!workspaceRoot) {
      setMessage('请先打开工作区')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const deviceId = ensureDeviceId()
      const local = await readLocalStudyPlanningSnapshot(window.teachingSystem, workspaceRoot)
      if (!local.ok) {
        setMessage(`无法读取本地规划：${local.message}`)
        return
      }
      const bridge = createStudyPlanningSyncBridge({ apiClient, deviceId })
      const result = await bridge.pushStudyPlanning(local.snapshot)
      if (!result.ok) {
        setMessage(`同步失败：${result.message}`)
        return
      }
      const revisionSuffix = result.serverRevision !== undefined ? ` (r${result.serverRevision})` : ''
      setMessage(`同步完成：${result.status}${revisionSuffix}`)
    } catch (err) {
      setMessage(`同步出错：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [apiClient, syncState.enabled, workspaceRoot])

  const loggedIn = Boolean(syncState.accessToken)
  const displayName = syncState.user?.nickname || syncState.user?.id || '已登录'
  const deviceLabel = syncState.deviceId ?? '未生成'

  return (
    <SettingsPanel title="账号与同步" subtitle="登录 StudiumX-Server 以同步学习计划（教学资产始终以本地为权威）。">
      <SettingsCard>
        <SettingsRow label="登录状态" detail="服务端账号">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{loggedIn ? displayName : '未登录'}</span>
            {loggedIn ? (
              <button type="button" onClick={handleLogout} disabled={busy}>
                退出登录
              </button>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow label="微信授权码" detail="占位输入（真实扫码流程稍后）">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <SettingsTextInput value={code} placeholder="wechat auth code" onChange={setCode} />
            <button type="button" onClick={handleLogin} disabled={busy}>
              微信登录
            </button>
          </div>
        </SettingsRow>

        <SettingsRow label="设备 ID" detail="同步设备标识">
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{deviceLabel}</span>
        </SettingsRow>

        <SettingsRow label="启用同步" detail="仅用户主动开启后才会同步">
          <ToggleSwitch
            checked={syncState.enabled}
            ariaLabel="启用同步"
            onChange={setSyncEnabled}
          />
        </SettingsRow>

        <SettingsRow label="立即同步" detail="将本地学习计划快照推送至服务端">
          <button type="button" onClick={handleSync} disabled={busy || !syncState.enabled || !workspaceRoot}>
            立即同步
          </button>
        </SettingsRow>

        {message ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary, inherit)' }}>{message}</div>
        ) : null}
      </SettingsCard>
    </SettingsPanel>
  )
}

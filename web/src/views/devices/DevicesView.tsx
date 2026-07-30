/**
 * Device management / 设备管理 view (plan §7.1).
 *
 * Lists the signed-in user's bound devices as reported by StudiumX-Server
 * (`GET /devices` -> `{ devices: Device[] }`, contract §6). Each row shows the
 * device name, platform, app version, last-seen and bound-at times, and a
 * badge marking the CURRENT device.
 *
 * Data source / adapter seam:
 *   `TeachingSystemApi` has NO device-listing method (devices are an account
 *   concept, not a teaching-system capability). Per the feature brief this is
 *   the same DOCUMENTED PRAGMATIC EXCEPTION used by the lessons/conversations
 *   list: this view calls `GET /devices` directly via `apiGet` from the shared
 *   HTTP client (which injects the Bearer header + handles 401 refresh/retry),
 *   instead of going through `window.teachingSystem.*`. No adapter file is
 *   created (there is no `TeachingSystemApi` method to implement).
 *
 * Current-device identification:
 *   The current device id is read from `GET /auth/me` (`{ user: { id,
 *   deviceId } }`, contract §1d/§8) - the `deviceId` baked into the access
 *   token. This stays on the http seam (no direct token / localStorage access,
 *   per red lines).
 *
 * Scope (red lines):
 *   Read-only. The server exposes `DELETE /devices/:id` to revoke+delete a
 *   device, but the shared HTTP client (`web/src/api/http.ts`) exports only
 *   `apiGet` / `apiPost` / `apiPut` (no `apiDelete`) and is locked from
 *   feature-level modification; a raw `fetch` would require reading the access
 *   token, which feature modules must never do. A web-side "解除绑定" action is
 *   therefore deferred (see TODO below) - read-only is the minimum acceptable
 *   scope per the brief. No model keys, agent loop, or workspace writes.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '../../api/http'

/** `Device` row mapped from the `devices` table (contract §6). */
interface Device {
  id: string
  platform: string | null
  deviceName: string | null
  appVersion: string | null
  /** UTC ms; null when unknown. */
  lastSeenAt: number | null
  /** UTC ms; null when unknown. */
  createdAt: number | null
}

/** Response envelope for `GET /devices`. */
interface DevicesResponse {
  devices: Device[]
}

/** Response envelope for `GET /auth/me` (id + deviceId from the access token). */
interface MeResponse {
  user: { id: string; deviceId: string }
}

type ViewStatus = 'loading' | 'error' | 'empty' | 'ready'

/**
 * Human message for a thrown error. The shared HTTP client throws `ApiError`
 * (any non-2xx) and `AuthError` (unrecoverable auth); `AuthError` is detected
 * by its class `name` so this view does not import the http seam beyond
 * `apiGet`.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AuthError') return '登录已过期，请退出后重新登录。'
    return err.message || '加载设备列表失败。'
  }
  return '加载设备列表失败。'
}

/** Format a UTC-ms timestamp as `zh-CN` date+time, or `-` when absent/invalid. */
function formatTimestamp(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '-'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Relative "x 分钟前"-style label for last-seen; falls back to an absolute date. */
function relativeTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '-'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '-'
  const diffMs = Date.now() - ms
  if (diffMs < 0) return formatTimestamp(ms) // clock skew / future stamp
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return formatTimestamp(ms)
}

/** Friendly Chinese label for a platform string (case-insensitive). */
function platformLabel(platform: string | null): string {
  if (!platform) return '未知'
  const map: Record<string, string> = {
    web: 'Web',
    darwin: 'macOS',
    macos: 'macOS',
    win32: 'Windows',
    windows: 'Windows',
    linux: 'Linux'
  }
  return map[platform.toLowerCase()] ?? platform
}

/** Display name for a device: explicit name -> platform -> id. */
function deviceLabel(device: Device): string {
  const name = device.deviceName?.trim()
  if (name) return name
  return platformLabel(device.platform) || device.id
}

export function DevicesView() {
  const [devices, setDevices] = useState<Device[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [status, setStatus] = useState<ViewStatus>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const load = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    try {
      // Fetch the device list and the current device id in parallel. `/auth/me`
      // failing must NOT block the list (degrade to "no current-device badge");
      // `/devices` failing is a hard error for this view.
      const [devicesRes, meRes] = await Promise.all([
        apiGet<DevicesResponse>('/devices'),
        apiGet<MeResponse>('/auth/me').catch(() => null)
      ])
      setDevices(devicesRes.devices)
      setCurrentDeviceId(meRes?.user.deviceId ?? null)
      setStatus(devicesRes.devices.length === 0 ? 'empty' : 'ready')
    } catch (err) {
      setDevices([])
      setCurrentDeviceId(null)
      setStatus('error')
      setErrorMsg(describeError(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">设备管理</h1>
        <p className="mt-1 text-sm text-neutral-500">
          查看已绑定到你账户的设备。当前登录的设备会被标记。
        </p>
      </header>

      {status === 'loading' && <LoadingState />}
      {status === 'error' && (
        <ErrorState message={errorMsg} onRetry={() => void load()} />
      )}
      {status === 'empty' && <EmptyState />}
      {status === 'ready' && (
        <DeviceTable
          devices={devices}
          currentDeviceId={currentDeviceId}
        />
      )}

      {/* Scope note: web is read-only for device management. */}
      <p className="mt-6 text-xs text-neutral-400">
        Web 端为只读视图，暂不支持在此解绑设备。如需解绑，请在对应设备上退出登录或使用桌面端。
      </p>
    </main>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-neutral-200 bg-white py-16">
      <div className="flex flex-col items-center gap-3">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        <span className="text-sm text-neutral-500">正在加载设备列表…</span>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-10 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
      >
        重试
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-5 py-16 text-center">
      <p className="text-sm text-neutral-500">暂无已绑定设备。</p>
    </div>
  )
}

function DeviceTable({
  devices,
  currentDeviceId
}: {
  devices: Device[]
  currentDeviceId: string | null
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium text-neutral-500">
            <th scope="col" className="px-5 py-3">设备</th>
            <th scope="col" className="px-5 py-3">平台</th>
            <th scope="col" className="px-5 py-3">版本</th>
            <th scope="col" className="px-5 py-3">最近活跃</th>
            <th scope="col" className="px-5 py-3">绑定时间</th>
            <th scope="col" className="px-5 py-3">状态</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => {
            const isCurrent = currentDeviceId !== null && device.id === currentDeviceId
            return (
              <tr
                key={device.id}
                className={
                  'border-b border-neutral-100 last:border-0 ' +
                  (isCurrent ? 'bg-blue-50/60' : '')
                }
              >
                <td className="px-5 py-3">
                  <div className="font-medium text-neutral-900">{deviceLabel(device)}</div>
                  <div className="font-mono text-xs text-neutral-400">{device.id}</div>
                </td>
                <td className="px-5 py-3 text-neutral-700">{platformLabel(device.platform)}</td>
                <td className="px-5 py-3 text-neutral-700">{device.appVersion ?? '-'}</td>
                <td className="px-5 py-3 text-neutral-700">
                  <span title={formatTimestamp(device.lastSeenAt)}>
                    {relativeTime(device.lastSeenAt)}
                  </span>
                </td>
                <td className="px-5 py-3 text-neutral-700">{formatTimestamp(device.createdAt)}</td>
                <td className="px-5 py-3">
                  {isCurrent ? (
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                      当前设备
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400">其他设备</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

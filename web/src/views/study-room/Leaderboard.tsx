/**
 * Read-only study room leaderboard.
 *
 * Members and ranking are loaded from the server-backed study-room presence
 * endpoint. The local/session analytics values remain available as an offline
 * fallback while the room is being assigned or temporarily unreachable.
 */

import { RefreshCw, Trophy } from 'lucide-react'
import type { LeaderboardData } from './types'

interface LeaderboardProps {
  data: LeaderboardData | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}

function formatFocusDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}小时${m > 0 ? `${m}分` : ''}`
  if (m > 0) return `${m}分钟`
  return `${s}秒`
}

const SOURCE_LABEL: Record<LeaderboardData['source'], string> = {
  server: '服务端',
  local: '本机',
  room: '房间实时',
  empty: '无'
}

export function Leaderboard({ data, loading, error, onRefresh }: LeaderboardProps) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Trophy size={18} aria-hidden="true" /> 自习室榜单
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
        >
          <RefreshCw size={13} aria-hidden="true" className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {error}
        </p>
      )}

      <div className="mt-4">
        {data && data.entries.length > 0 ? (
          <ul className="divide-y divide-neutral-100">
            {data.entries.map((entry) => (
              <li
                key={`${entry.rank}-${entry.nickname}`}
                className={`flex items-center justify-between py-3 ${
                  entry.isSelf ? 'rounded-md bg-rose-50 px-3' : ''
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
                    {entry.rank}
                  </span>
                  <span className="font-medium text-neutral-800">
                    {entry.nickname}
                    {entry.isSelf && (
                      <span className="ml-1 text-xs text-rose-500">（我）</span>
                    )}
                  </span>
                </span>
                <span className="tabular-nums text-neutral-700">
                  {formatFocusDuration(entry.focusSeconds)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-neutral-200 px-4 py-8 text-center">
            <p className="text-sm text-neutral-500">暂无榜单数据</p>
            <p className="mt-1 text-xs text-neutral-400">
              完成一个专注段后这里会显示你的今日时长。
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-400">
        <p>
          今日专注：<strong className="text-neutral-600">
            {formatFocusDuration(data?.selfFocusSeconds ?? 0)}
          </strong>
          ｜完成段数：<strong className="text-neutral-600">
            {data?.selfSessionsToday ?? 0}
          </strong>
          ｜数据来源：<strong className="text-neutral-600">
            {data ? SOURCE_LABEL[data.source] : '—'}
          </strong>
        </p>
        {data?.note && (
          <p className="mt-1.5">{data.note}</p>
        )}
      </div>
    </section>
  )
}

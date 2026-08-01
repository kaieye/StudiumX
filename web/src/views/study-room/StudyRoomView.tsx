/**
 * Study room view (plan §8 Phase 5 / §6.3 / §10): a client-side focus/pomodoro
 * timer plus a read-only leaderboard.
 *
 * The timer runs locally; completed focus segments are logged + best-effort
 * pushed to the server via the sync API (window.teachingSystem ->
 * study-room adapter -> POST /sync/push). The leaderboard renders the current
 * user's today focus and the server-backed room member ranking.
 */

import { useMemo } from 'react'
import { FocusTimer } from './FocusTimer'
import { Leaderboard } from './Leaderboard'
import { useStudyRoomSessions } from './useStudyRoomSessions'
import { useStudyRoomPresence } from './useStudyRoomPresence'
import type { LeaderboardData } from './types'

const SYNC_STATUS_LABEL = {
  idle: '已同步',
  syncing: '同步中…',
  error: '同步失败，将重试',
  offline: '离线，待联网后同步'
} as const

function formatFocusDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}小时${m > 0 ? `${m}分` : ''}`
  if (m > 0) return `${m}分钟`
  return `${s}秒`
}

export function StudyRoomView() {
  const study = useStudyRoomSessions()
  const presence = useStudyRoomPresence({ focusSecondsToday: study.todayFocusSeconds })
  const roomLeaderboard = useMemo<LeaderboardData | null>(() => {
    if (!presence.roomId || presence.members.length === 0) return study.leaderboard
    const members = [...presence.members].sort((a, b) => b.focusSecondsToday - a.focusSecondsToday)
    const self = members.find((member) => member.isSelf)
    return {
      entries: members.map((member, index) => ({
        rank: index + 1,
        nickname: member.nickname?.trim() || '未设置昵称',
        focusSeconds: member.focusSecondsToday,
        isSelf: member.isSelf
      })),
      selfFocusSeconds: self?.focusSecondsToday ?? study.todayFocusSeconds,
      selfSessionsToday: study.todaySessionCount,
      source: 'room',
      peersUnavailable: false,
      note: `房间实时排行，每 15 秒刷新（${members.length} 人在线）`
    }
  }, [presence.members, presence.roomId, study.leaderboard, study.todayFocusSeconds, study.todaySessionCount])
  const refreshAll = () => {
    study.refreshLeaderboard()
    presence.refresh()
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">自习室</h1>
        <p className="mt-1 text-sm text-neutral-500">
          本地番茄钟专注计时，完成后自动同步；排行榜展示房间内实时专注排行。
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          房间 {presence.roomId ?? '分配中'} · 在线 {presence.members.length} 人 · 每 15 秒同步
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <FocusTimer onFocusSessionComplete={study.addSession} />

          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">今日专注</h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  study.syncStatus === 'idle'
                    ? 'bg-emerald-50 text-emerald-600'
                    : study.syncStatus === 'syncing'
                      ? 'bg-sky-50 text-sky-600'
                      : 'bg-amber-50 text-amber-600'
                }`}
              >
                {SYNC_STATUS_LABEL[study.syncStatus]}
                {study.pendingCount > 0 ? `（${study.pendingCount} 待同步）` : ''}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-neutral-50 p-4">
                <p className="text-xs text-neutral-500">专注时长</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
                  {formatFocusDuration(study.todayFocusSeconds)}
                </p>
              </div>
              <div className="rounded-xl bg-neutral-50 p-4">
                <p className="text-xs text-neutral-500">完成段数</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
                  {study.todaySessionCount}
                </p>
              </div>
            </div>
            {study.pendingCount > 0 && (
              <button
                type="button"
                onClick={study.pushNow}
                className="mt-4 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100"
              >
                立即同步 {study.pendingCount} 个待推送段
              </button>
            )}
            {study.sessions.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-neutral-500">
                  本机记录（最近 {study.sessions.length} 段）
                </summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-neutral-500">
                  {study.sessions
                    .slice()
                    .reverse()
                    .map((s) => (
                      <li key={s.id} className="flex justify-between">
                        <span>
                          {new Date(s.endedAtMs).toLocaleTimeString()} ·{' '}
                          {s.state === 'completed' ? '完成' : '中止'} · {s.planLabel}
                        </span>
                        <span className="tabular-nums">
                          {formatFocusDuration(s.focusSeconds)}
                        </span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </section>
        </div>

        <Leaderboard
          data={roomLeaderboard}
          loading={study.leaderboardLoading || presence.loading}
          error={presence.error ?? study.leaderboardError}
          onRefresh={refreshAll}
        />
      </div>
    </main>
  )
}

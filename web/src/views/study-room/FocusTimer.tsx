/**
 * Client-side pomodoro focus timer (plan §6.3 / §10).
 *
 * Runs entirely in the browser: a focus countdown -> break countdown -> focus
 * cycle. Completed focus segments are emitted via `onFocusSessionComplete` so
 * the parent can log them locally and best-effort push them to the server.
 *
 * Timing uses the wall clock (`endsAtMs`) rather than counting ticks, so tab
 * throttling / background pausing never drifts the countdown (plan §390:
 * local timing must keep running correctly). The OS-power wake path from the
 * desktop (ADR powerMonitor) is intentionally absent on web.
 */

import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import type { StudyRoomSession } from './types'

type TimerPhase = 'focus' | 'break'
type TimerStatus = 'idle' | 'running' | 'paused'

interface FocusTimerProps {
  onFocusSessionComplete: (session: StudyRoomSession) => void
}

const DEFAULT_FOCUS_MIN = 25
const DEFAULT_BREAK_MIN = 5
const MIN_MIN = 1
const MAX_MIN = 120
/** Sub-minute focus segments are not worth recording/syncing. */
const MIN_FOCUS_SECONDS_TO_RECORD = 60
const TICK_MS = 250

function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_FOCUS_MIN
  return Math.min(MAX_MIN, Math.max(MIN_MIN, Math.round(n)))
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `ses-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function FocusTimer({ onFocusSessionComplete }: FocusTimerProps) {
  const [focusMinutes, setFocusMinutes] = useState(DEFAULT_FOCUS_MIN)
  const [breakMinutes, setBreakMinutes] = useState(DEFAULT_BREAK_MIN)
  const [phase, setPhase] = useState<TimerPhase>('focus')
  const [status, setStatus] = useState<TimerStatus>('idle')
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_FOCUS_MIN * 60)

  // Mutable timer values read inside the tick interval (kept in refs so the
  // interval effect only depends on `status` and is never restarted on
  // unrelated re-renders).
  const endsAtMsRef = useRef<number | null>(null)
  const segmentTargetRef = useRef<number>(DEFAULT_FOCUS_MIN * 60)
  const segmentStartMsRef = useRef<number | null>(null)
  const phaseRef = useRef<TimerPhase>('focus')
  const focusMinRef = useRef(focusMinutes)
  const breakMinRef = useRef(breakMinutes)
  const onCompleteRef = useRef(onFocusSessionComplete)
  focusMinRef.current = focusMinutes
  breakMinRef.current = breakMinutes
  onCompleteRef.current = onFocusSessionComplete

  const targetForPhase = (p: TimerPhase): number =>
    (p === 'focus' ? focusMinRef.current : breakMinRef.current) * 60

  const emitFocusSession = (
    focusSeconds: number,
    state: 'completed' | 'cancelled'
  ): void => {
    if (focusSeconds < MIN_FOCUS_SECONDS_TO_RECORD) return
    const now = Date.now()
    onCompleteRef.current({
      id: newSessionId(),
      phase: 'focus',
      state,
      targetSeconds: segmentTargetRef.current,
      focusSeconds,
      startedAtMs: segmentStartMsRef.current ?? now,
      endedAtMs: now,
      planLabel: `番茄 ${focusMinRef.current}/${breakMinRef.current}`,
      source: 'web'
    })
  }

  const resetToIdle = (): void => {
    const target = focusMinRef.current * 60
    phaseRef.current = 'focus'
    setPhase('focus')
    segmentTargetRef.current = target
    setSecondsLeft(target)
    segmentStartMsRef.current = null
    endsAtMsRef.current = null
    setStatus('idle')
  }

  // Countdown loop: starts when `status === 'running'`, cleared otherwise.
  useEffect(() => {
    if (status !== 'running') return
    const tick = () => {
      const endsAt = endsAtMsRef.current
      if (endsAt == null) return
      const remaining = Math.round((endsAt - Date.now()) / 1000)
      if (remaining > 0) {
        setSecondsLeft(remaining)
        return
      }
      // Phase complete.
      setSecondsLeft(0)
      const completedPhase = phaseRef.current
      if (completedPhase === 'focus') {
        emitFocusSession(segmentTargetRef.current, 'completed')
      }
      const nextPhase: TimerPhase = completedPhase === 'focus' ? 'break' : 'focus'
      const nextTarget = targetForPhase(nextPhase)
      phaseRef.current = nextPhase
      segmentTargetRef.current = nextTarget
      segmentStartMsRef.current = Date.now()
      endsAtMsRef.current = Date.now() + nextTarget * 1000
      setPhase(nextPhase)
      setSecondsLeft(nextTarget)
    }
    const handle = setInterval(tick, TICK_MS)
    return () => clearInterval(handle)
    // Only `status`: all mutable values are refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const handleStart = (): void => {
    const target = focusMinRef.current * 60
    phaseRef.current = 'focus'
    setPhase('focus')
    segmentTargetRef.current = target
    setSecondsLeft(target)
    segmentStartMsRef.current = Date.now()
    endsAtMsRef.current = Date.now() + target * 1000
    setStatus('running')
  }

  const handlePause = (): void => {
    const endsAt = endsAtMsRef.current
    if (endsAt != null) {
      setSecondsLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
    }
    setStatus('paused')
  }

  const handleResume = (): void => {
    endsAtMsRef.current = Date.now() + Math.max(0, secondsLeft) * 1000
    setStatus('running')
  }

  const handleStop = (): void => {
    if (phaseRef.current === 'focus' && status !== 'idle') {
      emitFocusSession(segmentTargetRef.current - secondsLeft, 'cancelled')
    }
    resetToIdle()
  }

  /** Skip the current phase (records a completed focus if skipping focus). */
  const handleSkip = (): void => {
    if (status === 'idle') return
    if (phaseRef.current === 'focus') {
      emitFocusSession(segmentTargetRef.current - secondsLeft, 'cancelled')
    }
    const nextPhase: TimerPhase = phaseRef.current === 'focus' ? 'break' : 'focus'
    const nextTarget = targetForPhase(nextPhase)
    phaseRef.current = nextPhase
    segmentTargetRef.current = nextTarget
    segmentStartMsRef.current = Date.now()
    endsAtMsRef.current = Date.now() + nextTarget * 1000
    setPhase(nextPhase)
    setSecondsLeft(nextTarget)
  }

  const handleFocusMinChange = (n: number): void => {
    const v = clampMinutes(n)
    setFocusMinutes(v)
    if (status === 'idle') {
      setSecondsLeft(v * 60)
      segmentTargetRef.current = v * 60
    }
  }

  const handleBreakMinChange = (n: number): void => {
    const v = clampMinutes(n)
    setBreakMinutes(v)
  }

  const target = (phase === 'focus' ? focusMinutes : breakMinutes) * 60
  const progress = target > 0 ? Math.min(1, Math.max(0, (target - secondsLeft) / target)) : 0
  const phaseLabel = phase === 'focus' ? '专注' : '休息'
  const phaseColor = phase === 'focus' ? 'bg-rose-500' : 'bg-emerald-500'
  const configDisabled = status !== 'idle'

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">专注计时器</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium text-white ${phaseColor}`}
        >
          {phaseLabel}
        </span>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <div
          className="text-6xl font-bold tabular-nums tracking-tight text-neutral-900"
          aria-live="polite"
        >
          {formatClock(secondsLeft)}
        </div>
        <div className="mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full transition-all ${phaseColor}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-3">
        {status === 'idle' && (
          <button
            type="button"
            onClick={handleStart}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            <Play size={16} aria-hidden="true" /> 开始专注
          </button>
        )}
        {status === 'running' && (
          <button
            type="button"
            onClick={handlePause}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
          >
            <Pause size={16} aria-hidden="true" /> 暂停
          </button>
        )}
        {status === 'paused' && (
          <button
            type="button"
            onClick={handleResume}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            <Play size={16} aria-hidden="true" /> 继续
          </button>
        )}
        {status !== 'idle' && (
          <>
            <button
              type="button"
              onClick={handleSkip}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
            >
              <SkipForward size={16} aria-hidden="true" /> 跳过
            </button>
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
            >
              <RotateCcw size={16} aria-hidden="true" /> 停止
            </button>
          </>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-600">专注时长（分钟）</span>
          <input
            type="number"
            min={MIN_MIN}
            max={MAX_MIN}
            value={focusMinutes}
            disabled={configDisabled}
            onChange={(e) => handleFocusMinChange(Number(e.target.value))}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-600">休息时长（分钟）</span>
          <input
            type="number"
            min={MIN_MIN}
            max={MAX_MIN}
            value={breakMinutes}
            disabled={configDisabled}
            onChange={(e) => handleBreakMinChange(Number(e.target.value))}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-400"
          />
        </label>
      </div>
      <p className="mt-3 text-xs text-neutral-400">
        计时在本机运行；专注段完成后会自动记录并尝试同步到服务端（断网时本地保留，联网后重试）。
      </p>
    </section>
  )
}

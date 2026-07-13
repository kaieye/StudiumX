export type ReliableTimerSample = {
  wallMs: number
  monotonicMs?: number
}

export type ReliableTimerState = {
  version: 1
  status: 'running' | 'paused'
  plannedActiveMs: number
  activeElapsedMs: number
  pausedElapsedMs: number
  effectiveWallMs: number
  observedWallMs: number
  observedMonotonicMs?: number
}

export type ReliableTimerAdvance = {
  timer: ReliableTimerState
  activeDeltaMs: number
  completed: boolean
  activeInterval: { startMs: number; endMs: number } | null
}

const MAX_RECOVERABLE_PAUSE_MS = 400 * 24 * 60 * 60 * 1000
const MAX_ACCEPTED_WALL_LEAD_MS = 10_000

function normalizedMs(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function elapsedBetween(timer: ReliableTimerState, sample: ReliableTimerSample): number {
  const observedWallMs = normalizedMs(sample.wallMs, timer.observedWallMs)
  const rawWallDelta = observedWallMs - timer.observedWallMs
  const wallDelta = Math.max(0, rawWallDelta)
  if (sample.monotonicMs === undefined || timer.observedMonotonicMs === undefined) return wallDelta

  const observedMonotonicMs = normalizedMs(sample.monotonicMs)
  if (observedMonotonicMs < timer.observedMonotonicMs) {
    // A navigation/reload can reset the monotonic origin. Wall time is the only
    // comparable clock in that case.
    return wallDelta
  }

  const monotonicDelta = observedMonotonicMs - timer.observedMonotonicMs
  if (rawWallDelta < 0) return monotonicDelta

  // Normal callback throttling advances both clocks. A small wall lead is accepted
  // because platform clocks have coarse sampling; a large lead is treated as a
  // manual/NTP wall-clock adjustment and must not finish a timer early.
  return wallDelta - monotonicDelta <= MAX_ACCEPTED_WALL_LEAD_MS
    ? Math.max(wallDelta, monotonicDelta)
    : monotonicDelta
}

function observedAt(timer: ReliableTimerState, sample: ReliableTimerSample): ReliableTimerState {
  return {
    ...timer,
    observedWallMs: normalizedMs(sample.wallMs, timer.observedWallMs),
    observedMonotonicMs: sample.monotonicMs === undefined
      ? timer.observedMonotonicMs
      : normalizedMs(sample.monotonicMs)
  }
}

export function createReliableTimer(input: ReliableTimerSample & { plannedActiveMs: number }): ReliableTimerState {
  const wallMs = normalizedMs(input.wallMs)
  return {
    version: 1,
    status: 'running',
    plannedActiveMs: normalizedMs(input.plannedActiveMs),
    activeElapsedMs: 0,
    pausedElapsedMs: 0,
    effectiveWallMs: wallMs,
    observedWallMs: wallMs,
    observedMonotonicMs: input.monotonicMs === undefined ? undefined : normalizedMs(input.monotonicMs)
  }
}

export function advanceReliableTimer(
  timer: ReliableTimerState,
  sample: ReliableTimerSample
): ReliableTimerAdvance {
  if (timer.status !== 'running') {
    return { timer: observedAt(timer, sample), activeDeltaMs: 0, completed: false, activeInterval: null }
  }
  const remainingMs = Math.max(0, timer.plannedActiveMs - timer.activeElapsedMs)
  const activeDeltaMs = Math.min(remainingMs, elapsedBetween(timer, sample))
  const startMs = timer.effectiveWallMs
  const next = observedAt({
    ...timer,
    activeElapsedMs: timer.activeElapsedMs + activeDeltaMs,
    effectiveWallMs: timer.effectiveWallMs + activeDeltaMs
  }, sample)
  return {
    timer: next,
    activeDeltaMs,
    completed: next.activeElapsedMs >= next.plannedActiveMs,
    activeInterval: activeDeltaMs > 0 ? { startMs, endMs: startMs + activeDeltaMs } : null
  }
}

export function pauseReliableTimer(timer: ReliableTimerState, sample: ReliableTimerSample): ReliableTimerState {
  const advanced = advanceReliableTimer(timer, sample).timer
  return { ...advanced, status: 'paused' }
}

export function resumeReliableTimer(timer: ReliableTimerState, sample: ReliableTimerSample): ReliableTimerState {
  if (timer.status !== 'paused') return observedAt(timer, sample)
  const pausedDeltaMs = Math.min(MAX_RECOVERABLE_PAUSE_MS, elapsedBetween(timer, sample))
  return observedAt({
    ...timer,
    status: 'running',
    pausedElapsedMs: timer.pausedElapsedMs + pausedDeltaMs,
    effectiveWallMs: timer.effectiveWallMs + pausedDeltaMs
  }, sample)
}

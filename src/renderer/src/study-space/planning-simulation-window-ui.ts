/**
 * Pure simulation / allocation window labels (HH:MM).
 *
 * Active product window is a rebuildable preference (ADR-0117), not schedule history.
 * Same semantics as V1 StudySnapshot.simulationStartTime/EndTime and migrate-v1 SuggestedTimeWindow.
 * No I/O, no React, no window.
 */

export type SimulationWindowLabels = {
  start: string
  end: string
}

/**
 * Normalize a single HH:MM label. Returns null when invalid (fail-closed).
 */
export function normalizeSimulationTimeLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Normalize a start/end pair. Requires start < end as strings after pad (same product rule as V1 draft).
 * Returns null when either side invalid or start >= end.
 */
export function normalizeSimulationWindow(input: {
  simulationStartTime?: unknown
  simulationEndTime?: unknown
}): SimulationWindowLabels | null {
  const start = normalizeSimulationTimeLabel(input.simulationStartTime)
  const end = normalizeSimulationTimeLabel(input.simulationEndTime)
  if (!start || !end) return null
  if (start >= end) return null
  return { start, end }
}

/**
 * Project preferences simulation window for sole-read hydrate.
 * null when unset / invalid — host keeps its V1 cache values.
 */
export function projectSimulationWindowFromPreferences(
  preferences:
    | {
        simulationStartTime?: string | null
        simulationEndTime?: string | null
      }
    | null
    | undefined
): SimulationWindowLabels | null {
  if (!preferences) return null
  return normalizeSimulationWindow({
    simulationStartTime: preferences.simulationStartTime,
    simulationEndTime: preferences.simulationEndTime
  })
}

/**
 * Build set_preferences patch for active simulation window only.
 */
export function buildSimulationWindowPreferencesPatch(window: SimulationWindowLabels): {
  simulationStartTime: string
  simulationEndTime: string
} {
  return {
    simulationStartTime: window.start,
    simulationEndTime: window.end
  }
}

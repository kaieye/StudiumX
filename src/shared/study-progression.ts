/**
 * Local-only study progression rules. This module is deliberately pure so every
 * product surface (desktop, personal analytics, Web adapter, and demos) uses
 * the same level curve and daily XP limits.
 */
export const MAX_STUDY_LEVEL = 100 as const
export const DAILY_XP_CAP = 300 as const

export const XP_SOURCE_CAPS = {
  focus_completion: 200,
  task_completion: 60,
  review_correct: 40
} as const

export type XpSource = keyof typeof XP_SOURCE_CAPS

/** Capped reward values; use these rather than duplicating XP literals at event producers. */
export const XP_SOURCE_REWARDS = {
  task_completion: 20,
  review_correct: 4
} as const

/** Completed focus rewards scale with the scheduled duration, with a 10 XP floor. */
export function xpForFocusCompletion(plannedSeconds: unknown): number {
  const seconds = typeof plannedSeconds === 'number' && Number.isFinite(plannedSeconds)
    ? Math.max(0, Math.floor(plannedSeconds))
    : 0
  return Math.max(10, Math.round(seconds / 30))
}

export type DailyXpProgress = {
  version: 1
  localDate: string
  awardedXp: number
  bySource: Record<XpSource, number>
  /** Bounded opaque ids used only to make local reward settlement idempotent. */
  appliedSourceEventIds: string[]
  /** A task can reward once per local day even if it is reopened and completed again. */
  rewardedTaskIds: string[]
}

export type DailyXpSourceSummary = {
  source: XpSource
  earnedXp: number
  capXp: number
  remainingXp: number
}

export type DailyXpSummary = {
  localDate: string
  earnedXp: number
  capXp: number
  remainingXp: number
  sources: DailyXpSourceSummary[]
}

export type StudyLevelProgress = {
  level: number
  xpAtLevelStart: number
  xpAtNextLevel: number
  currentXp: number
  progress: number
}

const XP_SOURCES = Object.keys(XP_SOURCE_CAPS) as XpSource[]
const MAX_TRACKED_EVENT_IDS = 512
const MAX_TRACKED_TASK_IDS = 256
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/

function finiteWhole(value: unknown, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.floor(value)))
    : 0
}

function opaqueIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || id.length > 256 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= limit) break
  }
  return result
}

/** XP needed to go from `level` to `level + 1`; Lv.100 is the cap. */
export function xpRequiredForNextLevel(level: number): number {
  if (Math.floor(level) >= MAX_STUDY_LEVEL) return 0
  const normalized = Math.min(MAX_STUDY_LEVEL - 1, Math.max(1, Math.floor(level)))
  return 120 + 40 * (normalized - 1)
}

/** Cumulative XP required on entering a level. */
export function xpThresholdForLevel(level: number): number {
  const normalized = Math.min(MAX_STUDY_LEVEL, Math.max(1, Math.floor(level)))
  const previousLevels = normalized - 1
  return 20 * previousLevels ** 2 + 100 * previousLevels
}

export const MAX_STUDY_XP = xpThresholdForLevel(MAX_STUDY_LEVEL)

export function clampStudyXp(value: unknown): number {
  return finiteWhole(value, MAX_STUDY_XP)
}

export function calculateStudyLevelProgress(totalXp: unknown): StudyLevelProgress {
  const currentXp = clampStudyXp(totalXp)
  let level = 1
  while (level < MAX_STUDY_LEVEL && currentXp >= xpThresholdForLevel(level + 1)) level += 1
  const xpAtLevelStart = xpThresholdForLevel(level)
  const xpAtNextLevel = level >= MAX_STUDY_LEVEL
    ? MAX_STUDY_XP
    : xpThresholdForLevel(level + 1)
  const span = Math.max(1, xpAtNextLevel - xpAtLevelStart)
  return {
    level,
    xpAtLevelStart,
    xpAtNextLevel,
    currentXp,
    progress: level >= MAX_STUDY_LEVEL ? 1 : Math.min(1, Math.max(0, (currentXp - xpAtLevelStart) / span))
  }
}

export function studyPlantStageForLevel(level: number): string {
  const normalized = Math.min(MAX_STUDY_LEVEL, Math.max(1, Math.floor(level)))
  if (normalized >= 65) return 'forest'
  if (normalized >= 35) return 'bloom'
  if (normalized >= 15) return 'branch'
  if (normalized >= 5) return 'sprout'
  return 'seed'
}

export function emptyDailyXpProgress(localDate: string): DailyXpProgress {
  return {
    version: 1,
    localDate: LOCAL_DATE.test(localDate) ? localDate : '',
    awardedXp: 0,
    bySource: {
      focus_completion: 0,
      task_completion: 0,
      review_correct: 0
    },
    appliedSourceEventIds: [],
    rewardedTaskIds: []
  }
}

/** Normalizes untrusted persisted local game metadata and resets it on date rollover. */
export function normalizeDailyXpProgress(value: unknown, localDate: string): DailyXpProgress {
  const empty = emptyDailyXpProgress(localDate)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const raw = value as Partial<DailyXpProgress>
  if (raw.localDate !== localDate || !LOCAL_DATE.test(localDate)) return empty
  const rawSources = raw.bySource && typeof raw.bySource === 'object' ? raw.bySource : {}
  const bySource = XP_SOURCES.reduce((result, source) => {
    result[source] = finiteWhole((rawSources as Partial<Record<XpSource, unknown>>)[source], XP_SOURCE_CAPS[source])
    return result
  }, {} as Record<XpSource, number>)
  const sourceAwarded = XP_SOURCES.reduce((sum, source) => sum + bySource[source], 0)
  return {
    version: 1,
    localDate,
    awardedXp: Math.min(DAILY_XP_CAP, sourceAwarded),
    bySource,
    appliedSourceEventIds: opaqueIds(raw.appliedSourceEventIds, MAX_TRACKED_EVENT_IDS),
    rewardedTaskIds: opaqueIds(raw.rewardedTaskIds, MAX_TRACKED_TASK_IDS)
  }
}

export function dailyXpSummary(value: unknown, localDate: string): DailyXpSummary {
  const daily = normalizeDailyXpProgress(value, localDate)
  const earnedXp = Math.min(DAILY_XP_CAP, daily.awardedXp)
  return {
    localDate,
    earnedXp,
    capXp: DAILY_XP_CAP,
    remainingXp: Math.max(0, DAILY_XP_CAP - earnedXp),
    sources: XP_SOURCES.map((source) => ({
      source,
      earnedXp: daily.bySource[source],
      capXp: XP_SOURCE_CAPS[source],
      remainingXp: Math.max(0, XP_SOURCE_CAPS[source] - daily.bySource[source])
    }))
  }
}

export function awardDailyXp(input: {
  totalXp: unknown
  daily: unknown
  localDate: string
  source: XpSource
  sourceEventId: string
  requestedXp: number
  taskId?: string
}): {
  awardedXp: number
  cappedXp: number
  alreadyAwarded: boolean
  maxLevelReached: boolean
  daily: DailyXpProgress
} {
  const daily = normalizeDailyXpProgress(input.daily, input.localDate)
  const sourceEventId = typeof input.sourceEventId === 'string' ? input.sourceEventId.trim() : ''
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : ''
  const totalXp = clampStudyXp(input.totalXp)
  const duplicateEvent = !sourceEventId || daily.appliedSourceEventIds.includes(sourceEventId)
  const duplicateTask = input.source === 'task_completion' && (!taskId || daily.rewardedTaskIds.includes(taskId))
  const maxLevelReached = totalXp >= MAX_STUDY_XP
  if (duplicateEvent || duplicateTask || maxLevelReached) {
    return { awardedXp: 0, cappedXp: 0, alreadyAwarded: duplicateEvent || duplicateTask, maxLevelReached, daily }
  }

  const requestedXp = finiteWhole(input.requestedXp, DAILY_XP_CAP)
  const sourceRemaining = Math.max(0, XP_SOURCE_CAPS[input.source] - daily.bySource[input.source])
  const dailyRemaining = Math.max(0, DAILY_XP_CAP - daily.awardedXp)
  const awardedXp = Math.min(requestedXp, sourceRemaining, dailyRemaining, MAX_STUDY_XP - totalXp)
  const next: DailyXpProgress = {
    ...daily,
    awardedXp: daily.awardedXp + awardedXp,
    bySource: { ...daily.bySource, [input.source]: daily.bySource[input.source] + awardedXp },
    appliedSourceEventIds: [...daily.appliedSourceEventIds, sourceEventId].slice(-MAX_TRACKED_EVENT_IDS),
    rewardedTaskIds: input.source === 'task_completion'
      ? [...daily.rewardedTaskIds, taskId].slice(-MAX_TRACKED_TASK_IDS)
      : daily.rewardedTaskIds
  }
  return {
    awardedXp,
    cappedXp: Math.max(0, requestedXp - awardedXp),
    alreadyAwarded: false,
    maxLevelReached: false,
    daily: next
  }
}

import {
  STUDY_PRESENCE_BROKER_URL,
  STUDY_PRESENCE_CLIENT_PREFIX,
  STUDY_PUBLIC_SPACE_CODE,
  STUDY_SPACE_SESSION_CLIENT_KEY,
  STUDY_SPACE_STORAGE_KEY,
  STUDY_TASK_LIMIT,
  defaultStudySnapshot,
  studyModes,
  studyRooms,
  studySignals
} from '../constants'
import { normalizeStudyTaskCategoryId } from '../taskCategories'
import { pickOptionalAdvancedFields } from '../planning-timer-plan-advanced-fields'
import { pickOptionalKindFields } from '../planning-timer-plan-kind'
import {
  isV1LocalAuthorityDemoted,
  shouldPersistV1TaskAuthority,
  shouldReseedV1TasksFromDefaults,
  stripTaskAuthorityFromSnapshot
} from '../planning-v1-authority-demote'
import type {
  StudyModeId,
  StudyRoomId,
  StudySignalId,
  StudySnapshot,
  StudyTimerPlan,
  StudyTask,
  StudyTaskSchedule,
  StudyTaskScheduleColorId
} from '../types'

/**
 * Durable browser-backed Study Session state.
 *
 * This is deliberately the only boundary that translates persisted state, session
 * identity, invite URL parameters, and canonical URL state into a StudySnapshot.
 * Session callers deal in snapshots rather than coordinating those browser facts.
 */

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function randomStudyClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${STUDY_PRESENCE_CLIENT_PREFIX}-${crypto.randomUUID()}`
  }
  return `${STUDY_PRESENCE_CLIENT_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function defaultStudyNickname(clientId: string): string {
  return `同学 ${clientId.slice(-4).toUpperCase()}`
}

export function normalizeStudyRoomId(input: unknown): StudyRoomId {
  return studyRooms.some((room) => room.id === input) ? input as StudyRoomId : defaultStudySnapshot.roomId
}

export function studyRoomSeatCount(roomId: StudyRoomId): number {
  return studyRooms.find((room) => room.id === roomId)?.seats ?? studyRooms[0].seats
}

export function defaultStudySeatIndex(clientId: string, roomId: StudyRoomId): number {
  const seatCount = studyRoomSeatCount(roomId)
  const hash = Array.from(`${clientId}:${roomId}`).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return hash % seatCount
}

export function normalizeStudySeatIndex(input: unknown, roomId: StudyRoomId, clientId: string): number {
  return Math.floor(clampNumber(input, 0, Math.max(0, studyRoomSeatCount(roomId) - 1), defaultStudySeatIndex(clientId, roomId)))
}

export function normalizeStudySeatClaimedAt(input: unknown, fallback = Date.now()): number {
  const maxFutureMs = Date.now() + 60_000
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return Math.floor(fallback)
  return Math.floor(Math.min(maxFutureMs, Math.max(1, input)))
}

export function normalizeStudyModeId(input: unknown): StudyModeId {
  return studyModes.some((mode) => mode.id === input) ? input as StudyModeId : defaultStudySnapshot.modeId
}

export function normalizeStudySignalId(input: unknown): StudySignalId {
  return studySignals.some((signal) => signal.id === input) ? input as StudySignalId : defaultStudySnapshot.signalId
}

export function normalizeStudySpaceCode(input: unknown): string {
  if (typeof input !== 'string') return STUDY_PUBLIC_SPACE_CODE
  let value = input.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 18)
  // Legacy generators used a "ROOM-" label; keep only the id segment.
  if (value.startsWith('ROOM-')) value = value.slice(5)
  return value.length >= 3 ? value : STUDY_PUBLIC_SPACE_CODE
}

export function normalizeStudyRelayUrl(input: unknown): string {
  if (typeof input !== 'string') return STUDY_PRESENCE_BROKER_URL
  const value = input.trim().slice(0, 180)
  if (!/^wss?:\/\/[^\s]+$/i.test(value)) return STUDY_PRESENCE_BROKER_URL
  return value
}

const studyTaskScheduleColorIds: StudyTaskScheduleColorId[] = ['sage', 'mist', 'clay', 'mauve', 'sand', 'slate', 'rose']

function normalizeStudyTaskScheduleColorId(input: unknown): StudyTaskScheduleColorId | undefined {
  if (typeof input !== 'string') return undefined
  if (studyTaskScheduleColorIds.includes(input as StudyTaskScheduleColorId)) return input as StudyTaskScheduleColorId
  return /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() as `#${string}` : undefined
}

export function normalizeStudyTaskSchedule(input: unknown): StudyTaskSchedule | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Partial<StudyTaskSchedule>
  const weekday = Math.floor(clampNumber(raw.weekday, 0, 6, 0))
  const startMinutes = Math.floor(clampNumber(raw.startMinutes, 0, 23 * 60 + 59, 9 * 60))
  const fallbackEnd = Math.min(24 * 60, startMinutes + 60)
  const rawEndMinutes = Math.floor(clampNumber(raw.endMinutes, 1, 24 * 60, fallbackEnd))
  const endMinutes = rawEndMinutes > startMinutes ? rawEndMinutes : fallbackEnd
  const colorId = normalizeStudyTaskScheduleColorId(raw.colorId)
  return { weekday, startMinutes, endMinutes, ...(colorId ? { colorId } : {}) }
}

export type NormalizeStudyTasksOptions = {
  /**
   * When true, empty/missing arrays stay empty (no defaultStudySnapshot.tasks refill).
   * Used after V1 authority demote so cold-start cannot resurrect invented defaults.
   */
  allowEmpty?: boolean
}

export function normalizeStudyTasks(
  input: unknown,
  options?: NormalizeStudyTasksOptions
): StudyTask[] {
  const allowEmpty = options?.allowEmpty === true
  if (!Array.isArray(input)) {
    return allowEmpty ? [] : defaultStudySnapshot.tasks
  }
  const tasks = input
    .filter((item): item is Partial<StudyTask> => Boolean(item) && typeof item === 'object')
    .map((item, index) => {
      const schedule = normalizeStudyTaskSchedule(item.schedule)
      const categoryId = normalizeStudyTaskCategoryId(item.categoryId) ?? 'study'
      const rawEstimate = (item as { estimateMinutes?: unknown }).estimateMinutes
      const estimateMinutes =
        rawEstimate === null
          ? null
          : typeof rawEstimate === 'number' && Number.isFinite(rawEstimate)
            ? Math.max(0, Math.min(24 * 60, Math.floor(rawEstimate)))
            : undefined
      return {
        id: typeof item.id === 'string' && item.id ? item.id : `task-${index}`,
        title: typeof item.title === 'string' ? item.title.trim().slice(0, 80) : '',
        done: Boolean(item.done),
        categoryId,
        ...(schedule ? { schedule } : {}),
        ...(estimateMinutes !== undefined ? { estimateMinutes } : {})
      }
    })
    .filter((item) => item.title)
    .slice(0, STUDY_TASK_LIMIT)
  if (tasks.length > 0) return tasks
  return allowEmpty ? [] : defaultStudySnapshot.tasks
}

const studyTimerPlanLimit = 12
const studyTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function normalizeStudyTime(input: unknown, fallback: string): string {
  return typeof input === 'string' && studyTimePattern.test(input) ? input : fallback
}

export function normalizeStudyTimerPlans(input: unknown): StudyTimerPlan[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is Partial<StudyTimerPlan> => Boolean(item) && typeof item === 'object')
    .map((item, index) => {
      // STC-502: preserve optional long break / breakPolicy when present in cache.
      // STC-504: preserve kind / clockMode / continuousTarget when present.
      const advanced = pickOptionalAdvancedFields(item as Record<string, unknown>)
      const kindFields = pickOptionalKindFields(item as Record<string, unknown>)
      const continuousTarget =
        (item as { continuousTarget?: unknown }).continuousTarget === true
      // Continuous open plans may store breakMinutes 0; widen clamp for continuous.
      const isContinuous = kindFields.kind === 'continuous'
      const focusMax = isContinuous ? 240 : 120
      const breakMin = isContinuous ? 0 : 1
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 80) : `timer-plan-${index}`,
        name: typeof item.name === 'string' ? item.name.trim().slice(0, 24) : '',
        focusMinutes: Math.floor(clampNumber(item.focusMinutes, 5, focusMax, defaultStudySnapshot.focusMinutes)),
        breakMinutes: Math.floor(clampNumber(item.breakMinutes, breakMin, 45, defaultStudySnapshot.breakMinutes)),
        simulationStartTime: normalizeStudyTime(item.simulationStartTime, defaultStudySnapshot.simulationStartTime),
        simulationEndTime: normalizeStudyTime(item.simulationEndTime, defaultStudySnapshot.simulationEndTime),
        ...(advanced.longBreakMinutes !== undefined
          ? { longBreakMinutes: advanced.longBreakMinutes }
          : {}),
        ...(advanced.longBreakEvery !== undefined
          ? { longBreakEvery: advanced.longBreakEvery }
          : {}),
        ...(advanced.breakPolicy !== undefined ? { breakPolicy: advanced.breakPolicy } : {}),
        ...(kindFields.kind !== undefined ? { kind: kindFields.kind } : {}),
        ...(kindFields.clockMode !== undefined ? { clockMode: kindFields.clockMode } : {}),
        ...(continuousTarget ? { continuousTarget: true } : {})
      }
    })
    .filter((plan) => plan.name)
    .slice(0, studyTimerPlanLimit)
}

function localTodayKey(date = new Date()): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

export type NormalizeStudySnapshotOptions = {
  /** Forwarded to normalizeStudyTasks — demoted cold-start must not refill defaults. */
  allowEmptyTasks?: boolean
}

/** Coerces an unknown persisted payload to the complete, current durable schema. */
export function normalizeStudySnapshot(
  input: unknown,
  options?: NormalizeStudySnapshotOptions
): StudySnapshot {
  const raw = input && typeof input === 'object' ? input as Partial<StudySnapshot> : {}
  const clientId = typeof raw.clientId === 'string' && raw.clientId.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)
    ? raw.clientId
    : randomStudyClientId()
  const nickname = typeof raw.nickname === 'string' && raw.nickname.trim()
    ? raw.nickname.trim().slice(0, 18)
    : defaultStudyNickname(clientId)
  const spaceCode = normalizeStudySpaceCode(raw.spaceCode)
  const modeId = normalizeStudyModeId(raw.modeId)
  const roomId = normalizeStudyRoomId(raw.roomId)
  const timerMode = raw.timerMode === 'break' ? 'break' : 'focus'
  const focusMinutes = Math.floor(clampNumber(raw.focusMinutes, 5, 120, defaultStudySnapshot.focusMinutes))
  const breakMinutes = Math.floor(clampNumber(raw.breakMinutes, 1, 45, defaultStudySnapshot.breakMinutes))
  const simulationStartTime = normalizeStudyTime(raw.simulationStartTime, defaultStudySnapshot.simulationStartTime)
  const simulationEndTime = normalizeStudyTime(raw.simulationEndTime, defaultStudySnapshot.simulationEndTime)
  const timerPlans = normalizeStudyTimerPlans(raw.timerPlans)
  const maxRemaining = (timerMode === 'focus' ? focusMinutes : breakMinutes) * 60
  const lastStudyDate = typeof raw.lastStudyDate === 'string' ? raw.lastStudyDate : ''
  const isToday = lastStudyDate === localTodayKey()
  const seatIndex = normalizeStudySeatIndex(raw.seatIndex, roomId, clientId)
  return {
    clientId,
    nickname,
    spaceCode,
    presenceRelayUrl: normalizeStudyRelayUrl(raw.presenceRelayUrl),
    signalId: normalizeStudySignalId(raw.signalId),
    modeId,
    contractText: typeof raw.contractText === 'string' ? raw.contractText.trim().slice(0, 120) : '',
    contractLocked: Boolean(raw.contractLocked),
    roomId,
    seatIndex,
    seatClaimedAt: normalizeStudySeatClaimedAt(raw.seatClaimedAt),
    timerMode,
    timerState: raw.timerState === 'running' || raw.timerState === 'paused' ? raw.timerState : 'idle',
    focusMinutes,
    breakMinutes,
    simulationStartTime,
    simulationEndTime,
    timerPlans,
    remainingSeconds: clampNumber(raw.remainingSeconds, 1, maxRemaining, maxRemaining),
    todayFocusSeconds: isToday ? clampNumber(raw.todayFocusSeconds, 0, 24 * 60 * 60, 0) : 0,
    todaySessions: isToday ? clampNumber(raw.todaySessions, 0, 99, 0) : 0,
    totalFocusSeconds: clampNumber(raw.totalFocusSeconds, 0, 100_000 * 60, 0),
    totalSessions: clampNumber(raw.totalSessions, 0, 100_000, 0),
    streakDays: clampNumber(raw.streakDays, 0, 10_000, 0),
    xp: clampNumber(raw.xp, 0, 1_000_000, 0),
    lastStudyDate,
    tasks: normalizeStudyTasks(raw.tasks, {
      allowEmpty: options?.allowEmptyTasks === true
    })
  }
}

export function readStudySessionClientId(): string {
  try {
    const params = new URLSearchParams(window.location.search)
    const forceFreshSession = params.get('studyFreshSession') === '1'
    const stored = window.sessionStorage.getItem(STUDY_SPACE_SESSION_CLIENT_KEY)
    if (stored?.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)) {
      window.sessionStorage.setItem(STUDY_SPACE_SESSION_CLIENT_KEY, stored)
    }
    if (!forceFreshSession && stored?.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)) return stored
    const nextClientId = randomStudyClientId()
    window.sessionStorage.setItem(STUDY_SPACE_SESSION_CLIENT_KEY, nextClientId)
    if (forceFreshSession) {
      params.delete('studyFreshSession')
      const search = params.toString()
      const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }
    return nextClientId
  } catch {
    return randomStudyClientId()
  }
}

/** Reuses one tab/session identity even when the durable snapshot came from another client. */
export function applyStudySessionIdentity(snapshot: StudySnapshot): StudySnapshot {
  const clientId = readStudySessionClientId()
  if (clientId === snapshot.clientId) return snapshot
  const nickname = /^同学 [A-Z0-9]{4}$/.test(snapshot.nickname)
    ? defaultStudyNickname(clientId)
    : snapshot.nickname
  return {
    ...snapshot,
    clientId,
    nickname,
    seatIndex: normalizeStudySeatIndex(snapshot.seatIndex, snapshot.roomId, clientId),
    seatClaimedAt: Date.now()
  }
}

function inviteParam(params: URLSearchParams, canonicalName: string, legacyName: string): string | null {
  return params.has(canonicalName) ? params.get(canonicalName) : params.get(legacyName)
}

/**
 * Applies an invite over durable state. Canonical studySpace/studyRoom parameters
 * intentionally take precedence over their legacy space/room aliases.
 */
export function applyStudyInviteParams(snapshot: StudySnapshot): StudySnapshot {
  try {
    const params = new URLSearchParams(window.location.search)
    const spaceParam = inviteParam(params, 'studySpace', 'space')
    const roomParam = inviteParam(params, 'studyRoom', 'room')
    const hasSpaceInvite = spaceParam !== null && spaceParam !== ''
    const hasRoomInvite = roomParam !== null && roomParam !== ''
    if (!hasSpaceInvite && !hasRoomInvite) return snapshot

    const nextSpaceCode = hasSpaceInvite ? normalizeStudySpaceCode(spaceParam) : snapshot.spaceCode
    const nextRoomId = hasRoomInvite ? normalizeStudyRoomId(roomParam) : snapshot.roomId
    const nextRoom = studyRooms.find((room) => room.id === nextRoomId)
    const spaceChanged = nextSpaceCode !== snapshot.spaceCode
    const roomChanged = nextRoomId !== snapshot.roomId
    return {
      ...snapshot,
      spaceCode: nextSpaceCode,
      roomId: nextRoomId,
      seatIndex: normalizeStudySeatIndex(snapshot.seatIndex, nextRoomId, snapshot.clientId),
      seatClaimedAt: spaceChanged || roomChanged ? Date.now() : snapshot.seatClaimedAt,
      focusMinutes: snapshot.timerState === 'running' || !nextRoom ? snapshot.focusMinutes : nextRoom.sessionMinutes,
      breakMinutes: snapshot.timerState === 'running' || !nextRoom ? snapshot.breakMinutes : nextRoom.breakMinutes,
      remainingSeconds: snapshot.timerState === 'running' || !nextRoom ? snapshot.remainingSeconds : nextRoom.sessionMinutes * 60,
      timerMode: snapshot.timerState === 'running' ? snapshot.timerMode : 'focus'
    }
  } catch {
    return snapshot
  }
}

function parseStoredSnapshot(serialized: string | null): unknown {
  if (!serialized) return null
  try {
    return JSON.parse(serialized)
  } catch {
    return null
  }
}

export type ReadStudySnapshotOptions = {
  /**
   * Host workspace root available — gates presence-only persist when demoted.
   * Task default reseed is suppressed by demote marker alone (fail-closed).
   */
  workspaceAvailable?: boolean
  /**
   * Force demoted gate (tests). When omitted, reads local demote marker.
   */
  demoted?: boolean
}

/**
 * Reads one durable Session snapshot, migrating legacy storage and applying the
 * current tab identity and URL invite before rewriting canonical storage.
 *
 * After V1 authority demote: empty task arrays stay empty (no default-task
 * resurrection). When demoted, persist writes presence shell only (even offline).
 */
export function readStudySnapshot(options?: ReadStudySnapshotOptions): StudySnapshot {
  const demoted =
    typeof options?.demoted === 'boolean'
      ? options.demoted
      : isV1LocalAuthorityDemoted()
  const workspaceAvailable = options?.workspaceAvailable === true
  const allowEmptyTasks = !shouldReseedV1TasksFromDefaults({ demoted, workspaceAvailable })
  try {
    const stored = window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)
    const snapshot = applyStudyInviteParams(
      applyStudySessionIdentity(
        normalizeStudySnapshot(parseStoredSnapshot(stored), { allowEmptyTasks })
      )
    )
    persistStudySnapshot(snapshot, { demoted, workspaceAvailable })
    return snapshot
  } catch {
    return applyStudyInviteParams(
      applyStudySessionIdentity(normalizeStudySnapshot(null, { allowEmptyTasks }))
    )
  }
}

export type PersistStudySnapshotOptions = {
  /**
   * When true (workspace + demote marker), skip writing task/timerPlans authority arrays.
   * Presence shell still persists. Fail-closed: omit / false keeps prior dual-write behavior.
   */
  workspaceAvailable?: boolean
  /**
   * Force demoted gate (tests / host). When omitted, reads local demote marker.
   */
  demoted?: boolean
}

/**
 * Persists only normalized durable snapshot data; unavailable storage remains non-fatal.
 * When V1 authority is demoted, write presence shell only (tasks/timerPlans
 * stripped) so localStorage is never a live task-authority co-cache — including
 * offline/transient empty workspaceRoot (no sole-read mirror into V1).
 */
export function persistStudySnapshot(
  snapshot: StudySnapshot,
  options?: PersistStudySnapshotOptions
): void {
  try {
    const demoted =
      typeof options?.demoted === 'boolean'
        ? options.demoted
        : isV1LocalAuthorityDemoted()
    const workspaceAvailable = options?.workspaceAvailable === true
    const writeTaskAuthority = shouldPersistV1TaskAuthority({ demoted, workspaceAvailable })
    if (!writeTaskAuthority) {
      // Do not pass through normalizeStudyTasks default refill — demoted shell stays empty.
      const shell = stripTaskAuthorityFromSnapshot(
        normalizeStudySnapshot(
          {
            ...snapshot,
            tasks: snapshot.tasks,
            timerPlans: snapshot.timerPlans
          },
          { allowEmptyTasks: true }
        )
      )
      window.localStorage.setItem(
        STUDY_SPACE_STORAGE_KEY,
        JSON.stringify({
          ...shell,
          tasks: [],
          timerPlans: []
        })
      )
      return
    }
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(normalizeStudySnapshot(snapshot)))
  } catch {
    // Study progress should stay usable even when storage is unavailable.
  }
}

/** Rewrites the browser location to the canonical shareable snapshot fields. */
export function syncStudyLocation(spaceCode: string, roomId: StudyRoomId): void {
  try {
    const params = new URLSearchParams(window.location.search)
    params.delete('space')
    params.delete('room')
    params.delete('studyFreshSession')
    params.set('studySpace', normalizeStudySpaceCode(spaceCode))
    params.set('studyRoom', normalizeStudyRoomId(roomId))
    const search = params.toString()
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextUrl !== currentUrl) window.history.replaceState(null, '', nextUrl)
  } catch {
    // URL sync is a convenience; the room state itself is already persisted.
  }
}
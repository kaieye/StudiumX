import type { WorkspaceView } from '../../../shared/teaching-types'
import {
  LEGACY_STUDY_SPACE_SESSION_CLIENT_KEY,
  LEGACY_STUDY_SPACE_STORAGE_KEY,
  STUDY_PRESENCE_BROKER_URL,
  STUDY_PRESENCE_CLIENT_PREFIX,
  STUDY_PRESENCE_RELAY_URLS,
  STUDY_PRESENCE_TOPIC_ROOT,
  STUDY_PUBLIC_SPACE_CODE,
  STUDY_SPACE_SESSION_CLIENT_KEY,
  STUDY_SPACE_STORAGE_KEY,
  STUDY_TASK_LIMIT,
  defaultStudySnapshot,
  studyModes,
  studyRooms,
  studySignals
} from './constants'
import type {
  StudyModeId,
  StudyRoomCycle,
  StudyRoomCyclePhase,
  StudyRoomId,
  StudySignalId,
  StudySnapshot,
  StudyTask,
  StudyTaskSchedule,
  StudyTaskScheduleColorId,
  StudyTimerMode,
  StudyTimerState
} from './types'

export type StudySeatClaim = {
  clientId: string
  roomId: StudyRoomId
  seatIndex: number
  seatClaimedAt: number
}

export type StudySeatConflictResolution = {
  hasConflict: boolean
  keepsSeat: boolean
  winnerClientId: string
  nextSeatIndex: number | null
}

export function studyRoomCycleOffset(roomId: StudyRoomId): number {
  const roomIndex = studyRooms.findIndex((room) => room.id === roomId)
  return Math.max(0, roomIndex) * 7 * 60
}

export function getStudyRoomCycle(room: typeof studyRooms[number], nowMs = Date.now()): StudyRoomCycle {
  const focusSeconds = room.sessionMinutes * 60
  const breakSeconds = room.breakMinutes * 60
  const cycleSeconds = focusSeconds + breakSeconds
  const anchorMs = Date.UTC(2026, 0, 1, 0, 0, 0)
  const elapsedSinceAnchor = Math.max(0, Math.floor((nowMs - anchorMs) / 1000) + studyRoomCycleOffset(room.id))
  const round = Math.floor(elapsedSinceAnchor / cycleSeconds) + 1
  const cycleElapsed = elapsedSinceAnchor % cycleSeconds
  const phase: StudyRoomCyclePhase = cycleElapsed < focusSeconds ? 'focus' : 'break'
  const elapsedSeconds = phase === 'focus' ? cycleElapsed : cycleElapsed - focusSeconds
  const totalSeconds = phase === 'focus' ? focusSeconds : breakSeconds
  const remainingSeconds = Math.max(1, totalSeconds - elapsedSeconds)
  return {
    phase,
    round,
    elapsedSeconds,
    remainingSeconds,
    totalSeconds,
    progress: Math.round((elapsedSeconds / totalSeconds) * 100),
    nextLabel: phase === 'focus' ? `${room.breakMinutes} 分钟休息` : `${room.sessionMinutes} 分钟专注`
  }
}

export function todayKey(date = new Date()): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function previousLocalDateKey(localDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  if (!match) return null
  const value = new Date(0)
  value.setHours(12, 0, 0, 0)
  value.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  value.setDate(value.getDate() - 1)
  return todayKey(value)
}

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

export function compareStudySeatClaims(left: StudySeatClaim, right: StudySeatClaim): number {
  if (left.seatClaimedAt !== right.seatClaimedAt) return left.seatClaimedAt - right.seatClaimedAt
  return left.clientId.localeCompare(right.clientId)
}

function normalizeStudySeatClaim(claim: StudySeatClaim, roomId = claim.roomId): StudySeatClaim {
  return {
    ...claim,
    roomId,
    seatIndex: normalizeStudySeatIndex(claim.seatIndex, roomId, claim.clientId),
    seatClaimedAt: normalizeStudySeatClaimedAt(claim.seatClaimedAt)
  }
}

export function winningStudySeatClaim(claims: StudySeatClaim[]): StudySeatClaim | null {
  if (claims.length === 0) return null
  return [...claims].sort(compareStudySeatClaims)[0] ?? null
}

export function findAvailableStudySeatIndex(input: {
  preferredSeatIndex: number
  roomId: StudyRoomId
  clientId: string
  occupiedSeatIndexes: Iterable<number>
}): number | null {
  const seatCount = studyRoomSeatCount(input.roomId)
  const preferredSeatIndex = normalizeStudySeatIndex(input.preferredSeatIndex, input.roomId, input.clientId)
  const occupiedSeats = new Set<number>()
  for (const seatIndex of input.occupiedSeatIndexes) {
    occupiedSeats.add(normalizeStudySeatIndex(seatIndex, input.roomId, input.clientId))
  }
  if (!occupiedSeats.has(preferredSeatIndex)) return preferredSeatIndex

  const clientOffset = defaultStudySeatIndex(input.clientId, input.roomId)
  const candidates = Array.from({ length: seatCount }, (_, index) => index)
    .filter((seatIndex) => !occupiedSeats.has(seatIndex))
    .sort((left, right) => {
      const leftDistance = Math.abs(left - preferredSeatIndex)
      const rightDistance = Math.abs(right - preferredSeatIndex)
      if (leftDistance !== rightDistance) return leftDistance - rightDistance
      const leftClientBias = (left - clientOffset + seatCount) % seatCount
      const rightClientBias = (right - clientOffset + seatCount) % seatCount
      return leftClientBias - rightClientBias
    })

  return candidates[0] ?? null
}

export function resolveStudySeatConflict(input: {
  self: StudySeatClaim
  peerClaims: StudySeatClaim[]
}): StudySeatConflictResolution {
  const self = normalizeStudySeatClaim(input.self)
  const peerClaims = input.peerClaims
    .filter((claim) => claim.roomId === self.roomId && claim.clientId !== self.clientId)
    .map((claim) => normalizeStudySeatClaim(claim, self.roomId))
  const sameSeatClaims = [self, ...peerClaims.filter((claim) => claim.seatIndex === self.seatIndex)]
  const winner = winningStudySeatClaim(sameSeatClaims) ?? self
  const hasConflict = sameSeatClaims.length > 1
  const keepsSeat = winner.clientId === self.clientId

  return {
    hasConflict,
    keepsSeat,
    winnerClientId: winner.clientId,
    nextSeatIndex: hasConflict && !keepsSeat
      ? findAvailableStudySeatIndex({
          preferredSeatIndex: self.seatIndex,
          roomId: self.roomId,
          clientId: self.clientId,
          occupiedSeatIndexes: peerClaims.map((claim) => claim.seatIndex)
        })
      : self.seatIndex
  }
}

export function formatStudySeatLabel(index: number): string {
  return `${String(index + 1).padStart(2, '0')}号座`
}

export function normalizeStudyModeId(input: unknown): StudyModeId {
  return studyModes.some((mode) => mode.id === input) ? input as StudyModeId : defaultStudySnapshot.modeId
}

export function normalizeStudySignalId(input: unknown): StudySignalId {
  return studySignals.some((signal) => signal.id === input) ? input as StudySignalId : defaultStudySnapshot.signalId
}

export function studySignalLabel(signalId: StudySignalId): string {
  return studySignals.find((signal) => signal.id === signalId)?.label ?? studySignals[0].label
}

export function studySignalShortLabel(signalId: StudySignalId): string {
  return studySignals.find((signal) => signal.id === signalId)?.shortLabel ?? studySignals[0].shortLabel
}

export function normalizeStudySpaceCode(input: unknown): string {
  if (typeof input !== 'string') return STUDY_PUBLIC_SPACE_CODE
  const value = input.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 18)
  return value.length >= 3 ? value : STUDY_PUBLIC_SPACE_CODE
}

export function normalizeStudyRelayUrl(input: unknown): string {
  if (typeof input !== 'string') return STUDY_PRESENCE_BROKER_URL
  const value = input.trim().slice(0, 180)
  if (!/^wss?:\/\/[^\s]+$/i.test(value)) return STUDY_PRESENCE_BROKER_URL
  return value
}

export function studyRelayCandidates(primaryRelayUrl: string): string[] {
  return Array.from(new Set([
    normalizeStudyRelayUrl(primaryRelayUrl),
    ...STUDY_PRESENCE_RELAY_URLS.map((relayUrl) => normalizeStudyRelayUrl(relayUrl))
  ]))
}

export function displayStudyRelayUrl(relayUrl: string): string {
  return relayUrl.replace(/^wss?:\/\//, '')
}

export function randomStudySpaceCode(): string {
  const bytes = new Uint8Array(3)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
  }
  return `ROOM-${Array.from(bytes).map((byte) => byte.toString(36).padStart(2, '0').toUpperCase()).join('')}`
}

export function studyPresenceTopic(spaceCode: string): string {
  return `${STUDY_PRESENCE_TOPIC_ROOT}/${normalizeStudySpaceCode(spaceCode).toLowerCase()}/presence`
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

export function normalizeStudyTasks(input: unknown): StudyTask[] {
  if (!Array.isArray(input)) return defaultStudySnapshot.tasks
  const tasks = input
    .filter((item): item is Partial<StudyTask> => Boolean(item) && typeof item === 'object')
    .map((item, index) => {
      const schedule = normalizeStudyTaskSchedule(item.schedule)
      return {
        id: typeof item.id === 'string' && item.id ? item.id : `task-${index}`,
        title: typeof item.title === 'string' ? item.title.trim().slice(0, 80) : '',
        done: Boolean(item.done),
        ...(schedule ? { schedule } : {})
      }
    })
    .filter((item) => item.title)
    .slice(0, STUDY_TASK_LIMIT)
  return tasks.length > 0 ? tasks : defaultStudySnapshot.tasks
}

export function normalizeStudySnapshot(input: unknown): StudySnapshot {
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
  const focusMinutes = clampNumber(raw.focusMinutes, 5, 120, defaultStudySnapshot.focusMinutes)
  const breakMinutes = clampNumber(raw.breakMinutes, 1, 45, defaultStudySnapshot.breakMinutes)
  const maxRemaining = (timerMode === 'focus' ? focusMinutes : breakMinutes) * 60
  const lastStudyDate = typeof raw.lastStudyDate === 'string' ? raw.lastStudyDate : ''
  const isToday = lastStudyDate === todayKey()
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
    ambientEnabled: Boolean(raw.ambientEnabled),
    ambientVolume: clampNumber(raw.ambientVolume, 0, 1, defaultStudySnapshot.ambientVolume),
    roomId,
    seatIndex,
    seatClaimedAt: normalizeStudySeatClaimedAt(raw.seatClaimedAt),
    timerMode,
    timerState: raw.timerState === 'running' || raw.timerState === 'paused' ? raw.timerState : 'idle',
    focusMinutes,
    breakMinutes,
    remainingSeconds: clampNumber(raw.remainingSeconds, 1, maxRemaining, maxRemaining),
    todayFocusSeconds: isToday ? clampNumber(raw.todayFocusSeconds, 0, 24 * 60 * 60, 0) : 0,
    todaySessions: isToday ? clampNumber(raw.todaySessions, 0, 99, 0) : 0,
    totalFocusSeconds: clampNumber(raw.totalFocusSeconds, 0, 100_000 * 60, 0),
    totalSessions: clampNumber(raw.totalSessions, 0, 100_000, 0),
    streakDays: clampNumber(raw.streakDays, 0, 10_000, 0),
    xp: clampNumber(raw.xp, 0, 1_000_000, 0),
    lastStudyDate,
    tasks: normalizeStudyTasks(raw.tasks)
  }
}

export function readStudySessionClientId(): string {
  try {
    const params = new URLSearchParams(window.location.search)
    const forceFreshSession = params.get('studyFreshSession') === '1'
    const stored =
      window.sessionStorage.getItem(STUDY_SPACE_SESSION_CLIENT_KEY) ??
      window.sessionStorage.getItem(LEGACY_STUDY_SPACE_SESSION_CLIENT_KEY)
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

export function applyStudyInviteParams(snapshot: StudySnapshot): StudySnapshot {
  try {
    const params = new URLSearchParams(window.location.search)
    const spaceParam = params.get('studySpace') ?? params.get('space')
    const roomParam = params.get('studyRoom') ?? params.get('room')
    const nextSpaceCode = spaceParam ? normalizeStudySpaceCode(spaceParam) : snapshot.spaceCode
    const nextRoomId = roomParam ? normalizeStudyRoomId(roomParam) : snapshot.roomId
    const nextRoom = studyRooms.find((room) => room.id === nextRoomId)
    if (!spaceParam && !roomParam) return snapshot
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

export function initialWorkspaceViewFromUrl(): WorkspaceView {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('workbench') || params.has('office')) return 'workbench'
    return params.has('studySpace') || params.has('space') || params.has('studyRoom') || params.has('room')
      ? 'workbench'
      : 'agent'
  } catch {
    return 'agent'
  }
}

export function readStudySnapshot(): StudySnapshot {
  try {
    const stored =
      window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STUDY_SPACE_STORAGE_KEY)
    const snapshot = applyStudyInviteParams(applyStudySessionIdentity(normalizeStudySnapshot(stored ? JSON.parse(stored) : null)))
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(snapshot))
    return snapshot
  } catch {
    return applyStudyInviteParams(applyStudySessionIdentity(normalizeStudySnapshot(null)))
  }
}

export function persistStudySnapshot(snapshot: StudySnapshot): void {
  try {
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Study progress should stay usable even when storage is unavailable.
  }
}

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

export function formatStudyDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatStudyHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600
  return hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)
}

export function formatStudyEventTime(createdAt: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  if (elapsedSeconds < 45) return '刚刚'
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} 分钟前`
  return `${Math.floor(elapsedSeconds / 3600)} 小时前`
}

export function formatStudyPresenceAge(timestamp: number, nowMs = Date.now()): string {
  if (!timestamp) return '尚未收到'
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000))
  if (elapsedSeconds < 5) return '刚刚'
  if (elapsedSeconds < 60) return `${elapsedSeconds} 秒前`
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} 分钟前`
  return `${Math.floor(elapsedSeconds / 3600)} 小时前`
}

export function studyMemberFreshnessLabel(member: { isSelf?: boolean; updatedAt?: number }, nowMs = Date.now()): string {
  if (member.isSelf) return '本机心跳'
  return `心跳 ${formatStudyPresenceAge(member.updatedAt ?? 0, nowMs)}`
}

export function studyMemberStatusLabel(status: StudyTimerState, timerMode: StudyTimerMode): string {
  if (status === 'running') return timerMode === 'focus' ? '在线专注' : '休息中'
  if (status === 'paused') return '暂停'
  return '准备'
}

export function studyLevel(xp: number): { level: number; current: number; next: number; progress: number } {
  const level = Math.max(1, Math.floor(xp / 120) + 1)
  const current = xp % 120
  return { level, current, next: 120, progress: Math.min(100, Math.round((current / 120) * 100)) }
}

export function studyPlantStage(xp: number): string {
  if (xp >= 720) return '成林'
  if (xp >= 420) return '开花'
  if (xp >= 180) return '抽枝'
  if (xp >= 60) return '发芽'
  return '种子'
}

export function studyInviteUrl(spaceCode: string, roomId: StudyRoomId): string {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('studySpace', normalizeStudySpaceCode(spaceCode))
    url.searchParams.set('studyRoom', normalizeStudyRoomId(roomId))
    url.searchParams.delete('room')
    return url.toString()
  } catch {
    return ''
  }
}

export function studyVerificationUrl(inviteUrl: string): string {
  try {
    const url = new URL(inviteUrl)
    url.searchParams.set('studyFreshSession', '1')
    return url.toString()
  } catch {
    return inviteUrl
  }
}

export function nextStudyStreakForDate(
  lastStudyDate: string,
  currentStreak: number,
  localStudyDate: string
): number {
  if (lastStudyDate === localStudyDate) return currentStreak || 1
  return lastStudyDate === previousLocalDateKey(localStudyDate) ? currentStreak + 1 : 1
}

export function nextStudyStreak(lastStudyDate: string, currentStreak: number, now = new Date()): number {
  return nextStudyStreakForDate(lastStudyDate, currentStreak, todayKey(now))
}

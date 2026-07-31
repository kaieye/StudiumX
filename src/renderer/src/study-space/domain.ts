import type { WorkspaceView } from '../../../shared/teaching-types'
import {
  defaultStudySeatIndex,
  normalizeStudyRelayUrl,
  normalizeStudyRoomId,
  normalizeStudySeatClaimedAt,
  normalizeStudySeatIndex,
  normalizeStudySpaceCode,
  studyRoomSeatCount
} from './session/session-snapshot'
import {
  STUDY_PRESENCE_RELAY_URLS,
  STUDY_PRESENCE_TOPIC_ROOT,
  studyRooms,
  studySignals
} from './constants'
import type {
  StudyRoomCycle,
  StudyRoomCyclePhase,
  StudyRoomId,
  StudySignalId,
  StudyTimerMode,
  StudyTimerState
} from './types'

export {
  applyStudyInviteParams,
  applyStudySessionIdentity,
  clampNumber,
  defaultStudyNickname,
  defaultStudySeatIndex,
  normalizeStudyModeId,
  normalizeStudyRelayUrl,
  normalizeStudyRoomId,
  normalizeStudySeatClaimedAt,
  normalizeStudySeatIndex,
  normalizeStudySignalId,
  normalizeStudySnapshot,
  normalizeStudySpaceCode,
  normalizeStudyTaskSchedule,
  normalizeStudyTasks,
  persistStudySnapshot,
  randomStudyClientId,
  readStudySessionClientId,
  readStudySnapshot,
  randomStudySpaceCode,
  studyRoomSeatCount,
  syncStudyLocation
} from './session/session-snapshot'

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

export function studySignalLabel(signalId: StudySignalId): string {
  return studySignals.find((signal) => signal.id === signalId)?.label ?? studySignals[0].label
}

export function studySignalShortLabel(signalId: StudySignalId): string {
  return studySignals.find((signal) => signal.id === signalId)?.shortLabel ?? studySignals[0].shortLabel
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

export function studyPresenceTopic(spaceCode: string): string {
  return `${STUDY_PRESENCE_TOPIC_ROOT}/${normalizeStudySpaceCode(spaceCode).toLowerCase()}/presence`
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

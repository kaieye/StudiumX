import assert from 'node:assert/strict'

import { studyModes, studyRooms } from '../../src/renderer/src/study-space/constants'
import { resolveStudySeatConflict, studyRoomSeatCount } from '../../src/renderer/src/study-space/domain'
import {
  addStudyTask,
  addScheduledStudyTask,
  chooseStudySeatSnapshot,
  defaultStudyContractText,
  deriveStudyHostAction,
  followStudyRoomCycle,
  joinStudySpace,
  resetStudyTimer,
  removeStudyTask,
  saveStudyRelayUrl,
  setStudySpaceCode,
  selectStudyModeSnapshot,
  switchStudyTimerMode,
  tickStudyTimer,
  toggleStudyContract,
  toggleStudyTask,
  toggleStudyTimer,
  updateStudyTask,
  updateStudyTimerPreset
} from '../../src/renderer/src/study-space/session/transitions'
import type { StudySnapshot } from '../../src/renderer/src/study-space/types'

const snapshot: StudySnapshot = {
  clientId: 'studiumx-client',
  nickname: 'Learner',
  spaceCode: 'PUBLIC',
  presenceRelayUrl: 'wss://broker.emqx.io:8084/mqtt',
  signalId: 'reading',
  modeId: 'free',
  contractText: '',
  contractLocked: false,
  ambientEnabled: true,
  ambientVolume: 0.5,
  roomId: 'silent',
  seatIndex: 0,
  seatClaimedAt: 1000,
  timerMode: 'focus',
  timerState: 'idle',
  focusMinutes: 25,
  breakMinutes: 5,
  remainingSeconds: 25 * 60,
  todayFocusSeconds: 0,
  todaySessions: 0,
  totalFocusSeconds: 0,
  totalSessions: 0,
  streakDays: 0,
  xp: 0,
  lastStudyDate: '',
  tasks: [
    { id: 'task-1', title: 'Read chapter', done: false },
    { id: 'task-2', title: 'Review notes', done: true }
  ]
}

assert.equal(defaultStudyContractText(snapshot, 'Free study'), 'Read chapter')

const ticking = tickStudyTimer({ ...snapshot, timerState: 'running', remainingSeconds: 3 }, '2026-07-08')
assert.equal(ticking.remainingSeconds, 2)
assert.equal(ticking.todayFocusSeconds, 1)
assert.equal(ticking.totalFocusSeconds, 1)
assert.equal(ticking.lastStudyDate, '2026-07-08')

const focusDone = tickStudyTimer({ ...snapshot, timerState: 'running', remainingSeconds: 1, focusMinutes: 25 }, '2026-07-08')
assert.equal(focusDone.timerMode, 'break')
assert.equal(focusDone.timerState, 'idle')
assert.equal(focusDone.remainingSeconds, 5 * 60)
assert.equal(focusDone.todaySessions, 1)
assert.equal(focusDone.totalSessions, 1)
assert.equal(focusDone.xp, 50)
assert.equal(focusDone.contractLocked, false)

const breakDone = tickStudyTimer({
  ...snapshot,
  timerMode: 'break',
  timerState: 'running',
  remainingSeconds: 1
})
assert.equal(breakDone.timerMode, 'focus')
assert.equal(breakDone.timerState, 'idle')
assert.equal(breakDone.remainingSeconds, snapshot.focusMinutes * 60)

const presetIdle = updateStudyTimerPreset(snapshot, 45, 10)
assert.equal(presetIdle.focusMinutes, 45)
assert.equal(presetIdle.breakMinutes, 10)
assert.equal(presetIdle.remainingSeconds, 45 * 60)

assert.equal(studyRooms.length, 4)
const studyRoom = studyRooms[0]!

assert.equal(joinStudySpace(snapshot, ' room-ab12 ', 3000).spaceCode, 'ROOM-AB12')
assert.equal(joinStudySpace(snapshot, ' room-ab12 ', 3000).seatClaimedAt, 3000)
assert.equal(joinStudySpace(snapshot, ' public ', 3000).seatClaimedAt, snapshot.seatClaimedAt)
assert.equal(joinStudySpace(snapshot, 'x').spaceCode, 'PUBLIC')
assert.equal(setStudySpaceCode(snapshot, 'ROOM-NEW', 3100).spaceCode, 'ROOM-NEW')
assert.equal(setStudySpaceCode(snapshot, 'ROOM-NEW', 3100).seatClaimedAt, 3100)

const sameSeat = chooseStudySeatSnapshot(snapshot, 0, 3200)
assert.equal(sameSeat.seatIndex, 0)
assert.equal(sameSeat.seatClaimedAt, snapshot.seatClaimedAt)

const changedSeat = chooseStudySeatSnapshot(snapshot, 4, 3200)
assert.equal(changedSeat.seatIndex, 4)
assert.equal(changedSeat.seatClaimedAt, 3200)

const earlierSeatClaimWins = resolveStudySeatConflict({
  self: { clientId: 'studiumx-loser', roomId: 'silent', seatIndex: 2, seatClaimedAt: 2000 },
  peerClaims: [
    { clientId: 'studiumx-winner', roomId: 'silent', seatIndex: 2, seatClaimedAt: 1000 },
    { clientId: 'studiumx-neighbor', roomId: 'silent', seatIndex: 1, seatClaimedAt: 1500 }
  ]
})
assert.equal(earlierSeatClaimWins.hasConflict, true)
assert.equal(earlierSeatClaimWins.keepsSeat, false)
assert.equal(earlierSeatClaimWins.winnerClientId, 'studiumx-winner')
assert.equal(earlierSeatClaimWins.nextSeatIndex, 3)

const tiedSeatClaimUsesClientId = resolveStudySeatConflict({
  self: { clientId: 'studiumx-b', roomId: 'silent', seatIndex: 5, seatClaimedAt: 4000 },
  peerClaims: [{ clientId: 'studiumx-a', roomId: 'silent', seatIndex: 5, seatClaimedAt: 4000 }]
})
assert.equal(tiedSeatClaimUsesClientId.hasConflict, true)
assert.equal(tiedSeatClaimUsesClientId.keepsSeat, false)
assert.equal(tiedSeatClaimUsesClientId.winnerClientId, 'studiumx-a')

const fullRoomConflict = resolveStudySeatConflict({
  self: { clientId: 'studiumx-full-loser', roomId: 'silent', seatIndex: 0, seatClaimedAt: 5000 },
  peerClaims: Array.from({ length: studyRoomSeatCount('silent') }, (_, seatIndex) => ({
    clientId: `studiumx-full-${seatIndex}`,
    roomId: 'silent' as const,
    seatIndex,
    seatClaimedAt: seatIndex === 0 ? 1000 : 3000 + seatIndex
  }))
})
assert.equal(fullRoomConflict.hasConflict, true)
assert.equal(fullRoomConflict.keepsSeat, false)
assert.equal(fullRoomConflict.nextSeatIndex, null)

const examMode = studyModes.find((mode) => mode.id === 'exam')!
const selectedMode = selectStudyModeSnapshot(snapshot, examMode)
assert.equal(selectedMode.modeId, 'exam')
assert.equal(selectedMode.roomId, 'exam')
assert.equal(selectedMode.ambientEnabled, false)

const contract = toggleStudyContract(snapshot, 'Fallback contract')
assert.equal(contract.contractText, 'Fallback contract')
assert.equal(contract.contractLocked, true)

const started = toggleStudyTimer(snapshot, 'Fallback contract')
assert.equal(started.timerState, 'running')
assert.equal(started.contractText, 'Fallback contract')
assert.equal(started.contractLocked, true)

const followed = followStudyRoomCycle({
  snapshot,
  room: studyRoom,
  phase: 'focus',
  remainingSeconds: 44,
  fallbackContract: 'Follow contract'
})
assert.equal(followed.timerState, 'running')
assert.equal(followed.focusMinutes, studyRoom.sessionMinutes)
assert.equal(followed.remainingSeconds, 44)
assert.equal(followed.contractLocked, true)

assert.equal(deriveStudyHostAction({ ...snapshot, timerState: 'running' }, false), 'open_focus_theater')
assert.equal(deriveStudyHostAction(snapshot, false), 'lock_contract')
assert.equal(deriveStudyHostAction({ ...snapshot, contractLocked: true }, false), 'follow_room_cycle')
assert.equal(deriveStudyHostAction({ ...snapshot, contractLocked: true }, true), 'toggle_timer')

const reset = resetStudyTimer({ ...snapshot, timerMode: 'break', timerState: 'running', contractLocked: true })
assert.equal(reset.timerState, 'idle')
assert.equal(reset.contractLocked, false)
assert.equal(reset.remainingSeconds, snapshot.breakMinutes * 60)

const switched = switchStudyTimerMode({ ...snapshot, timerState: 'running' }, 'break')
assert.equal(switched.timerMode, 'break')
assert.equal(switched.timerState, 'paused')
assert.equal(switched.remainingSeconds, snapshot.breakMinutes * 60)

const added = addStudyTask(snapshot, '  New task  ', 'new-task')
assert.equal(added.added, true)
assert.equal(added.snapshot.tasks[0]?.title, 'New task')
assert.equal(addStudyTask(snapshot, '   ', 'blank').added, false)

const scheduled = addScheduledStudyTask(snapshot, ' Lecture prep ', 'scheduled-task', {
  weekday: 1,
  startMinutes: 9 * 60,
  endMinutes: 10 * 60 + 30,
  colorId: 'mist'
})
assert.equal(scheduled.added, true)
assert.deepEqual(scheduled.snapshot.tasks[0]?.schedule, { weekday: 1, startMinutes: 540, endMinutes: 630, colorId: 'mist' })

const toggled = toggleStudyTask(snapshot, 'task-1')
assert.equal(toggled.tasks.find((task) => task.id === 'task-1')?.done, true)

const removed = removeStudyTask(snapshot, 'task-1')
assert.equal(removed.tasks.some((task) => task.id === 'task-1'), false)
assert.equal(removed.tasks.length, 1)

const updatedTask = updateStudyTask(snapshot, 'task-1', {
  title: '  Read chapter 2  ',
  done: true,
  schedule: { weekday: 2, startMinutes: 13 * 60, endMinutes: 14 * 60, colorId: 'clay' }
})
assert.equal(updatedTask.updated, true)
assert.deepEqual(updatedTask.snapshot.tasks.find((task) => task.id === 'task-1'), {
  id: 'task-1',
  title: 'Read chapter 2',
  done: true,
  schedule: { weekday: 2, startMinutes: 780, endMinutes: 840, colorId: 'clay' }
})

const relay = saveStudyRelayUrl(snapshot, 'not a url')
assert.equal(relay.relayUrl, 'wss://broker.emqx.io:8084/mqtt')
assert.equal(relay.snapshot.presenceRelayUrl, relay.relayUrl)

console.log('study session transitions ok')

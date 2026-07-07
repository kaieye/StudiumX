import assert from 'node:assert/strict'

import { studyModes, studyRooms } from '../../src/renderer/src/study-space/constants'
import {
  addStudyTask,
  defaultStudyContractText,
  deriveStudyHostAction,
  followStudyRoomCycle,
  resetStudyTimer,
  saveStudyRelayUrl,
  selectStudyModeSnapshot,
  selectStudyRoomSnapshot,
  switchStudyTimerMode,
  tickStudyTimer,
  toggleStudyContract,
  toggleStudyTask,
  toggleStudyTimer,
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

const sprintRoom = studyRooms.find((room) => room.id === 'sprint')!
const selectedRoom = selectStudyRoomSnapshot(snapshot, sprintRoom)
assert.equal(selectedRoom.roomId, 'sprint')
assert.equal(selectedRoom.focusMinutes, sprintRoom.sessionMinutes)
assert.equal(selectedRoom.breakMinutes, sprintRoom.breakMinutes)

const runningRoom = selectStudyRoomSnapshot({ ...snapshot, timerState: 'running', remainingSeconds: 88 }, sprintRoom)
assert.equal(runningRoom.roomId, 'sprint')
assert.equal(runningRoom.remainingSeconds, 88)
assert.equal(runningRoom.focusMinutes, snapshot.focusMinutes)

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
  room: sprintRoom,
  phase: 'focus',
  remainingSeconds: 44,
  fallbackContract: 'Follow contract'
})
assert.equal(followed.timerState, 'running')
assert.equal(followed.focusMinutes, sprintRoom.sessionMinutes)
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

const toggled = toggleStudyTask(snapshot, 'task-1')
assert.equal(toggled.tasks.find((task) => task.id === 'task-1')?.done, true)

const relay = saveStudyRelayUrl(snapshot, 'not a url')
assert.equal(relay.relayUrl, 'wss://broker.emqx.io:8084/mqtt')
assert.equal(relay.snapshot.presenceRelayUrl, relay.relayUrl)

console.log('study session transitions ok')

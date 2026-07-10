import assert from 'node:assert/strict'

import { buildStudySeatMapItems } from '../../src/renderer/src/study-space/seatMapPresenter'
import type { StudyPresencePeer, StudySnapshot } from '../../src/renderer/src/study-space/types'

const snapshot: StudySnapshot = {
  clientId: 'studiumx-client-self',
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
  seatIndex: 2,
  timerMode: 'focus',
  timerState: 'running',
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
  tasks: []
}

const peer: StudyPresencePeer = {
  clientId: 'studiumx-client-peer',
  roomId: 'silent',
  spaceCode: 'PUBLIC',
  nickname: 'Peer',
  signalId: 'writing',
  seatIndex: 4,
  status: 'running',
  timerMode: 'focus',
  focusMinutes: 25,
  todayFocusSeconds: 1200,
  todaySessions: 1,
  streakDays: 3,
  updatedAt: 1_000
}

const items = buildStudySeatMapItems({
  snapshot,
  peersBySeat: new Map([[4, peer]]),
  roomCycleNow: 16_000,
  seatCount: 13,
  userSeat: 2
})

assert.equal(items.length, 14)

const selfSeat = items.find((item) => item.kind === 'seat' && item.seatIndex === 2)
assert.ok(selfSeat)
assert.equal(selfSeat.className, 'study-seat is-user is-occupied')
assert.equal(selfSeat.disabled, false)
assert.equal(selfSeat.avatarLabel, '我')
assert.equal(selfSeat.label, 'Learner')
assert.equal(selfSeat.meta, '读 · 在线专注')
assert.equal(selfSeat.title, '03号座 · Learner（我） · 阅读材料 · 在线专注 · 本机心跳')
assert.equal(selfSeat.ariaLabel, selfSeat.title)

const peerSeat = items.find((item) => item.kind === 'seat' && item.seatIndex === 4)
assert.ok(peerSeat)
assert.equal(peerSeat.className, 'study-seat is-occupied is-focusing')
assert.equal(peerSeat.disabled, true)
assert.equal(peerSeat.avatarLabel, '写')
assert.equal(peerSeat.label, 'Peer')
assert.equal(peerSeat.meta, '写 · 在线专注')
assert.equal(peerSeat.title, '05号座 · Peer · 写作输出 · 在线专注 · 心跳 15 秒前')

const emptySeat = items.find((item) => item.kind === 'seat' && item.seatIndex === 0)
assert.ok(emptySeat)
assert.equal(emptySeat.className, 'study-seat is-empty')
assert.equal(emptySeat.disabled, false)
assert.equal(emptySeat.avatarLabel, '')
assert.equal(emptySeat.label, '空座')
assert.equal(emptySeat.meta, '可入座')
assert.equal(emptySeat.title, '01号座 · 空座，点击入座')

const aisle = items.find((item) => item.kind === 'aisle')
assert.deepEqual(aisle, {
  kind: 'aisle',
  key: 'aisle-12',
  label: '中排学习区'
})

console.log('study seat map presenter ok')

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [workbench, leaderboard, studySpace, studyRoomStage, css] = await Promise.all([
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchLeaderboard.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/StudySpace.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/StudyRoomStage.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench.css', 'utf8')
])

assert.doesNotMatch(
  workbench,
  /WorkbenchPresencePanel|在线心跳|远端心跳|本机心跳|心跳来源/,
  'workbench should not render the old expanded heartbeat panel'
)

assert.match(
  workbench,
  /<WorkbenchLeaderboard members=\{viewModel\.roomMembers\} presenceStatus=\{presence\.status\} \/>/,
  'workbench should pass the live heartbeat status into the leaderboard'
)

assert.match(
  leaderboard,
  /自习室榜单[\s\S]*workbench-heartbeat-dot/,
  'leaderboard title should render the compact heartbeat dot beside the label'
)

assert.match(
  leaderboard,
  /presenceStatus: StudyPresenceStatus/,
  'leaderboard should type the heartbeat status explicitly'
)

assert.doesNotMatch(
  `${studySpace}\n${studyRoomStage}`,
  /心跳|remoteHeartbeatLabel|studyMemberFreshnessLabel|StudyArrivalPanel|study-live-proof/,
  'study space should no longer render heartbeat-specific UI'
)

assert.match(css, /\.workbench-heartbeat-dot \{/, 'workbench heartbeat dot should have dedicated styling')
assert.doesNotMatch(css, /workbench-presence-card|workbench-presence-proof/, 'old expanded heartbeat panel styles should be removed')

console.log('workbench presence checks passed')

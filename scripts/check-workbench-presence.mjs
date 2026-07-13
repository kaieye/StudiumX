import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, workbench, leaderboard, css] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchLeaderboard.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench.css', 'utf8')
])

assert.doesNotMatch(app, /StudySpace|view === 'studio'|id: 'studio'/, 'app should no longer expose the old study space page')

assert.doesNotMatch(
  workbench,
  /WorkbenchPresencePanel|在线心跳|远端心跳|本机心跳|心跳来源/,
  'workbench should not render the old expanded heartbeat panel'
)

assert.match(
  workbench,
  /new URL\('\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/ref\.png', import\.meta\.url\)/,
  'workbench should load ref.png as its desk artwork'
)

assert.match(
  workbench,
  /drawDeskImage\(ctx, assets\.deskImage, slot\)/,
  'every workbench seat should draw the ref.png desk image'
)

assert.match(
  workbench,
  /<WorkbenchLeaderboard[\s\S]*members=\{viewModel\.roomMembers\}[\s\S]*presenceStatus=\{presence\.status\}[\s\S]*spaceCode=\{snapshot\.spaceCode\}[\s\S]*\/>/,
  'workbench should pass the live heartbeat status and room code into the leaderboard'
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
  app,
  /心跳|remoteHeartbeatLabel|studyMemberFreshnessLabel|StudyArrivalPanel|study-live-proof/,
  'removed study space page should no longer render heartbeat-specific UI'
)

assert.match(css, /\.workbench-heartbeat-dot \{/, 'workbench heartbeat dot should have dedicated styling')
assert.doesNotMatch(css, /workbench-presence-card|workbench-presence-proof/, 'old expanded heartbeat panel styles should be removed')

console.log('workbench presence checks passed')

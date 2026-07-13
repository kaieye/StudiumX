import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, workbench, leaderboard, roomSwitcher, pomodoro, viewModel, css] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchLeaderboard.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchRoomSwitcher.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchPomodoro.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/viewModel.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench.css', 'utf8')
])

assert.match(
  workbench,
  /<WorkbenchLeaderboard[\s\S]*members=\{viewModel\.roomMembers\}[\s\S]*presenceStatus=\{presence\.status\}[\s\S]*spaceCode=\{snapshot\.spaceCode\}[\s\S]*\/>/,
  'workbench should render the leaderboard from the existing live room member ranking and room code'
)

assert.equal(
  [...leaderboard.matchAll(/<button\b/g)].length,
  1,
  'collapsed leaderboard entry should use exactly one button'
)

assert.match(
  leaderboard,
  /const selfRank = Math\.max\(1, members\.findIndex\(\(member\) => member\.isSelf\) \+ 1\)/,
  'leaderboard button should derive the current user rank from the sorted member list'
)

assert.match(
  leaderboard,
  /<strong>#\{selfRank\}\/\{totalMembers\}<\/strong>/,
  'leaderboard button should show rank and current member count as #rank/total'
)

assert.match(
  leaderboard,
  /workbench-heartbeat-dot[\s\S]*workbench-leaderboard-space-code[^>]*>\{spaceCode\}<\/code>/,
  'leaderboard header should show the room code immediately after the heartbeat dot'
)

assert.doesNotMatch(
  roomSwitcher,
  /<strong>\{spaceCode\}<\/strong>/,
  'room switcher card should no longer display the room code value'
)

assert.doesNotMatch(
  pomodoro,
  /25\/5|50\/10|90\/15|workbench-pomodoro-presets/,
  'pomodoro card should not render preset duration buttons'
)

assert.match(
  leaderboard,
  /aria-expanded=\{open\}[\s\S]*\{open \? \(/,
  'leaderboard rows should only render after the button is expanded'
)

assert.match(css, /\.workbench-tools \.workbench-leaderboard-toggle \{/, 'workbench leaderboard button should have dedicated styling')
assert.match(css, /\.workbench-leaderboard-panel \{/, 'expanded workbench leaderboard should have dedicated styling')

const removedStudyCopy = `${app}\n${viewModel}`
assert.doesNotMatch(removedStudyCopy, /本空间专注榜/, 'removed study space page should no longer show its old focus leaderboard')
assert.doesNotMatch(removedStudyCopy, /人数来自同空间的实时同步/, 'removed study space page should no longer show the removed online-count explanation')
assert.doesNotMatch(removedStudyCopy, /study-leaderboard|study-invite-note|view === 'studio'|id: 'studio'/, 'app should no longer render the removed study space page')

console.log('workbench leaderboard checks passed')

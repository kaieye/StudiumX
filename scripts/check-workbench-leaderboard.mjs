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
  /<WorkbenchLeaderboard[\s\S]*members=\{viewModel\.roomMembers\}[\s\S]*presenceStatus=\{presence\.status\}[\s\S]*spaceCode=\{snapshot\.spaceCode\}[\s\S]*onEnterRandomSpace=\{enterRandomSpace\}[\s\S]*onJoinSpace=\{joinSpace\}[\s\S]*\/>/,
  'workbench should render the leaderboard with live room data and room switching callbacks'
)

assert.doesNotMatch(
  workbench,
  /<div className="workbench-tools"[\s\S]*<WorkbenchRoomSwitcher/,
  'room switching controls should no longer render in the right-side tools rail'
)

assert.equal(
  [...leaderboard.matchAll(/<button\b/g)].length,
  1,
  'collapsed leaderboard entry should use exactly one button before its conditional panel'
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
  /spaceCode=\{|<Copy|复制/,
  'leaderboard room actions should not duplicate the room code or the old copy control'
)

assert.doesNotMatch(
  pomodoro,
  /25\/5|50\/10|90\/15|workbench-pomodoro-presets/,
  'pomodoro card should not render preset duration buttons'
)

assert.match(
  leaderboard,
  /aria-expanded=\{open\}[\s\S]*\{open \? \([\s\S]*<WorkbenchRoomSwitcher[\s\S]*onEnterRandomSpace=\{onEnterRandomSpace\}[\s\S]*onJoinSpace=\{onJoinSpace\}/,
  'leaderboard rows and room actions should only render after the card is expanded'
)

assert.match(
  roomSwitcher,
  /workbench-leaderboard-actions[\s\S]*workbench-room-random[\s\S]*随机进入自习室[\s\S]*<form className="workbench-room-join"[\s\S]*加入房间/,
  'expanded leaderboard footer should render random-entry and join-room actions together'
)

assert.match(css, /\.workbench-tools \.workbench-leaderboard-toggle \{/, 'workbench leaderboard button should have dedicated styling')
assert.match(css, /\.workbench-leaderboard-panel \{/, 'expanded workbench leaderboard should have dedicated styling')
assert.match(
  css,
  /\.workbench-leaderboard-actions \{[\s\S]*grid-template-columns:/,
  'leaderboard room actions should use a side-by-side grid layout'
)

const removedStudyCopy = `${app}\n${viewModel}`
assert.doesNotMatch(removedStudyCopy, /本空间专注榜/, 'removed study space page should no longer show its old focus leaderboard')
assert.doesNotMatch(removedStudyCopy, /人数来自同空间的实时同步/, 'removed study space page should no longer show the removed online-count explanation')
assert.doesNotMatch(removedStudyCopy, /study-leaderboard|study-invite-note|view === 'studio'|id: 'studio'/, 'app should no longer render the removed study space page')

console.log('workbench leaderboard checks passed')

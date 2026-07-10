import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [workbench, leaderboard, studySpace, viewModel, css] = await Promise.all([
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchLeaderboard.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/StudySpace.tsx', 'utf8'),
  readFile('src/renderer/src/study-space/viewModel.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench.css', 'utf8')
])

assert.match(
  workbench,
  /<WorkbenchLeaderboard members=\{viewModel\.roomMembers\} presenceStatus=\{presence\.status\} \/>/,
  'workbench should render the leaderboard from the existing live room member ranking'
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
  /aria-expanded=\{open\}[\s\S]*\{open \? \(/,
  'leaderboard rows should only render after the button is expanded'
)

assert.match(css, /\.workbench-tools \.workbench-leaderboard-toggle \{/, 'workbench leaderboard button should have dedicated styling')
assert.match(css, /\.workbench-leaderboard-panel \{/, 'expanded workbench leaderboard should have dedicated styling')

const removedStudyCopy = `${studySpace}\n${viewModel}`
assert.doesNotMatch(removedStudyCopy, /本空间专注榜/, 'study space should no longer show its old focus leaderboard')
assert.doesNotMatch(removedStudyCopy, /人数来自同空间的实时同步/, 'study space should no longer show the removed online-count explanation')
assert.doesNotMatch(removedStudyCopy, /study-leaderboard|study-invite-note/, 'study space should no longer render the removed leaderboard or explanation containers')

console.log('workbench leaderboard checks passed')

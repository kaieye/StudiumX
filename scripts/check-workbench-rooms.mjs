import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [constants, workbench, leaderboard, switcher, shellCss, cardsCss, scheduleCss, immersiveCss, timerCss] = await Promise.all([
  readFile('src/renderer/src/study-space/constants.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchLeaderboard.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchRoomSwitcher.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench-css/office-workbench-shell.css', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench-css/office-workbench-cards.css', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench-css/office-workbench-schedule.css', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench-css/office-workbench-immersive.css', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench-css/office-workbench-timer.css', 'utf8')
])

// office-workbench.css is a thin aggregator; the cascade lives in its partials.
const finalCss = [shellCss, cardsCss, scheduleCss, immersiveCss, timerCss].join('\n')

for (const roomId of ['silent', 'sprint', 'deep', 'exam']) {
  assert.match(constants, new RegExp(`id: '${roomId}'`), `study rooms should include ${roomId}`)
}

assert.match(leaderboard, /<WorkbenchRoomSwitcher/, 'workbench leaderboard should render the room switcher')
assert.match(workbench, /onEnterRandomSpace=\{handleEnterRandomSpace\}/, 'workbench should expose random room entry')
assert.match(workbench, /onJoinSpace=\{handleJoinExistingSpace\}/, 'workbench should expose room joining')
assert.doesNotMatch(switcher, /navigator\.clipboard\.writeText/, 'room switcher should no longer copy invite codes')
assert.match(switcher, /随机分配新自习室/, 'room switcher should label random room entry clearly')
assert.doesNotMatch(switcher, /studyRooms\.map|workbench-room-list|当前自习室|创建房间码/, 'room switcher should not render room-type selection or old create copy')
assert.doesNotMatch(finalCss, /workbench-room-list|workbench-room-current|workbench-room-members/, 'removed room-type styles should stay deleted')

console.log('workbench room checks passed')

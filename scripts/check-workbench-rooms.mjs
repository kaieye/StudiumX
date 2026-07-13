import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [constants, workbench, switcher, css] = await Promise.all([
  readFile('src/renderer/src/study-space/constants.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchRoomSwitcher.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/office-workbench.css', 'utf8')
])

for (const roomId of ['silent', 'sprint', 'deep', 'exam']) {
  assert.match(constants, new RegExp(`id: '${roomId}'`), `study rooms should include ${roomId}`)
}

assert.match(workbench, /<WorkbenchRoomSwitcher/, 'workbench should render the room switcher')
assert.match(workbench, /enterRandomSpace/, 'workbench should expose random room entry')
assert.match(workbench, /joinSpace/, 'workbench should expose room joining')
assert.match(switcher, /navigator\.clipboard\.writeText/, 'room switcher should copy invite codes')
assert.match(switcher, /随机进入自习室/, 'room switcher should label random room entry clearly')
assert.doesNotMatch(switcher, /studyRooms\.map|workbench-room-list|当前自习室|创建房间码/, 'room switcher should not render room-type selection or old create copy')
assert.doesNotMatch(css, /workbench-room-list|workbench-room-current|workbench-room-members/, 'removed room-type styles should stay deleted')

console.log('workbench room checks passed')

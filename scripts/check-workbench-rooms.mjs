import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [constants, workbench, switcher] = await Promise.all([
  readFile('src/renderer/src/study-space/constants.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/views/workbench/WorkbenchRoomSwitcher.tsx', 'utf8')
])

for (const roomId of ['silent', 'sprint', 'deep', 'exam']) {
  assert.match(constants, new RegExp(`id: '${roomId}'`), `study rooms should include ${roomId}`)
}

assert.match(workbench, /<WorkbenchRoomSwitcher/, 'workbench should render the room switcher')
assert.match(workbench, /createSpace/, 'workbench should expose room creation')
assert.match(workbench, /selectRoom/, 'workbench should expose room selection')
assert.match(workbench, /joinSpace/, 'workbench should expose room joining')
assert.match(switcher, /navigator\.clipboard\.writeText/, 'room switcher should copy invite codes')
assert.match(switcher, /studyRooms\.map/, 'room switcher should list every available room')

console.log('workbench room checks passed')

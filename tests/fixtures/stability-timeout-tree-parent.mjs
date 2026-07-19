import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const [workerPidPath, escapedMarkerPath] = process.argv.slice(2)
if (!workerPidPath || !escapedMarkerPath) {
  throw new Error('Expected worker PID and marker paths.')
}

const worker = spawn(
  process.execPath,
  ['-e', `setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'orphaned'), 1_500)`, escapedMarkerPath],
  { stdio: 'ignore' }
)

await writeFile(workerPidPath, String(worker.pid), 'utf8')
setInterval(() => {}, 1_000)

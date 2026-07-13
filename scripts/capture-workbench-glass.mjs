import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const port = 9700 + (process.pid % 200)
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-glass-capture-'))
const child = spawn(
  electronPath,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(tempDir, 'profile')}`,
    resolve('out/main/index.js')
  ],
  { env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] }
)

let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => { stderr += chunk })

const outDir = resolve('scripts')

try {
  const target = await waitForTarget()
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await waitFor(() => evaluate(cdp, `document.readyState === 'complete'`))

  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => /自习室|study room|workbench/i.test(entry.textContent || ''))
    button?.click()
    return Boolean(button)
  })()`)
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.office-workbench-page'))`))

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1180,
    height: 760,
    deviceScaleFactor: 2,
    mobile: false
  })
  await new Promise((r) => setTimeout(r, 900))

  for (const theme of ['light', 'dark']) {
    await evaluate(cdp, `document.documentElement.setAttribute('data-resolved-theme', ${JSON.stringify(theme)})`)
    await new Promise((r) => setTimeout(r, 600))
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(outDir, `glass-${theme}.png`), Buffer.from(shot.data, 'base64'))
    console.log(`captured ${theme}`)
  }

  cdp.close()
} finally {
  if (child.exitCode === null) {
    const closed = new Promise((r) => child.once('close', r))
    child.kill()
    await closed
  }
  await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function waitForTarget() {
  return waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`)
      const t = await r.json()
      return t.find((x) => x.type === 'page') || false
    } catch {
      if (child.exitCode !== null) throw new Error(`Electron exited early\n${stderr}`)
      return false
    }
  }, 15000)
}

async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const r = await check()
    if (r) return r
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out\n${stderr}`)
}

function connectCdp(url) {
  return new Promise((resolveConnect, reject) => {
    const socket = new WebSocket(url)
    let seq = 0
    const pending = new Map()
    socket.addEventListener('open', () => {
      resolveConnect({
        send(method, params = {}) {
          const id = ++seq
          socket.send(JSON.stringify({ id, method, params }))
          return new Promise((res, rej) => pending.set(id, { res, rej }))
        },
        close() { socket.close() }
      })
    })
    socket.addEventListener('error', reject)
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(event.data)
      if (!m.id) return
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.rej(new Error(m.error.message))
      else p.res(m.result)
    })
  })
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

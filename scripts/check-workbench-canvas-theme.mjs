import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const port = 9300 + (process.pid % 500)
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-workbench-theme-'))

const child = spawn(
  electronPath,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(tempDir, 'profile')}`,
    resolve('out/main/index.js')
  ],
  {
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  }
)

let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => { stderr += chunk })

try {
  const target = await waitForTarget(port)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  await waitFor(() => evaluate(cdp, `document.readyState === 'complete'`))
  const clicked = await evaluate(cdp, `(() => {
    const entries = [...document.querySelectorAll('button')]
    const target = entries.find((entry) => /自习室|study room|workbench/i.test(entry.textContent || ''))
    target?.click()
    return Boolean(target)
  })()`)
  if (!clicked) {
    const bodyText = await evaluate(cdp, `document.body.innerText.slice(0, 2000)`)
    throw new Error(`workbench navigation button not found\n${bodyText}`)
  }

  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.office-workbench-page'))`))
  await evaluate(cdp, `(() => {
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.dataset.resolvedTheme = 'dark'
    document.documentElement.style.colorScheme = 'dark'
    return true
  })()`)
  await new Promise((resolveWait) => setTimeout(resolveWait, 800))

  const result = await evaluate(cdp, `(() => {
    const canvas = document.querySelector('.office-workbench-canvas')
    const page = document.querySelector('.office-workbench-page')
    const stage = document.querySelector('.office-workbench-stage')
    const canvasRect = canvas.getBoundingClientRect()
    const pageRect = page.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const context = canvas.getContext('2d')
    const rowStats = (y) => {
      const pixels = context.getImageData(0, y, canvas.width, 1).data
      let white = 0
      let transparent = 0
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] === 0) transparent += 1
        if (pixels[index] >= 245 && pixels[index + 1] >= 245 && pixels[index + 2] >= 245 && pixels[index + 3] >= 245) white += 1
      }
      return { whiteRatio: white / canvas.width, transparentRatio: transparent / canvas.width }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      page: { rect: pageRect.toJSON(), background: getComputedStyle(page).backgroundColor },
      stage: { rect: stageRect.toJSON(), background: getComputedStyle(stage).backgroundColor },
      canvas: {
        rect: canvasRect.toJSON(),
        width: canvas.width,
        height: canvas.height,
        bottom: rowStats(canvas.height - 1),
        nearBottom: rowStats(Math.max(0, canvas.height - 32)),
        center: rowStats(Math.floor(canvas.height / 2))
      },
      bottomElement: (() => {
        const element = document.elementFromPoint(innerWidth / 2, innerHeight - 2)
        return { className: element?.className || '', background: element ? getComputedStyle(element).backgroundColor : '' }
      })()
    }
  })()`)

  assert.equal(result.page.background, 'rgb(16, 16, 16)', 'dark workbench page should use the app theme background')
  assert.equal(result.stage.background, 'rgb(16, 16, 16)', 'dark workbench stage should use the app theme background')
  assert.ok(
    result.canvas.bottom.whiteRatio < 0.05,
    `dark workbench canvas should not paint a white bottom area, got ${(result.canvas.bottom.whiteRatio * 100).toFixed(1)}% white pixels`
  )
  assert.equal(
    result.canvas.bottom.transparentRatio,
    1,
    'unused dark workbench canvas pixels should remain transparent so the theme background can show through'
  )
  console.log('check:workbench-canvas-theme passed')
  cdp.close()
} finally {
  if (child.exitCode === null) {
    const closed = new Promise((resolveClose) => child.once('close', resolveClose))
    child.kill()
    await closed
  }
  await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function waitForTarget(debugPort) {
  return waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json()
      return targets.find((target) => target.type === 'page') || false
    } catch {
      if (child.exitCode !== null) throw new Error(`Electron exited early\n${stderr}`)
      return false
    }
  }, 15000)
}

async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`timed out waiting for workbench state\n${stderr}`)
}

function connectCdp(url) {
  return new Promise((resolveConnect, reject) => {
    const socket = new WebSocket(url)
    let sequence = 0
    const pending = new Map()
    socket.addEventListener('open', () => {
      resolveConnect({
        send(method, params = {}) {
          const id = ++sequence
          socket.send(JSON.stringify({ id, method, params }))
          return new Promise((resolveSend, rejectSend) => pending.set(id, { resolveSend, rejectSend }))
        },
        close() { socket.close() }
      })
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !pending.has(message.id)) return
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.rejectSend(new Error(message.error.message))
      else request.resolveSend(message.result)
    })
    socket.addEventListener('error', reject)
  })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

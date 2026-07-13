import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const port = 9600 + (process.pid % 300)
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-workbench-card-legibility-'))
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
  const target = await waitForTarget()
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await waitFor(() => evaluate(cdp, `document.readyState === 'complete'`))

  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => /自习室|study room|workbench/i.test(entry.textContent || ''))
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(clicked, true, 'workbench navigation button should be available')
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.office-workbench-page'))`))

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  })
  await new Promise((resolveWait) => setTimeout(resolveWait, 500))

  const result = await evaluate(cdp, `(() => {
    const tools = document.querySelector('.workbench-tools')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(tools).transform)
    const scale = Math.hypot(matrix.a, matrix.b) || 1
    const leaves = [...tools.querySelectorAll('*')].filter((element) => {
      if (!(element.textContent || '').trim()) return false
      return ![...element.children].some((child) => (child.textContent || '').trim())
    })
    const labels = leaves.map((element) => {
      const style = getComputedStyle(element)
      const fontSize = Number.parseFloat(style.fontSize)
      return {
        text: (element.textContent || '').trim(),
        fontSize,
        effectiveFontSize: Number((fontSize * scale).toFixed(2))
      }
    })
    const canvas = document.querySelector('.office-workbench-canvas')
    const toolsRect = tools.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const cards = [...tools.children].map((card) => {
      const rect = card.getBoundingClientRect()
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
    })
    const overlapWidth = Math.max(0, Math.min(toolsRect.right, canvasRect.right) - Math.max(toolsRect.left, canvasRect.left))
    const overlapHeight = Math.max(0, Math.min(toolsRect.bottom, canvasRect.bottom) - Math.max(toolsRect.top, canvasRect.top))
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scale: Number(scale.toFixed(4)),
      minEffectiveFontSize: Math.min(...labels.map((label) => label.effectiveFontSize)),
      smallestLabels: labels
        .sort((left, right) => left.effectiveFontSize - right.effectiveFontSize)
        .slice(0, 6),
      tools: {
        clientHeight: tools.clientHeight,
        scrollHeight: tools.scrollHeight,
        bottomSpace: Number((innerHeight - toolsRect.bottom).toFixed(2)),
        rect: { top: toolsRect.top, right: toolsRect.right, bottom: toolsRect.bottom, left: toolsRect.left }
      },
      canvas: { top: canvasRect.top, right: canvasRect.right, bottom: canvasRect.bottom, left: canvasRect.left },
      cards,
      canvasOverlapArea: Number((overlapWidth * overlapHeight).toFixed(2))
    }
  })()`)

  console.log(JSON.stringify(result))
  assert.deepEqual(result.viewport, { width: 1100, height: 720 })
  assert.ok(
    result.scale >= 1,
    `study-room cards must not shrink below their designed size; got scale ${result.scale}`
  )
  assert.ok(
    result.minEffectiveFontSize >= 12,
    `study-room card text should remain at least 12px at the minimum window size; got ${result.minEffectiveFontSize}px (${JSON.stringify(result.smallestLabels)})`
  )
  assert.ok(
    result.tools.scrollHeight <= result.tools.clientHeight + 1,
    `all study-room cards should be fully visible without rail scrolling; got ${result.tools.scrollHeight}px of content in ${result.tools.clientHeight}px`
  )
  assert.ok(
    result.cards.every((card) => card.top >= result.tools.rect.top - 1 && card.bottom <= result.tools.rect.bottom + 1),
    `study-room cards should remain inside the visible rail: ${JSON.stringify({ tools: result.tools.rect, cards: result.cards })}`
  )
  assert.ok(
    result.tools.bottomSpace >= 32,
    `compact study-room cards should keep vertical safety space; got ${result.tools.bottomSpace}px`
  )
  assert.equal(
    result.canvasOverlapArea,
    0,
    `study-room cards should not cover the desk canvas; overlap area ${result.canvasOverlapArea}px²`
  )

  const collapsedTask = result.cards.at(-1)
  const taskToggleClicked = await evaluate(cdp, `(() => {
    const toggle = document.querySelector('.workbench-task-toggle-card')
    toggle?.click()
    return Boolean(toggle)
  })()`)
  assert.equal(taskToggleClicked, true, 'collapsed task-list toggle should be available')
  await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.workbench-task-panel'))`))
  await new Promise((resolveWait) => setTimeout(resolveWait, 320))

  const expandedTask = await evaluate(cdp, `(() => {
    const card = document.querySelector('.workbench-task-card')
    const panel = card.querySelector('.workbench-task-panel')
    const toggle = card.querySelector('.workbench-task-toggle-card')
    const cardRect = card.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const toggleRect = toggle.getBoundingClientRect()
    return {
      card: { top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom, left: cardRect.left },
      panel: { top: panelRect.top, bottom: panelRect.bottom },
      toggle: { top: toggleRect.top, bottom: toggleRect.bottom },
      borderRadius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius),
      expanded: toggle.getAttribute('aria-expanded')
    }
  })()`)

  assert.ok(
    Math.abs(expandedTask.card.bottom - collapsedTask.bottom) <= 1,
    `expanded task list should keep its bottom-right anchor; got ${JSON.stringify({ collapsedTask, expandedTask })}`
  )
  assert.ok(
    expandedTask.card.top < collapsedTask.top - 100,
    `expanded task list should grow upward; got ${JSON.stringify({ collapsedTask, expandedTask })}`
  )
  assert.ok(
    Math.abs((expandedTask.card.right - expandedTask.card.left) - (collapsedTask.right - collapsedTask.left)) <= 1,
    'expanded task list should keep the collapsed card width'
  )
  assert.ok(
    expandedTask.panel.bottom <= expandedTask.toggle.top - 8,
    'expanded task panel should stay above the bottom toggle'
  )
  assert.equal(expandedTask.borderRadius, 24, 'expanded task list should keep 24px rounded corners')
  assert.equal(expandedTask.expanded, 'true', 'task-list toggle should expose its expanded state')

  console.log('check:workbench-card-legibility passed')
  cdp.close()
} finally {
  if (child.exitCode === null) {
    const closed = new Promise((resolveClose) => child.once('close', resolveClose))
    child.kill()
    await closed
  }
  await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function waitForTarget() {
  return waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
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
        close() {
          socket.close()
        }
      })
    })
    socket.addEventListener('error', reject)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.rejectSend(new Error(message.error.message))
      else request.resolveSend(message.result)
    })
  })
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}

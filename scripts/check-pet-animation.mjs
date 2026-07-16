import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const states = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review'
]
const appearances = ['boba', 'lulu-capybara', 'shinchan', 'usagi']
const port = await availablePort()
const userDataPath = await mkdtemp(join(tmpdir(), 'studiumx-pet-animation-'))
const child = spawn(electronPath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataPath}`,
  'out/main/index.js'
], {
  detached: process.platform !== 'win32',
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  stdio: 'ignore'
})
const spawned = new Promise((resolve, reject) => {
  child.once('spawn', resolve)
  child.once('error', reject)
})
const childExit = new Promise((resolve) => {
  child.once('exit', (code, signal) => resolve({ code, signal }))
})
let client = null

try {
  await spawned
  const page = await withChildRunning(waitForPage(port), childExit)
  client = await withChildRunning(cdpClient(page.webSocketDebuggerUrl), childExit)
  try {
    const result = await withChildRunning(client.evaluate(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const waitFor = async (selector, timeout = 5000) => {
        const deadline = Date.now() + timeout
        while (Date.now() < deadline) {
          const element = document.querySelector(selector)
          if (element) return element
          await wait(100)
        }
        throw new Error('Timed out waiting for ' + selector + ': ' + document.body.innerText.slice(-800))
      }
      const waitForButtonText = async (labels, timeout = 5000) => {
        const deadline = Date.now() + timeout
        while (Date.now() < deadline) {
          const button = [...document.querySelectorAll('button')]
            .find((candidate) => labels.includes(candidate.innerText.trim()))
          if (button) return button
          await wait(100)
        }
        throw new Error('Timed out waiting for button text: ' + labels.join(', '))
      }
      const mascot = await waitFor('.app-pet-mascot')
      mascot.click()
      const assistantOpened = Boolean(await waitFor('#pet-assistant-dialog'))

      const resourceButton = await waitForButtonText(['资源', 'Resources'])
      resourceButton.click()
      const petButton = await waitFor('button[aria-label="宠物"], button[aria-label="Pet"]')
      petButton.click()
      await waitFor('.pet-preview-controls')

      const controls = [...document.querySelectorAll('.pet-preview-controls button')]
      const hoverResults = []
      for (const button of controls) {
        button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        await wait(30)
        hoverResults.push({
          control: button.dataset.state ?? null,
          sprite: document.querySelector('.pet-preview-mascot .pet-sprite')?.dataset.state ?? null
        })
      }

      const hash = (data) => {
        let value = 2166136261
        for (let index = 0; index < data.length; index += 1) {
          value ^= data[index]
          value = Math.imul(value, 16777619)
        }
        return value >>> 0
      }
      const atlases = []
      const activeFrameCounts = [6, 8, 8, 4, 5, 8, 6, 6, 6]
      for (const sprite of document.querySelectorAll('.pet-appearance-grid .pet-sprite')) {
        const background = getComputedStyle(sprite).backgroundImage
        const image = new Image()
        image.src = background.slice(5, -2)
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0)
        const rows = ${JSON.stringify(states)}.map((state, row) => {
          const frameHashes = Array.from({ length: activeFrameCounts[row] }, (_, frame) => hash(
            context.getImageData(frame * 192, row * 208, 192, 208).data
          ))
          return { state, activeFrames: activeFrameCounts[row], uniqueFrames: new Set(frameHashes).size }
        })
        atlases.push({
          appearance: sprite.dataset.appearance,
          backgroundSize: getComputedStyle(sprite).backgroundSize,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          rows
        })
      }
      return {
        assistantOpened,
        controls: controls.map((button) => button.dataset.state ?? null),
        hoverResults,
        atlases,
        layout: {
          clippedControls: controls
            .filter((button) => button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight)
            .map((button) => button.dataset.state),
          controlsOverflow: (() => {
            const panel = document.querySelector('.pet-preview-controls')
            return panel.scrollHeight > panel.clientHeight || panel.scrollWidth > panel.clientWidth
          })(),
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        }
      }
    })()`), childExit)

    assert.equal(result.assistantOpened, true, 'the built Electron renderer should open the Pet Assistant from the launcher')
    assert.deepEqual(result.controls, states, 'preview controls should expose all nine actions in atlas order')
    assert.deepEqual(
      result.hoverResults,
      states.map((state) => ({ control: state, sprite: state })),
      'hovering a preview action should display the action named by that control'
    )
    assert.deepEqual(result.layout.clippedControls, [], 'preview action names should not be clipped')
    assert.equal(result.layout.controlsOverflow, false, 'preview controls should fit inside their panel')
    assert.equal(result.layout.pageOverflow, false, 'the pet page should not introduce horizontal overflow')
    assert.equal(result.atlases.length, appearances.length, 'the pet page should expose every bundled atlas')
    assert.deepEqual(
      result.atlases.map((atlas) => atlas.appearance),
      appearances,
      'appearance cards should follow the shared pet catalog order'
    )
    for (const atlas of result.atlases) {
      assert.equal(atlas.naturalWidth, 1536, `${atlas.appearance} should contain eight 192px columns`)
      assert.equal(atlas.naturalHeight, 1872, `${atlas.appearance} should contain nine 208px rows`)
      assert.equal(atlas.backgroundSize, '800% 900%', `${atlas.appearance} should use the Codex v1 background grid`)
      assert.equal(atlas.rows.length, 9, `${atlas.appearance} should contain nine action rows`)
      for (const row of atlas.rows) {
        assert.equal(
          row.uniqueFrames,
          row.activeFrames,
          `${atlas.appearance}/${row.state} should preserve every Codex-active animation frame`
        )
      }
    }
  } finally {
    await client.close()
    client = null
  }
} finally {
  try {
    if (client) await client.close()
  } finally {
    try {
      await terminateElectron(child, childExit)
    } finally {
      await rm(userDataPath, { recursive: true, force: true })
    }
  }
}

console.log('check:pet-animation passed')

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForPage(port) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000)
      })
      const pages = await response.json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // Electron is still starting.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for the Electron renderer')
}

async function cdpClient(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out connecting to the Electron CDP endpoint'))
    }, 5_000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('Failed to connect to the Electron CDP endpoint'))
    }, { once: true })
  })

  let sequence = 0
  const pending = new Map()
  const rejectPending = (error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  socket.onmessage = ({ data }) => {
    let message
    try {
      message = JSON.parse(data)
    } catch (error) {
      rejectPending(new Error('Electron CDP returned invalid JSON', { cause: error }))
      return
    }
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
  }
  socket.onclose = (event) => {
    rejectPending(new Error(`Electron CDP disconnected (${event.code}${event.reason ? `: ${event.reason}` : ''})`))
  }
  socket.onerror = () => rejectPending(new Error('Electron CDP WebSocket error'))

  const send = (method, params = {}, timeout = 5_000) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error(`Electron CDP is not open while sending ${method}`))
      return
    }
    const id = ++sequence
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return
      reject(new Error(`Timed out waiting for Electron CDP method ${method}`))
    }, timeout)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    })
    try {
      socket.send(JSON.stringify({ id, method, params }))
    } catch (error) {
      pending.delete(id)
      clearTimeout(timer)
      reject(new Error(`Failed to send Electron CDP method ${method}`, { cause: error }))
    }
  })

  await send('Runtime.enable')
  return {
    evaluate: async (expression) => {
      const response = await send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        20_000
      )
      if (response.exceptionDetails) {
        const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
        throw new Error(`Electron renderer evaluation failed: ${detail}`)
      }
      return response.result.value
    },
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) return
      const closed = new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }))
      socket.close()
      await Promise.race([closed, delay(1_000)])
      rejectPending(new Error('Electron CDP client closed'))
    }
  }
}

function withChildRunning(operation, childExit) {
  return Promise.race([
    operation,
    childExit.then(({ code, signal }) => {
      throw new Error(`Electron exited before verification completed (code=${code}, signal=${signal ?? 'none'})`)
    })
  ])
}

async function terminateElectron(child, childExit) {
  if (!child.pid || !isChildTreeAlive(child)) return

  signalChildTree(child, 'SIGTERM')
  await Promise.race([childExit, delay(2_000)])
  if (!isChildTreeAlive(child)) return

  signalChildTree(child, 'SIGKILL')
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && isChildTreeAlive(child)) await delay(50)
  if (isChildTreeAlive(child)) {
    throw new Error(`Failed to terminate Electron process tree rooted at pid ${child.pid}`)
  }
}

function signalChildTree(child, signal) {
  if (!child.pid) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if (error?.code === 'ESRCH' || error?.code === 'EPERM') return
      throw error
    }
  }
  child.kill(signal)
}

function isChildTreeAlive(child) {
  if (!child.pid) return false
  if (process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null
  }
  try {
    process.kill(-child.pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'

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
const child = spawn(electronPath, [`--remote-debugging-port=${port}`, 'out/main/index.js'], {
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  stdio: 'ignore'
})

try {
  const page = await waitForPage(port)
  const client = await cdpClient(page.webSocketDebuggerUrl)
  try {
    const result = await client.evaluate(`(async () => {
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
    })()`)

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
    client.close()
  }
  console.log('check:pet-animation passed')
} finally {
  child.kill()
}

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
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the Electron renderer')
}

async function cdpClient(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  return {
    evaluate: async (expression) => {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
      return response.result.value
    },
    close: () => socket.close()
  }
}

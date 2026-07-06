import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appUrl = process.env.STUDIUMX_STUDY_URL ?? 'http://localhost:5173/'
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = Number(process.env.STUDIUMX_CHROME_DEBUG_PORT ?? 9233)
const timeoutMs = Number(process.env.STUDIUMX_STUDY_LIVE_TIMEOUT_MS ?? 30_000)
const pollMs = 1_500

await assertAppIsRunning(appUrl)

const userDataDir = await mkdtemp(join(tmpdir(), 'studiumx-study-presence-'))
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] })

let stderr = ''
let chromeClosed = false
const chromeClose = new Promise((resolve) => {
  chrome.once('close', () => {
    chromeClosed = true
    resolve()
  })
})
chrome.stderr.setEncoding('utf8')
chrome.stderr.on('data', (chunk) => {
  stderr += chunk
})

try {
  await waitForDebugger(debugPort)
  const result = await verifyTwoStudyClients(debugPort, appUrl, timeoutMs)

  assert.equal(result.clientA.hasStudy, true, 'first invite URL should open the study space view directly')
  assert.equal(result.clientB.hasStudy, true, 'second invite URL should open the study space view directly')
  assert.deepEqual(result.clientA.counts, ['2', '2', '1'], 'first client should see one local and one remote session')
  assert.deepEqual(result.clientB.counts, ['2', '2', '1'], 'second client should see one local and one remote session')
  assert.equal(result.clientA.remoteVerified, true, 'first client should show remote verification state')
  assert.equal(result.clientB.remoteVerified, true, 'second client should show remote verification state')
  assert.equal(result.clientA.liveLineCode, 'PEER', 'first client stage should surface the remote peer heartbeat')
  assert.equal(result.clientB.liveLineCode, 'PEER', 'second client stage should surface the remote peer heartbeat')
  assert.match(result.clientA.liveLineText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'first client live line should describe the remote peer seat and status')
  assert.match(result.clientB.liveLineText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'second client live line should describe the remote peer seat and status')
  assert.equal(result.clientA.pulseCode, 'PEER', 'first client arrival pulse should surface the remote peer heartbeat')
  assert.equal(result.clientB.pulseCode, 'PEER', 'second client arrival pulse should surface the remote peer heartbeat')
  assert.match(result.clientA.pulseText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'first client arrival pulse should describe the remote peer seat and status')
  assert.match(result.clientB.pulseText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'second client arrival pulse should describe the remote peer seat and status')
  assert.deepEqual(result.clientA.pulseStats, ['0', '1/1', '2/36'], 'first client arrival pulse should show real focus, heartbeat, and capacity stats')
  assert.deepEqual(result.clientB.pulseStats, ['0', '1/1', '2/36'], 'second client arrival pulse should show real focus, heartbeat, and capacity stats')
  assert.equal(result.clientA.heroPulseCode, 'PEER', 'first client hero should surface the remote peer heartbeat')
  assert.equal(result.clientB.heroPulseCode, 'PEER', 'second client hero should surface the remote peer heartbeat')
  assert.match(result.clientA.heroPulseText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'first client hero should describe the remote peer seat and status')
  assert.match(result.clientB.heroPulseText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'second client hero should describe the remote peer seat and status')
  assert.deepEqual(result.clientA.heroPulseStats, ['0 专注', '1/1 心跳', '2/36'], 'first client hero should show real focus, heartbeat, and capacity stats')
  assert.deepEqual(result.clientB.heroPulseStats, ['0 专注', '1/1 心跳', '2/36'], 'second client hero should show real focus, heartbeat, and capacity stats')
  assert.equal(result.clientA.boardCode, 'PEER', 'first client room board should surface the remote peer heartbeat')
  assert.equal(result.clientB.boardCode, 'PEER', 'second client room board should surface the remote peer heartbeat')
  assert.match(result.clientA.boardText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'first client room board should describe the remote peer seat and status')
  assert.match(result.clientB.boardText, /\d+号座.+专注|\d+号座.+暂停|\d+号座.+准备|\d+号座.+休息/, 'second client room board should describe the remote peer seat and status')
  assert.deepEqual(result.clientA.boardValues.slice(1, 3), ['1/1', '2/36'], 'first client room board should show real heartbeat and capacity values')
  assert.deepEqual(result.clientB.boardValues.slice(1, 3), ['1/1', '2/36'], 'second client room board should show real heartbeat and capacity values')
  assert.equal(result.clientA.boardRosterCount, 2, 'first client room board roster should include local and remote sessions')
  assert.equal(result.clientB.boardRosterCount, 2, 'second client room board roster should include local and remote sessions')
  assert.equal(result.clientA.arrivalOpen, false, 'first client advanced arrival/settings panel should be collapsed by default')
  assert.equal(result.clientB.arrivalOpen, false, 'second client advanced arrival/settings panel should be collapsed by default')
  assert.equal(result.clientA.roomSeatCount, 36, 'first client study room should render all live seats')
  assert.equal(result.clientB.roomSeatCount, 36, 'second client study room should render all live seats')
  assert.equal(result.clientA.roomAisleCount, 2, 'first client study room should render seat zone aisles')
  assert.equal(result.clientB.roomAisleCount, 2, 'second client study room should render seat zone aisles')
  assert.match(result.clientA.roomFrontText, /FOCUS BOARD/, 'first client study room should render a front room board')
  assert.match(result.clientB.roomFrontText, /FOCUS BOARD/, 'second client study room should render a front room board')
  assert.equal(result.clientA.companionHeroHasDebugCopy, false, 'first client companion hero should not show debug-style fake-user copy')
  assert.equal(result.clientB.companionHeroHasDebugCopy, false, 'second client companion hero should not show debug-style fake-user copy')
  assert.notEqual(result.clientA.sessionId, result.clientB.sessionId, 'clients should use distinct session identities')

  console.log(`study presence live ok: ${result.spaceCode}`)
} finally {
  if (!chromeClosed) chrome.kill('SIGTERM')
  await chromeClose
  await rm(userDataDir, { force: true, recursive: true })
}

async function assertAppIsRunning(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    assert.equal(response.ok, true)
  } catch (error) {
    throw new Error(`Study presence live check requires the dev server at ${url}. Start it with npm run dev.\n${error.message}`)
  }
}

async function waitForDebugger(port) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Chrome is still starting.
    }
    await delay(200)
  }
  throw new Error(`Chrome debugger did not start on port ${port}${stderr ? `\n${stderr}` : ''}`)
}

async function verifyTwoStudyClients(port, rootUrl, timeout) {
  const browserInfo = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json())
  const browser = await connect(browserInfo.webSocketDebuggerUrl)
  const spaceCode = `SX${Date.now().toString(36).slice(-6).toUpperCase()}`
  const inviteUrl = new URL(rootUrl)
  inviteUrl.searchParams.set('studySpace', spaceCode)
  inviteUrl.searchParams.set('studyRoom', 'silent')
  inviteUrl.searchParams.set('studyFreshSession', '1')

  const targetA = await browser.send('Target.createTarget', { url: inviteUrl.href })
  const targetB = await browser.send('Target.createTarget', { url: inviteUrl.href })
  await delay(1_000)

  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
  const clientA = await connect(targetWebSocket(tabs, targetA.targetId))
  const clientB = await connect(targetWebSocket(tabs, targetB.targetId))

  await Promise.all([
    clientA.send('Runtime.enable'),
    clientB.send('Runtime.enable'),
    clientA.send('Page.enable'),
    clientB.send('Page.enable')
  ])

  let lastA = null
  let lastB = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    await delay(pollMs)
    lastA = await readStudyPresence(clientA)
    lastB = await readStudyPresence(clientB)
    if (lastA.hasStudy && lastB.hasStudy && lastA.counts[2] === '1' && lastB.counts[2] === '1') break
  }

  clientA.close()
  clientB.close()
  browser.close()

  return { spaceCode, clientA: lastA, clientB: lastB }
}

function targetWebSocket(tabs, targetId) {
  const tab = tabs.find((item) => item.id === targetId)
  if (!tab) throw new Error(`Could not find Chrome target ${targetId}`)
  return tab.webSocketDebuggerUrl
}

async function readStudyPresence(client) {
  const result = await client.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const q = (selector) => document.querySelector(selector)
      const text = document.body.innerText
      const proofText = q('.study-online-proof')?.textContent ?? ''
      return {
        hasStudy: Boolean(q('.study-space')),
        heading: q('.study-arrival-live h2')?.textContent?.trim() ?? '',
        status: q('.study-relay-badge')?.textContent?.trim() ?? '',
        liveLineCode: q('.study-cinema-liveline span')?.textContent?.trim() ?? '',
        liveLineText: q('.study-cinema-liveline p')?.textContent?.trim() ?? '',
        pulseCode: q('.study-room-pulse-main > span')?.textContent?.trim() ?? '',
        pulseText: q('.study-room-pulse-main strong')?.textContent?.trim() ?? '',
        pulseStats: [...document.querySelectorAll('.study-room-pulse-stats strong')].map((node) => node.textContent.trim()),
        heroPulseCode: q('.study-hero-livebar > span')?.textContent?.trim() ?? '',
        heroPulseText: q('.study-hero-livebar strong')?.textContent?.trim() ?? '',
        heroPulseStats: [...document.querySelectorAll('.study-hero-livebar small')].map((node) => node.textContent.trim()),
        boardCode: q('.study-room-board-head > span')?.textContent?.trim() ?? '',
        boardText: q('.study-room-board-head strong')?.textContent?.trim() ?? '',
        boardValues: [...document.querySelectorAll('.study-room-board-grid strong')].map((node) => node.textContent.trim()),
        boardRosterCount: document.querySelectorAll('.study-room-board-roster span').length,
        arrivalOpen: q('.study-arrival')?.open ?? null,
        roomSeatCount: document.querySelectorAll('.study-seat-room .study-seat').length,
        roomAisleCount: document.querySelectorAll('.study-seat-room .study-seat-aisle').length,
        roomFrontText: q('.study-seat-front')?.textContent?.trim() ?? '',
        companionHeroHasDebugCopy: (q('.study-companion-hero')?.textContent ?? '').includes('未显示模拟同学'),
        counts: [...document.querySelectorAll('.study-arrival-counts strong')].map((node) => node.textContent.trim()),
        remoteVerified: text.includes('已见远端') || text.includes('已收到 1 个远端同桌') || text.includes('1 位远端同学刚刚心跳') || text.includes('1/1 心跳'),
        sessionId: proofText.match(/会话身份([A-Z0-9]+)/)?.[1] ?? '',
        text: text.slice(0, 800)
      }
    })()`
  })
  return result.result.value
}

function connect(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl)
  let id = 0

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  return opened.then(() => ({
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const callId = ++id
        const onMessage = (event) => {
          const data = JSON.parse(event.data)
          if (data.id !== callId) return
          ws.removeEventListener('message', onMessage)
          if (data.error) reject(new Error(JSON.stringify(data.error)))
          else resolve(data.result)
        }
        ws.addEventListener('message', onMessage)
        ws.send(JSON.stringify({ id: callId, method, params }))
      })
    },
    close() {
      ws.close()
    }
  }))
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

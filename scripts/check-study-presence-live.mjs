import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appUrl = process.env.STUDIUMX_STUDY_URL ?? 'http://localhost:5173/'
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = Number(process.env.STUDIUMX_CHROME_DEBUG_PORT ?? 9233)
const timeoutMs = Number(process.env.STUDIUMX_STUDY_LIVE_TIMEOUT_MS ?? 45_000)
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
  assert.deepEqual(result.clientA.counts, ['2', '3', '1'], 'first client should see two people in the room and three in the space')
  assert.deepEqual(result.clientB.counts, ['2', '3', '1'], 'second client should see two people in the room and three in the space')
  assert.equal(result.clientA.remoteVerified, true, 'first client should show remote verification state')
  assert.equal(result.clientB.remoteVerified, true, 'second client should show remote verification state')
  assert.equal(result.clientA.liveLineCode, 'OK', 'first client stage should surface the completed focus room event')
  assert.equal(result.clientB.liveLineCode, 'OK', 'second client stage should surface the completed focus room event')
  assert.match(result.clientA.liveLineText, /完成 5 分钟专注/, 'first client live line should describe the completed focus session')
  assert.match(result.clientB.liveLineText, /完成 5 分钟专注/, 'second client live line should describe the completed focus session')
  assert.match(result.clientA.focusCompletionEventText, /完成 5 分钟专注/, 'first client event stream should include the completed focus session')
  assert.match(result.clientB.focusCompletionEventText, /完成 5 分钟专注/, 'second client event stream should include the remote completed focus session')
  assert.equal(result.clientA.liveDeskRosterCount, 2, 'first client live desk should show local and remote classmates')
  assert.equal(result.clientB.liveDeskRosterCount, 2, 'second client live desk should show local and remote classmates')
  assert.match(result.clientA.liveDeskHeading, /2 个席位在线 · 0 人专注/, 'first client live desk should show real online and focus counts')
  assert.match(result.clientB.liveDeskHeading, /2 个席位在线 · 0 人专注/, 'second client live desk should show real online and focus counts')
  assert.match(result.clientA.liveDeskEventText, /完成 5 分钟专注/, 'first client live desk should show the completed focus event')
  assert.match(result.clientB.liveDeskEventText, /完成 5 分钟专注/, 'second client live desk should show the remote completed focus event')
  assert.equal(result.clientA.pulseCode, 'OK', 'first client arrival pulse should surface the completed focus room event')
  assert.equal(result.clientB.pulseCode, 'OK', 'second client arrival pulse should surface the completed focus room event')
  assert.match(result.clientA.pulseText, /完成 5 分钟专注/, 'first client arrival pulse should describe the completed focus session')
  assert.match(result.clientB.pulseText, /完成 5 分钟专注/, 'second client arrival pulse should describe the completed focus session')
  assert.deepEqual(result.clientA.pulseStats, ['0', '1/1', '2/36'], 'first client arrival pulse should show real focus, heartbeat, and capacity stats')
  assert.deepEqual(result.clientB.pulseStats, ['0', '1/1', '2/36'], 'second client arrival pulse should show real focus, heartbeat, and capacity stats')
  assert.equal(result.clientA.heroPulseCode, 'OK', 'first client hero should surface the completed focus room event')
  assert.equal(result.clientB.heroPulseCode, 'OK', 'second client hero should surface the completed focus room event')
  assert.match(result.clientA.heroPulseText, /完成 5 分钟专注/, 'first client hero should describe the completed focus session')
  assert.match(result.clientB.heroPulseText, /完成 5 分钟专注/, 'second client hero should describe the completed focus session')
  assert.deepEqual(result.clientA.heroPulseStats, ['0 专注', '1/1 心跳', '2/36'], 'first client hero should show real focus, heartbeat, and capacity stats')
  assert.deepEqual(result.clientB.heroPulseStats, ['0 专注', '1/1 心跳', '2/36'], 'second client hero should show real focus, heartbeat, and capacity stats')
  assert.equal(result.clientA.boardCode, 'OK', 'first client room board should surface the completed focus room event')
  assert.equal(result.clientB.boardCode, 'OK', 'second client room board should surface the completed focus room event')
  assert.match(result.clientA.boardText, /完成 5 分钟专注/, 'first client room board should describe the completed focus session')
  assert.match(result.clientB.boardText, /完成 5 分钟专注/, 'second client room board should describe the completed focus session')
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
  assert.equal(result.clientA.visibleTechCopy, false, 'first client default study UI should not expose MQTT/presence/session wording')
  assert.equal(result.clientB.visibleTechCopy, false, 'second client default study UI should not expose MQTT/presence/session wording')
  assert.equal(result.clientA.roomTabCount, 4, 'first client should render the live room navigator')
  assert.equal(result.clientB.roomTabCount, 4, 'second client should render the live room navigator')
  assert.equal(result.clientA.activeRoomTabMeta.includes('2/36'), true, 'first client active room tab should show live occupancy')
  assert.equal(result.clientB.activeRoomTabMeta.includes('2/36'), true, 'second client active room tab should show live occupancy')
  assert.match(result.clientA.activeRoomTabCycle, /专注|休息/, 'first client active room tab should show room cycle')
  assert.match(result.clientB.activeRoomTabCycle, /专注|休息/, 'second client active room tab should show room cycle')
  assert.equal(result.clientA.sprintRoomTabMeta.includes('1/32'), true, 'first client room directory should show a real classmate in another room')
  assert.equal(result.clientB.sprintRoomTabMeta.includes('1/32'), true, 'second client room directory should show a real classmate in another room')
  assert.match(result.clientA.sprintRoomTabActivity, /跨房间同学|冲刺教室/, 'first client room directory should show another room activity')
  assert.match(result.clientB.sprintRoomTabActivity, /跨房间同学|冲刺教室/, 'second client room directory should show another room activity')
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

  const clientA = await openStudyClient(browser, port, inviteUrl.href, seededStudySnapshot({
    nickname: '完成同学',
    spaceCode,
    roomId: 'silent',
    timerState: 'running',
    timerMode: 'focus',
    focusMinutes: 5,
    breakMinutes: 1,
    remainingSeconds: 18,
    contractText: '远端完成验证',
    contractLocked: true
  }))
  const clientB = await openStudyClient(browser, port, inviteUrl.href, seededStudySnapshot({
    nickname: '观察同学',
    spaceCode,
    roomId: 'silent',
    timerState: 'idle',
    timerMode: 'focus',
    focusMinutes: 5,
    breakMinutes: 1,
    remainingSeconds: 5 * 60,
    contractText: '',
    contractLocked: false
  }))
  const sprintUrl = new URL(inviteUrl.href)
  sprintUrl.searchParams.set('studyRoom', 'sprint')
  const clientC = await openStudyClient(browser, port, sprintUrl.href, seededStudySnapshot({
    nickname: '跨房间同学',
    spaceCode,
    roomId: 'sprint',
    modeId: 'sync',
    timerState: 'running',
    timerMode: 'focus',
    focusMinutes: 45,
    breakMinutes: 10,
    remainingSeconds: 45 * 60,
    contractText: '冲刺教室验证',
    contractLocked: true
  }))

  let lastA = null
  let lastB = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    await delay(pollMs)
    lastA = await readStudyPresence(clientA)
    lastB = await readStudyPresence(clientB)
    if (
      lastA.hasStudy
      && lastB.hasStudy
      && lastA.counts[2] === '1'
      && lastB.counts[2] === '1'
      && lastA.counts[1] === '3'
      && lastB.counts[1] === '3'
      && /完成 5 分钟专注/.test(lastA.focusCompletionEventText)
      && /完成 5 分钟专注/.test(lastB.focusCompletionEventText)
      && lastA.pulseStats[0] === '0'
      && lastB.pulseStats[0] === '0'
      && lastA.liveDeskRosterCount === 2
      && lastB.liveDeskRosterCount === 2
      && /完成 5 分钟专注/.test(lastA.liveDeskEventText)
      && /完成 5 分钟专注/.test(lastB.liveDeskEventText)
      && lastA.sprintRoomTabMeta.includes('1/32')
      && lastB.sprintRoomTabMeta.includes('1/32')
    ) break
  }

  await Promise.all([
    clientA.close(),
    clientB.close(),
    clientC.close()
  ])
  browser.close()

  return { spaceCode, clientA: lastA, clientB: lastB }
}

async function openStudyClient(browser, port, url, snapshot) {
  const context = await browser.send('Target.createBrowserContext')
  const target = await browser.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId: context.browserContextId
  })
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
  const client = await connect(targetWebSocket(tabs, target.targetId))
  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Page.enable')
  ])
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.localStorage.setItem('studiumx:study-space:v1', ${JSON.stringify(JSON.stringify(snapshot))});`
  })
  await client.send('Page.navigate', { url })
  await waitForStudyMount(client)
  return {
    send: client.send,
    async close() {
      client.close()
      await browser.send('Target.disposeBrowserContext', { browserContextId: context.browserContextId })
    }
  }
}

async function waitForStudyMount(client) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    const result = await client.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `Boolean(document.querySelector('.study-space'))`
    })
    if (result.result.value === true) return
    await delay(200)
  }
  throw new Error('Study space did not mount in Chrome tab')
}

function seededStudySnapshot(overrides) {
  return {
    clientId: 'studiumx-seeded-client',
    nickname: '验证同学',
    spaceCode: 'PUBLIC',
    presenceRelayUrl: 'wss://broker.emqx.io:8084/mqtt',
    signalId: 'reading',
    modeId: 'free',
    contractText: '',
    contractLocked: false,
    ambientEnabled: false,
    ambientVolume: 0.45,
    roomId: 'silent',
    seatIndex: 0,
    timerMode: 'focus',
    timerState: 'idle',
    focusMinutes: 5,
    breakMinutes: 1,
    remainingSeconds: 5 * 60,
    todayFocusSeconds: 0,
    todaySessions: 0,
    totalFocusSeconds: 0,
    totalSessions: 0,
    streakDays: 0,
    xp: 0,
    lastStudyDate: new Date().toISOString().slice(0, 10),
    tasks: [
      { id: 'verify', title: '验证远端完成动态', done: false }
    ],
    ...overrides
  }
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
        visibleTechCopy: [
          '.study-hero',
          '.study-room-stage',
          '.study-companion-hero',
          '.study-room-board',
          '.study-invite-note'
        ].some((selector) => /\\b(MQTT|presence|session)\\b/i.test(q(selector)?.textContent ?? '')),
        roomTabCount: document.querySelectorAll('.study-room-tab').length,
        activeRoomTabMeta: q('.study-room-tab.is-active .study-room-tab-meta')?.textContent?.trim() ?? '',
        activeRoomTabCycle: q('.study-room-tab.is-active .study-room-tab-cycle')?.textContent?.trim() ?? '',
        sprintRoomTabMeta: [...document.querySelectorAll('.study-room-tab')]
          .find((node) => /冲刺教室/.test(node.textContent ?? ''))
          ?.querySelector('.study-room-tab-meta')?.textContent?.trim() ?? '',
        sprintRoomTabActivity: [...document.querySelectorAll('.study-room-tab')]
          .find((node) => /冲刺教室/.test(node.textContent ?? ''))
          ?.querySelector('.study-room-tab-activity')?.textContent?.trim() ?? '',
        liveDeskHeading: q('.study-live-desk-head strong')?.textContent?.trim() ?? '',
        liveDeskRosterCount: [...document.querySelectorAll('.study-live-roster .study-live-peer')]
          .filter((node) => !node.classList.contains('is-empty')).length,
        liveDeskEventText: [...document.querySelectorAll('.study-live-events .study-live-event p')]
          .map((node) => node.textContent.trim())
          .find((item) => /完成 5 分钟专注/.test(item)) ?? '',
        focusCompletionEventText: [...document.querySelectorAll('.study-event-row.is-task_done p')]
          .map((node) => node.textContent.trim())
          .find((item) => /完成 5 分钟专注/.test(item)) ?? '',
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

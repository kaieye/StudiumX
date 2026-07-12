import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-workbench-theme-'))

try {
  const stylesHref = pathToFileURL(resolve('src/renderer/src/styles.css')).href
  const htmlPath = join(tempDir, 'workbench-theme.html')
  const electronMainPath = join(tempDir, 'main.cjs')

  await writeFile(
    htmlPath,
    `<!doctype html>
<html data-resolved-theme="dark" style="font-size: 120%">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${stylesHref}" />
  </head>
  <body>
    <main class="office-workbench-page">
      <aside class="workbench-tools">
        <form class="workbench-space-join">
          <svg></svg>
          <input value="FOCUS" />
          <button type="button">加入</button>
        </form>
        <section class="workbench-pomodoro-card is-focus">
          <div class="workbench-pomodoro-mode">
            <button class="is-active" type="button">专注</button>
            <button type="button">休息</button>
          </div>
          <div class="workbench-pomodoro-time">
            <strong>25:00</strong>
            <span>保持专注</span>
          </div>
          <div class="workbench-pomodoro-actions">
            <button class="is-primary" type="button">开始</button>
          </div>
        </section>
        <section class="workbench-task-card">
          <div class="workbench-task-head">
            <div><span>当前任务</span><strong>完成主题适配</strong></div>
          </div>
          <form class="workbench-task-form"><input value="新任务" /></form>
        </section>
      </aside>
    </main>
  </body>
</html>`,
    'utf8'
  )

  await writeFile(
    electronMainPath,
    `const { app, BrowserWindow } = require('electron')

const htmlPath = process.argv[2]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })

  await win.loadFile(htmlPath)
  const result = await win.webContents.executeJavaScript(String.raw\`
    (async () => {
      const styles = (selector) => {
        const computed = window.getComputedStyle(document.querySelector(selector))
        return {
          backgroundColor: computed.backgroundColor,
          color: computed.color,
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize
        }
      }

      const snapshot = () => ({
        root: styles(':root'),
        card: styles('.workbench-pomodoro-card'),
        modeButton: styles('.workbench-pomodoro-mode button:not(.is-active)'),
        timer: styles('.workbench-pomodoro-time strong'),
        timerDetail: styles('.workbench-pomodoro-time span'),
        primaryButton: styles('.workbench-pomodoro-actions .is-primary'),
        taskInput: styles('.workbench-task-form input'),
        joinIcon: styles('.workbench-space-join svg')
      })

      const dark = snapshot()
      document.documentElement.dataset.resolvedTheme = 'light'
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      return {
        dark,
        light: snapshot()
      }
    })()
  \`)

  console.log(JSON.stringify(result))
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
`,
    'utf8'
  )

  const result = await runElectron(electronMainPath, htmlPath)

  assert.equal(result.dark.card.color, 'rgb(242, 242, 243)', 'workbench cards should use dark theme text')
  assertSurfaceLightness(result.dark.card.backgroundColor, 'dark', 'workbench cards should use a dark theme surface')
  assert.equal(result.dark.timer.color, 'rgb(242, 242, 243)', 'timer should use the dark primary text color')
  assert.equal(result.dark.timerDetail.color, 'rgb(182, 182, 187)', 'timer detail should use dark muted text')
  assert.equal(result.dark.modeButton.color, 'rgb(182, 182, 187)', 'inactive controls should use dark muted text')
  assert.equal(result.dark.taskInput.color, 'rgb(242, 242, 243)', 'workbench inputs should use dark theme text')
  assert.equal(result.dark.joinIcon.color, 'rgb(138, 180, 255)', 'workbench accents should use the dark theme accent')
  assert.equal(result.dark.primaryButton.color, 'rgb(16, 19, 26)', 'dark theme accent buttons should use dark contrast text')

  assert.equal(result.light.card.color, 'rgb(36, 50, 74)', 'workbench cards should update to light theme text')
  assertSurfaceLightness(result.light.card.backgroundColor, 'light', 'workbench cards should update to a light theme surface')
  assert.equal(result.light.timerDetail.color, 'rgb(104, 119, 143)', 'timer detail should update to light muted text')
  assert.equal(result.light.taskInput.color, 'rgb(36, 50, 74)', 'workbench inputs should update to light theme text')
  assert.equal(result.light.joinIcon.color, 'rgb(79, 124, 245)', 'workbench accents should update to the light theme accent')
  assert.equal(result.light.primaryButton.color, 'rgb(255, 255, 255)', 'light theme accent buttons should use light contrast text')

  assert.equal(result.dark.timer.fontFamily, result.dark.root.fontFamily, 'timer typography should inherit the configured app font')
  assert.equal(result.dark.modeButton.fontSize, '13.2px', 'workbench text should follow the configured 120% font scale')

  console.log('check:workbench-theme passed')
} finally {
  await rm(tempDir, { force: true, recursive: true })
}

function assertSurfaceLightness(color, theme, message) {
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  const srgbMatch = color.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+\/\s+[\d.]+)?\)$/)
  assert.ok(rgbMatch || srgbMatch, `expected an rgb/rgba or color(srgb) color, got ${color}`)
  const channels = rgbMatch
    ? [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])]
    : [Number(srgbMatch[1]) * 255, Number(srgbMatch[2]) * 255, Number(srgbMatch[3]) * 255]
  const lightness = 0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]
  if (theme === 'dark') {
    assert.ok(lightness < 64, `${message}, got ${color}`)
    return
  }
  assert.ok(lightness > 200, `${message}, got ${color}`)
}

function runElectron(mainPath, htmlPath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(electronPath, [mainPath, htmlPath], {
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Electron exited with code ${code}\n${stderr}\n${stdout}`))
        return
      }

      const jsonLine = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('{'))
      if (!jsonLine) {
        reject(new Error(`Electron did not return computed styles\n${stderr}\n${stdout}`))
        return
      }
      resolveResult(JSON.parse(jsonLine))
    })
  })
}

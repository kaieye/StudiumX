import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-agent-process-dark-'))

try {
  const stylesHref = pathToFileURL(resolve('src/renderer/src/styles.css')).href
  const htmlPath = join(tempDir, 'agent-process-dark-theme.html')
  const electronMainPath = join(tempDir, 'main.cjs')

  await writeFile(
    htmlPath,
    `<!doctype html>
<html data-resolved-theme="dark">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${stylesHref}" />
  </head>
  <body>
    <section class="overview-dialog-shell has-conversation">
      <div class="overview-dialog-thread">
        <div class="overview-dialog-message is-assistant">
          <div class="agent-process-panel is-compact">
            <div class="agent-process-header">
              <svg></svg>
              <strong>思考过程</strong>
              <span>已记录</span>
            </div>
            <div class="agent-process-list">
              <div class="agent-process-event">
                <span class="agent-process-event-icon"><svg></svg></span>
                <div class="agent-process-event-copy">
                  <strong>工具完成：glob_workspace</strong>
                  <small>读取本地教学工作区。</small>
                  <div class="agent-process-tool-detail">
                    <button class="agent-process-tool-detail-trigger" type="button">
                      <span>查看工具结果</span>
                      <svg></svg>
                    </button>
                    <div class="tool-call-body is-inline">
                      <div class="tool-call-section">
                        <div>结果</div>
                        <pre>{"entries":[]}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="tool-call-card">
                <button class="tool-call-trigger" type="button">
                  <svg></svg>
                  <strong>glob_workspace</strong>
                  <span class="tool-call-state">完成</span>
                  <svg></svg>
                </button>
                <div class="tool-call-body">
                  <div class="tool-call-section">
                    <div>参数</div>
                    <pre>{"pattern":"**/*.md"}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  await win.loadFile(htmlPath)
  const result = await win.webContents.executeJavaScript(String.raw\`
    (() => {
      const color = (selector) => {
        const element = document.querySelector(selector)
        return window.getComputedStyle(element).color
      }
      const background = (selector) => {
        const element = document.querySelector(selector)
        return window.getComputedStyle(element).backgroundColor
      }

      return {
        panelBackground: background('.agent-process-panel'),
        headerTitle: color('.agent-process-header strong'),
        headerState: color('.agent-process-header span'),
        eventTitle: color('.agent-process-event-copy strong'),
        eventDetail: color('.agent-process-event-copy small'),
        detailTrigger: color('.agent-process-tool-detail-trigger'),
        detailTriggerIcon: color('.agent-process-tool-detail-trigger svg'),
        inlineBody: color('.tool-call-body.is-inline'),
        inlineBodyBackground: background('.tool-call-body.is-inline'),
        sectionLabel: color('.tool-call-section > div'),
        preText: color('.tool-call-section pre'),
        cardBackground: background('.tool-call-card'),
        cardTitle: color('.tool-call-trigger strong'),
        cardBody: color('.tool-call-card > .tool-call-body')
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

  for (const selector of ['eventTitle', 'headerTitle', 'cardTitle', 'preText']) {
    assertReadableText(selector, result[selector], 170)
  }

  for (const selector of ['headerState', 'eventDetail', 'detailTrigger', 'detailTriggerIcon', 'inlineBody', 'sectionLabel', 'cardBody']) {
    assertReadableText(selector, result[selector], 120)
  }

  for (const selector of ['panelBackground', 'inlineBodyBackground', 'cardBackground']) {
    assertDarkSurface(selector, result[selector])
  }

  console.log('check:agent-process-dark-theme passed')
} finally {
  await rm(tempDir, { force: true, recursive: true })
}

function assertReadableText(name, color, minimumLightness) {
  const lightness = perceivedLightness(color)
  assert.ok(
    lightness >= minimumLightness,
    `${name} should be readable light text in dark mode, got ${color}`
  )
}

function assertDarkSurface(name, color) {
  const lightness = perceivedLightness(color)
  assert.ok(lightness < 64, `${name} should be a dark surface, got ${color}`)
}

function perceivedLightness(color) {
  const { r, g, b, alpha } = parseCssColor(color)
  return (0.299 * r + 0.587 * g + 0.114 * b) * alpha
}

function parseCssColor(color) {
  const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  assert.ok(match, `expected an rgb/rgba color, got ${color}`)
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4])
  }
}

function runElectron(mainPath, htmlPath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(electronPath, [mainPath, htmlPath], {
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Electron exited with code ${code}\n${stderr}\n${stdout}`))
        return
      }

      const jsonLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .find((line) => line.startsWith('{'))

      if (!jsonLine) {
        reject(new Error(`Electron did not return computed styles\n${stderr}\n${stdout}`))
        return
      }

      resolveResult(JSON.parse(jsonLine))
    })
  })
}

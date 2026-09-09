import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-dark-neutral-'))

try {
  const stylesHref = pathToFileURL(resolve('src/renderer/src/styles.css')).href
  const settingsHref = pathToFileURL(resolve('src/renderer/src/settings-extra.css')).href
  const htmlPath = join(tempDir, 'dark-theme-neutrality.html')
  const electronMainPath = join(tempDir, 'main.cjs')

  await writeFile(
    htmlPath,
    `<!doctype html>
<html data-resolved-theme="dark">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${stylesHref}" />
    <link rel="stylesheet" href="${settingsHref}" />
  </head>
  <body>
    <div class="app-frame">
      <div class="window-titlebar"></div>
      <div class="app-shell">
        <aside class="sidebar"></aside>
        <main class="main-area" data-view="resources">
          <header class="topbar"></header>
          <section class="resource-page">
            <div class="style-gallery is-card-only">
              <div class="style-gallery-cards">
                <article class="style-card is-selected">
                  <button class="style-card-preview" type="button">
                    <span class="style-card-thumb"></span>
                    <span class="style-card-body">
                      <strong>Nightfall focus</strong>
                      <span>Low-glare dark theme.</span>
                    </span>
                  </button>
                </article>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
    <section class="settings-view">
      <nav class="settings-nav"></nav>
      <div class="settings-card"></div>
      <div class="segmented-control"></div>
      <div class="settings-select-menu"></div>
    </section>
    <section class="remove-dialog-backdrop">
      <section class="remove-dialog remove-dialog-confirmation" role="dialog" aria-modal="true">
        <div class="remove-dialog-header"><span class="remove-dialog-icon" aria-hidden="true"></span><h2>Remove workspace</h2></div>
        <p class="remove-dialog-detail">This removes the item from StudiumX. Files on disk are not deleted.</p>
        <div class="remove-dialog-footer">
          <button class="remove-dialog-cancel-button" type="button">Cancel</button>
          <button class="remove-dialog-confirm-button" type="button">Remove</button>
        </div>
      </section>
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
      const background = (selector) => {
        const element = document.querySelector(selector)
        return window.getComputedStyle(element).backgroundColor
      }

      return {
        body: background('body'),
        appFrame: background('.app-frame'),
        appShell: background('.app-shell'),
        mainArea: background('.main-area'),
        sidebar: background('.sidebar'),
        topbar: background('.topbar'),
        styleCard: background('.style-card'),
        settingsView: background('.settings-view'),
        settingsCard: background('.settings-card'),
        segmentedControl: background('.segmented-control'),
        settingsSelectMenu: background('.settings-select-menu'),
        removeDialog: background('.remove-dialog'),
        removeDialogBackdrop: background('.remove-dialog-backdrop'),
        removeDialogCancelButton: background('.remove-dialog-cancel-button'),
        removeDialogConfirmButton: background('.remove-dialog-confirm-button'),
        removeDialogIcon: background('.remove-dialog-header .remove-dialog-icon')
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

  // Accent chips and the danger confirm button are allowed to carry a tint
  // (amber/red) while still needing a dark surface; everything else must be
  // a neutral dark surface rather than blue-tinted.
  const darkOnly = (selector) => selector.endsWith('Icon') || selector === 'removeDialogConfirmButton'
  for (const [selector, color] of Object.entries(result)) {
    if (darkOnly(selector)) {
      assertDarkSurface(selector, color)
    } else {
      assertNeutralDarkSurface(selector, color)
    }
  }

  console.log('check:dark-theme-neutrality passed')
} finally {
  await rm(tempDir, { force: true, recursive: true })
}

function assertNeutralDarkSurface(name, color) {
  const { r, g, b, alpha } = parseCssColor(color)
  const blueDominance = b - Math.max(r, g)
  const channelSpread = Math.max(r, g, b) - Math.min(r, g, b)
  assertDarkSurface(name, color)
  assert.ok(
    blueDominance <= 4 && channelSpread <= 10,
    `${name} should be neutral black/gray rather than blue-tinted, got ${color}`
  )
}

function assertDarkSurface(name, color) {
  const { r, g, b, alpha } = parseCssColor(color)
  const perceivedLightness = (0.299 * r + 0.587 * g + 0.114 * b) * alpha

  assert.ok(
    perceivedLightness < 64,
    `${name} should be a dark surface, got ${color}`
  )
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

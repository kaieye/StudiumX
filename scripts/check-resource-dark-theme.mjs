import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-resource-theme-'))

try {
  const stylesHref = pathToFileURL(resolve('src/renderer/src/styles.css')).href
  const htmlPath = join(tempDir, 'resource-dark-theme.html')
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
    <main class="main-area" data-view="resources">
      <section class="resource-page">
        <div class="style-gallery is-card-only">
          <div class="style-gallery-cards">
            <article class="style-card is-selected">
              <button class="style-card-preview" type="button">
                <span class="style-card-thumb"></span>
                <span class="style-card-body">
                  <strong>Nightfall focus</strong>
                  <span>Low-glare dark theme that is easy on the eyes at night.</span>
                </span>
              </button>
              <button class="style-card-apply" type="button">Apply</button>
            </article>
          </div>
        </div>
      </section>
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  await win.loadFile(htmlPath)
  const result = await win.webContents.executeJavaScript(String.raw\`
    (() => {
      const styles = (selector) => {
        const element = document.querySelector(selector)
        const computed = window.getComputedStyle(element)
        return {
          backgroundColor: computed.backgroundColor,
          borderColor: computed.borderColor,
          color: computed.color
        }
      }

      return {
        resolvedTheme: document.documentElement.dataset.resolvedTheme,
        card: styles('.style-card'),
        title: styles('.style-card-body strong'),
        applyButton: styles('.style-card-apply')
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

  assert.equal(result.resolvedTheme, 'dark', 'fixture should render with dark mode enabled')
  assert.equal(
    result.card.backgroundColor,
    'rgb(24, 24, 27)',
    'resources style cards should use the dark solid surface, not a white card'
  )
  assert.equal(
    result.title.color,
    'rgb(242, 242, 243)',
    'resources style card titles should use the dark theme text color'
  )
  assert.equal(
    result.applyButton.backgroundColor,
    'rgba(80, 132, 255, 0.16)',
    'resources style card action buttons should use the dark accent surface'
  )

  console.log('check:resource-dark-theme passed')
} finally {
  await rm(tempDir, { force: true, recursive: true })
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

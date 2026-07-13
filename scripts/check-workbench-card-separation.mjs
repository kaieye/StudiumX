import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const tempDir = await mkdtemp(join(tmpdir(), 'studiumx-workbench-card-separation-'))

try {
  const stylesHref = pathToFileURL(resolve('src/renderer/src/styles.css')).href
  const htmlPath = join(tempDir, 'workbench-card-separation.html')
  const electronMainPath = join(tempDir, 'main.cjs')

  await writeFile(
    htmlPath,
    `<!doctype html>
<html data-resolved-theme="light">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${stylesHref}" />
    <style>
      html, body { width: 1200px; height: 720px; margin: 0; overflow: hidden; }
      .office-workbench-page,
      .office-workbench-stage { width: 1200px; height: 720px; }
      .office-workbench-stage {
        --workbench-tools-scale: 1;
        --workbench-tools-layout-height: 660px;
        --workbench-tools-gap: 28px;
        --workbench-card-width: 240px;
        background: rgb(42, 126, 214) !important;
      }
      .office-workbench-stage .workbench-tools { top: 30px; }
      .workbench-room-switcher,
      .workbench-pomodoro-card,
      .workbench-task-card { min-height: 120px; padding: 0; }
    </style>
  </head>
  <body>
    <main class="office-workbench-page">
      <section class="office-workbench-stage">
        <aside class="workbench-tools">
          <section class="workbench-room-switcher"></section>
          <section class="workbench-pomodoro-card"></section>
          <section class="workbench-task-card"></section>
        </aside>
      </section>
    </main>
  </body>
</html>`,
    'utf8'
  )

  await writeFile(
    electronMainPath,
    `const { app, BrowserWindow } = require('electron')

app.disableHardwareAcceleration()

const htmlPath = process.argv[2]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 720,
    useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })

  await win.loadFile(htmlPath)
  await new Promise((resolve) => setTimeout(resolve, 120))

  const geometry = await win.webContents.executeJavaScript(String.raw\`
    (() => {
      const stage = document.querySelector('.office-workbench-stage').getBoundingClientRect()
      const cards = [...document.querySelectorAll('.workbench-tools > *')].map((card) => {
        const rect = card.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      })
      return { stage: { left: stage.left, right: stage.right, top: stage.top }, cards }
    })()
  \`)

  const image = await win.webContents.capturePage()
  const size = image.getSize()
  const bitmap = image.toBitmap()
  const pixel = (x, y) => {
    const offset = (Math.round(y) * size.width + Math.round(x)) * 4
    return { b: bitmap[offset], g: bitmap[offset + 1], r: bitmap[offset + 2], a: bitmap[offset + 3] }
  }

  const samples = geometry.cards.slice(0, -1).map((card, index) => {
    const next = geometry.cards[index + 1]
    const x = (card.left + card.right) / 2
    const y = (card.bottom + next.top) / 2
    return { x, y, color: pixel(x, y) }
  })

  console.log(JSON.stringify({ samples, rightInset: geometry.stage.right - geometry.cards[0].right }))
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
`,
    'utf8'
  )

  const result = await runElectron(electronMainPath, htmlPath)
  assert.ok(
    result.rightInset >= 6 && result.rightInset <= 14,
    `right-side cards should sit close to the stage edge instead of covering the desks; got ${result.rightInset}px`
  )

  const expected = { r: 42, g: 126, b: 214 }
  for (const [index, sample] of result.samples.entries()) {
    const distance = Math.max(
      Math.abs(sample.color.r - expected.r),
      Math.abs(sample.color.g - expected.g),
      Math.abs(sample.color.b - expected.b)
    )
    assert.ok(
      distance <= 4,
      `gap ${index + 1} should expose the study-room background without a gray connection; got ${JSON.stringify(sample.color)}`
    )
  }

  console.log('check:workbench-card-separation passed')
} finally {
  await rm(tempDir, { force: true, recursive: true })
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
        reject(new Error(`Electron did not return card gap samples\n${stderr}\n${stdout}`))
        return
      }
      resolveResult(JSON.parse(jsonLine))
    })
  })
}

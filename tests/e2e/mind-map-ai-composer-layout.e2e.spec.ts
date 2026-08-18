import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function mindMapPanelStyles(): Promise<string> {
  const paths = [
    'src/renderer/src/styles/base.css',
    'src/renderer/src/styles/overview.css',
    'src/renderer/src/views/mindmap/mindmap.css'
  ]
  return (await Promise.all(paths.map((path) => readFile(resolve(repoRoot, path), 'utf8')))).join('\n')
}

test('keeps the AI composer and send button inside a 300px mind-map inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 })
  const styles = await mindMapPanelStyles()

  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          :root {
            --surface: #fff;
            --surface-solid: #fff;
            --surface-muted: #f5f6fa;
            --surface-subtle: #f4f5f8;
            --text: #1f2a44;
            --text-soft: #6e7d99;
            --text-muted: #7e8ca8;
            --line: #e4e7ed;
            --line-muted: #edf0f4;
            --accent: #4f7cf5;
            --accent-soft: #eaf0ff;
            --radius-md: 12px;
            --radius-sm: 8px;
            --radius-full: 999px;
            --space-xs: 6px;
            --space-sm: 8px;
            --rose-soft: #fff0f3;
            --rose: #e16281;
            --red: #e64848;
          }
          html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
          .mindmap-ai-composer-layout-app {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 300px;
            width: 100%;
            height: 100%;
          }
          .mindmap-inspector-header,
          .mindmap-inspector-tabs { flex: 0 0 44px; }
          ${styles}
        </style>
      </head>
      <body>
        <div class="mindmap-ai-composer-layout-app">
          <main></main>
          <aside class="mindmap-ai-panel">
            <div class="mindmap-inspector-header"></div>
            <div class="mindmap-inspector-tabs"></div>
            <div class="mindmap-inspector-tab-content mindmap-inspector-tab-content--ai">
              <div class="mindmap-ai-panel__conversation overview-dialog-shell has-conversation">
                <div class="mindmap-ai-panel__thread overview-dialog-thread">
                  <div class="mindmap-ai-panel__thread-inner">
                    <article class="mindmap-ai-panel__message mindmap-ai-panel__message--assistant overview-dialog-message is-assistant is-error">
                      The long provider error belongs in the scrollable transcript, not below the composer.
                    </article>
                  </div>
                </div>
                <form class="mindmap-ai-panel__composer overview-dialog-stack">
                  <div class="mindmap-ai-panel__composer-card overview-dialog-card">
                    <textarea class="mindmap-ai-panel__input">帮我根据资料分析的 md 文档生成思维导图</textarea>
                    <div class="mindmap-ai-panel__composer-footer">
                      <div class="mindmap-ai-panel__composer-actions">
                        <div class="overview-picker overview-model-picker">
                          <button class="overview-dialog-model" type="button">
                            <span>deepseek-v4-flash</span><svg></svg>
                          </button>
                        </div>
                        <div class="overview-picker overview-reasoning-picker">
                          <button class="overview-dialog-model overview-dialog-reasoning" type="button">
                            <span>自动</span><svg></svg>
                          </button>
                        </div>
                      </div>
                      <button class="mindmap-ai-panel__send overview-dialog-send" type="button">↗</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </aside>
        </div>
      </body>
    </html>`)

  const panel = await page.locator('.mindmap-ai-panel').boundingBox()
  const composer = await page.locator('.mindmap-ai-panel__composer-card').boundingBox()
  const send = await page.locator('.mindmap-ai-panel__send').boundingBox()

  expect(panel).not.toBeNull()
  expect(composer).not.toBeNull()
  expect(send).not.toBeNull()

  const panelBounds = panel!
  const composerBounds = composer!
  const sendBounds = send!
  expect(composerBounds.x).toBeGreaterThanOrEqual(panelBounds.x)
  expect(composerBounds.x + composerBounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width)
  expect(sendBounds.x).toBeGreaterThanOrEqual(panelBounds.x)
  expect(sendBounds.x + sendBounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width)
  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height)
})

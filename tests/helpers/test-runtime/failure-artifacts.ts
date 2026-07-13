import { writeFile } from 'node:fs/promises'
import type { TestRuntime } from '../test-runtime'

export interface FailureArtifactAttachment {
  name: string
  path: string
  contentType: string
}

export interface FailureArtifactSink {
  outputPath(fileName: string): string
  attach(attachment: FailureArtifactAttachment): Promise<void>
}

export interface FailureArtifactWindow {
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>
}

export interface FailureArtifactInput {
  windows: readonly FailureArtifactWindow[]
  runtime: TestRuntime
  sink: FailureArtifactSink
  consoleMessages: readonly string[]
  pageErrors?: readonly string[]
}

async function attachIfAvailable(
  sink: FailureArtifactSink,
  attachment: FailureArtifactAttachment
): Promise<void> {
  await sink.attach(attachment).catch(() => undefined)
}

export async function collectFailureArtifacts({
  windows,
  runtime,
  sink,
  consoleMessages,
  pageErrors = []
}: FailureArtifactInput): Promise<void> {
  await Promise.all(
    windows.map(async (window, index) => {
      const screenshotPath = sink.outputPath(`failure-window-${index + 1}.png`)
      const captured = await window
        .screenshot({ path: screenshotPath, fullPage: true })
        .then(() => true)
        .catch(() => false)
      if (captured) {
        await attachIfAvailable(sink, {
          name: `failure-window-${index + 1}`,
          path: screenshotPath,
          contentType: 'image/png'
        })
      }
    })
  )

  const logs = [...consoleMessages, ...pageErrors.map((message) => `[renderer:error] ${message}`)]
  if (logs.length > 0) {
    const consolePath = sink.outputPath('electron-console.log')
    const written = await writeFile(consolePath, `${logs.join('\n')}\n`, 'utf8')
      .then(() => true)
      .catch(() => false)
    if (written) {
      await attachIfAvailable(sink, {
        name: 'electron-console',
        path: consolePath,
        contentType: 'text/plain'
      })
    }
  }

  const runtimePath = sink.outputPath('test-runtime.json')
  const written = await writeFile(
    runtimePath,
    `${JSON.stringify({ paths: runtime.paths }, null, 2)}\n`,
    'utf8'
  )
    .then(() => true)
    .catch(() => false)
  if (written) {
    await attachIfAvailable(sink, {
      name: 'test-runtime',
      path: runtimePath,
      contentType: 'application/json'
    })
  }
}
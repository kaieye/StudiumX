import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectFailureArtifacts } from './test-runtime/failure-artifacts'
import { createTestRuntime, isPathInside, type TestRuntime } from './test-runtime'

const runtimes: TestRuntime[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.cleanup()))
})

async function runtime(label: string): Promise<TestRuntime> {
  const value = await createTestRuntime(label, { baseEnv: { PRESERVED_FOR_TEST: 'yes', HOME: 'host-home' } })
  runtimes.push(value)
  return value
}

describe('test runtime', () => {
  it('creates a complete disposable filesystem topology and projects it into a child environment', async () => {
    const isolated = await runtime('topology and env')

    for (const directory of Object.values(isolated.paths)) {
      await expect(access(directory)).resolves.toBeUndefined()
      expect(isPathInside(isolated.paths.root, directory)).toBe(true)
    }
    expect(isPathInside(isolated.paths.root, `${isolated.paths.root}-sibling`)).toBe(false)
    expect(isolated.env).toMatchObject({
      PRESERVED_FOR_TEST: 'yes',
      NODE_ENV: 'test',
      STUDIUMX_TEST: '1',
      HOME: isolated.paths.home,
      USERPROFILE: isolated.paths.home,
      APPDATA: isolated.paths.appData,
      LOCALAPPDATA: isolated.paths.localAppData,
      XDG_CONFIG_HOME: isolated.paths.appData,
      XDG_DATA_HOME: isolated.paths.localAppData,
      XDG_CACHE_HOME: isolated.paths.temp,
      TEMP: isolated.paths.temp,
      TMP: isolated.paths.temp,
      TMPDIR: isolated.paths.temp
    })
  })

  it('removes only its owned runtime directory and permits idempotent cleanup', async () => {
    const isolated = await runtime('cleanup')
    const root = isolated.paths.root

    await isolated.cleanup()
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(isolated.cleanup()).resolves.toBeUndefined()
  })

  it('collects screenshots, logs, and a non-secret runtime descriptor without masking artifact failures', async () => {
    const isolated = await runtime('failure-artifacts')
    const attachments: { name: string; path: string; contentType: string }[] = []
    const artifactDirectory = join(isolated.paths.temp, 'artifacts')
    await mkdir(artifactDirectory, { recursive: true })
    const sink = {
      outputPath: (name: string) => join(artifactDirectory, name),
      attach: async (attachment: { name: string; path: string; contentType: string }) => {
        attachments.push(attachment)
      }
    }

    await collectFailureArtifacts({
      runtime: isolated,
      sink,
      windows: [
        {
          screenshot: async ({ path }) => {
            await writeFile(path, 'png fixture')
          }
        },
        {
          screenshot: async () => {
            throw new Error('screenshot unavailable')
          }
        }
      ],
      consoleMessages: ['[main:error] main failure'],
      pageErrors: ['renderer failure']
    })

    expect(attachments.map((attachment) => attachment.name)).toEqual([
      'failure-window-1',
      'electron-console',
      'test-runtime'
    ])
    await expect(readFile(join(artifactDirectory, 'failure-window-1.png'), 'utf8')).resolves.toBe('png fixture')
    await expect(readFile(join(artifactDirectory, 'electron-console.log'), 'utf8')).resolves.toContain('[renderer:error] renderer failure')
    const descriptor = await readFile(join(artifactDirectory, 'test-runtime.json'), 'utf8')
    expect(JSON.parse(descriptor)).toMatchObject({ paths: { workspace: isolated.paths.workspace } })
    expect(descriptor).not.toContain('PRESERVED_FOR_TEST')
  })
})
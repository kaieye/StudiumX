import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

const TEST_RUNTIME_PREFIX = 'studiumx-test-'

export interface IsolatedTestRuntime {
  rootDir: string
  userDataDir: string
  appDataDir: string
  localAppDataDir: string
  homeDir: string
  tempDir: string
  workspaceDir: string
  env: Record<string, string>
  cleanup: () => Promise<void>
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const pathFromParent = relative(resolve(parentPath), resolve(candidatePath))
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

export async function createIsolatedTestRuntime(label = 'worker'): Promise<IsolatedTestRuntime> {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'worker'
  const rootDir = await mkdtemp(join(tmpdir(), `${TEST_RUNTIME_PREFIX}${safeLabel}-`))
  const userDataDir = join(rootDir, 'user-data')
  const homeDir = join(rootDir, 'home')
  const appDataDir = join(homeDir, 'AppData', 'Roaming')
  const localAppDataDir = join(homeDir, 'AppData', 'Local')
  const tempDir = join(rootDir, 'tmp')
  const workspaceDir = join(rootDir, 'workspace')
  const windowsKnownFolders = [
    join(homeDir, 'Desktop'),
    join(homeDir, 'Documents'),
    join(homeDir, 'Downloads')
  ]

  await Promise.all(
    [
      userDataDir,
      appDataDir,
      localAppDataDir,
      homeDir,
      tempDir,
      workspaceDir,
      ...windowsKnownFolders
    ].map((directory) =>
      mkdir(directory, { recursive: true })
    )
  )

  let cleanedUp = false
  return {
    rootDir,
    userDataDir,
    appDataDir,
    localAppDataDir,
    homeDir,
    tempDir,
    workspaceDir,
    env: Object.fromEntries(
      Object.entries({
        ...process.env,
        NODE_ENV: 'test',
        STUDIUMX_TEST: '1',
        HOME: homeDir,
        USERPROFILE: homeDir,
        APPDATA: appDataDir,
        LOCALAPPDATA: localAppDataDir,
        XDG_CONFIG_HOME: appDataDir,
        XDG_DATA_HOME: localAppDataDir,
        TEMP: tempDir,
        TMP: tempDir
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    cleanup: async () => {
      if (cleanedUp) return
      cleanedUp = true

      const resolvedRoot = resolve(rootDir)
      const resolvedSystemTemp = resolve(tmpdir())
      if (
        !isPathInside(resolvedSystemTemp, resolvedRoot) ||
        !basename(resolvedRoot).startsWith(TEST_RUNTIME_PREFIX)
      ) {
        throw new Error(`Refusing to remove unexpected test runtime path: ${resolvedRoot}`)
      }

      await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  }
}

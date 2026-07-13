import { lstat, mkdir, mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const TEST_RUNTIME_PREFIX = 'studiumx-test-runtime-'

export interface TestRuntimePaths {
  root: string
  userData: string
  home: string
  appData: string
  localAppData: string
  temp: string
  workspace: string
  desktop: string
  documents: string
  downloads: string
}

export interface TestRuntime {
  readonly paths: TestRuntimePaths
  readonly env: Record<string, string>
  cleanup(): Promise<void>
}

export interface CreateTestRuntimeOptions {
  baseEnv?: NodeJS.ProcessEnv
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const pathFromParent = relative(resolve(parentPath), resolve(candidatePath))
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'worker'
}

function projectEnvironment(paths: TestRuntimePaths, baseEnv: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...baseEnv,
      NODE_ENV: 'test',
      STUDIUMX_TEST: '1',
      HOME: paths.home,
      USERPROFILE: paths.home,
      HOMEDRIVE: paths.home.slice(0, 2),
      HOMEPATH: paths.home.slice(2) || paths.home,
      APPDATA: paths.appData,
      LOCALAPPDATA: paths.localAppData,
      XDG_CONFIG_HOME: paths.appData,
      XDG_DATA_HOME: paths.localAppData,
      XDG_CACHE_HOME: paths.temp,
      TEMP: paths.temp,
      TMP: paths.temp,
      TMPDIR: paths.temp
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

function isSafeRuntimeRoot(rootPath: string): boolean {
  const resolvedRoot = resolve(rootPath)
  const resolvedSystemTemp = resolve(tmpdir())
  return (
    isPathInside(resolvedSystemTemp, resolvedRoot) &&
    dirname(resolvedRoot) === resolvedSystemTemp &&
    basename(resolvedRoot).startsWith(TEST_RUNTIME_PREFIX)
  )
}

async function removeRuntimeRoot(rootPath: string): Promise<void> {
  if (!isSafeRuntimeRoot(rootPath)) {
    throw new Error(`Refusing to remove unexpected test runtime path: ${resolve(rootPath)}`)
  }

  const entry = await lstat(rootPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!entry) return

  if (entry.isSymbolicLink()) {
    await unlink(rootPath)
    return
  }

  await rm(rootPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

export async function createTestRuntime(
  label = 'worker',
  { baseEnv = process.env }: CreateTestRuntimeOptions = {}
): Promise<TestRuntime> {
  const root = await mkdtemp(join(resolve(tmpdir()), `${TEST_RUNTIME_PREFIX}${sanitizeLabel(label)}-`))
  const paths: TestRuntimePaths = {
    root,
    userData: join(root, 'user-data'),
    home: join(root, 'home'),
    appData: join(root, 'home', 'AppData', 'Roaming'),
    localAppData: join(root, 'home', 'AppData', 'Local'),
    temp: join(root, 'tmp'),
    workspace: join(root, 'workspace'),
    desktop: join(root, 'home', 'Desktop'),
    documents: join(root, 'home', 'Documents'),
    downloads: join(root, 'home', 'Downloads')
  }

  await Promise.all(Object.values(paths).map((directory) => mkdir(directory, { recursive: true })))

  let cleanedUp = false
  return {
    paths,
    env: projectEnvironment(paths, baseEnv),
    cleanup: async () => {
      if (cleanedUp) return
      await removeRuntimeRoot(paths.root)
      cleanedUp = true
    }
  }
}
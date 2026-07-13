import { createTestRuntime, isPathInside, type TestRuntime } from './test-runtime'

export interface IsolatedTestRuntime extends TestRuntime {
  readonly rootDir: string
  readonly userDataDir: string
  readonly appDataDir: string
  readonly localAppDataDir: string
  readonly homeDir: string
  readonly tempDir: string
  readonly workspaceDir: string
}

export async function createIsolatedTestRuntime(label = 'worker'): Promise<IsolatedTestRuntime> {
  const runtime = await createTestRuntime(label)
  return {
    ...runtime,
    rootDir: runtime.paths.root,
    userDataDir: runtime.paths.userData,
    appDataDir: runtime.paths.appData,
    localAppDataDir: runtime.paths.localAppData,
    homeDir: runtime.paths.home,
    tempDir: runtime.paths.temp,
    workspaceDir: runtime.paths.workspace
  }
}

export { isPathInside }
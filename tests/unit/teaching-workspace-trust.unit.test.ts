import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve()
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function createService(label: string) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  const registryPath = join(runtime.paths.appData, 'teaching-workspaces.json')
  return {
    registryPath,
    service: new TeachingWorkspaceService({
      registryPath,
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
  }
}

describe('TeachingWorkspaceService workspace trust availability', () => {
  it('serializes concurrent trust grants so different workspace updates both persist', async () => {
    const { service, registryPath } = await createService('concurrent-trust-mutations')
    const firstWorkspace = (await service.createWorkspace({ name: 'First workspace', prompt: 'Teach the first trust boundary.' })).activeWorkspace!
    const secondWorkspace = (await service.createWorkspace({ name: 'Second workspace', prompt: 'Teach the second trust boundary.' })).activeWorkspace!
    const internals = service as unknown as {
      ensureRegistry: () => Promise<unknown>
      saveRegistry: (registry: unknown) => Promise<void>
    }
    const originalEnsureRegistry = internals.ensureRegistry.bind(service)
    const originalSaveRegistry = internals.saveRegistry.bind(service)
    let persistedRegistry = structuredClone(await originalEnsureRegistry())
    const firstSaveEntered = deferred()
    const releaseFirstSave = deferred()
    let saveCalls = 0

    vi.spyOn(internals, 'ensureRegistry').mockImplementation(async () => structuredClone(persistedRegistry))
    vi.spyOn(internals, 'saveRegistry').mockImplementation(async (registry) => {
      saveCalls += 1
      if (saveCalls === 1) {
        firstSaveEntered.resolve()
        await releaseFirstSave.promise
      }
      persistedRegistry = structuredClone(registry)
      await originalSaveRegistry(registry)
    })

    const firstGrant = service.setWorkspaceTrust(firstWorkspace.id, 'trusted')
    await firstSaveEntered.promise
    const secondGrant = service.setWorkspaceTrust(secondWorkspace.id, 'trusted')

    try {
      await flushMicrotasks()
      // A second writer here would have read the same stale whole-file registry.
      expect(saveCalls).toBe(1)
    } finally {
      releaseFirstSave.resolve()
      await Promise.allSettled([firstGrant, secondGrant])
    }

    const persisted = JSON.parse(await readFile(registryPath, 'utf8')) as {
      workspaces: Array<{ id: string; agentWorkspaceTrust?: string }>
    }
    expect(persisted.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstWorkspace.id, agentWorkspaceTrust: 'trusted' }),
      expect.objectContaining({ id: secondWorkspace.id, agentWorkspaceTrust: 'trusted' })
    ]))
  })

  it('rejects archived trust mutation and requires re-import to restore the preserved grant', async () => {
    const { service, registryPath } = await createService('archived-trust-mutation')
    const workspace = (await service.createWorkspace({
      name: 'Archived trust boundary',
      prompt: 'Teach why trust grants must not be mutable while archived.'
    })).activeWorkspace!

    await service.setWorkspaceTrust(workspace.id, 'trusted')
    await service.setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: '', archived: true })
    const registryBeforeRejectedMutation = await readFile(registryPath, 'utf8')

    await expect(service.setWorkspaceTrust(workspace.id, 'untrusted')).rejects.toThrow('Workspace not found.')
    expect(await readFile(registryPath, 'utf8')).toBe(registryBeforeRejectedMutation)

    const restored = await service.importWorkspace(workspace.rootPath)
    expect(restored.activeWorkspace).toMatchObject({
      id: workspace.id,
      agentWorkspaceTrust: 'trusted'
    })
  })
})

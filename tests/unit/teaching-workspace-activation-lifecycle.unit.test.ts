import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

type RegistryFile = {
  activeWorkspaceId: string | null
  workspaces: Array<{ id: string; rootPath: string; archived?: boolean }>
}

async function createService(label: string) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  return {
    runtime,
    managedRoot,
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    service: new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
  }
}

async function readRegistry(registryPath: string): Promise<RegistryFile> {
  return JSON.parse(await readFile(registryPath, 'utf8')) as RegistryFile
}

async function readSessionKinds(rootPath: string): Promise<string[]> {
  const events = await readFile(join(rootPath, '.teachos', 'sessions.jsonl'), 'utf8')
  return events.trim().split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { kind: string }).kind)
}

describe('Teaching workspace activation lifecycle', () => {
  it('creates a default-targeted workspace with initial material, structure, registry selection, and session event', async () => {
    const { service, managedRoot, registryPath } = await createService('activation-create')

    const state = await service.createWorkspace({
      name: '  Graph Theory  ',
      prompt: '学习图论中的连通性'
    })
    const workspace = state.activeWorkspace

    expect(workspace).not.toBeNull()
    expect(workspace).toMatchObject({ name: 'Graph Theory', rootPath: join(managedRoot, 'graph-theory') })
    expect(state.selectedLessonPath).toBeNull()
    await expect(readFile(join(workspace!.rootPath, 'MISSION.md'), 'utf8')).resolves.toContain('图论中的连通性')
    await expect(readFile(join(workspace!.rootPath, 'RESOURCES.md'), 'utf8')).resolves.toContain('图论中的连通性 Resources')
    await expect(readFile(join(workspace!.rootPath, 'assets', 'lesson.css'), 'utf8')).resolves.toContain('body')
    await expect(readFile(join(workspace!.rootPath, '.teachos', 'index.json'), 'utf8')).resolves.toContain(workspace!.id)
    await expect(readSessionKinds(workspace!.rootPath)).resolves.toEqual(['workspace_created'])

    expect(await readRegistry(registryPath)).toMatchObject({
      activeWorkspaceId: workspace!.id,
      workspaces: [{ id: workspace!.id, rootPath: workspace!.rootPath }]
    })
  })

  it('re-imports an archived root idempotently, reselects it, and preserves its catalog material without a second initialization event', async () => {
    const { runtime, service, registryPath } = await createService('activation-import')
    const importedRoot = join(runtime.paths.workspace, 'imported-workspace')
    await mkdir(importedRoot, { recursive: true })

    const imported = await service.importWorkspace(importedRoot)
    const original = imported.activeWorkspace!
    const lessonPath = join(importedRoot, 'lessons', '0001-imported.html')
    await writeFile(lessonPath, '<!doctype html><html><body>Imported lesson</body></html>', 'utf8')

    const archived = await readRegistry(registryPath)
    archived.activeWorkspaceId = null
    archived.workspaces[0]!.archived = true
    await writeFile(registryPath, `${JSON.stringify(archived, null, 2)}\n`, 'utf8')

    const reimported = await service.importWorkspace(importedRoot)
    expect(reimported.activeWorkspace).toMatchObject({ id: original.id, rootPath: importedRoot })
    expect(reimported.activeWorkspace?.lessons).toEqual(expect.arrayContaining([
      expect.objectContaining({ absolutePath: lessonPath })
    ]))
    expect(reimported.selectedLessonPath).toBe(lessonPath)
    await expect(readSessionKinds(importedRoot)).resolves.toEqual(['workspace_imported'])

    const registry = await readRegistry(registryPath)
    expect(registry).toMatchObject({
      activeWorkspaceId: original.id,
      workspaces: [{ id: original.id, rootPath: importedRoot, archived: false }]
    })
  })

  it('rejects invalid and unavailable selections while leaving a valid active registry selection intact', async () => {
    const { service, registryPath } = await createService('activation-selection')
    const first = (await service.createWorkspace({ name: 'first', prompt: 'first prompt' })).activeWorkspace!
    const second = (await service.createWorkspace({ name: 'second', prompt: 'second prompt' })).activeWorkspace!
    const registryBeforeInvalidSelection = await readFile(registryPath, 'utf8')

    await expect(service.selectWorkspace('missing-workspace')).rejects.toThrow('Workspace not found.')
    expect(await readFile(registryPath, 'utf8')).toBe(registryBeforeInvalidSelection)

    await rm(second.rootPath, { recursive: true, force: true })
    await expect(service.selectWorkspace(second.id)).rejects.toThrow('Workspace not found.')

    const recovered = await service.getState()
    expect(recovered.activeWorkspace?.id).toBe(first.id)
    expect(await readRegistry(registryPath)).toMatchObject({
      activeWorkspaceId: first.id,
      workspaces: [{ id: first.id, rootPath: first.rootPath }]
    })
  })

  it('prunes unavailable roots during load and never retains a selected Lesson from the unavailable workspace', async () => {
    const { service, registryPath } = await createService('activation-load')
    const created = await service.createWorkspace({ name: 'temporary', prompt: 'temporary prompt' })
    const workspace = created.activeWorkspace!
    const lessonPath = join(workspace.rootPath, 'lessons', '0001-temporary.html')
    await writeFile(lessonPath, '<!doctype html><html><body>Temporary lesson</body></html>', 'utf8')

    const loadedWithLesson = await service.getState({ selectedLessonPath: lessonPath })
    expect(loadedWithLesson.activeWorkspace?.id).toBe(workspace.id)
    expect(loadedWithLesson.selectedLessonPath).toBe(lessonPath)

    await rm(workspace.rootPath, { recursive: true, force: true })
    const recovered = await service.getState({
      activeWorkspaceId: workspace.id,
      selectedLessonPath: lessonPath
    })

    expect(recovered.activeWorkspace?.id).not.toBe(workspace.id)
    expect(recovered.selectedLessonPath).toBeNull()
    expect(recovered.previewUrl).toBe('')
    expect((await readRegistry(registryPath)).workspaces).toHaveLength(1)
    expect((await readRegistry(registryPath)).workspaces[0]?.id).not.toBe(workspace.id)
  })
})

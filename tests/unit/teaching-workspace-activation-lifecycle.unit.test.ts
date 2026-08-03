import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type RegistryFile = {
  activeWorkspaceId: string | null
  workspaces: Array<{
    id: string
    rootPath: string
    pinned?: boolean
    archived?: boolean
    agentWorkspaceTrust?: unknown
    [key: string]: unknown
  }>
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

type WorkspaceLifecycleEvent = {
  id: string
  kind: string
  timestamp: string
  workspaceId: string
  traceId?: string
  prompt?: string
  paths?: string[]
}

async function readSessionEvents(rootPath: string): Promise<WorkspaceLifecycleEvent[]> {
  const events = await readFile(join(rootPath, '.studiumx', 'sessions.jsonl'), 'utf8')
  return events.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as WorkspaceLifecycleEvent)
}

async function readSessionKinds(rootPath: string): Promise<string[]> {
  return (await readSessionEvents(rootPath)).map((event) => event.kind)
}

describe('Teaching workspace activation lifecycle', () => {
  it('bootstraps the default workspace through first load with one traced workspace_created event', async () => {
    const { service, managedRoot, registryPath } = await createService('activation-bootstrap')

    const initial = await service.getState()
    const workspace = initial.activeWorkspace

    expect(workspace).not.toBeNull()
    expect(workspace).toMatchObject({ name: 'learn', rootPath: join(managedRoot, 'learn') })
    expect(initial.selectedLessonPath).toBeNull()
    const initialMission = await readFile(join(workspace!.rootPath, 'MISSION.md'), 'utf8')
    expect(initialMission).toContain('待确认学习主题')
    expect(initialMission).not.toContain('搭建个人化 AI 教学系统')
    await expect(readFile(join(workspace!.rootPath, '.studiumx', 'index.json'), 'utf8')).resolves.toContain(workspace!.id)

    const initialEvents = await readSessionEvents(workspace!.rootPath)
    const createdEvents = initialEvents.filter((event) => (
      event.kind === 'workspace_created' && event.workspaceId === workspace!.id
    ))
    expect(initialEvents).toHaveLength(1)
    expect(createdEvents).toHaveLength(1)
    expect(createdEvents[0]).toMatchObject({
      id: expect.stringMatching(UUID_RE),
      kind: 'workspace_created',
      timestamp: expect.any(String),
      workspaceId: workspace!.id,
      traceId: expect.stringMatching(UUID_RE),
      paths: ['MISSION.md', 'RESOURCES.md', 'assets/lesson.css', 'assets/quiz.js']
    })

    expect(await readRegistry(registryPath)).toMatchObject({
      activeWorkspaceId: workspace!.id,
      workspaces: [{ id: workspace!.id, rootPath: workspace!.rootPath }]
    })

    const sessionJsonlBeforeReload = await readFile(join(workspace!.rootPath, '.studiumx', 'sessions.jsonl'), 'utf8')
    const reloaded = await service.getState()
    expect(reloaded.activeWorkspace?.id).toBe(workspace!.id)
    expect(await readFile(join(workspace!.rootPath, '.studiumx', 'sessions.jsonl'), 'utf8')).toBe(sessionJsonlBeforeReload)
  })

  it('creates a default-targeted workspace with initial material, structure, registry selection, and session event', async () => {
    const { service, managedRoot, registryPath } = await createService('activation-create')

    const state = await service.createWorkspace({
      name: '  Graph Theory  ',
      prompt: '学习图论中的连通性'
    })
    const workspace = state.activeWorkspace

    expect(workspace).not.toBeNull()
    expect(workspace).toMatchObject({
      name: 'Graph Theory',
      rootPath: join(managedRoot, 'graph-theory'),
      agentWorkspaceTrust: 'untrusted'
    })
    expect(state.selectedLessonPath).toBeNull()
    await expect(readFile(join(workspace!.rootPath, 'MISSION.md'), 'utf8')).resolves.toContain('图论中的连通性')
    await expect(readFile(join(workspace!.rootPath, 'RESOURCES.md'), 'utf8')).resolves.toContain('图论中的连通性 Resources')
    await expect(readFile(join(workspace!.rootPath, 'assets', 'lesson.css'), 'utf8')).resolves.toContain('body')
    await expect(readFile(join(workspace!.rootPath, '.studiumx', 'index.json'), 'utf8')).resolves.toContain(workspace!.id)
    await expect(readSessionKinds(workspace!.rootPath)).resolves.toEqual(['workspace_created'])
    expect(await readSessionEvents(workspace!.rootPath)).toEqual([
      {
        id: expect.stringMatching(UUID_RE),
        kind: 'workspace_created',
        timestamp: expect.any(String),
        workspaceId: workspace!.id,
        traceId: expect.stringMatching(UUID_RE),
        prompt: '学习图论中的连通性',
        paths: ['MISSION.md', 'RESOURCES.md', 'assets/lesson.css', 'assets/quiz.js']
      }
    ])

    expect(await readRegistry(registryPath)).toMatchObject({
      activeWorkspaceId: workspace!.id,
      workspaces: [{ id: workspace!.id, rootPath: workspace!.rootPath }]
    })
  })

  it('defaults created and imported workspaces to untrusted and fails closed for malformed persisted trust', async () => {
    const { runtime, service, registryPath } = await createService('activation-trust-default')
    const created = (await service.createWorkspace({ name: 'Created', prompt: 'Create safely.' })).activeWorkspace!
    const importedRoot = join(runtime.paths.workspace, 'untrusted-import')
    await mkdir(importedRoot, { recursive: true })
    const imported = (await service.importWorkspace(importedRoot)).activeWorkspace!

    let registry = await readRegistry(registryPath)
    expect(registry.workspaces.find((workspace) => workspace.id === created.id)).not.toHaveProperty('agentWorkspaceTrust')
    expect(registry.workspaces.find((workspace) => workspace.id === imported.id)).not.toHaveProperty('agentWorkspaceTrust')
    await expect(readFile(join(imported.rootPath, '.studiumx', 'index.json'), 'utf8')).resolves.not.toContain('agentWorkspaceTrust')

    const importedRecord = registry.workspaces.find((workspace) => workspace.id === imported.id)!
    importedRecord.agentWorkspaceTrust = 'trusted-by-typo'
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')

    await service.getState()
    registry = await readRegistry(registryPath)
    expect(registry.workspaces.find((workspace) => workspace.id === imported.id)).not.toHaveProperty('agentWorkspaceTrust')
    await expect(service.setWorkspaceTrust(imported.id, 'invalid' as never)).rejects.toThrow(
      'Workspace trust must be trusted or untrusted.'
    )
  })

  it('persists explicit trust in application data and preserves it when the exact canonical root is re-imported', async () => {
    const { runtime, service, registryPath } = await createService('activation-trust-reimport')
    const importedRoot = join(runtime.paths.workspace, 'trusted-import')
    await mkdir(importedRoot, { recursive: true })
    const imported = (await service.importWorkspace(importedRoot)).activeWorkspace!

    const registryBeforeTrust = await readRegistry(registryPath)
    const recordBeforeTrust = registryBeforeTrust.workspaces.find((workspace) => workspace.id === imported.id)!
    recordBeforeTrust.pinned = true
    recordBeforeTrust.workspaceWriteEnabled = true
    recordBeforeTrust.permissionGrants = { workspace_write: ['notes'] }
    await writeFile(registryPath, `${JSON.stringify(registryBeforeTrust, null, 2)}\n`, 'utf8')

    const trustedState = await service.setWorkspaceTrust(imported.id, 'trusted')
    expect(trustedState.activeWorkspace?.agentWorkspaceTrust).toBe('trusted')
    let registry = await readRegistry(registryPath)
    expect(registry.workspaces.find((workspace) => workspace.id === imported.id)).toMatchObject({
      agentWorkspaceTrust: 'trusted',
      pinned: true,
      workspaceWriteEnabled: true,
      permissionGrants: { workspace_write: ['notes'] }
    })
    await expect(readFile(join(imported.rootPath, '.studiumx', 'index.json'), 'utf8')).resolves.not.toContain('agentWorkspaceTrust')

    registry.activeWorkspaceId = null
    registry.workspaces.find((workspace) => workspace.id === imported.id)!.archived = true
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')

    const reimported = await service.importWorkspace(importedRoot)
    expect(reimported.activeWorkspace).toMatchObject({ id: imported.id, rootPath: await realpath(importedRoot) })
    registry = await readRegistry(registryPath)
    expect(registry.workspaces.find((workspace) => workspace.id === imported.id)).toMatchObject({
      agentWorkspaceTrust: 'trusted',
      pinned: true,
      archived: false,
      workspaceWriteEnabled: true,
      permissionGrants: { workspace_write: ['notes'] }
    })
  })

  it('keeps case-distinct canonical roots separate so trust cannot transfer between them', async () => {
    const { runtime, service, registryPath } = await createService('activation-case-distinct-roots')
    const trustedRoot = join(runtime.paths.workspace, 'Trusted')
    const untrustedRoot = join(runtime.paths.workspace, 'trusted')
    await mkdir(trustedRoot, { recursive: true })
    const canCreateCaseDistinctRoot = await mkdir(untrustedRoot)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return false
        throw error
      })
    // Case-insensitive hosts cannot represent the two security principals this
    // regression covers, so only conditionally exercise the assertion there.
    if (!canCreateCaseDistinctRoot) return

    const trustedCanonicalRoot = await realpath(trustedRoot)
    const untrustedCanonicalRoot = await realpath(untrustedRoot)
    if (trustedCanonicalRoot === untrustedCanonicalRoot) return

    const trusted = (await service.importWorkspace(trustedRoot)).activeWorkspace!
    await service.setWorkspaceTrust(trusted.id, 'trusted')
    const untrusted = (await service.importWorkspace(untrustedRoot)).activeWorkspace!

    expect(untrusted.id).not.toBe(trusted.id)
    expect(untrusted.agentWorkspaceTrust).toBe('untrusted')
    const registry = await readRegistry(registryPath)
    expect(registry.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: trusted.id, rootPath: trustedCanonicalRoot, agentWorkspaceTrust: 'trusted' }),
      expect.objectContaining({ id: untrusted.id, rootPath: untrustedCanonicalRoot })
    ]))
  })

  it('canonicalizes junction/symlink imports so the physical root re-imports as the same workspace', async () => {
    const { runtime, service, registryPath } = await createService('activation-canonical-root')
    const physicalRoot = join(runtime.paths.workspace, 'physical-workspace')
    const importedAlias = join(runtime.paths.workspace, 'workspace-alias')
    await mkdir(physicalRoot, { recursive: true })
    await symlink(physicalRoot, importedAlias, process.platform === 'win32' ? 'junction' : 'dir')

    const fromAlias = (await service.importWorkspace(importedAlias)).activeWorkspace!
    const canonicalRoot = await realpath(physicalRoot)
    expect(fromAlias.rootPath).toBe(canonicalRoot)
    expect((await readRegistry(registryPath)).workspaces.find((workspace) => workspace.id === fromAlias.id)?.rootPath)
      .toBe(canonicalRoot)

    const nonCanonicalRegistry = await readRegistry(registryPath)
    nonCanonicalRegistry.workspaces.find((workspace) => workspace.id === fromAlias.id)!.rootPath = importedAlias
    await writeFile(registryPath, `${JSON.stringify(nonCanonicalRegistry, null, 2)}\n`, 'utf8')
    await service.getState()
    expect((await readRegistry(registryPath)).workspaces.find((workspace) => workspace.id === fromAlias.id)?.rootPath)
      .toBe(canonicalRoot)

    const fromPhysicalRoot = (await service.importWorkspace(physicalRoot)).activeWorkspace!
    expect(fromPhysicalRoot.id).toBe(fromAlias.id)
    expect((await readRegistry(registryPath)).workspaces.filter((workspace) => workspace.rootPath === canonicalRoot)).toHaveLength(1)
  })

  it('re-imports an archived root idempotently, reselects it, and preserves its catalog material without a second initialization event', async () => {
    const { runtime, service, registryPath } = await createService('activation-import')
    const importedRoot = join(runtime.paths.workspace, 'imported-workspace')
    await mkdir(importedRoot, { recursive: true })

    const imported = await service.importWorkspace(importedRoot)
    const original = imported.activeWorkspace!
    expect(await readSessionEvents(importedRoot)).toEqual([
      expect.objectContaining({
        kind: 'workspace_imported',
        workspaceId: original.id,
        traceId: expect.stringMatching(UUID_RE)
      })
    ])
    const sessionJsonlBeforeReimport = await readFile(join(importedRoot, '.studiumx', 'sessions.jsonl'), 'utf8')
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
    expect(await readFile(join(importedRoot, '.studiumx', 'sessions.jsonl'), 'utf8')).toBe(sessionJsonlBeforeReimport)

    const registry = await readRegistry(registryPath)
    expect(registry).toMatchObject({
      activeWorkspaceId: original.id,
      workspaces: [{ id: original.id, rootPath: importedRoot, archived: false }]
    })
  })

  it('rejects direct agent requests for archived workspace IDs before the conversation runtime can run', async () => {
    const { service } = await createService('activation-archived-agent-request')
    const workspace = (await service.createWorkspace({ name: 'Archived', prompt: 'Archive the workspace.' })).activeWorkspace!
    await service.setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: '', archived: true })

    await expect(service.agentChatStream({
      workspaceId: workspace.id,
      messages: [],
      userInput: 'This must not reach the agent runtime.'
    }, {
      streamId: 'archived-workspace-stream',
      onChunk: () => undefined,
      onStatus: () => undefined,
      onTool: () => undefined
    })).rejects.toThrow('Workspace not found.')
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

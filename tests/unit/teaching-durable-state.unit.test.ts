import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultSettings, TeachingSettingsService, type SettingsSecretStorage } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { loadWorkspaceIndex, saveWorkspaceIndex, type WorkspaceIndex } from '../../src/main/teaching-workspace/lifecycle'
import type { RegistryWorkspace } from '../../src/main/teaching-workspace/registry'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(label: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), `studiumx-${label}-`))
  roots.push(value)
  return value
}

function sealedStorage(calls?: { encrypt: number }): SettingsSecretStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      if (calls) calls.encrypt += 1
      return Buffer.from(`sealed:${value}`, 'utf8')
    },
    decryptString: (value) => {
      const decoded = value.toString('utf8')
      if (!decoded.startsWith('sealed:')) throw new Error('bad secret')
      return decoded.slice('sealed:'.length)
    }
  }
}

describe('critical durable JSON consumers', () => {
  it('does not rewrite, back up, or re-encrypt a healthy canonical settings document during load', async () => {
    const temp = await root('settings-valid-load')
    const userDataPath = join(temp, 'user-data')
    const defaultRoot = join(temp, 'workspace')
    const settingsPath = join(userDataPath, 'studiumx-settings.json')
    const calls = { encrypt: 0 }
    const storage = sealedStorage(calls)
    const initial = defaultSettings(defaultRoot)
    initial.provider.providers[0]!.apiKey = 'healthy-secret'
    await new TeachingSettingsService({ userDataPath, defaultRoot, secretStorage: storage }).save(initial)
    const canonicalBeforeLoad = await readFile(settingsPath, 'utf8')
    const encryptsBeforeLoad = calls.encrypt

    const loaded = await new TeachingSettingsService({ userDataPath, defaultRoot, secretStorage: storage }).load()

    expect(loaded.provider.providers[0]!.apiKey).toBe('healthy-secret')
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(canonicalBeforeLoad)
    await expect(readFile(`${settingsPath}.bak`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls.encrypt).toBe(encryptsBeforeLoad)
    if (process.platform !== 'win32') expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
  })

  it('persists an explicit settings canonicalization migration only when normalization changes a healthy object', async () => {
    const temp = await root('settings-canonicalization')
    const userDataPath = join(temp, 'user-data')
    const defaultRoot = join(temp, 'workspace')
    const settingsPath = join(userDataPath, 'studiumx-settings.json')
    const legacyShape = JSON.stringify({ workspace: { defaultRoot } })
    await mkdir(userDataPath, { recursive: true })
    await writeFile(settingsPath, legacyShape, 'utf8')

    const loaded = await new TeachingSettingsService({ userDataPath, defaultRoot }).load()

    expect(loaded.workspace.defaultRoot).toBe(defaultRoot)
    await expect(readFile(settingsPath, 'utf8')).resolves.toContain('"version": 2')
    await expect(readFile(`${settingsPath}.bak`, 'utf8')).resolves.toBe(legacyShape)
    if (process.platform !== 'win32') expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
    if (process.platform !== 'win32') expect((await stat(`${settingsPath}.bak`)).mode & 0o777).toBe(0o600)
  })

  it('migrates a legacy persisted tools.enabled false value to application-wide tool availability', async () => {
    const temp = await root('settings-tools-enabled-migration')
    const userDataPath = join(temp, 'user-data')
    const defaultRoot = join(temp, 'workspace')
    const settingsPath = join(userDataPath, 'studiumx-settings.json')
    const legacy = JSON.stringify({ version: 2, workspace: { defaultRoot }, tools: { enabled: false } })
    await mkdir(userDataPath, { recursive: true })
    await writeFile(settingsPath, legacy, 'utf8')

    const loaded = await new TeachingSettingsService({ userDataPath, defaultRoot }).load()

    expect(loaded.tools.enabled).toBe(true)
    await expect(readFile(settingsPath, 'utf8')).resolves.toContain('"enabled": true')
    await expect(readFile(`${settingsPath}.bak`, 'utf8')).resolves.toBe(legacy)
  })

  it('recovers encrypted settings secrets from a retained backup without restoring the damaged canonical file', async () => {
    const temp = await root('settings-backup')
    const userDataPath = join(temp, 'user-data')
    const defaultRoot = join(temp, 'workspace')
    const settingsPath = join(userDataPath, 'studiumx-settings.json')
    const storage = sealedStorage()
    const initial = defaultSettings(defaultRoot)
    initial.provider.providers[0]!.apiKey = 'retained-secret'
    const service = new TeachingSettingsService({ userDataPath, defaultRoot, secretStorage: storage })
    await service.save(initial)
    await service.patch({ theme: 'dark' })

    await expect(readFile(`${settingsPath}.bak`, 'utf8')).resolves.toContain('safeStorage:v1:')
    await writeFile(settingsPath, '{ invalid settings', 'utf8')

    const recovered = await new TeachingSettingsService({ userDataPath, defaultRoot, secretStorage: storage }).load()
    expect(recovered.provider.providers[0]!.apiKey).toBe('retained-secret')
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe('{ invalid settings')
    if (process.platform !== 'win32') expect((await stat(`${settingsPath}.bak`)).mode & 0o777).toBe(0o600)
  })

  it('replaces settings only after both canonical and retained backup are invalid', async () => {
    const temp = await root('settings-invalid-both')
    const userDataPath = join(temp, 'user-data')
    const defaultRoot = join(temp, 'workspace')
    const settingsPath = join(userDataPath, 'studiumx-settings.json')
    await mkdir(userDataPath, { recursive: true })
    await writeFile(settingsPath, '{ invalid settings', 'utf8')
    await writeFile(`${settingsPath}.bak`, '[]', 'utf8')

    const loaded = await new TeachingSettingsService({ userDataPath, defaultRoot }).load()

    expect(loaded.version).toBe(2)
    await expect(readFile(settingsPath, 'utf8')).resolves.toContain('"version": 2')
    await expect(readFile(`${settingsPath}.bak`, 'utf8')).resolves.toBe('[]')
  })

  it('uses a retained registry backup without auto-rewriting recovered state', async () => {
    const temp = await root('registry-backup')
    const registryPath = join(temp, 'app-data', 'teaching-workspaces.json')
    const workspaceRoot = join(temp, 'workspaces')
    const first = new TeachingWorkspaceService({
      registryPath,
      defaultRoot: workspaceRoot,
      settingsProvider: async () => defaultSettings(workspaceRoot)
    })
    const created = await first.createWorkspace({ name: 'retained registry', prompt: 'backup registry' })
    const retainedId = created.activeWorkspace!.id
    await first.createWorkspace({ name: 'newer registry', prompt: 'newer state creates backup' })
    await writeFile(registryPath, '{ invalid registry', 'utf8')

    const recovered = await new TeachingWorkspaceService({
      registryPath,
      defaultRoot: workspaceRoot,
      settingsProvider: async () => defaultSettings(workspaceRoot)
    }).getState()
    expect(recovered.workspaces.map((workspace) => workspace.id)).toEqual([retainedId])
    await expect(readFile(registryPath, 'utf8')).resolves.toBe('{ invalid registry')
    if (process.platform !== 'win32') expect((await stat(`${registryPath}.bak`)).mode & 0o777).toBe(0o600)
  })

  it('rebuilds a registry after both canonical and retained backup are invalid', async () => {
    const temp = await root('registry-invalid-both')
    const registryPath = join(temp, 'app-data', 'teaching-workspaces.json')
    const workspaceRoot = join(temp, 'workspaces')
    await mkdir(join(temp, 'app-data'), { recursive: true })
    await writeFile(registryPath, '{ invalid registry', 'utf8')
    await writeFile(`${registryPath}.bak`, '[]', 'utf8')

    const rebuilt = await new TeachingWorkspaceService({
      registryPath,
      defaultRoot: workspaceRoot,
      settingsProvider: async () => defaultSettings(workspaceRoot)
    }).getState()

    expect(rebuilt.workspaces).toHaveLength(1)
    await expect(readFile(registryPath, 'utf8')).resolves.toContain('"workspaces"')
    await expect(readFile(`${registryPath}.bak`, 'utf8')).resolves.toBe('[]')
  })

  it('reads a modern workspace index backup when the canonical document is invalid', async () => {
    const temp = await root('workspace-index-backup')
    const rootPath = join(temp, 'workspace')
    const workspace: RegistryWorkspace = {
      id: 'workspace-id',
      name: 'Backup workspace',
      rootPath,
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z'
    }
    const index = (updatedAt: string, lessons: WorkspaceIndex['lessons']): WorkspaceIndex => ({
      ...workspace,
      updatedAt,
      lessons
    })
    await saveWorkspaceIndex(rootPath, index('2026-07-17T00:00:00.000Z', []))
    await saveWorkspaceIndex(rootPath, index('2026-07-17T00:01:00.000Z', []))
    const modernPath = join(rootPath, '.studiumx', 'index.json')
    await writeFile(modernPath, '{ invalid modern index', 'utf8')

    await expect(loadWorkspaceIndex(workspace)).resolves.toMatchObject({ updatedAt: '2026-07-17T00:00:00.000Z' })
    await expect(readFile(modernPath, 'utf8')).resolves.toBe('{ invalid modern index')
    if (process.platform !== 'win32') expect((await stat(`${modernPath}.bak`)).mode & 0o777).toBe(0o600)
  })

  it('returns an empty workspace index when modern canonical and backup are both invalid', async () => {
    const temp = await root('workspace-index-invalid-both')
    const rootPath = join(temp, 'workspace')
    const workspace: RegistryWorkspace = {
      id: 'workspace-id',
      name: 'Broken workspace',
      rootPath,
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z'
    }
    const modernPath = join(rootPath, '.studiumx', 'index.json')
    await mkdir(join(rootPath, '.studiumx'), { recursive: true })
    await writeFile(modernPath, '{ invalid modern index', 'utf8')
    await writeFile(`${modernPath}.bak`, '[]', 'utf8')

    await expect(loadWorkspaceIndex(workspace)).resolves.toMatchObject({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      lessons: []
    })
    await expect(readFile(modernPath, 'utf8')).resolves.toBe('{ invalid modern index')
    await expect(readFile(`${modernPath}.bak`, 'utf8')).resolves.toBe('[]')
  })

  it('writes the temporary conversation index through the private durable replacement path without a backup', async () => {
    const temp = await root('temporary-conversation-index')
    const registryPath = join(temp, 'app-data', 'teaching-workspaces.json')
    const workspaceRoot = join(temp, 'workspaces')
    const service = new TeachingWorkspaceService({
      registryPath,
      defaultRoot: workspaceRoot,
      settingsProvider: async () => defaultSettings(workspaceRoot)
    })
    const saveTemporaryConversationIndex = (service as unknown as {
      saveTemporaryConversationIndex: (index: { pathMeta: Record<string, unknown> }) => Promise<void>
    }).saveTemporaryConversationIndex.bind(service)
    const indexPath = join(temp, 'app-data', 'conversations', '.index.json')

    await saveTemporaryConversationIndex({ pathMeta: {} })
    await saveTemporaryConversationIndex({ pathMeta: { 'conversation.md': { pinned: true } } })

    await expect(readFile(indexPath, 'utf8')).resolves.toContain('"conversation.md"')
    await expect(readFile(`${indexPath}.bak`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    if (process.platform !== 'win32') expect((await stat(indexPath)).mode & 0o777).toBe(0o600)
  })
})

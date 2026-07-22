import { execFile, spawnSync } from 'node:child_process'
import { link, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getWorkspaceWriteToolAvailability,
  runWorkspaceWriteWithDurableDependenciesForTesting,
  type WorkspaceWriteDurableDependencies
} from '../../src/main/ai/tools/workspace'
import { buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'

const roots: string[] = []
const execFileAsync = promisify(execFile)
const mkfifoUnavailable = (spawnSync('mkfifo', [], { stdio: 'ignore' }).error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
const sensitivePayload = 'PRIVATE-PAYLOAD-DO-NOT-LEAK'
const sensitiveTemporaryName = '.workspace-write-candidate-secret'
const sensitiveNativeDetail = 'RAW_NATIVE_DETAIL_DO_NOT_LEAK'
const overwriteTargetKinds = process.platform === 'win32'
  ? ['directory', 'hardlink'] as const
  : ['directory', 'symlink', 'hardlink'] as const

async function workspace(): Promise<{ root: string; ctx: ReturnType<typeof buildToolContext> }> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-workspace-write-tool-unit-'))
  roots.push(root)
  await mkdir(join(root, 'notes'), { recursive: true })
  return { root, ctx: buildToolContext(defaultSettings(root), { workspaceRoot: root }) }
}

function protocolError(kind: string, phase?: string): Error & { kind: string; phase?: string } {
  return Object.assign(
    new Error(`${sensitiveNativeDetail}: ${sensitiveTemporaryName}: ${sensitivePayload}`),
    { kind, ...(phase ? { phase } : {}) }
  )
}

function dependencies(
  overrides: Partial<WorkspaceWriteDurableDependencies> = {}
): WorkspaceWriteDurableDependencies {
  return {
    createNoOverwrite: async () => undefined,
    overwriteExistingRestricted: async () => undefined,
    ...overrides
  }
}

async function invoke(
  root: string,
  args: unknown,
  seam: WorkspaceWriteDurableDependencies
): Promise<Record<string, unknown>> {
  const result = await runWorkspaceWriteWithDurableDependenciesForTesting(
    args,
    buildToolContext(defaultSettings(root), { workspaceRoot: root }),
    seam
  )
  return JSON.parse(result) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('write_workspace_file C-4P8 S4 durable handler integration', () => {
  it.runIf(!getWorkspaceWriteToolAvailability().available)('withholds the write tool before permission when durable containment is unavailable', async () => {
    const { root } = await workspace()
    const requestToolPermission = vi.fn()
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.approvalMode = 'request_approval'

    expect(getWorkspaceWriteToolAvailability()).toEqual({
      available: false,
      code: 'containment_unavailable',
      message: '当前平台无法安全发布工作区文件。'
    })

    const registry = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
    expect(registry.names()).toContain('read_workspace_file')
    expect(registry.names()).not.toContain('write_workspace_file')

    const handlers = registry.handlerMap(buildToolContext(settings, {
      workspaceRoot: root,
      requestToolPermission
    }))
    expect(handlers.write_workspace_file).toBeUndefined()
    expect(requestToolPermission).not.toHaveBeenCalled()
    await expect(stat(join(root, 'notes', 'entry.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses pathname-default create and non-CAS overwrite on every host', async () => {
    const { root, ctx } = await workspace()
    const createdPath = join(root, 'notes', 'direct-created.md')
    const createdContent = 'Pathname create content 🧪'

    expect(getWorkspaceWriteToolAvailability()).toEqual({ available: true })
    expect(JSON.parse(await runWorkspaceWriteWithDurableDependenciesForTesting({
      path: 'notes/direct-created.md',
      content: createdContent
    }, ctx))).toMatchObject({
      path: 'notes/direct-created.md',
      created: true,
      overwritten: false
    })
    await expect(readFile(createdPath, 'utf8')).resolves.toBe(createdContent)

    const overwritePath = join(root, 'notes', 'direct-overwrite.md')
    await writeFile(overwritePath, 'old pathname bytes', 'utf8')
    const replacement = 'Pathname overwrite replacement 🧪'
    expect(JSON.parse(await runWorkspaceWriteWithDurableDependenciesForTesting({
      path: 'notes/direct-overwrite.md',
      content: replacement,
      overwrite: true
    }, ctx))).toMatchObject({
      path: 'notes/direct-overwrite.md',
      created: false,
      overwritten: true
    })
    await expect(readFile(overwritePath, 'utf8')).resolves.toBe(replacement)
  })

  it('uses S2 for a no-overwrite create with exact UTF-8 content and has no pathname-write fallback', async () => {
    const { root } = await workspace()
    const createNoOverwrite = vi.fn(async () => undefined)
    const content = `开始\n${'汉字🧪'.repeat(9_000)}\n结束`

    const result = await invoke(root, { path: 'notes/entry.md', content }, dependencies({ createNoOverwrite }))

    expect(createNoOverwrite).toHaveBeenCalledTimes(1)
    expect(createNoOverwrite).toHaveBeenCalledWith({
      workspaceRootPath: root,
      relativePath: 'notes/entry.md',
      content
    })
    expect(result).toMatchObject({
      path: 'notes/entry.md',
      bytes: Buffer.byteLength(content, 'utf8'),
      created: true,
      overwritten: false
    })
    await expect(stat(join(root, 'notes', 'entry.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('maps an S2 target_exists failure without falling back to a pathname write', async () => {
    const { root } = await workspace()
    const result = await invoke(root, {
      path: 'notes/entry.md',
      content: 'new bytes'
    }, dependencies({ createNoOverwrite: async () => { throw protocolError('target_exists') } }))

    expect(result).toMatchObject({ code: 'target_exists', path: 'notes/entry.md' })
    await expect(stat(join(root, 'notes', 'entry.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses S2 when overwrite:true targets an absent file', async () => {
    const { root } = await workspace()
    const createNoOverwrite = vi.fn(async () => undefined)
    const overwriteExistingRestricted = vi.fn(async () => undefined)

    const result = await invoke(root, {
      path: 'notes/entry.md',
      content: 'created through S2',
      overwrite: true
    }, dependencies({ createNoOverwrite, overwriteExistingRestricted }))

    expect(result).toMatchObject({ created: true, overwritten: false })
    expect(createNoOverwrite).toHaveBeenCalledTimes(1)
    expect(overwriteExistingRestricted).not.toHaveBeenCalled()
  })

  it('uses S3 only for an existing single-link regular file and has no pathname-write fallback', async () => {
    const { root } = await workspace()
    const target = join(root, 'notes', 'entry.md')
    await writeFile(target, 'old pathname bytes', 'utf8')
    const createNoOverwrite = vi.fn(async () => undefined)
    const overwriteExistingRestricted = vi.fn(async () => undefined)

    const result = await invoke(root, {
      path: 'notes/entry.md',
      content: 'new S3 bytes',
      overwrite: true
    }, dependencies({ createNoOverwrite, overwriteExistingRestricted }))

    expect(result).toMatchObject({ created: false, overwritten: true, path: 'notes/entry.md' })
    expect(overwriteExistingRestricted).toHaveBeenCalledTimes(1)
    expect(createNoOverwrite).not.toHaveBeenCalled()
    expect(await readFile(target, 'utf8')).toBe('old pathname bytes')
  })

  it.skipIf(process.platform === 'win32')(
    'uses S3 for a backslash input when its normalized target already exists',
    async () => {
      const { root } = await workspace()
      await writeFile(join(root, 'notes', 'entry.md'), 'existing canonical target', 'utf8')
      const createNoOverwrite = vi.fn(async () => undefined)
      const overwriteExistingRestricted = vi.fn(async () => undefined)

      const result = await invoke(root, {
        path: 'notes\\entry.md',
        content: 'replacement through S3',
        overwrite: true
      }, dependencies({ createNoOverwrite, overwriteExistingRestricted }))

      expect(result).toMatchObject({
        path: 'notes/entry.md',
        created: false,
        overwritten: true
      })
      expect(overwriteExistingRestricted).toHaveBeenCalledWith({
        workspaceRootPath: root,
        relativePath: 'notes/entry.md',
        content: 'replacement through S3'
      })
      expect(createNoOverwrite).not.toHaveBeenCalled()
    }
  )

  it.each(overwriteTargetKinds)(
    'rejects an overwrite target that is a %s before either durable publisher runs',
    async (kind) => {
      const { root } = await workspace()
      const target = join(root, 'notes', 'entry.md')

      if (kind === 'directory') {
        await mkdir(target)
      } else if (kind === 'symlink') {
        await symlink(join(root, 'outside.md'), target)
      } else {
        const firstName = join(root, 'notes', 'first.md')
        await writeFile(firstName, 'hard-linked original', 'utf8')
        await link(firstName, target)
      }

      const createNoOverwrite = vi.fn(async () => undefined)
      const overwriteExistingRestricted = vi.fn(async () => undefined)
      const result = await invoke(root, {
        path: 'notes/entry.md',
        content: 'must not publish',
        overwrite: true
      }, dependencies({ createNoOverwrite, overwriteExistingRestricted }))

      expect(result).toMatchObject({ code: 'path_rejected', path: 'notes/entry.md' })
      expect(createNoOverwrite).not.toHaveBeenCalled()
      expect(overwriteExistingRestricted).not.toHaveBeenCalled()
    }
  )

  it.skipIf(process.platform === 'win32' || mkfifoUnavailable)(
    'rejects an overwrite target that is another filesystem type (FIFO)',
    async () => {
      const { root } = await workspace()
      const target = join(root, 'notes', 'entry.md')
      await execFileAsync('mkfifo', [target])
      const createNoOverwrite = vi.fn(async () => undefined)
      const overwriteExistingRestricted = vi.fn(async () => undefined)

      const result = await invoke(root, {
        path: 'notes/entry.md',
        content: 'must not publish',
        overwrite: true
      }, dependencies({ createNoOverwrite, overwriteExistingRestricted }))

      expect(result).toMatchObject({ code: 'path_rejected', path: 'notes/entry.md' })
      expect(createNoOverwrite).not.toHaveBeenCalled()
      expect(overwriteExistingRestricted).not.toHaveBeenCalled()
    }
  )

  it('maps a raced S2 EEXIST to target_exists and preserves the competitor bytes', async () => {
    const { root } = await workspace()
    const target = join(root, 'notes', 'entry.md')
    const competitorBytes = 'competitor is authoritative'
    const publisherBytes = 'S2 must not overwrite competitor'
    const createNoOverwrite = vi.fn(async () => {
      await writeFile(target, competitorBytes, 'utf8')
      throw protocolError('target_exists')
    })

    const result = await invoke(root, { path: 'notes/entry.md', content: publisherBytes }, dependencies({ createNoOverwrite }))

    expect(result).toMatchObject({ code: 'target_exists', path: 'notes/entry.md' })
    expect(createNoOverwrite).toHaveBeenCalledTimes(1)
    expect(await readFile(target, 'utf8')).toBe(competitorBytes)
  })

  it.each([
    ['missing', 'target_missing'],
    ['changed type', 'target_not_restricted_regular']
  ])('maps S3 target %s to target_changed', async (_name, kind) => {
    const { root } = await workspace()
    await writeFile(join(root, 'notes', 'entry.md'), 'old bytes', 'utf8')

    const result = await invoke(root, {
      path: 'notes/entry.md',
      content: 'replacement',
      overwrite: true
    }, dependencies({ overwriteExistingRestricted: async () => { throw protocolError(kind) } }))

    expect(result).toMatchObject({ code: 'target_changed', path: 'notes/entry.md' })
  })

  it.each([
    ['S2 atomic no-clobber', false, 'atomic_no_clobber_unavailable'],
    ['S3 atomic exchange', true, 'atomic_exchange_unavailable']
  ])('maps unavailable %s capability to containment_unavailable', async (_name, overwrite, kind) => {
    const { root } = await workspace()
    if (overwrite) await writeFile(join(root, 'notes', 'entry.md'), 'old bytes', 'utf8')

    const result = await invoke(root, {
      path: 'notes/entry.md',
      content: 'new bytes',
      overwrite
    }, dependencies({
      createNoOverwrite: async () => { throw protocolError(kind) },
      overwriteExistingRestricted: async () => { throw protocolError(kind) }
    }))

    expect(result).toMatchObject({ code: 'containment_unavailable', path: 'notes/entry.md' })
  })

  it('maps pre-publication failures without publishing or exposing native detail', async () => {
    const { root } = await workspace()
    const result = await invoke(root, {
      path: 'notes/entry.md',
      content: sensitivePayload
    }, dependencies({ createNoOverwrite: async () => { throw protocolError('prepublication_failure', 'temporary_write') } }))

    expect(result).toMatchObject({ code: 'prepublication_failed', path: 'notes/entry.md' })
    expect(JSON.stringify(result)).not.toContain(sensitivePayload)
    expect(JSON.stringify(result)).not.toContain(sensitiveTemporaryName)
    expect(JSON.stringify(result)).not.toContain(sensitiveNativeDetail)
    await expect(stat(join(root, 'notes', 'entry.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('confirms a possibly-published result only with a full exact pathname UTF-8 read', async () => {
    const { root } = await workspace()
    const content = `首尾必须都在\n${'多字节🧪'.repeat(9_000)}\n完整结束`
    const expectedBytes = Buffer.from(content, 'utf8')
    const readExact = vi.fn(async () => true)

    const result = await invoke(root, { path: 'notes/entry.md', content }, dependencies({
      createNoOverwrite: async () => { throw protocolError('possibly_published') },
      readExact
    }))

    expect(result).toMatchObject({
      path: 'notes/entry.md',
      bytes: expectedBytes.byteLength,
      created: true,
      overwritten: false,
      possiblyPublished: true,
      canonicalRead: 'exact',
      retryable: false
    })
    expect(readExact).toHaveBeenCalledTimes(1)
    expect(readExact).toHaveBeenCalledWith({
      workspaceRootPath: root,
      relativePath: 'notes/entry.md',
      expectedBytes
    })
    expect(JSON.stringify(result)).not.toMatch(/durab|持久|耐久/i)
    await expect(stat(join(root, 'notes', 'entry.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['canonical mismatch', async () => false],
    ['canonical missing', async () => false],
    ['canonical read failure', async () => { throw protocolError('read_failure') }]
  ])('leaves possibly-published unconfirmed after %s', async (_name, readExact) => {
    const { root } = await workspace()

    const result = await invoke(root, { path: 'notes/entry.md', content: 'requested bytes' }, dependencies({
      createNoOverwrite: async () => { throw protocolError('possibly_published') },
      readExact
    }))

    expect(result).toMatchObject({
      code: 'possibly_published',
      path: 'notes/entry.md',
      retryable: false
    })
    expect(result).not.toHaveProperty('canonicalRead')
  })

  it.skipIf(!getWorkspaceWriteToolAvailability().available)('keeps pathname I/O detail private when an available writer cannot bind the target', async () => {
    const { root } = await workspace()
    const rawTargetPath = join(root, 'notes', 'entry.md')
    await rm(join(root, 'notes'), { recursive: true, force: true })
    await writeFile(join(root, 'notes'), 'not a directory', 'utf8')

    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.approvalMode = 'full_access'
    const handlers = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      .handlerMap(buildToolContext(settings, { workspaceRoot: root }))
    const handler = handlers.write_workspace_file
    expect(handler).toBeTypeOf('function')

    const result = JSON.parse(await handler!({
      path: 'notes/entry.md',
      content: 'must not reach publisher',
      overwrite: true
    })) as Record<string, unknown>
    const serialized = JSON.stringify(result)

    expect(result).toMatchObject({
      tool: 'write_workspace_file',
      code: 'containment_unavailable',
      error: '无法安全绑定工作区目标。'
    })
    expect(result).not.toHaveProperty('permission')
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain(rawTargetPath)
    expect(serialized).not.toContain('ENOTDIR')
    expect(serialized).not.toContain('lstat')
  })

  it.each([
    ['request_rejected', async (root: string) => invoke(root, { path: 'notes/entry.md' }, dependencies())],
    ['path_rejected', async (root: string) => invoke(root, { path: '../outside.md', content: sensitivePayload }, dependencies())],
    ['containment_unavailable', async (root: string) => invoke(root, { path: 'notes/entry.md', content: sensitivePayload }, dependencies({ createNoOverwrite: async () => { throw protocolError('atomic_no_clobber_unavailable') } }))],
    ['target_exists', async (root: string) => invoke(root, { path: 'notes/entry.md', content: sensitivePayload }, dependencies({ createNoOverwrite: async () => { throw protocolError('target_exists') } }))],
    ['target_changed', async (root: string) => {
      await writeFile(join(root, 'notes', 'entry.md'), 'existing bytes', 'utf8')
      return invoke(root, { path: 'notes/entry.md', content: sensitivePayload, overwrite: true }, dependencies({ overwriteExistingRestricted: async () => { throw protocolError('target_missing') } }))
    }],
    ['prepublication_failed', async (root: string) => invoke(root, { path: 'notes/entry.md', content: sensitivePayload }, dependencies({ createNoOverwrite: async () => { throw protocolError('prepublication_failure') } }))],
    ['possibly_published', async (root: string) => invoke(root, { path: 'notes/entry.md', content: sensitivePayload }, dependencies({
      createNoOverwrite: async () => { throw protocolError('possibly_published') },
      readExact: async () => false
    }))]
  ])('keeps stable %s errors private', async (code, action) => {
    const { root } = await workspace()
    const result = await action(root)
    const serialized = JSON.stringify(result)

    expect(result).toMatchObject({ code })
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain(sensitivePayload)
    expect(serialized).not.toContain(sensitiveTemporaryName)
    expect(serialized).not.toContain(sensitiveNativeDetail)
  })
})

import { lstat, mkdir, mkdtemp, open as openFile, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TeachingWorkspaceDocuments,
  type ResolvedTeachingWorkspace
} from '../../src/main/teaching-workspace-documents'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'

const roots: string[] = []

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

async function createWorkspace(): Promise<ResolvedTeachingWorkspace> {
  const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-workspace-documents-durable-'))
  roots.push(rootPath)
  return { id: 'workspace-documents-durable', rootPath }
}

function instrumentedDurableOperations(options: {
  fail?: (event: string) => Error | undefined
  onEvent?: (event: string) => void | Promise<void>
} = {}): {
  operations: DurableFileOperations
  events: string[]
  modes: Array<{ path: string; mode: number | undefined }>
} {
  const events: string[] = []
  const modes: Array<{ path: string; mode: number | undefined }> = []
  const observe = async (event: string): Promise<void> => {
    events.push(event)
    await options.onEvent?.(event)
    const failure = options.fail?.(event)
    if (failure) throw failure
  }
  const operations: DurableFileOperations = {
    mkdir,
    readFile,
    open: async (path, flags, mode) => {
      await observe(`open:${flags}:${path}`)
      modes.push({ path, mode })
      const handle = await openFile(path, flags, mode)
      return {
        writeFile: async (content) => {
          await observe(`write:${path}`)
          await handle.writeFile(content)
        },
        sync: async () => {
          await observe(`sync:${path}`)
          // Windows cannot fsync directory handles. The production primitive
          // downgrades that native capability gap; retain injected faults above.
          if (process.platform === 'win32' && (await handle.stat()).isDirectory()) return
          await handle.sync()
        },
        close: async () => {
          const event = `close:${path}`
          events.push(event)
          await options.onEvent?.(event)
          const failure = options.fail?.(event)
          await handle.close()
          if (failure) throw failure
        }
      }
    },
    rename: async (from, to) => {
      await observe(`rename:${from}->${to}`)
      await rename(from, to)
    },
    rm
  }
  return { operations, events, modes }
}

function durableCandidate(events: readonly string[]): string {
  const event = events.find((item) => item.startsWith('open:wx:') && item.endsWith('.tmp'))
  if (!event) throw new Error('Missing durable Markdown temporary candidate.')
  return event.slice('open:wx:'.length)
}

async function temporaryFiles(rootPath: string): Promise<string[]> {
  const visit = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return visit(path)
      return entry.name.endsWith('.tmp') ? [relative(rootPath, path)] : []
    }))
    return nested.flat()
  }
  return visit(rootPath)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

describe('TeachingWorkspaceDocuments durable Markdown publication', () => {
  it('uses the shared user-readable same-directory publisher and returns existing metadata readback facts', async () => {
    const workspace = await createWorkspace()
    const documents = new TeachingWorkspaceDocuments()
    const targetPath = join(workspace.rootPath, 'courses', 'durable-course', 'notes.md')
    const durable = instrumentedDurableOperations()
    const content = '# Durable notes\n\nMarkdown bytes stay exact.\n'

    const saved = await documents.saveMarkdown(workspace, 'courses/durable-course/notes.md', content, {
      durableFileOperations: durable.operations
    })

    const candidate = durableCandidate(durable.events)
    const directory = dirname(targetPath)
    expect(dirname(candidate)).toBe(directory)
    expect(durable.events).toEqual([
      `open:wx:${candidate}`,
      `write:${candidate}`,
      `sync:${candidate}`,
      `close:${candidate}`,
      `rename:${candidate}->${targetPath}`,
      `open:r:${directory}`,
      `sync:${directory}`,
      `close:${directory}`
    ])
    expect(durable.modes).toContainEqual({ path: candidate, mode: 0o666 })
    expect(saved).toMatchObject({
      title: 'Durable notes',
      relativePath: 'courses/durable-course/notes.md',
      absolutePath: targetPath,
      content
    })
    expect(saved.updatedAt).toEqual(expect.any(String))
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(content)
    await expect(documents.readMarkdown(workspace, 'courses/durable-course/notes.md')).resolves.toMatchObject(saved)
    expect((await stat(targetPath)).mode & 0o777).toBe(0o666 & ~process.umask() & 0o777)
    await expect(temporaryFiles(workspace.rootPath)).resolves.toEqual([])
  })

  it.each([
    ['write', (event: string, candidate: string, targetPath: string) => event === `write:${candidate}`],
    ['file sync', (event: string, candidate: string, targetPath: string) => event === `sync:${candidate}`],
    ['file close', (event: string, candidate: string, targetPath: string) => event === `close:${candidate}`],
    ['rename', (event: string, candidate: string, targetPath: string) => event === `rename:${candidate}->${targetPath}`]
  ])('rejects and preserves the prior Markdown when durable %s fails before rename', async (_name, matches) => {
    const workspace = await createWorkspace()
    const documents = new TeachingWorkspaceDocuments()
    const targetPath = join(workspace.rootPath, 'NOTES.md')
    const oldContent = '# Previous notes\n'
    await writeFile(targetPath, oldContent, 'utf8')
    let candidate = ''
    const durable = instrumentedDurableOperations({
      fail: (event) => matches(event, candidate, targetPath) ? errno('EIO') : undefined,
      onEvent: (event) => {
        if (event.startsWith('open:wx:')) candidate = event.slice('open:wx:'.length)
      }
    })

    await expect(documents.saveMarkdown(workspace, 'NOTES.md', '# Next notes\n', {
      durableFileOperations: durable.operations
    })).rejects.toMatchObject({ code: 'EIO' })

    await expect(readFile(targetPath, 'utf8')).resolves.toBe(oldContent)
    await expect(temporaryFiles(workspace.rootPath)).resolves.toEqual([])
    expect(durable.events).not.toContain(`sync:${workspace.rootPath}`)
  })

  it.each([
    ['directory sync EIO', (event: string, directory: string) => event === `sync:${directory}`, errno('EIO')],
    ['directory sync EACCES', (event: string, directory: string) => event === `sync:${directory}`, errno('EACCES')],
    ['directory sync EPERM', (event: string, directory: string) => event === `sync:${directory}`, errno('EPERM')],
    ['directory sync unknown error', (event: string, directory: string) => event === `sync:${directory}`, new Error('unexpected directory failure')],
    ['directory close', (event: string, directory: string) => event === `close:${directory}`, errno('EIO')]
  ])('fails closed for fatal post-rename %s failures without rolling back Markdown', async (_name, matches, failure) => {
    const workspace = await createWorkspace()
    const documents = new TeachingWorkspaceDocuments()
    const targetPath = join(workspace.rootPath, 'NOTES.md')
    const durable = instrumentedDurableOperations({
      fail: (event) => matches(event, workspace.rootPath) ? failure : undefined
    })

    await expect(documents.saveMarkdown(workspace, 'NOTES.md', '# Published before fsync failure\n', {
      durableFileOperations: durable.operations
    })).rejects.toBe(failure)

    expect(durable.events).toContain(`rename:${durableCandidate(durable.events)}->${targetPath}`)
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('# Published before fsync failure\n')
    await expect(temporaryFiles(workspace.rootPath)).resolves.toEqual([])
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'downgrades only the shared directory-fsync capability error %s with a path-free warning',
    async (code) => {
      const workspace = await createWorkspace()
      const documents = new TeachingWorkspaceDocuments()
      const warnings: string[] = []
      const durable = instrumentedDurableOperations({
        fail: (event) => event === `sync:${workspace.rootPath}` ? errno(code) : undefined
      })

      await expect(documents.saveMarkdown(workspace, 'NOTES.md', '# Allowed directory capability\n', {
        durableFileOperations: durable.operations,
        durableWarn: (message) => warnings.push(message)
      })).resolves.toMatchObject({ content: '# Allowed directory capability\n' })

      expect(warnings).toEqual(['[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'])
      expect(warnings[0]).not.toContain(workspace.rootPath)
      await expect(readFile(join(workspace.rootPath, 'NOTES.md'), 'utf8')).resolves.toBe('# Allowed directory capability\n')
      await expect(temporaryFiles(workspace.rootPath)).resolves.toEqual([])
    }
  )

  it('rejects symlinked parents but replaces a final target symlink without following it', async () => {
    const workspace = await createWorkspace()
    const documents = new TeachingWorkspaceDocuments()
    const outsideRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-documents-outside-'))
    roots.push(outsideRoot)
    const outsideTarget = join(outsideRoot, 'outside.md')
    await writeFile(outsideTarget, '# Outside remains untouched\n', 'utf8')
    const targetPath = join(workspace.rootPath, 'NOTES.md')
    try {
      await symlink(outsideTarget, targetPath)
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(documents.saveMarkdown(workspace, 'NOTES.md', '# Replaced safely\n')).resolves.toMatchObject({
      content: '# Replaced safely\n'
    })
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(false)
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('# Replaced safely\n')
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('# Outside remains untouched\n')

    const secondWorkspace = await createWorkspace()
    const durable = instrumentedDurableOperations()
    await symlink(outsideRoot, join(secondWorkspace.rootPath, 'courses'))
    await expect(documents.saveMarkdown(secondWorkspace, 'courses/escaped.md', '# Must not escape\n', {
      durableFileOperations: durable.operations
    })).rejects.toThrow('Workspace document resolves outside the workspace.')
    expect(durable.events).toEqual([])
  })
})

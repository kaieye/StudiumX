import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readValidatedWithBackup,
  replaceDurably,
  replaceWithBackup,
  type DurableFileOperations
} from '../../src/main/persistence/durable-file'

const roots: string[] = []
const isVersioned = (value: unknown): value is { version: number } =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof (value as { version?: unknown }).version === 'number'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryFile(name = 'state.json'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-durable-file-'))
  roots.push(root)
  return join(root, name)
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function memoryOperations(options: {
  fail?: (event: string) => Error | undefined
  onEvent?: (event: string, value?: string) => void | Promise<void>
} = {}): {
  operations: DurableFileOperations
  files: Map<string, string>
  events: string[]
  modes: Array<{ path: string; mode: number | undefined }>
} {
  const files = new Map<string, string>()
  const events: string[] = []
  const modes: Array<{ path: string; mode: number | undefined }> = []
  const observe = async (event: string, value?: string) => {
    events.push(event)
    await options.onEvent?.(event, value)
    const error = options.fail?.(event)
    if (error) throw error
  }
  const operations: DurableFileOperations = {
    mkdir: async () => undefined as never,
    readFile: async (path) => {
      await observe(`read:${path}`)
      const value = files.get(path)
      if (value === undefined) throw errno('ENOENT')
      return value
    },
    open: async (path, flags, mode) => {
      await observe(`open:${flags}:${path}`)
      modes.push({ path, mode })
      if (flags === 'r') {
        return {
          writeFile: async () => { throw new Error('directory handle is not writable') },
          sync: async () => { await observe(`sync:${path}`) },
          close: async () => { await observe(`close:${path}`) }
        }
      }
      let content = ''
      return {
        writeFile: async (value) => {
          content = typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
          await observe(`write:${path}`, content)
        },
        sync: async () => { await observe(`sync:${path}`) },
        close: async () => {
          await observe(`close:${path}`)
          files.set(path, content)
        }
      }
    },
    rename: async (from, to) => {
      await observe(`rename:${from}->${to}`)
      const value = files.get(from)
      if (value === undefined) throw errno('ENOENT')
      files.delete(from)
      files.set(to, value)
    },
    rm: async (path) => {
      await observe(`rm:${path}`)
      files.delete(path)
    }
  }
  return { operations, files, events, modes }
}

function temporaryFiles(fake: ReturnType<typeof memoryOperations>): string[] {
  return [...fake.files.keys()].filter((path) => path.endsWith('.tmp'))
}

describe('durable file replacement', () => {
  it('writes private same-directory temps, fsyncs file then directory, and normalizes canonical and backup modes to 0600', async () => {
    const path = await temporaryFile()
    await replaceWithBackup({ path, content: '{"version":1}\n', validate: isVersioned, mode: 0o644 })
    await expect(readFile(`${path}.bak`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await replaceWithBackup({ path, content: '{"version":2}\n', validate: isVersioned, mode: 0o644 })
    await expect(readFile(path, 'utf8')).resolves.toContain('"version":2')
    await expect(readFile(`${path}.bak`, 'utf8')).resolves.toContain('"version":1')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(`${path}.bak`)).mode & 0o777).toBe(0o600)
  })

  it('orders candidate fsync/close, backup publication, and canonical directory fsync', async () => {
    const path = '/state/state.json'
    const fake = memoryOperations()
    fake.files.set(path, '{"version":1}')

    await replaceWithBackup({ path, content: '{"version":2}', validate: isVersioned, operations: fake.operations, mode: 0o644 })

    const canonicalTemp = fake.events.find((event) => event.startsWith('open:wx:') && event.includes('.state.json.'))!
    const canonicalTempPath = canonicalTemp.slice('open:wx:'.length)
    const canonicalWrite = fake.events.indexOf(`write:${canonicalTempPath}`)
    const canonicalSync = fake.events.indexOf(`sync:${canonicalTempPath}`)
    const canonicalClose = fake.events.indexOf(`close:${canonicalTempPath}`)
    const canonicalRename = fake.events.findIndex((event) => event === `rename:${canonicalTempPath}->${path}`)
    expect(canonicalWrite).toBeLessThan(canonicalSync)
    expect(canonicalSync).toBeLessThan(canonicalClose)
    expect(canonicalClose).toBeLessThan(canonicalRename)
    expect(fake.events.slice(0, canonicalRename).some((event) => event.startsWith(`rename:${path}.bak->`))).toBe(true)
    expect(fake.events.slice(canonicalRename + 1)).toContain('sync:/state')
    expect(fake.modes.filter(({ path: opened }) => opened.includes('.tmp')).every(({ mode }) => mode === 0o600)).toBe(true)
  })

  it('serializes concurrent replacements for one canonical target so the backup is the immediate predecessor', async () => {
    const path = '/state/state.json'
    let releaseV2: (() => void) | undefined
    let markV2WriteStarted: (() => void) | undefined
    const v2WriteStarted = new Promise<void>((resolve) => { markV2WriteStarted = resolve })
    const allowV2Write = new Promise<void>((resolve) => { releaseV2 = resolve })
    const fake = memoryOperations({
      onEvent: async (event, value) => {
        if (event.startsWith('write:') && value === '{"version":2}') {
          markV2WriteStarted?.()
          await allowV2Write
        }
      }
    })
    fake.files.set(path, '{"version":1}')

    const v2 = replaceWithBackup({ path, content: '{"version":2}', validate: isVersioned, operations: fake.operations })
    await v2WriteStarted
    const v3 = replaceWithBackup({ path, content: '{"version":3}', validate: isVersioned, operations: fake.operations })
    releaseV2?.()
    await Promise.all([v2, v3])

    expect(fake.files.get(path)).toBe('{"version":3}')
    expect(fake.files.get(`${path}.bak`)).toBe('{"version":2}')

    // A subsequent replacement proves the per-target queue was released.
    await replaceWithBackup({ path, content: '{"version":4}', validate: isVersioned, operations: fake.operations })
    expect(fake.files.get(path)).toBe('{"version":4}')
    expect(fake.files.get(`${path}.bak`)).toBe('{"version":3}')
  })

  it.each([
    ['write', (event: string) => event.startsWith('write:')],
    ['file sync', (event: string) => event.startsWith('sync:/state/.state.json.')],
    ['file close', (event: string) => event.startsWith('close:/state/.state.json.')]
  ])('cleans unpublished temporary files after a %s failure', async (_boundary, matches) => {
    const path = '/state/state.json'
    const fake = memoryOperations({ fail: (event) => matches(event) ? new Error('disk full') : undefined })

    await expect(replaceDurably({ path, content: 'new', operations: fake.operations })).rejects.toThrow('disk full')
    expect(fake.files.get(path)).toBeUndefined()
    expect(temporaryFiles(fake)).toEqual([])
    expect(fake.events.some((event) => event.startsWith('rm:/state/.state.json.'))).toBe(true)
  })

  it('only downgrades the narrow unsupported directory-fsync set and keeps I/O, permission, and close failures fatal', async () => {
    const path = '/state/state.json'
    for (const code of ['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR']) {
      const unsupported = memoryOperations({
        fail: (event) => event === 'sync:/state' ? errno(code) : undefined
      })
      const warnings: string[] = []
      await replaceDurably({ path, content: 'state', operations: unsupported.operations, warn: (message) => warnings.push(message) })
      expect(warnings).toEqual(['[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'])
      expect(warnings[0]).not.toContain('/state')
      expect(unsupported.files.get(path)).toBe('state')
    }

    for (const code of ['EIO', 'EACCES', 'EPERM']) {
      const denied = memoryOperations({
        fail: (event) => event === 'sync:/state' ? errno(code) : undefined
      })
      await expect(replaceDurably({ path, content: 'state', operations: denied.operations })).rejects.toMatchObject({ code })
      expect(denied.files.get(path)).toBe('state')
    }

    const closeFailure = memoryOperations({
      fail: (event) => event === 'close:/state' ? errno('EIO') : undefined
    })
    await expect(replaceDurably({ path, content: 'state', operations: closeFailure.operations })).rejects.toMatchObject({ code: 'EIO' })
    expect(closeFailure.files.get(path)).toBe('state')
  })

  it('keeps published state and cleans candidates at backup, canonical-rename, and directory-sync failure boundaries', async () => {
    const path = '/state/state.json'
    const backupRenameFailure = memoryOperations({
      fail: (event) => event.includes(`->${path}.bak`) && event.includes('.state.json.bak.') && !event.includes('.previous.')
        ? errno('EACCES')
        : undefined
    })
    backupRenameFailure.files.set(path, '{"version":2}')
    backupRenameFailure.files.set(`${path}.bak`, '{"version":1}')
    await expect(replaceWithBackup({ path, content: '{"version":3}', validate: isVersioned, operations: backupRenameFailure.operations })).rejects.toMatchObject({ code: 'EACCES' })
    expect(backupRenameFailure.files.get(path)).toBe('{"version":2}')
    expect(backupRenameFailure.files.get(`${path}.bak`)).toBe('{"version":1}')
    expect(temporaryFiles(backupRenameFailure)).toEqual([])

    const canonicalRenameFailure = memoryOperations({
      fail: (event) => event.includes(`->${path}`) && event.includes('.state.json.') && !event.includes('.bak.')
        ? errno('EIO')
        : undefined
    })
    canonicalRenameFailure.files.set(path, '{"version":2}')
    canonicalRenameFailure.files.set(`${path}.bak`, '{"version":1}')
    await expect(replaceWithBackup({ path, content: '{"version":3}', validate: isVersioned, operations: canonicalRenameFailure.operations })).rejects.toMatchObject({ code: 'EIO' })
    expect(canonicalRenameFailure.files.get(path)).toBe('{"version":2}')
    expect(canonicalRenameFailure.files.get(`${path}.bak`)).toBe('{"version":2}')
    expect(temporaryFiles(canonicalRenameFailure)).toEqual([])

    let directorySyncFailures = 0
    const backupDirectorySyncFailure = memoryOperations({
      fail: (event) => {
        if (event !== 'sync:/state' || directorySyncFailures++ > 0) return undefined
        return errno('EIO')
      }
    })
    backupDirectorySyncFailure.files.set(path, '{"version":2}')
    backupDirectorySyncFailure.files.set(`${path}.bak`, '{"version":1}')
    await expect(replaceWithBackup({ path, content: '{"version":3}', validate: isVersioned, operations: backupDirectorySyncFailure.operations })).rejects.toMatchObject({ code: 'EIO' })
    expect(backupDirectorySyncFailure.files.get(path)).toBe('{"version":2}')
    expect(backupDirectorySyncFailure.files.get(`${path}.bak`)).toBe('{"version":1}')
    expect(temporaryFiles(backupDirectorySyncFailure)).toEqual([])
  })

  it('uses only valid backups for recovery, never restores automatically, and does not fall back after I/O errors', async () => {
    const path = await temporaryFile()
    await replaceWithBackup({ path, content: '{"version":1}', validate: isVersioned })
    await replaceWithBackup({ path, content: '{"version":2}', validate: isVersioned })
    await writeFile(path, '{ malformed', 'utf8')

    await expect(readValidatedWithBackup({ path, validate: isVersioned })).resolves.toMatchObject({
      value: { version: 1 }, source: 'backup', canonicalStatus: 'invalid'
    })
    await expect(readFile(path, 'utf8')).resolves.toBe('{ malformed')
    await writeFile(path, '{"version":2}', 'utf8')
    await writeFile(`${path}.bak`, '{ invalid backup', 'utf8')
    await expect(readValidatedWithBackup({ path, validate: isVersioned })).resolves.toMatchObject({
      value: { version: 2 }, source: 'canonical', backupStatus: 'not-read'
    })

    const denied = memoryOperations({ fail: (event) => event === `read:${path}` ? errno('EPERM') : undefined })
    denied.files.set(`${path}.bak`, '{"version":1}')
    await expect(readValidatedWithBackup({ path, validate: isVersioned, operations: denied.operations })).rejects.toMatchObject({ code: 'EPERM' })
    expect(denied.events).not.toContain(`read:${path}.bak`)
  })
})

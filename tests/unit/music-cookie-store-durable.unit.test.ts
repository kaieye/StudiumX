import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MusicCookieStore, type MusicCookieState } from '../../src/main/music/music-cookie-store'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'

const roots: string[] = []
function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

async function temporaryCookieFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-music-cookies-'))
  roots.push(root)
  return join(root, 'state', 'music-cookies.json')
}

function memoryOperations(options: {
  fail?: (event: string) => Error | undefined
  onEvent?: (event: string, content?: string) => void | Promise<void>
} = {}): {
  operations: DurableFileOperations
  files: Map<string, string>
  events: string[]
  modes: Array<{ path: string; mode: number | undefined }>
} {
  const files = new Map<string, string>()
  const events: string[] = []
  const modes: Array<{ path: string; mode: number | undefined }> = []
  const observe = async (event: string, content?: string): Promise<void> => {
    events.push(event)
    await options.onEvent?.(event, content)
    const error = options.fail?.(event)
    if (error) throw error
  }

  const operations: DurableFileOperations = {
    mkdir: async () => undefined as never,
    readFile: async (path) => {
      await observe(`read:${path}`)
      const content = files.get(path)
      if (content === undefined) throw errno('ENOENT')
      return content
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
      const content = files.get(from)
      if (content === undefined) throw errno('ENOENT')
      files.delete(from)
      files.set(to, content)
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

function cookieJson(state: MusicCookieState): string {
  return JSON.stringify(state, null, 2)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('MusicCookieStore durable publishing', () => {
  it('durably creates and overwrites private cookie state without changing its JSON schema', async () => {
    const path = await temporaryCookieFile()
    const store = new MusicCookieStore({ path })

    await expect(store.set('netease', 'MUSIC_U=first;\nfoo=bar;;')).resolves.toBe('MUSIC_U=first; foo=bar')
    await expect(readFile(path, 'utf8')).resolves.toBe(cookieJson({ netease: 'MUSIC_U=first; foo=bar', qq: '' }))
    expect((await stat(path)).mode & 0o777).toBe(0o600)

    await store.set('qq', 'uin=second;')
    await expect(readFile(path, 'utf8')).resolves.toBe(cookieJson({ netease: 'MUSIC_U=first; foo=bar', qq: 'uin=second' }))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('single-flights an initial load shared by concurrent reads and the first mutation', async () => {
    const path = '/cookies/music-cookies.json'
    let readCount = 0
    let releaseInitialRead: (() => void) | undefined
    let markInitialReadStarted: (() => void) | undefined
    const initialReadStarted = new Promise<void>((resolve) => { markInitialReadStarted = resolve })
    const allowInitialRead = new Promise<void>((resolve) => { releaseInitialRead = resolve })
    const fake = memoryOperations({
      onEvent: async (event) => {
        if (event !== `read:${path}`) return
        readCount += 1
        if (readCount === 1) {
          markInitialReadStarted?.()
          await allowInitialRead
        }
      }
    })
    const old = { netease: 'MUSIC_U=old', qq: 'uin=old' }
    fake.files.set(path, cookieJson(old))
    const store = new MusicCookieStore({ path, operations: fake.operations })

    const initialGetAll = store.getAll()
    await initialReadStarted
    const initialGet = store.get('qq')
    const firstSet = store.set('netease', 'MUSIC_U=new')
    await Promise.resolve()
    expect(readCount).toBe(1)

    releaseInitialRead?.()
    await expect(initialGetAll).resolves.toEqual(old)
    await expect(initialGet).resolves.toBe('uin=old')
    await expect(firstSet).resolves.toBe('MUSIC_U=new')
    expect(readCount).toBe(1)
    await expect(store.getAll()).resolves.toEqual({ netease: 'MUSIC_U=new', qq: 'uin=old' })
  })

  it.each([
    ['write', (event: string) => event.startsWith('write:')],
    ['file sync', (event: string) => event.startsWith('sync:/cookies/.music-cookies.json.')],
    ['file close', (event: string) => event.startsWith('close:/cookies/.music-cookies.json.')],
    ['rename', (event: string) => event.includes('->/cookies/music-cookies.json')]
  ])('keeps old bytes and memory on a pre-rename %s failure and removes the candidate', async (_boundary, matches) => {
    const path = '/cookies/music-cookies.json'
    const fake = memoryOperations({ fail: (event) => matches(event) ? errno('EIO') : undefined })
    const old = { netease: 'MUSIC_U=old', qq: 'uin=old' }
    fake.files.set(path, cookieJson(old))
    const store = new MusicCookieStore({ path, operations: fake.operations })
    await expect(store.getAll()).resolves.toEqual(old)

    await expect(store.set('netease', 'MUSIC_U=new')).rejects.toMatchObject({ code: 'EIO' })
    expect(fake.files.get(path)).toBe(cookieJson(old))
    await expect(store.getAll()).resolves.toEqual(old)
    expect(temporaryFiles(fake)).toEqual([])
  })

  it.each([
    ['EIO', () => errno('EIO')],
    ['EACCES', () => errno('EACCES')],
    ['EPERM', () => errno('EPERM')],
    ['unknown error', () => new Error('directory sync failed')]
  ])('fails closed after rename when directory sync returns %s', async (_name, makeError) => {
    const path = '/cookies/music-cookies.json'
    const fake = memoryOperations({ fail: (event) => event === 'sync:/cookies' ? makeError() : undefined })
    const old = { netease: 'MUSIC_U=old', qq: 'uin=old' }
    fake.files.set(path, cookieJson(old))
    const store = new MusicCookieStore({ path, operations: fake.operations })
    await store.getAll()

    await expect(store.clear('qq')).rejects.toThrow()
    expect(fake.files.get(path)).toBe(cookieJson({ netease: 'MUSIC_U=old', qq: '' }))
    await expect(store.getAll()).resolves.toEqual(old)
    expect(temporaryFiles(fake)).toEqual([])
  })

  it('fails closed after rename when closing the directory handle rejects', async () => {
    const path = '/cookies/music-cookies.json'
    const fake = memoryOperations({ fail: (event) => event === 'close:/cookies' ? new Error('directory close failed') : undefined })
    const old = { netease: 'MUSIC_U=old', qq: 'uin=old' }
    fake.files.set(path, cookieJson(old))
    const store = new MusicCookieStore({ path, operations: fake.operations })
    await store.getAll()

    await expect(store.clear('qq')).rejects.toThrow('directory close failed')
    expect(fake.files.get(path)).toBe(cookieJson({ netease: 'MUSIC_U=old', qq: '' }))
    await expect(store.getAll()).resolves.toEqual(old)
  })

  it('refreshes canonical state before the next mutation after a post-rename failure', async () => {
    const path = '/cookies/music-cookies.json'
    let failDirectorySync = true
    const fake = memoryOperations({
      fail: (event) => event === 'sync:/cookies' && failDirectorySync ? errno('EIO') : undefined
    })
    const old = { netease: 'MUSIC_U=old', qq: 'uin=old' }
    const firstCandidate = { netease: 'MUSIC_U=first', qq: 'uin=old' }
    const expected = { netease: 'MUSIC_U=first', qq: 'uin=second' }
    fake.files.set(path, cookieJson(old))
    const store = new MusicCookieStore({ path, operations: fake.operations })
    await expect(store.getAll()).resolves.toEqual(old)

    await expect(store.set('netease', 'MUSIC_U=first')).rejects.toMatchObject({ code: 'EIO' })
    expect(fake.files.get(path)).toBe(cookieJson(firstCandidate))
    await expect(store.getAll()).resolves.toEqual(old)

    const independentReader = new MusicCookieStore({ path, operations: fake.operations })
    await expect(independentReader.getAll()).resolves.toEqual(firstCandidate)

    failDirectorySync = false
    await expect(store.set('qq', 'uin=second')).resolves.toBe('uin=second')
    expect(fake.files.get(path)).toBe(cookieJson(expected))
    await expect(store.getAll()).resolves.toEqual(expected)
  })

  it('does not publish from stale memory when canonical refresh fails after a post-rename failure', async () => {
    const path = '/cookies/music-cookies.json'
    let failDirectorySync = true
    let failCanonicalRead = false
    const fake = memoryOperations({
      fail: (event) => {
        if (event === 'sync:/cookies' && failDirectorySync) return errno('EIO')
        if (event === `read:${path}` && failCanonicalRead) return errno('EACCES')
        return undefined
      }
    })
    const old = { netease: 'MUSIC_U=old', qq: 'uin=old' }
    const firstCandidate = { netease: 'MUSIC_U=first', qq: 'uin=old' }
    const expected = { netease: 'MUSIC_U=first', qq: 'uin=second' }
    fake.files.set(path, cookieJson(old))
    const store = new MusicCookieStore({ path, operations: fake.operations })
    await store.getAll()

    await expect(store.set('netease', 'MUSIC_U=first')).rejects.toMatchObject({ code: 'EIO' })
    expect(fake.files.get(path)).toBe(cookieJson(firstCandidate))

    failDirectorySync = false
    failCanonicalRead = true
    const failedRefreshEventStart = fake.events.length
    await expect(store.set('qq', 'uin=second')).rejects.toMatchObject({ code: 'EACCES' })
    const failedRefreshEvents = fake.events.slice(failedRefreshEventStart)
    expect(failedRefreshEvents).toContain(`read:${path}`)
    expect(failedRefreshEvents.some((event) => event.startsWith('write:'))).toBe(false)
    expect(failedRefreshEvents.some((event) => event.startsWith('rename:'))).toBe(false)
    expect(fake.files.get(path)).toBe(cookieJson(firstCandidate))

    failCanonicalRead = false
    failDirectorySync = false
    await expect(store.set('qq', 'uin=second')).resolves.toBe('uin=second')
    expect(fake.files.get(path)).toBe(cookieJson(expected))
    await expect(store.getAll()).resolves.toEqual(expected)
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])('only accepts unsupported directory fsync %s and emits a non-sensitive warning', async (code) => {
    const path = '/cookies/music-cookies.json'
    const warnings: string[] = []
    const fake = memoryOperations({ fail: (event) => event === 'sync:/cookies' ? errno(code) : undefined })
    const store = new MusicCookieStore({ path, operations: fake.operations, warn: (message) => warnings.push(message) })

    await expect(store.set('netease', 'MUSIC_U=private-cookie')).resolves.toBe('MUSIC_U=private-cookie')
    await expect(store.getAll()).resolves.toEqual({ netease: 'MUSIC_U=private-cookie', qq: '' })
    expect(warnings).toEqual(['[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'])
    expect(warnings[0]).not.toContain(path)
    expect(warnings[0]).not.toContain('private-cookie')
  })

  it('serializes concurrent set and clear mutations so each publish starts from the last committed state', async () => {
    const path = '/cookies/music-cookies.json'
    let releaseFirstWrite: (() => void) | undefined
    let markFirstWriteStarted: (() => void) | undefined
    const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve })
    const allowFirstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
    const fake = memoryOperations({
      onEvent: async (event, content) => {
        if (event.startsWith('write:') && content && JSON.parse(content).netease === 'MUSIC_U=new') {
          markFirstWriteStarted?.()
          await allowFirstWrite
        }
      }
    })
    fake.files.set(path, cookieJson({ netease: 'MUSIC_U=old', qq: 'uin=old' }))
    const store = new MusicCookieStore({ path, operations: fake.operations })

    const set = store.set('netease', 'MUSIC_U=new')
    await firstWriteStarted
    const clear = store.clear('qq')
    releaseFirstWrite?.()
    await Promise.all([set, clear])

    const expected = { netease: 'MUSIC_U=new', qq: '' }
    expect(fake.files.get(path)).toBe(cookieJson(expected))
    await expect(store.getAll()).resolves.toEqual(expected)
  })
})

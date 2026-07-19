import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_DURABLE_JSONL_MAX_BYTES,
  appendDurableJsonlLine,
  discoverDurableJsonlSegments,
  durableJsonlSealedSegmentFileName,
  readDurableJsonlLines,
  readDurableJsonlSources,
  rotateDurableJsonl
} from '../../src/main/durable-jsonl'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createActivePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-durable-jsonl-'))
  roots.push(root)
  return join(root, '.studiumx', 'ledger.jsonl')
}

describe('durable JSONL', () => {
  it('uses a named 50 MB default limit', () => {
    expect(DEFAULT_DURABLE_JSONL_MAX_BYTES).toBe(50 * 1024 * 1024)
  })

  it('serializes concurrent appends and keeps the active filename stable', async () => {
    const activePath = await createActivePath()
    await Promise.all(Array.from({ length: 24 }, (_, index) =>
      appendDurableJsonlLine({ activePath }, JSON.stringify({ index }))
    ))

    const lines = await readDurableJsonlLines(activePath)
    expect(lines).toHaveLength(24)
    expect(new Set(lines.map((line) => JSON.parse(line).index))).toEqual(new Set(Array.from({ length: 24 }, (_, index) => index)))
    await expect(readFile(activePath, 'utf8')).resolves.toContain('"index"')
  })

  it('seals on size, discovers only strict segment names, and reads sealed rows before active rows', async () => {
    const activePath = await createActivePath()
    await appendDurableJsonlLine({ activePath, maxBytes: 12 }, '{"id":1}')
    await appendDurableJsonlLine({ activePath, maxBytes: 12 }, '{"id":2}')

    const directory = dirname(activePath)
    await writeFile(join(directory, 'ledger.sealed-2026-07-00001.jsonl'), '{"ignored":"short-sequence"}\n', 'utf8')
    await writeFile(join(directory, 'ledger.sealed-2026-13-000001.jsonl'), '{"ignored":"invalid-month"}\n', 'utf8')
    await writeFile(join(directory, 'ledger.sealed-2026-07-000001.jsonl.bak'), '{"ignored":"suffix"}\n', 'utf8')

    const segments = await discoverDurableJsonlSegments(activePath)
    expect(segments.map((segment) => segment.kind)).toEqual(['sealed', 'active'])
    expect(segments[0]).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/), sequence: 1 })
    await expect(readDurableJsonlLines(activePath)).resolves.toEqual(['{"id":1}', '{"id":2}'])
    await expect(readFile(activePath, 'utf8')).resolves.toBe('{"id":2}\n')
  })

  it('returns exact source buffers while excluding invalid, directory, and symlink segment candidates', async () => {
    const activePath = await createActivePath()
    const directory = dirname(activePath)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'ledger.sealed-2026-07-000001.jsonl'), '{"id":"sealed"}\n', 'utf8')
    await writeFile(activePath, '{"id":"active"}\n', 'utf8')
    await writeFile(join(directory, 'ledger.sealed-2026-13-000002.jsonl'), '{"id":"invalid-month"}\n', 'utf8')
    await writeFile(join(directory, 'ledger.sealed-2026-07-000000.jsonl'), '{"id":"invalid-sequence"}\n', 'utf8')
    await mkdir(join(directory, 'ledger.sealed-2026-07-000002.jsonl'))
    const symlinkTarget = join(directory, 'outside.jsonl')
    await writeFile(symlinkTarget, '{"id":"symlink"}\n', 'utf8')
    // File symlink creation commonly needs Developer Mode or elevated rights on
    // Windows. The directory candidate above still covers the unprivileged
    // host's unsafe-entry filter; exercise the file-symlink branch where the
    // platform grants that capability.
    try {
      await symlink(symlinkTarget, join(directory, 'ledger.sealed-2026-07-000003.jsonl'))
    } catch (error) {
      if (!(process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM')) throw error
    }

    const sources = await readDurableJsonlSources(activePath)
    expect(sources.map((source) => source.path)).toEqual([
      join(directory, 'ledger.sealed-2026-07-000001.jsonl'),
      activePath
    ])
    expect(sources.map((source) => source.bytes.toString('utf8'))).toEqual(['{"id":"sealed"}\n', '{"id":"active"}\n'])
    expect(sources.flatMap((source) => source.lines)).toEqual(['{"id":"sealed"}', '{"id":"active"}'])
  })

  it('seals an old active file at the month boundary and assigns later explicit rotations a sequence', async () => {
    const activePath = await createActivePath()
    await appendDurableJsonlLine({ activePath }, '{"id":"june"}')
    const june = new Date('2026-06-30T12:00:00.000Z')
    await utimes(activePath, june, june)

    await appendDurableJsonlLine({
      activePath,
      now: () => new Date('2026-07-01T00:00:00.000Z')
    }, '{"id":"july"}')
    const firstJulySeal = await rotateDurableJsonl({ activePath })

    expect(firstJulySeal).toContain(durableJsonlSealedSegmentFileName('ledger.jsonl', '2026-07', 1))
    await expect(readFile(activePath, 'utf8')).resolves.toBe('')
    expect(await readDurableJsonlLines(activePath)).toEqual(['{"id":"june"}', '{"id":"july"}'])
  })

  it.runIf(process.platform === 'win32')('appends and rotates with Windows directory fsync unavailable', async () => {
    const activePath = await createActivePath()

    await appendDurableJsonlLine({ activePath, maxBytes: 12 }, '{"id":1}')
    await appendDurableJsonlLine({ activePath, maxBytes: 12 }, '{"id":2}')

    expect(await readDurableJsonlLines(activePath)).toEqual(['{"id":1}', '{"id":2}'])
  })

  it('rejects real directory fsync failures instead of reporting a durable append', async () => {
    const activePath = await createActivePath()
    const failure = Object.assign(new Error('simulated directory I/O failure'), { code: 'EIO' })

    await expect(appendDurableJsonlLine({
      activePath,
      syncDirectory: async () => { throw failure }
    }, '{"id":"written-before-directory-sync-failure"}')).rejects.toBe(failure)

    // The write may already be visible, but callers received the failure and can
    // make a recovery decision rather than being told durability succeeded.
    await expect(readDurableJsonlLines(activePath)).resolves.toEqual(['{"id":"written-before-directory-sync-failure"}'])
  })

  it('gracefully degrades only explicit unsupported directory fsync errors', async () => {
    const activePath = await createActivePath()
    const unsupported = Object.assign(new Error('directory fsync unsupported'), { code: 'EOPNOTSUPP' })

    await appendDurableJsonlLine({
      activePath,
      syncDirectory: async () => { throw unsupported }
    }, '{"id":"portable"}')

    await expect(readDurableJsonlLines(activePath)).resolves.toEqual(['{"id":"portable"}'])
  })

  it('rejects an explicit rotation when directory fsync actually fails', async () => {
    const activePath = await createActivePath()
    await appendDurableJsonlLine({ activePath }, '{"id":"sealed-but-not-acknowledged"}')
    const failure = Object.assign(new Error('simulated directory I/O failure'), { code: 'EIO' })

    await expect(rotateDurableJsonl({
      activePath,
      syncDirectory: async () => { throw failure }
    })).rejects.toBe(failure)

    const segments = await discoverDurableJsonlSegments(activePath)
    expect(segments.map((segment) => segment.kind)).toEqual(['sealed', 'active'])
    await expect(readDurableJsonlLines(activePath)).resolves.toEqual(['{"id":"sealed-but-not-acknowledged"}'])
  })

})

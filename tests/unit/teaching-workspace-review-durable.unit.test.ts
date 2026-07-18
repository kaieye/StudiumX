import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import {
  TeachingWorkspaceReviewDeck,
  type ReviewWorkspace
} from '../../src/main/teaching-workspace/review'

const roots: string[] = []
const DIRECTORY_FSYNC_WARNING = '[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'

type MemoryDurableFile = {
  operations: DurableFileOperations
  files: Map<string, string>
  events: string[]
  modes: Array<{ path: string; mode: number | undefined }>
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function memoryOperations(options: {
  fail?: (event: string) => Error | undefined
} = {}): MemoryDurableFile {
  const files = new Map<string, string>()
  const events: string[] = []
  const modes: Array<{ path: string; mode: number | undefined }> = []
  const observe = async (event: string) => {
    events.push(event)
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
          sync: async () => observe(`sync:${path}`),
          close: async () => observe(`close:${path}`)
        }
      }
      let content = ''
      return {
        writeFile: async (value) => {
          content = typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
          await observe(`write:${path}`)
        },
        sync: async () => observe(`sync:${path}`),
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

function temporaryFiles(fake: MemoryDurableFile): string[] {
  return [...fake.files.keys()].filter((path) => path.endsWith('.tmp'))
}

async function reviewFixture(): Promise<{
  workspace: ReviewWorkspace
  progressPath: string
  oldProgress: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-review-durable-'))
  roots.push(root)
  const progressPath = join(root, '.studiumx', 'progress.json')
  const oldProgress = `${JSON.stringify({
    version: 2,
    totalAnswered: 4,
    correct: 3,
    byLesson: { 'lesson-a': { answered: 4, correct: 3 } },
    byCard: {}
  }, null, 2)}\n`

  await Promise.all([
    mkdir(join(root, '.studiumx'), { recursive: true }),
    mkdir(join(root, 'lessons'), { recursive: true })
  ])
  await writeFile(join(root, 'lessons', 'lesson-a-flashcards.json'), JSON.stringify({
    lessonId: 'lesson-a',
    lessonTitle: 'Lesson A',
    cards: [{ id: 'card-a', front: 'Question A', back: 'Answer A' }]
  }), 'utf8')
  await writeFile(progressPath, oldProgress, 'utf8')
  return { workspace: { id: 'workspace-a', rootPath: root }, progressPath, oldProgress }
}

function recordAttempt(deck: TeachingWorkspaceReviewDeck, workspace: ReviewWorkspace) {
  return deck.recordAttempt(workspace, {
    workspaceId: workspace.id,
    lessonId: 'lesson-a',
    results: [{ lessonId: 'lesson-a', question: 'Question A', correct: true }]
  })
}

function expectUpdatedProgress(content: string | undefined): void {
  const parsed = JSON.parse(content ?? '') as {
    version: number
    totalAnswered: number
    correct: number
    byLesson: Record<string, { answered: number; correct: number }>
    byCard: Record<string, { answered: number; correct: number }>
  }
  expect(parsed).toMatchObject({
    version: 2,
    totalAnswered: 5,
    correct: 4,
    byLesson: { 'lesson-a': { answered: 5, correct: 4 } }
  })
  expect(Object.values(parsed.byCard)).toEqual([{ answered: 1, correct: 1 }])
}

describe('TeachingWorkspaceReviewDeck durable progress publication', () => {
  it('publishes the existing progress schema only after file and directory durability complete', async () => {
    const { workspace, progressPath, oldProgress } = await reviewFixture()
    const fake = memoryOperations()
    fake.files.set(progressPath, oldProgress)
    const deck = new TeachingWorkspaceReviewDeck({ durableFileOperations: fake.operations })

    await expect(recordAttempt(deck, workspace)).resolves.toMatchObject({
      progress: {
        totalAnswered: 5,
        correct: 4,
        byLesson: { 'lesson-a': { answered: 5, correct: 4 } }
      }
    })

    expectUpdatedProgress(fake.files.get(progressPath))
    expect(await readFile(progressPath, 'utf8')).toBe(oldProgress)
    expect(temporaryFiles(fake)).toEqual([])

    const temporaryPath = fake.events.find((event) => event.startsWith('open:wx:'))!.slice('open:wx:'.length)
    const write = fake.events.indexOf(`write:${temporaryPath}`)
    const fileSync = fake.events.indexOf(`sync:${temporaryPath}`)
    const fileClose = fake.events.indexOf(`close:${temporaryPath}`)
    const rename = fake.events.indexOf(`rename:${temporaryPath}->${progressPath}`)
    const directorySync = fake.events.indexOf(`sync:${join(workspace.rootPath, '.studiumx')}`)
    const directoryClose = fake.events.indexOf(`close:${join(workspace.rootPath, '.studiumx')}`)
    expect(write).toBeLessThan(fileSync)
    expect(fileSync).toBeLessThan(fileClose)
    expect(fileClose).toBeLessThan(rename)
    expect(rename).toBeLessThan(directorySync)
    expect(directorySync).toBeLessThan(directoryClose)
    expect(fake.modes).toContainEqual({ path: temporaryPath, mode: 0o666 })
  })

  it.each([
    ['write', (event: string, progressPath: string) => event.startsWith('write:') && event.includes('.progress.json.')],
    ['file sync', (event: string, progressPath: string) => event.startsWith('sync:') && event.includes('.progress.json.')],
    ['file close', (event: string, progressPath: string) => event.startsWith('close:') && event.includes('.progress.json.')],
    ['rename', (event: string, progressPath: string) => event.startsWith('rename:') && event.endsWith(`->${progressPath}`)]
  ])('does not report success or replace the old progress when %s fails before publication', async (_name, matches) => {
    const { workspace, progressPath, oldProgress } = await reviewFixture()
    const fake = memoryOperations({
      fail: (event) => matches(event, progressPath) ? errno('EIO') : undefined
    })
    fake.files.set(progressPath, oldProgress)
    const deck = new TeachingWorkspaceReviewDeck({ durableFileOperations: fake.operations })

    await expect(recordAttempt(deck, workspace)).rejects.toMatchObject({ code: 'EIO' })
    expect(fake.files.get(progressPath)).toBe(oldProgress)
    expect(temporaryFiles(fake)).toEqual([])
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'allows only the shared directory-fsync capability downgrade (%s)',
    async (code) => {
      const { workspace, progressPath, oldProgress } = await reviewFixture()
      const warnings: string[] = []
      const fake = memoryOperations({
        fail: (event) => event === `sync:${join(workspace.rootPath, '.studiumx')}` ? errno(code) : undefined
      })
      fake.files.set(progressPath, oldProgress)
      const deck = new TeachingWorkspaceReviewDeck({
        durableFileOperations: fake.operations,
        durableWarn: (message) => warnings.push(message)
      })

      await expect(recordAttempt(deck, workspace)).resolves.toMatchObject({
        progress: { totalAnswered: 5, correct: 4 }
      })
      expectUpdatedProgress(fake.files.get(progressPath))
      expect(temporaryFiles(fake)).toEqual([])
      expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
      expect(warnings[0]).not.toContain(workspace.rootPath)
    }
  )

  it.each([
    ['EIO', errno('EIO')],
    ['EACCES', errno('EACCES')],
    ['unknown error', new Error('unexpected directory failure')]
  ])('does not downgrade a directory-fsync %s failure or falsely return updated progress', async (_name, failure) => {
    const { workspace, progressPath, oldProgress } = await reviewFixture()
    const fake = memoryOperations({
      fail: (event) => event === `sync:${join(workspace.rootPath, '.studiumx')}` ? failure : undefined
    })
    fake.files.set(progressPath, oldProgress)
    const deck = new TeachingWorkspaceReviewDeck({ durableFileOperations: fake.operations })

    await expect(recordAttempt(deck, workspace)).rejects.toBe(failure)
    // Rename precedes directory fsync. The shared primitive therefore leaves a
    // complete, newly published canonical document rather than claiming success
    // or attempting an unsafe post-publication rollback.
    expectUpdatedProgress(fake.files.get(progressPath))
    expect(temporaryFiles(fake)).toEqual([])
  })

  it('does not report success when closing the directory after publication fails', async () => {
    const { workspace, progressPath, oldProgress } = await reviewFixture()
    const directoryPath = join(workspace.rootPath, '.studiumx')
    const fake = memoryOperations({
      fail: (event) => event === `close:${directoryPath}` ? errno('EIO') : undefined
    })
    fake.files.set(progressPath, oldProgress)
    const deck = new TeachingWorkspaceReviewDeck({ durableFileOperations: fake.operations })

    await expect(recordAttempt(deck, workspace)).rejects.toMatchObject({ code: 'EIO' })
    expectUpdatedProgress(fake.files.get(progressPath))
    expect(temporaryFiles(fake)).toEqual([])
  })
})

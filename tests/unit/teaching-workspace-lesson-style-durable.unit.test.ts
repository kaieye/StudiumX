import { mkdir, open as openFile, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH } from '../../src/main/teaching-workspace/lifecycle'
import { lessonStyleCss } from '../../src/shared/lesson-styles'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()
const DIRECTORY_FSYNC_WARNING = '[StudiumX] Directory fsync is unsupported; durable rename completed without directory fsync.'

type RecordedOperation = {
  event: string
  mode?: number
}

type RecordingDurableOperations = {
  operations: DurableFileOperations
  recorded: RecordedOperation[]
}

type LessonStyleFixture = {
  service: TeachingWorkspaceService
  workspace: NonNullable<Awaited<ReturnType<TeachingWorkspaceService['createWorkspace']>>['activeWorkspace']>
  stylesheetPath: string
  registryPath: string
  ledgerPath: string
  oldStylesheet: string
  oldRegistry: string
  oldLedger: string
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function recordingOperations(options: {
  fail?: (event: string) => Error | undefined
} = {}): RecordingDurableOperations {
  const recorded: RecordedOperation[] = []
  const observe = (event: string, mode?: number) => {
    recorded.push({ event, mode })
    const failure = options.fail?.(event)
    if (failure) throw failure
  }

  const operations: DurableFileOperations = {
    mkdir,
    readFile,
    open: async (path, flags, mode) => {
      observe(`open:${flags}:${path}`, mode)
      const handle = await openFile(path, flags, mode)
      return {
        writeFile: async (content) => {
          observe(`write:${path}`)
          await handle.writeFile(content)
        },
        sync: async () => {
          observe(`sync:${path}`)
          // Windows cannot fsync directory handles. The production primitive
          // downgrades that native capability gap; retain injected faults above.
          if (process.platform === 'win32' && (await handle.stat()).isDirectory()) return
          await handle.sync()
        },
        close: async () => {
          // Close the real handle even for an injected close failure, so the
          // test models a reported close error without leaking descriptors.
          recorded.push({ event: `close:${path}` })
          const failure = options.fail?.(`close:${path}`)
          await handle.close()
          if (failure) throw failure
        }
      }
    },
    rename: async (from, to) => {
      observe(`rename:${from}->${to}`)
      await rename(from, to)
    },
    rm
  }
  return { operations, recorded }
}

async function lessonStyleFixture(
  label: string,
  operations: DurableFileOperations,
  durableWarn?: (message: string) => void
): Promise<LessonStyleFixture> {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  const registryPath = join(runtime.paths.appData, 'teaching-workspaces.json')
  const service = new TeachingWorkspaceService({
    registryPath,
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot),
    durableFileOperations: operations,
    durableWarn
  })
  const created = await service.createWorkspace({
    name: 'Durable Lesson Style',
    prompt: 'Initial lesson style prompt.'
  })
  const workspace = created.activeWorkspace
  if (!workspace) throw new Error('Expected created workspace.')
  const stylesheetPath = join(workspace.rootPath, 'assets/lesson.css')
  const ledgerPath = join(workspace.rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH)
  return {
    service,
    workspace,
    stylesheetPath,
    registryPath,
    ledgerPath,
    oldStylesheet: await readFile(stylesheetPath, 'utf8'),
    oldRegistry: await readFile(registryPath, 'utf8'),
    oldLedger: await readFile(ledgerPath, 'utf8')
  }
}

async function temporaryStylesheetCandidates(stylesheetPath: string): Promise<string[]> {
  const name = basename(stylesheetPath)
  return (await readdir(dirname(stylesheetPath)))
    .filter((entry) => entry.startsWith(`.${name}.`) && entry.endsWith('.tmp'))
}

async function expectNoStylePostPublishEffects(fixture: LessonStyleFixture): Promise<void> {
  await expect(readFile(fixture.ledgerPath, 'utf8')).resolves.toBe(fixture.oldLedger)
  await expect(readFile(fixture.registryPath, 'utf8')).resolves.toBe(fixture.oldRegistry)
}

function styleUpdate(fixture: LessonStyleFixture) {
  return fixture.service.applyLessonStyle({
    workspaceId: fixture.workspace.id,
    styleId: 'nightfall'
  })
}

function updatedStylesheet(fixture: LessonStyleFixture): string {
  return lessonStyleCss('nightfall')
}

describe('TeachingWorkspaceService durable assets/lesson.css publication', () => {
  it('durably publishes lesson.css before the lifecycle event and registry update', async () => {
    const fake = recordingOperations()
    const fixture = await lessonStyleFixture('lessonStyle-durable-success', fake.operations)

    const state = await styleUpdate(fixture)

    expect(await readFile(fixture.stylesheetPath, 'utf8')).toBe(updatedStylesheet(fixture))
    expect(state.activeWorkspace?.id).toBe(fixture.workspace.id)
    expect(await readFile(fixture.registryPath, 'utf8')).not.toBe(fixture.oldRegistry)
    const lifecycleEvents = (await readFile(fixture.ledgerPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const lessonStyleEvent = lifecycleEvents.findLast((event) => event.kind === 'lesson_style_applied')
    expect(lessonStyleEvent).toMatchObject({
      kind: 'lesson_style_applied',
      workspaceId: fixture.workspace.id,
      paths: ['assets/lesson.css'],
      meta: { styleId: 'nightfall' }
    })
    // C-4 adds durability only; this action does not gain C-5 correlation
    // identifiers or receipts.
    expect(lessonStyleEvent).not.toHaveProperty('traceId')
    expect(lessonStyleEvent).not.toHaveProperty('actionId')
    expect(lessonStyleEvent).not.toHaveProperty('receipt')

    const temporaryPath = fake.recorded.find(({ event }) => event.startsWith('open:wx:'))?.event.slice('open:wx:'.length)
    expect(temporaryPath).toBeDefined()
    const path = temporaryPath!
    const order = (event: string) => fake.recorded.findIndex((record) => record.event === event)
    const directoryPath = dirname(fixture.stylesheetPath)
    expect(order(`write:${path}`)).toBeLessThan(order(`sync:${path}`))
    expect(order(`sync:${path}`)).toBeLessThan(order(`close:${path}`))
    expect(order(`close:${path}`)).toBeLessThan(order(`rename:${path}->${fixture.stylesheetPath}`))
    expect(order(`rename:${path}->${fixture.stylesheetPath}`)).toBeLessThan(order(`sync:${directoryPath}`))
    expect(order(`sync:${directoryPath}`)).toBeLessThan(order(`close:${directoryPath}`))
    expect(fake.recorded).toContainEqual({ event: `open:wx:${path}`, mode: 0o666 })
    expect((await stat(fixture.stylesheetPath)).mode & 0o777).toBe(0o666 & ~process.umask() & 0o777)
    await expect(temporaryStylesheetCandidates(fixture.stylesheetPath)).resolves.toEqual([])
  })

  it.each([
    ['write', (event: string) => event.startsWith('write:') && event.includes('.lesson.css.')],
    ['file sync', (event: string) => event.startsWith('sync:') && event.includes('.lesson.css.')],
    ['file close', (event: string) => event.startsWith('close:') && event.includes('.lesson.css.')],
    ['rename', (event: string, fixture: LessonStyleFixture) => event.startsWith('rename:') && event.endsWith(`->${fixture.stylesheetPath}`)]
  ])('fails closed before publication when %s fails', async (_name, matches) => {
    let failureMatcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
    const fixture = await lessonStyleFixture(`lessonStyle-durable-pre-${_name}`, fake.operations)
    const failure = errno('EIO')
    failureMatcher = (event) => matches(event, fixture) ? failure : undefined

    await expect(styleUpdate(fixture)).rejects.toBe(failure)
    await expect(readFile(fixture.stylesheetPath, 'utf8')).resolves.toBe(fixture.oldStylesheet)
    await expect(temporaryStylesheetCandidates(fixture.stylesheetPath)).resolves.toEqual([])
    await expectNoStylePostPublishEffects(fixture)
  })

  it.each([
    ['EIO', errno('EIO')],
    ['EACCES', errno('EACCES')],
    ['unknown error', new Error('unexpected directory failure')]
  ])('does not downgrade directory fsync %s or append lifecycle/registry effects', async (_name, failure) => {
    let failureMatcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
    const fixture = await lessonStyleFixture(`lessonStyle-durable-dir-sync-${_name}`, fake.operations)
    failureMatcher = (event) => event === `sync:${dirname(fixture.stylesheetPath)}` ? failure : undefined

    await expect(styleUpdate(fixture)).rejects.toBe(failure)
    // Rename precedes directory fsync. The complete new stylesheet remains, but
    // the caller does not receive success and no post-publish side effects run.
    await expect(readFile(fixture.stylesheetPath, 'utf8')).resolves.toBe(updatedStylesheet(fixture))
    await expect(temporaryStylesheetCandidates(fixture.stylesheetPath)).resolves.toEqual([])
    await expectNoStylePostPublishEffects(fixture)
  })

  it('fails closed after rename when closing the directory fails', async () => {
    let failureMatcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
    const fixture = await lessonStyleFixture('lessonStyle-durable-dir-close', fake.operations)
    const failure = errno('EIO')
    failureMatcher = (event) => event === `close:${dirname(fixture.stylesheetPath)}` ? failure : undefined

    await expect(styleUpdate(fixture)).rejects.toBe(failure)
    await expect(readFile(fixture.stylesheetPath, 'utf8')).resolves.toBe(updatedStylesheet(fixture))
    await expect(temporaryStylesheetCandidates(fixture.stylesheetPath)).resolves.toEqual([])
    await expectNoStylePostPublishEffects(fixture)
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'permits only the shared directory-fsync capability downgrade (%s)',
    async (code) => {
      let failureMatcher: (event: string) => Error | undefined = () => undefined
      const warnings: string[] = []
      const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
      const fixture = await lessonStyleFixture(`lessonStyle-durable-allowlist-${code}`, fake.operations, (message) => warnings.push(message))
      failureMatcher = (event) => event === `sync:${dirname(fixture.stylesheetPath)}` ? errno(code) : undefined

      await expect(styleUpdate(fixture)).resolves.toMatchObject({
        activeWorkspace: { id: fixture.workspace.id }
      })
      await expect(readFile(fixture.stylesheetPath, 'utf8')).resolves.toBe(updatedStylesheet(fixture))
      expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
      expect(warnings[0]).not.toContain(dirname(fixture.stylesheetPath))
      await expect(temporaryStylesheetCandidates(fixture.stylesheetPath)).resolves.toEqual([])
    }
  )
})

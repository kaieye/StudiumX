import { mkdir, open as openFile, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import {
  deriveWorkspaceTopic,
  renderMission,
  WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH
} from '../../src/main/teaching-workspace/lifecycle'
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

type MissionFixture = {
  service: TeachingWorkspaceService
  workspace: NonNullable<Awaited<ReturnType<TeachingWorkspaceService['createWorkspace']>>['activeWorkspace']>
  missionPath: string
  registryPath: string
  ledgerPath: string
  oldMission: string
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

async function missionFixture(
  label: string,
  operations: DurableFileOperations,
  durableWarn?: (message: string) => void
): Promise<MissionFixture> {
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
    name: 'Durable Mission',
    prompt: 'Initial mission prompt.'
  })
  const workspace = created.activeWorkspace
  if (!workspace) throw new Error('Expected created workspace.')
  const missionPath = join(workspace.rootPath, 'MISSION.md')
  const ledgerPath = join(workspace.rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH)
  return {
    service,
    workspace,
    missionPath,
    registryPath,
    ledgerPath,
    oldMission: await readFile(missionPath, 'utf8'),
    oldRegistry: await readFile(registryPath, 'utf8'),
    oldLedger: await readFile(ledgerPath, 'utf8')
  }
}

async function temporaryMissionCandidates(missionPath: string): Promise<string[]> {
  const name = basename(missionPath)
  return (await readdir(dirname(missionPath)))
    .filter((entry) => entry.startsWith(`.${name}.`) && entry.endsWith('.tmp'))
}

async function expectNoMissionPostPublishEffects(fixture: MissionFixture): Promise<void> {
  await expect(readFile(fixture.ledgerPath, 'utf8')).resolves.toBe(fixture.oldLedger)
  await expect(readFile(fixture.registryPath, 'utf8')).resolves.toBe(fixture.oldRegistry)
}

function missionActionId(label = 'mission'): string {
  // Deterministic-looking but valid UUID v4-shaped id for focused tests.
  const hex = Buffer.from(label.padEnd(16, '0').slice(0, 16)).toString('hex').slice(0, 12)
  return `aaaaaaaa-bbbb-4ccc-8ddd-${hex.padEnd(12, '0')}`
}

function missionUpdate(fixture: MissionFixture, actionId = missionActionId()) {
  return fixture.service.updateMission({
    workspaceId: fixture.workspace.id,
    prompt: 'Teach durable canonical mission publication.',
    actionId
  })
}

function updatedMission(fixture: MissionFixture): string {
  const prompt = 'Teach durable canonical mission publication.'
  return renderMission(deriveWorkspaceTopic(prompt, fixture.workspace.name), prompt)
}

describe('TeachingWorkspaceService durable MISSION.md publication', () => {
  it('durably publishes the rendered mission before the lifecycle event and registry update', async () => {
    const fake = recordingOperations()
    const fixture = await missionFixture('mission-durable-success', fake.operations)

    const result = await missionUpdate(fixture)
    expect(result.disposition).toBe('completed')
    if (result.disposition !== 'completed' && result.disposition !== 'reused') {
      throw new Error('expected success disposition')
    }
    const state = result.state

    expect(await readFile(fixture.missionPath, 'utf8')).toBe(updatedMission(fixture))
    expect(state.activeWorkspace?.id).toBe(fixture.workspace.id)
    expect(await readFile(fixture.registryPath, 'utf8')).not.toBe(fixture.oldRegistry)
    const lifecycleEvents = (await readFile(fixture.ledgerPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const missionEvent = lifecycleEvents.findLast((event) => event.kind === 'mission_updated')
    expect(missionEvent).toMatchObject({
      kind: 'mission_updated',
      workspaceId: fixture.workspace.id,
      prompt: 'Teach durable canonical mission publication.',
      paths: ['MISSION.md']
    })
    // C-5H extends mission_updated with main-owned diagnostic trace only.
    // actionId remains private to the receipt and must never enter JSONL.
    expect(missionEvent).toHaveProperty('traceId')
    expect(typeof missionEvent?.traceId).toBe('string')
    expect(missionEvent).not.toHaveProperty('actionId')

    const temporaryPath = fake.recorded.find(({ event }) =>
      event.startsWith('open:wx:') && event.includes('.MISSION.md.')
    )?.event.slice('open:wx:'.length)
    expect(temporaryPath).toBeDefined()
    const path = temporaryPath!
    const order = (event: string) => fake.recorded.findIndex((record) => record.event === event)
    const directoryPath = fixture.workspace.rootPath
    expect(order(`write:${path}`)).toBeLessThan(order(`sync:${path}`))
    expect(order(`sync:${path}`)).toBeLessThan(order(`close:${path}`))
    expect(order(`close:${path}`)).toBeLessThan(order(`rename:${path}->${fixture.missionPath}`))
    expect(order(`rename:${path}->${fixture.missionPath}`)).toBeLessThan(order(`sync:${directoryPath}`))
    expect(order(`sync:${directoryPath}`)).toBeLessThan(order(`close:${directoryPath}`))
    expect(fake.recorded).toContainEqual({ event: `open:wx:${path}`, mode: 0o666 })
    expect((await stat(fixture.missionPath)).mode & 0o777).toBe(0o666 & ~process.umask() & 0o777)
    await expect(temporaryMissionCandidates(fixture.missionPath)).resolves.toEqual([])
  })

  it.each([
    ['write', (event: string) => event.startsWith('write:') && event.includes('.MISSION.md.')],
    ['file sync', (event: string) => event.startsWith('sync:') && event.includes('.MISSION.md.')],
    ['file close', (event: string) => event.startsWith('close:') && event.includes('.MISSION.md.')],
    ['rename', (event: string, fixture: MissionFixture) => event.startsWith('rename:') && event.endsWith(`->${fixture.missionPath}`)]
  ])('fails closed before publication when %s fails', async (_name, matches) => {
    let failureMatcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
    const fixture = await missionFixture(`mission-durable-pre-${_name}`, fake.operations)
    const failure = errno('EIO')
    failureMatcher = (event) => matches(event, fixture) ? failure : undefined

    await expect(missionUpdate(fixture)).rejects.toBe(failure)
    await expect(readFile(fixture.missionPath, 'utf8')).resolves.toBe(fixture.oldMission)
    await expect(temporaryMissionCandidates(fixture.missionPath)).resolves.toEqual([])
    await expectNoMissionPostPublishEffects(fixture)
  })

  it.each([
    ['EIO', errno('EIO')],
    ['EACCES', errno('EACCES')],
    ['unknown error', new Error('unexpected directory failure')]
  ])('does not downgrade directory fsync %s or append lifecycle/registry effects', async (_name, failure) => {
    let failureMatcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
    const fixture = await missionFixture(`mission-durable-dir-sync-${_name}`, fake.operations)
    failureMatcher = (event) => event === `sync:${fixture.workspace.rootPath}` ? failure : undefined

    await expect(missionUpdate(fixture)).rejects.toBe(failure)
    // Rename precedes directory fsync. The complete new MISSION remains, but
    // the caller does not receive success and no post-publish side effects run.
    await expect(readFile(fixture.missionPath, 'utf8')).resolves.toBe(updatedMission(fixture))
    await expect(temporaryMissionCandidates(fixture.missionPath)).resolves.toEqual([])
    await expectNoMissionPostPublishEffects(fixture)
  })

  it('fails closed after rename when closing the directory fails', async () => {
    let failureMatcher: (event: string) => Error | undefined = () => undefined
    const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
    const fixture = await missionFixture('mission-durable-dir-close', fake.operations)
    const failure = errno('EIO')
    failureMatcher = (event) => event === `close:${fixture.workspace.rootPath}` ? failure : undefined

    await expect(missionUpdate(fixture)).rejects.toBe(failure)
    await expect(readFile(fixture.missionPath, 'utf8')).resolves.toBe(updatedMission(fixture))
    await expect(temporaryMissionCandidates(fixture.missionPath)).resolves.toEqual([])
    await expectNoMissionPostPublishEffects(fixture)
  })

  it.each(['EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'])(
    'permits only the shared directory-fsync capability downgrade (%s)',
    async (code) => {
      let failureMatcher: (event: string) => Error | undefined = () => undefined
      const warnings: string[] = []
      const fake = recordingOperations({ fail: (event) => failureMatcher(event) })
      const fixture = await missionFixture(`mission-durable-allowlist-${code}`, fake.operations, (message) => warnings.push(message))
      failureMatcher = (event) => event === `sync:${fixture.workspace.rootPath}` ? errno(code) : undefined

      await expect(missionUpdate(fixture)).resolves.toMatchObject({
        disposition: 'completed',
        state: { activeWorkspace: { id: fixture.workspace.id } }
      })
      await expect(readFile(fixture.missionPath, 'utf8')).resolves.toBe(updatedMission(fixture))
      expect(warnings).toEqual([DIRECTORY_FSYNC_WARNING])
      expect(warnings[0]).not.toContain(fixture.workspace.rootPath)
      await expect(temporaryMissionCandidates(fixture.missionPath)).resolves.toEqual([])
    }
  )
})

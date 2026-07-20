import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open as openFile, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import {
  computeMissionRequestTag,
  loadOrCreateMissionActionBindingKey,
  missionActionReceiptPath,
  MISSION_ACTION_RECEIPT_DIR_RELATIVE,
  parseMissionActionReceipt,
  readMissionActionReceipt,
  writeMissionActionReceipt
} from '../../src/main/teaching-workspace/mission-action-receipt'
import {
  deriveWorkspaceTopic,
  renderMission,
  WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH
} from '../../src/main/teaching-workspace/lifecycle'
import { parseUpdateMissionPayload } from '../../src/main/teaching-ipc-commands'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

type RecordingDurableOperations = {
  operations: DurableFileOperations
  recorded: string[]
  counts: () => { missionWrites: number; receiptWrites: number; registryWrites: number }
}

function recordingOperations(): RecordingDurableOperations {
  const recorded: string[] = []
  const operations: DurableFileOperations = {
    mkdir,
    readFile,
    open: async (path, flags, mode) => {
      recorded.push(`open:${flags}:${path}`)
      const handle = await openFile(path, flags, mode)
      return {
        writeFile: async (content) => {
          recorded.push(`write:${path}`)
          await handle.writeFile(content)
        },
        sync: async () => {
          recorded.push(`sync:${path}`)
          if (process.platform === 'win32' && (await handle.stat()).isDirectory()) return
          await handle.sync()
        },
        close: async () => {
          recorded.push(`close:${path}`)
          await handle.close()
        }
      }
    },
    rename: async (from, to) => {
      recorded.push(`rename:${from}->${to}`)
      await rename(from, to)
    },
    rm
  }
  return {
    operations,
    recorded,
    counts: () => ({
      missionWrites: recorded.filter((event) => event.startsWith('write:') && event.includes('.MISSION.md.')).length,
      receiptWrites: recorded.filter((event) => event.startsWith('write:') && event.includes('.studiumx/mission-actions/')).length
        + recorded.filter((event) => event.startsWith('write:') && event.includes(`${MISSION_ACTION_RECEIPT_DIR_RELATIVE}/`)).length,
      registryWrites: recorded.filter((event) => event.startsWith('write:') && event.includes('teaching-workspaces')).length
    })
  }
}

async function createService(label: string, operations?: DurableFileOperations) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  const registryPath = join(runtime.paths.appData, 'teaching-workspaces.json')
  const service = new TeachingWorkspaceService({
    registryPath,
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot),
    durableFileOperations: operations
  })
  const created = await service.createWorkspace({
    name: 'Mission Action',
    prompt: 'Initial mission prompt for correlation.'
  })
  const workspace = created.activeWorkspace
  if (!workspace) throw new Error('Expected workspace')
  return {
    service,
    workspace,
    registryPath,
    missionPath: join(workspace.rootPath, 'MISSION.md'),
    ledgerPath: join(workspace.rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH),
    appDataRoot: runtime.paths.appData
  }
}

function lifecycleEvents(raw: string): Array<Record<string, unknown>> {
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('parseUpdateMissionPayload actionId contract', () => {
  it('accepts exact workspaceId/prompt/actionId payloads', () => {
    const actionId = randomUUID()
    expect(
      parseUpdateMissionPayload({
        workspaceId: 'ws-1',
        prompt: 'Learn durable mission actions.',
        actionId
      })
    ).toEqual({
      workspaceId: 'ws-1',
      prompt: 'Learn durable mission actions.',
      actionId: actionId.toLowerCase()
    })
  })

  it('rejects missing, extra, or non-UUID actionId fields without side effects', () => {
    expect(() => parseUpdateMissionPayload({ workspaceId: 'ws-1', prompt: 'x' })).toThrow(/actionId/)
    expect(() =>
      parseUpdateMissionPayload({
        workspaceId: 'ws-1',
        prompt: 'x',
        actionId: randomUUID(),
        extra: true
      })
    ).toThrow(/only/)
    expect(() =>
      parseUpdateMissionPayload({
        workspaceId: 'ws-1',
        prompt: 'x',
        actionId: 'not-a-uuid'
      })
    ).toThrow(/UUID/)
  })
})

describe('mission action request binding privacy', () => {
  it('stores only irreversible request tags and never embeds the raw prompt', async () => {
    const runtime = await runtimeScope.create('mission-binding-privacy')
    const key = await loadOrCreateMissionActionBindingKey({ appDataRoot: runtime.paths.appData })
    const prompt = 'SECRET_PROMPT_VALUE_SHOULD_NOT_LEAK'
    const actionId = randomUUID()
    const tag = computeMissionRequestTag({
      bindingKey: key,
      workspaceId: 'workspace-privacy',
      actionId,
      prompt
    })
    expect(tag).toMatch(/^[0-9a-f]{64}$/)
    expect(tag).not.toContain('SECRET')
    expect(tag).not.toBe(createHash('sha256').update(prompt).digest('hex'))

    const receiptPath = missionActionReceiptPath(runtime.paths.workspace, actionId)
    await writeMissionActionReceipt({
      workspaceRoot: runtime.paths.workspace,
      receipt: {
        schemaVersion: 1,
        kind: 'mission_update',
        workspaceId: 'workspace-privacy',
        actionId,
        traceId: randomUUID(),
        eventId: randomUUID(),
        phase: 'final',
        requestTag: tag,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z'
      }
    })
    const raw = await readFile(receiptPath, 'utf8')
    expect(raw).not.toContain(prompt)
    expect(raw).not.toContain('SECRET_PROMPT')
    expect(raw).toContain(tag)
    const parsed = parseMissionActionReceipt(raw)
    expect(parsed.status).toBe('valid')
  })
})

describe('TeachingWorkspaceService mission_update action/receipt', () => {
  it('completes a mission update and reuses the same actionId without second participant writes', async () => {
    const fake = recordingOperations()
    const fixture = await createService('mission-action-reuse', fake.operations)
    const actionId = randomUUID()
    const prompt = 'Teach mission action exact retry.'

    const first = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt,
      actionId
    })
    expect(first.disposition).toBe('completed')
    if (first.disposition !== 'completed') throw new Error('expected completed')

    const afterFirst = {
      mission: await readFile(fixture.missionPath, 'utf8'),
      ledger: await readFile(fixture.ledgerPath, 'utf8'),
      registry: await readFile(fixture.registryPath, 'utf8'),
      counts: fake.counts()
    }
    expect(afterFirst.mission).toBe(
      renderMission(deriveWorkspaceTopic(prompt, fixture.workspace.name), prompt)
    )
    const events = lifecycleEvents(afterFirst.ledger).filter((event) => event.kind === 'mission_updated')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      workspaceId: fixture.workspace.id,
      prompt,
      paths: ['MISSION.md']
    })
    expect(events[0]).toHaveProperty('traceId')
    expect(events[0]).not.toHaveProperty('actionId')

    const receipt = await readMissionActionReceipt({
      workspaceRoot: fixture.workspace.rootPath,
      actionId
    })
    expect(receipt).toMatchObject({ status: 'valid', receipt: { phase: 'final', actionId } })
    const receiptRaw = await readFile(
      missionActionReceiptPath(fixture.workspace.rootPath, actionId),
      'utf8'
    )
    expect(receiptRaw).not.toContain(prompt)

    const baseline = fake.recorded.length
    const second = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt,
      actionId
    })
    expect(second.disposition).toBe('reused')
    if (second.disposition !== 'reused') throw new Error('expected reused')
    expect(second.state.activeWorkspace?.id).toBe(fixture.workspace.id)

    expect(await readFile(fixture.missionPath, 'utf8')).toBe(afterFirst.mission)
    expect(await readFile(fixture.ledgerPath, 'utf8')).toBe(afterFirst.ledger)
    // Registry may be reread for fresh state assembly, but durable replace of
    // mission/receipt must not run again for a final receipt.
    const postReuseWrites = fake.recorded.slice(baseline).filter((event) => event.startsWith('write:'))
    expect(postReuseWrites.filter((event) => event.includes('.MISSION.md.'))).toEqual([])
    expect(postReuseWrites.filter((event) => event.includes('mission-actions'))).toEqual([])
    expect(lifecycleEvents(await readFile(fixture.ledgerPath, 'utf8')).filter((e) => e.kind === 'mission_updated')).toHaveLength(1)
  })

  it('treats different actionIds with the same prompt as independent actions', async () => {
    const fixture = await createService('mission-action-no-content-dedupe')
    const prompt = 'Same prompt, different user actions.'
    const first = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt,
      actionId: randomUUID()
    })
    const second = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt,
      actionId: randomUUID()
    })
    expect(first.disposition).toBe('completed')
    expect(second.disposition).toBe('completed')
    const missionEvents = lifecycleEvents(await readFile(fixture.ledgerPath, 'utf8'))
      .filter((event) => event.kind === 'mission_updated')
    // createWorkspace may not write mission_updated; only our two updates should.
    expect(missionEvents.length).toBeGreaterThanOrEqual(2)
    expect(missionEvents.at(-2)?.prompt).toBe(prompt)
    expect(missionEvents.at(-1)?.prompt).toBe(prompt)
    expect(missionEvents.at(-2)?.id).not.toBe(missionEvents.at(-1)?.id)
    expect(missionEvents.at(-2)?.traceId).not.toBe(missionEvents.at(-1)?.traceId)
  })

  it('fails closed with conflict when the same actionId is retried with a different prompt', async () => {
    const fixture = await createService('mission-action-payload-conflict')
    const actionId = randomUUID()
    const first = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt: 'Original bound prompt.',
      actionId
    })
    expect(first.disposition).toBe('completed')
    const missionBefore = await readFile(fixture.missionPath, 'utf8')
    const ledgerBefore = await readFile(fixture.ledgerPath, 'utf8')

    const conflicted = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt: 'Changed prompt for same action id.',
      actionId
    })
    expect(conflicted).toEqual({ disposition: 'conflict', retryable: false })
    expect(await readFile(fixture.missionPath, 'utf8')).toBe(missionBefore)
    expect(await readFile(fixture.ledgerPath, 'utf8')).toBe(ledgerBefore)
  })

  it('fails closed with indeterminate when the receipt is missing after a non-final partial state is simulated via corrupt receipt', async () => {
    const fixture = await createService('mission-action-corrupt-receipt')
    const actionId = randomUUID()
    const completed = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt: 'Prompt before corruption.',
      actionId
    })
    expect(completed.disposition).toBe('completed')
    const receiptPath = missionActionReceiptPath(fixture.workspace.rootPath, actionId)
    await writeFile(receiptPath, '{not-json', 'utf8')
    const missionBefore = await readFile(fixture.missionPath, 'utf8')
    const ledgerBefore = await readFile(fixture.ledgerPath, 'utf8')

    const result = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt: 'Prompt before corruption.',
      actionId
    })
    expect(result).toEqual({ disposition: 'indeterminate', retryable: false })
    expect(await readFile(fixture.missionPath, 'utf8')).toBe(missionBefore)
    expect(await readFile(fixture.ledgerPath, 'utf8')).toBe(ledgerBefore)
  })

  it('fails closed with indeterminate for a non-final receipt without auto-continuing participants', async () => {
    const fixture = await createService('mission-action-nonfinal')
    const actionId = randomUUID()
    const bindingKey = await loadOrCreateMissionActionBindingKey({
      appDataRoot: fixture.appDataRoot
    })
    const prompt = 'Prepared only, never finalized.'
    const requestTag = computeMissionRequestTag({
      bindingKey,
      workspaceId: fixture.workspace.id,
      actionId,
      prompt
    })
    await writeMissionActionReceipt({
      workspaceRoot: fixture.workspace.rootPath,
      receipt: {
        schemaVersion: 1,
        kind: 'mission_update',
        workspaceId: fixture.workspace.id,
        actionId,
        traceId: randomUUID(),
        eventId: randomUUID(),
        phase: 'prepared',
        requestTag,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z'
      }
    })
    const missionBefore = await readFile(fixture.missionPath, 'utf8')
    const ledgerBefore = await readFile(fixture.ledgerPath, 'utf8')
    const registryBefore = await readFile(fixture.registryPath, 'utf8')

    const result = await fixture.service.updateMission({
      workspaceId: fixture.workspace.id,
      prompt,
      actionId
    })
    expect(result).toEqual({ disposition: 'indeterminate', retryable: false })
    expect(await readFile(fixture.missionPath, 'utf8')).toBe(missionBefore)
    expect(await readFile(fixture.ledgerPath, 'utf8')).toBe(ledgerBefore)
    expect(await readFile(fixture.registryPath, 'utf8')).toBe(registryBefore)
  })

  it('rejects invalid receipt schemas that include forbidden prompt fields', () => {
    const parsed = parseMissionActionReceipt(JSON.stringify({
      schemaVersion: 1,
      kind: 'mission_update',
      workspaceId: 'ws',
      actionId: randomUUID(),
      traceId: randomUUID(),
      eventId: randomUUID(),
      phase: 'final',
      requestTag: 'a'.repeat(64),
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      prompt: 'leaky'
    }))
    expect(parsed.status).toBe('invalid')
  })
})

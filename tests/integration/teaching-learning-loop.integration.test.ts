import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLearningAssetCatalog } from '../../src/main/teaching-workspace/learning-assets-catalog'
import { buildTeachingTurnPresentation, consumeTeachingTurnAnnouncement } from '../../src/renderer/src/teaching-turn-presentation'

const gatewayIpc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'D:/test-app-data') },
  BrowserWindow: { getFocusedWindow: vi.fn(), fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: {
    handlers: gatewayIpc.handlers,
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      gatewayIpc.handlers.set(channel, handler)
    }
  },
  Notification: { isSupported: vi.fn(() => false) },
  shell: { openPath: vi.fn(), openExternal: vi.fn() }
}))

import { createGoldenTeachingLoopHarness, type GoldenTeachingLoopHarness } from '../fixtures/teaching-learning-loop/harness'

const harnesses: GoldenTeachingLoopHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()))
})

describe('P0-R6 deterministic offline Golden teaching loop', () => {
  it('settles a fixed session through real evidence, IPC, catalog, grounding, and learner presentation without duplicate facts', async () => {
    const harness = await createGoldenTeachingLoopHarness()
    harnesses.push(harness)

    const preview = await harness.openPreviewThroughIpc()
    expect(preview.sessionId).toBe('session-golden-001')

    const wrong = await harness.submitWrongEvidenceThroughIpc()
    const wrongReplay = await harness.submitWrongEvidenceThroughIpc()
    expect(wrong).toMatchObject({ eventId: 'evidence-golden-wrong-001', duplicate: false })
    expect(wrongReplay).toMatchObject({ eventId: 'evidence-golden-wrong-001', duplicate: true })

    const needsPractice = await harness.commitThroughIpc('operation-golden-needs-practice-001')
    expect(needsPractice).toEqual({ status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false })
    const practiceRecords = await readdir(join(harness.root, 'learning-records')).catch(() => [] as string[])
    expect(practiceRecords.filter((file) => file.endsWith('.md'))).toEqual([])
    expect(harness.planFor(needsPractice)).toMatchObject({ action: 'contrast_and_retry', reason: 'needs_practice' })

    const corrected = await harness.submitCorrectedEvidenceThroughIpc()
    const correctedReplay = await harness.submitCorrectedEvidenceThroughIpc()
    expect(corrected).toMatchObject({ eventId: 'evidence-golden-corrected-002', duplicate: false })
    expect(correctedReplay).toMatchObject({ eventId: 'evidence-golden-corrected-002', duplicate: true })

    const saved = await harness.commitThroughIpc('operation-golden-correction-002')
    expect(saved).toEqual({ status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true })
    await expect(harness.commitThroughIpc('operation-golden-correction-002')).resolves.toEqual({
      status: 'already_committed',
      outcome: { kind: 'misconception_corrected' },
      recordSaved: true
    })

    const canonical = await harness.readCanonical()
    expect(canonical.session).toMatchObject({ id: 'session-golden-001', status: 'completed' })
    expect(canonical.outcome).toMatchObject({
      kind: 'misconception_corrected',
      evidenceEventIds: ['evidence-golden-corrected-002', 'evidence-golden-wrong-001']
    })
    expect(canonical.records).toHaveLength(1)
    expect(canonical.records[0]).toContain('evidence-golden-corrected-002')

    const catalog = await readLearningAssetCatalog(harness.root, 'Golden Teaching Workspace')
    expect(catalog.records).toHaveLength(1)

    const next = await harness.publishGroundedNextLesson(saved)
    expect(next.decision).toMatchObject({
      action: 'continue_next_session',
      reason: 'misconception_corrected_with_next_goal'
    })
    expect(next.context.grounding.sources.map((source) => source.sourceId)).toEqual([
      'source-golden-foundation',
      'source-golden-practice'
    ])
    expect(next.lessonGroundingSourceId).toBe(next.context.grounding.sources[0]?.sourceId)
    await expect(readFile(next.lessonPath, 'utf8')).resolves.toContain(next.lessonGroundingSourceId)

    const presentation = buildTeachingTurnPresentation(harness.presentationSnapshot(saved, next))
    expect(presentation.activePhaseId).toBe('save_continue')
    expect(presentation.action).toEqual({ kind: 'continue', label: '继续下一步' })
    const firstAnnouncement = consumeTeachingTurnAnnouncement(presentation, [])
    expect(firstAnnouncement.announcement).not.toBeNull()
    expect(consumeTeachingTurnAnnouncement(presentation, firstAnnouncement.emittedIds).announcement).toBeNull()
    expect(JSON.stringify(presentation)).not.toMatch(/private|prompt|answer|provider|secret|[a-f0-9]{64}/i)
  })

  it('Crash A repairs exactly one published record after artifact rename before catalog reconciliation', async () => {
    const harness = await createGoldenTeachingLoopHarness({ fault: 'before_catalog_reconcile' })
    harnesses.push(harness)
    await harness.submitWrongEvidenceThroughIpc()
    await harness.commitThroughIpc('operation-crash-a-needs-practice')
    await harness.submitCorrectedEvidenceThroughIpc()

    await expect(harness.commitThroughIpc('operation-crash-a-correction')).resolves.toEqual({
      status: 'retryable_failure',
      reason: 'reconciliation_required'
    })
    expect((await harness.readCanonical()).records).toHaveLength(1)

    const restarted = await harness.restartWithoutFault()
    harnesses.push(restarted)
    const repair = await restarted.readRepair('session-golden-001')
    expect(repair).toMatchObject({ state: 'settled', catalogRecordPresent: true })
    expect((await restarted.readCanonical()).records).toHaveLength(1)
    expect((await readLearningAssetCatalog(restarted.root, 'Golden Teaching Workspace')).records).toHaveLength(1)
    expect(buildTeachingTurnPresentation(restarted.recoveredPresentationSnapshot()).announcement).toBeTruthy()
  })

  it('Crash B leaves no half-published outcome or completed UI and permits safe retry after stage write', async () => {
    const harness = await createGoldenTeachingLoopHarness({ fault: 'after_stage_flush' })
    harnesses.push(harness)
    await harness.submitWrongEvidenceThroughIpc()
    await harness.commitThroughIpc('operation-crash-b-needs-practice')
    await harness.submitCorrectedEvidenceThroughIpc()

    await expect(harness.commitThroughIpc('operation-crash-b-correction')).resolves.toEqual({
      status: 'retryable_failure',
      reason: 'reconciliation_required'
    })
    const incomplete = await harness.readCanonical()
    expect(incomplete.records).toHaveLength(0)
    expect(incomplete.outcome).toBeNull()
    expect(incomplete.session).toMatchObject({ status: 'active' })
    expect(buildTeachingTurnPresentation(harness.incompletePresentationSnapshot()).announcement).toBeNull()

    const restarted = await harness.restartWithoutFault()
    harnesses.push(restarted)
    await expect(restarted.commitThroughIpc('operation-crash-b-correction')).resolves.toEqual({
      status: 'committed',
      outcome: { kind: 'misconception_corrected' },
      recordSaved: true
    })
    expect((await restarted.readCanonical()).records).toHaveLength(1)
  })
})

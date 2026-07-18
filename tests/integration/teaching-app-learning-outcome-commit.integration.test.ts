import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import {
  createLearningOutcomeCommitClient,
  recordPreviewLessonInteractionAndMaybeCommit
} from '../../src/renderer/src/teaching/learning-outcome-commit-client'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

async function createService(label: string) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  return new TeachingWorkspaceService({
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot)
  })
}

function activatePreviewLesson(service: TeachingWorkspaceService, webContentsId: number, url: string): void {
  service.observePreviewLessonNavigation(webContentsId, {
    url,
    isMainFrame: false,
    isSameDocument: false,
    frameProcessId: webContentsId,
    frameRoutingId: webContentsId + 1000
  })
}

async function countLearningRecords(workspaceRoot: string): Promise<number> {
  const entries = await readdir(join(workspaceRoot, 'learning-records')).catch(() => [] as string[])
  return entries.filter((name) => name.endsWith('.md')).length
}

describe('production App learning-outcome commit cutover (TeachingWorkspaceService sole writer)', () => {
  it('records wrong then corrected evidence through the App helper and proves sole-writer record counts', async () => {
    const service = await createService('app-commit-cutover')
    const created = await service.createWorkspace({
      name: 'App commit cutover',
      prompt: 'Teach a trustworthy quiz correction loop.'
    })
    const workspace = created.activeWorkspace!
    const generated = await service.generateLesson({
      workspaceId: workspace.id,
      prompt: 'Explain the difference between a fact and an inference.',
      messages: []
    })
    const lesson = generated.lesson
    const senderId = 901

    const preview = await service.readLesson(
      { workspaceId: workspace.id, lessonPath: lesson.relativePath },
      senderId
    )
    activatePreviewLesson(service, senderId, preview.url)

    const api = {
      recordPreviewLessonInteraction: (intent: Parameters<TeachingWorkspaceService['recordPreviewLessonInteraction']>[1]) =>
        service.recordPreviewLessonInteraction(senderId, intent),
      commitLearningOutcome: (request: Parameters<TeachingWorkspaceService['commitLearningOutcome']>[0]) =>
        service.commitLearningOutcome(request)
    }
    const client = createLearningOutcomeCommitClient({
      commitLearningOutcome: api.commitLearningOutcome
    })
    client.setLessonScope(`${workspace.id}:${lesson.relativePath}`)

    const wrong = await recordPreviewLessonInteractionAndMaybeCommit({
      api,
      workspaceId: workspace.id,
      client,
      intent: {
        eventId: 'app-commit-wrong-001',
        kind: 'quiz_answered',
        itemId: 'quiz-1',
        selectedOptionIds: ['a'],
        correct: false
      }
    })
    expect(wrong.receipt).toMatchObject({
      eventId: 'app-commit-wrong-001',
      sessionId: lesson.sessionId,
      duplicate: false
    })
    expect(wrong.commitStatus).toMatchObject({
      kind: 'needs_practice',
      recordSaved: false,
      announcement: null,
      operationId: `outcome-seq-${wrong.receipt!.sequence}`
    })
    expect(await countLearningRecords(workspace.rootPath)).toBe(0)

    const corrected = await recordPreviewLessonInteractionAndMaybeCommit({
      api,
      workspaceId: workspace.id,
      client,
      intent: {
        eventId: 'app-commit-corrected-002',
        kind: 'quiz_answered',
        itemId: 'quiz-1',
        selectedOptionIds: ['b'],
        correct: false
      }
    })
    expect(corrected.receipt).toMatchObject({
      eventId: 'app-commit-corrected-002',
      sessionId: lesson.sessionId,
      duplicate: false
    })
    expect(corrected.commitStatus).toMatchObject({
      kind: 'saved',
      recordSaved: true,
      outcomeKind: 'misconception_corrected',
      operationId: `outcome-seq-${corrected.receipt!.sequence}`
    })
    expect(corrected.commitStatus.kind === 'saved' ? corrected.commitStatus.announcement : null).toMatchObject({
      id: `saved:outcome-seq-${corrected.receipt!.sequence}`
    })
    expect(await countLearningRecords(workspace.rootPath)).toBe(1)

    // After a mastery commit the Session is completed, so re-recording evidence is
    // no longer accepted by the trusted binding. Same-op commit replay still goes
    // through the sole writer without creating another learning-record.
    const replay = await client.commitAfterEvidence({
      workspaceId: workspace.id,
      sessionId: lesson.sessionId,
      evidenceSequence: corrected.receipt!.sequence,
      eventId: 'app-commit-corrected-002',
      intentKind: 'quiz_answered'
    })
    expect(replay).toMatchObject({
      kind: 'already_committed',
      recordSaved: true,
      announcement: null,
      operationId: `outcome-seq-${corrected.receipt!.sequence}`
    })
    expect(await countLearningRecords(workspace.rootPath)).toBe(1)
    expect(client.getEmittedAnnouncementIds()).toEqual([
      `saved:outcome-seq-${corrected.receipt!.sequence}`
    ])
  })
})
